// =============================================================================
//  GridPathPuzzle.js  —  the PUBLIC FACADE (the only file a host imports)
// =============================================================================
//
//  A reusable, dependency-free, DOM/SVG mini-game: drag a path from START to
//  GOAL across a grid; nodes you pass through grant benefits or apply penalties;
//  reaching GOAL "executes" and emits a result. The host supplies a `nodeTypes`
//  catalog (what each node MEANS) and an optional level/generator; this class
//  owns the grid, the drawing interaction, the rules, the timer, and events.
//
//  See the README in this folder for the full API. Quick start:
//      const game = new GridPathPuzzle({ mount, nodeTypes, generate: { size: 8 } });
//      game.on('complete', r => console.log(r.runState));
// =============================================================================

import { clampGridSize } from './util/clamp.js';
import { Emitter } from './util/events.js';
import { neighbors4, inBounds, isSolvable } from './core/gridModel.js';
import { canExtend, backtrackIndex, reachedGoal } from './core/pathRules.js';
import { generate } from './core/generator.js';
import { loadLevel } from './core/levelLoader.js';
import { createGameState, snapshot } from './core/state.js';
import { runEffects, buildResult, describePath } from './core/effects.js';
import { Renderer } from './view/Renderer.js';
import { releaseStyles } from './view/styles.js';
import { PointerController } from './input/PointerController.js';
import { KeyboardController } from './input/KeyboardController.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class GridPathPuzzle {
  constructor(options = {}) {
    if (!options.mount || !options.mount.appendChild) {
      throw new Error('[grid-path-puzzle] options.mount must be a DOM element.');
    }
    if (!options.nodeTypes) {
      throw new Error('[grid-path-puzzle] options.nodeTypes catalog is required.');
    }

    this.options = {
      size: 8,
      allowKeyboard: true,
      autoStart: true,
      trapEntryMode: 'commitFail', // 'commitFail' | 'block'
      countdownMs: 0,              // pre-start "GO" pause before the timer/interaction begin (0 = off)
      flashStart: false,          // flash the START cell during that pause
      countdownText: 'GO',        // the overlay label
      ...options,
    };
    this.options.size = clampGridSize(this.options.size, 'size');
    this.nodeTypes = this.options.nodeTypes;
    this.emitter = new Emitter();

    // Build the first level from options.level (authored) or options.generate.
    this.level = this._resolveLevel(options.level ?? options.generate ?? null);
    this.state = createGameState(this.level, this.options.initialRunState);

    this._mounted = false;
    this._timerRunning = false;
    this._raf = null;
    this._lastTickEmit = 0;
    this._countdownTimer = null; // setTimeout handle for the pre-start "GO" pause

    this.mount(); // build the DOM immediately (mount() is idempotent)
  }

  // ---- level resolution ---------------------------------------------------
  _resolveLevel(source) {
    let level;
    if (!source) {
      level = generate({ size: this.options.size, nodeTypes: this.nodeTypes });
    } else if (Array.isArray(source.grid) || Array.isArray(source.cells)) {
      const authored = source.cells ? { ...source, grid: source.cells } : source;
      level = loadLevel(authored, this.nodeTypes);
    } else {
      level = generate({ size: this.options.size, nodeTypes: this.nodeTypes, ...source });
    }
    // Option-level constraints fill in only when the level didn't set its own,
    // so a generator's feasibility-adjusted budget is never clobbered.
    if (level.moveBudget == null && this.options.moveBudget != null) level.moveBudget = this.options.moveBudget;
    if (level.timeLimitMs == null && this.options.timeLimitMs != null) level.timeLimitMs = this.options.timeLimitMs;
    return level;
  }

  // ---- lifecycle ----------------------------------------------------------
  mount() {
    if (this._mounted) return this;
    this.renderer = new Renderer(this.options.mount, this.nodeTypes);
    this.renderer.setLevel(this.level);
    this.pointer = new PointerController(this.renderer.gridEl, this);
    if (this.options.allowKeyboard) this.keyboard = new KeyboardController(this.renderer.gridEl, this);
    this._mounted = true;
    return this;
  }

  loadLevel(source) {
    this._clearCountdown();
    this.level = this._resolveLevel(source);
    this.state = createGameState(this.level, this.options.initialRunState);
    this.renderer.setLevel(this.level);
    this._stopTimer();
    return this;
  }

  reset() {
    this._clearCountdown();
    this._stopTimer();
    this.state = createGameState(this.level, this.options.initialRunState);
    this.renderer.update([], { status: 'idle' });
    return this;
  }

  destroy() {
    if (!this._mounted) return;
    this._clearCountdown();
    this._stopTimer();
    this.pointer?.destroy();
    this.keyboard?.destroy();
    this.renderer?.destroy();
    releaseStyles();
    this.emitter.clear();
    this._mounted = false;
  }

  // ---- public state / events ---------------------------------------------
  getState() {
    return {
      ...snapshot(this.state),
      level: {
        cols: this.level.cols,
        rows: this.level.rows,
        moveBudget: this.level.moveBudget ?? null,
        timeLimitMs: this.level.timeLimitMs ?? null,
      },
    };
  }

  on(event, fn) { return this.emitter.on(event, fn); }
  off(event, fn) { this.emitter.off(event, fn); }

  getHead() {
    const p = this.state.path;
    return p.length ? p[p.length - 1] : null;
  }

  // ---- timer --------------------------------------------------------------
  start() {
    if (this._timerRunning) return this;
    if (this._countdownTimer != null) return this; // a "GO" countdown is already pending
    const cd = this.options.countdownMs | 0;
    if (cd > 0 && this.state.status !== 'drawing') {
      // Pre-start "GO" pause: show the overlay (and optionally flash START), block
      // interaction and the timer, then actually begin when the countdown elapses.
      this.state.status = 'ready';
      this.renderer?.showCountdown(this.options.countdownText || 'GO');
      if (this.options.flashStart) this.renderer?.setStartFlash(true);
      this._fire('onCountdownStart', 'countdownStart', { countdownMs: cd });
      this._countdownTimer = setTimeout(() => this._beginAfterCountdown(), cd);
      return this;
    }
    this._beginTimer();
    return this;
  }

  _beginTimer() {
    this._timerRunning = true;
    this._timerStart = now() - this.state.elapsedMs;
    if (typeof requestAnimationFrame === 'function') this._loop();
  }

  // Called when the "GO" pause ends: clear the overlay and start the timer/play.
  _beginAfterCountdown() {
    this._countdownTimer = null;
    this.renderer?.hideCountdown();
    this.renderer?.setStartFlash(false);
    if (this.state.status === 'ready') this.state.status = 'idle';
    this._beginTimer();
    this._fire('onCountdownEnd', 'ready', {});
  }

  _clearCountdown() {
    if (this._countdownTimer != null) { clearTimeout(this._countdownTimer); this._countdownTimer = null; }
    this.renderer?.hideCountdown();
    this.renderer?.setStartFlash(false);
  }

  pause() {
    if (!this._timerRunning) return this;
    this.state.elapsedMs = now() - this._timerStart;
    this._stopTimer();
    return this;
  }

  resume() { return this.start(); }

  _stopTimer() {
    this._timerRunning = false;
    if (this._raf != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _loop() {
    if (!this._timerRunning) return;
    this.state.elapsedMs = now() - this._timerStart;
    const limit = this.level.timeLimitMs;
    // Throttle tick emission to ~10/sec so hosts don't get spammed every frame.
    if (this.state.elapsedMs - this._lastTickEmit >= 100) {
      this._lastTickEmit = this.state.elapsedMs;
      this._fire('onTick', 'tick', {
        elapsedMs: Math.round(this.state.elapsedMs),
        remainingMs: limit == null ? null : Math.max(0, Math.round(limit - this.state.elapsedMs)),
        limitMs: limit ?? null,
      });
    }
    if (limit != null && this.state.elapsedMs >= limit) {
      this._fail('timeout');
      return;
    }
    this._raf = requestAnimationFrame(() => this._loop());
  }

  // ---- the drawing interaction (called by the controllers) ----------------
  tryBegin(cell) {
    if (this.state.status === 'ready') return false; // "GO" pause still running — not interactive yet
    if (this.state.status === 'done' || this.state.status === 'failed') return false;
    if (cell.x !== this.level.start.x || cell.y !== this.level.start.y) return false; // path starts at START
    this.state.path = [{ x: cell.x, y: cell.y }];
    this.state.pendingFail = false;
    this.state.status = 'drawing';
    if (this.options.autoStart) this.start();
    this._afterChange();
    return true;
  }

  // Re-attach an interrupted drag: if you press on a cell already on the path,
  // continue from there (clicking an earlier cell trims the tail back to it).
  // This is what lets you release the mouse mid-draw and pick up where you left
  // off instead of restarting from START.
  tryResume(cell) {
    if (this.state.status !== 'drawing' || this.state.path.length === 0) return false;
    const idx = this.state.path.findIndex((c) => c.x === cell.x && c.y === cell.y);
    if (idx < 0) return false; // pressed off the path — not a resume
    this.state.path = this.state.path.slice(0, idx + 1);
    this.state.pendingFail = false;
    this._afterChange();
    return true;
  }

  tryMoveTo(cell) {
    if (this.state.status !== 'drawing') return;
    const path = this.state.path;
    if (path.length === 0) return;
    const head = path[path.length - 1];
    if (cell.x === head.x && cell.y === head.y) return; // no movement

    // Backtrack: dragging onto any earlier path cell rubs out the tail.
    const bi = backtrackIndex(path, cell);
    if (bi >= 0) {
      this.state.path = path.slice(0, bi + 1);
      this.state.pendingFail = false;
      this._afterChange();
      return;
    }
    this._extendToward(cell);
  }

  // Walk one orthogonal step at a time toward `target`, taking only LEGAL steps.
  // A fast drag can skip cells; this keeps the line continuous and stops at the
  // first illegal step (so you can't tunnel through a blocker or teleport).
  _extendToward(target) {
    const startLen = this.state.path.length;
    // `added` = the cells appended by this move; the renderer animates them.
    const finish = (extra) => this._afterChange({ added: this.state.path.slice(startLen), ...extra });
    let guard = 0;
    while (guard++ < 256) {
      const head = this.state.path[this.state.path.length - 1];
      if (head.x === target.x && head.y === target.y) break;

      const step = this._stepToward(head, target);
      if (!step) break; // no legal distance-reducing step

      // Budget: refuse to grow past the move budget.
      if (this.level.moveBudget != null && this.state.path.length + 1 > this.level.moveBudget) {
        finish({ budgetReached: true });
        return;
      }

      const def = this.nodeTypes[this.level.cells[step.y][step.x]];
      if (def.failsOnPass) {
        if (this.options.trapEntryMode === 'block') break; // refuse to enter the trap
        // commitFail: step in, flag failure, and stop drawing further.
        this.state.path.push(step);
        this.state.pendingFail = true;
        finish();
        return;
      }
      this.state.path.push(step);
    }
    finish();
  }

  // Candidate next cells that reduce distance to target, preferring the longer
  // axis; returns the first that passes the shared canExtend rules, else null.
  _stepToward(head, target) {
    const dx = target.x - head.x;
    const dy = target.y - head.y;
    const cands = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx !== 0) cands.push({ x: head.x + Math.sign(dx), y: head.y });
      if (dy !== 0) cands.push({ x: head.x, y: head.y + Math.sign(dy) });
    } else {
      if (dy !== 0) cands.push({ x: head.x, y: head.y + Math.sign(dy) });
      if (dx !== 0) cands.push({ x: head.x + Math.sign(dx), y: head.y });
    }
    for (const c of cands) {
      if (canExtend(this.state.path, c, this.level, this.nodeTypes)) return c;
    }
    return null;
  }

  endDrag() {
    if (this.state.status !== 'drawing') return;
    if (this.state.pendingFail) { this._fail('trap'); return; }
    if (reachedGoal(this.state.path, this.level, this.nodeTypes)) { this._commit('goal'); return; }
    this._afterChange(); // released short of the goal — leave the path drawn
  }

  /** Host "Execute / See results" button: commit if the head is on the goal. */
  execute() {
    if (this.state.pendingFail) { this._fail('trap'); return; }
    if (reachedGoal(this.state.path, this.level, this.nodeTypes)) this._commit('goal');
  }

  // ---- outcomes -----------------------------------------------------------
  _commit(reason) {
    this._stopTimer();
    this.state.status = 'done';
    this.renderer.update(this.state.path, { status: 'done' });
    const result = buildResult({
      path: this.state.path, level: this.level, nodeTypes: this.nodeTypes,
      baseRunState: this.state.baseRunState, reason, success: true, elapsedMs: this.state.elapsedMs,
    });
    this._fire('onComplete', 'complete', result);
  }

  _fail(reason) {
    this._stopTimer();
    this.state.status = 'failed';
    this.renderer.update(this.state.path, { pendingFail: this.state.pendingFail, status: 'failed' });
    this._fire('onFail', 'fail', {
      reason,
      path: describePath(this.state.path, this.level),
      runState: runEffects(this.state.path, this.level, this.nodeTypes, this.state.baseRunState),
    });
  }

  // Re-render + broadcast a live preview after any path change. `added` (cells
  // appended by this move) is forwarded to the renderer for pass animations.
  _afterChange({ added = [], ...extra } = {}) {
    this.renderer.update(this.state.path, { pendingFail: this.state.pendingFail, status: this.state.status, added });
    this._fire('onPathChange', 'pathChange', {
      path: describePath(this.state.path, this.level),
      steps: this.state.path.length,
      previewRunState: runEffects(this.state.path, this.level, this.nodeTypes, this.state.baseRunState),
      budget: { used: this.state.path.length, max: this.level.moveBudget ?? null },
      canReachGoal: this._canReachGoal(),
      ...extra,
    });
  }

  // BFS from the head over unvisited solvable cells, within the remaining budget.
  _canReachGoal() {
    const path = this.state.path;
    if (path.length === 0) return true;
    const head = path[path.length - 1];
    const { goal } = this.level;
    if (head.x === goal.x && head.y === goal.y) return true;
    const visited = new Set(path.map((c) => `${c.x},${c.y}`));
    const remaining = this.level.moveBudget == null ? Infinity : this.level.moveBudget - path.length;
    const queue = [{ x: head.x, y: head.y, d: 0 }];
    while (queue.length) {
      const cur = queue.shift();
      if (cur.x === goal.x && cur.y === goal.y) return true;
      if (cur.d >= remaining) continue;
      for (const n of neighbors4(cur.x, cur.y)) {
        if (!inBounds(this.level, n.x, n.y)) continue;
        const k = `${n.x},${n.y}`;
        if (visited.has(k)) continue;
        if (!isSolvable(this.nodeTypes[this.level.cells[n.y][n.x]])) continue;
        visited.add(k);
        queue.push({ x: n.x, y: n.y, d: cur.d + 1 });
      }
    }
    return false;
  }

  // Call the option-callback (if any) AND emit the event.
  _fire(optName, eventName, payload) {
    const cb = this.options[optName];
    if (typeof cb === 'function') cb(payload);
    this.emitter.emit(eventName, payload);
  }
}
