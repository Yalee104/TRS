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
import { makeRng } from './util/rng.js';
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

// FREEZE: base fill speed (cells/sec) that the `slow` factor scales (0.75 = 75%).
const FREEZE_BASE_CPS = 16;

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
      objective: null,            // optional win gate: { type, min, icon?, label? } — null = off
      failText: null,             // optional: big centred banner shown on fail (null = off)
      modifiers: null,            // optional runtime status modifiers (see _normalizeModifiers) — null = off
      ...options,
    };
    this.options.size = clampGridSize(this.options.size, 'size');
    this.nodeTypes = this.options.nodeTypes;
    this.emitter = new Emitter();

    // Optional "objective gate": the path must cross >= min cells of node-type
    // `type` before reaching GOAL counts as a win (generic; the host decides what
    // `type` means). null when off, so existing hosts are byte-identical.
    this._objective = this._normalizeObjective(this.options.objective);

    // Build the first level from options.level (authored) or options.generate.
    this.level = this._resolveLevel(options.level ?? options.generate ?? null);
    this.state = createGameState(this.level, this.options.initialRunState);

    // Runtime status modifiers (drain/shatter/confused/freeze). A seeded RNG keeps
    // the random ones reproducible per level seed (tests inject `options.rng`).
    this._mods = this._normalizeModifiers(this.options.modifiers);
    this._rng = this.options.rng || makeRng(this.level.seed);
    this._fillKey = this._resolveFillKey();
    this._decayTimers = null;
    // FREEZE: the icy preview (where the cursor has dragged) vs the slow solid
    // path (state.path, which all gameplay reads). null when freeze is off.
    this._previewPath = null;
    this._freezeReleasing = false;
    this._lastFillAt = 0;

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
    this._applyObjective();
    this._applyModifierVisuals();
    this.pointer = new PointerController(this.renderer.gridEl, this);
    if (this.options.allowKeyboard) this.keyboard = new KeyboardController(this.renderer.gridEl, this);
    this._mounted = true;
    return this;
  }

  loadLevel(source) {
    this._clearCountdown();
    this._clearDecay();
    this._clearFreeze();
    this.level = this._resolveLevel(source);
    this.state = createGameState(this.level, this.options.initialRunState);
    this.renderer.setLevel(this.level);
    this._applyObjective();
    this._applyModifierVisuals();
    this._stopTimer();
    return this;
  }

  reset() {
    this._clearCountdown();
    this._clearDecay();
    this._clearFreeze();
    this._stopTimer();
    this.state = createGameState(this.level, this.options.initialRunState);
    this.renderer.update([], { status: 'idle' });
    if (this._objective) this.renderer?.updateObjective(0, this._objective.min, false);
    return this;
  }

  destroy() {
    if (!this._mounted) return;
    this._clearCountdown();
    this._clearDecay();
    this._clearFreeze();
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
      objective: this._objective
        ? { type: this._objective.type, min: this._objective.min, have: this._objectiveCount(), met: this._objectiveMet() }
        : null,
    };
  }

  on(event, fn) { return this.emitter.on(event, fn); }
  off(event, fn) { this.emitter.off(event, fn); }

  getHead() {
    const p = this.state.path;
    return p.length ? p[p.length - 1] : null;
  }

  // ---- objective gate (optional) ------------------------------------------
  // Normalize the option; null (off) when missing/invalid so existing hosts are
  // unaffected. Resolves a display icon generically from the node-type catalog.
  _normalizeObjective(obj) {
    if (!obj || !obj.type || !(obj.min > 0)) return null;
    const def = this.nodeTypes[obj.type];
    return {
      type: obj.type,
      min: Math.max(1, obj.min | 0),
      icon: obj.icon ?? def?.icon ?? obj.label ?? obj.type,
      label: obj.label ?? def?.label ?? obj.type,
    };
  }

  // Count path cells whose node-type is the objective type (TOTAL, not a run).
  _objectiveCount(path = this.state.path) {
    if (!this._objective) return 0;
    let n = 0;
    for (const c of path) if (this.level.cells[c.y][c.x] === this._objective.type) n++;
    return n;
  }

  _objectiveMet(path = this.state.path) {
    return !this._objective || this._objectiveCount(path) >= this._objective.min;
  }

  // Persistent visual indicators for active modifiers (currently: confused).
  _applyModifierVisuals() {
    if (this._mods?.confusion) this.renderer?.setConfused(true);
  }

  // Apply the objective to a freshly-built board (badge + locked goal + counts).
  _applyObjective() {
    if (!this._objective) return;
    this.renderer?.setObjective(this._objective);
    this.renderer?.updateObjective(this._objectiveCount(), this._objective.min, this._objectiveMet());
  }

  _fireObjectiveBlocked() {
    if (!this._objective) return;
    const have = this._objectiveCount();
    const missing = Math.max(0, this._objective.min - have);
    this.renderer?.showObjectiveNeed(missing);
    this._fire('onObjectiveBlocked', 'objectiveBlocked', { type: this._objective.type, have, need: this._objective.min, missing });
  }

  // ---- runtime status modifiers -------------------------------------------
  _normalizeModifiers(m) {
    if (!m) return null;
    const out = {};
    if (m.slow > 0 && m.slow < 1) out.slow = m.slow;                                    // freeze
    if (m.confusion > 0) out.confusion = Math.min(1, m.confusion);                       // confused
    if (m.decay && m.decay.type && m.decay.baseMs > 0) out.decay = { type: m.decay.type, baseMs: m.decay.baseMs | 0, stepMs: Math.max(0, m.decay.stepMs | 0) }; // drain
    if (m.wander && m.wander.type && m.wander.chance > 0) out.wander = { type: m.wander.type, chance: Math.min(1, m.wander.chance) }; // shatter
    return Object.keys(out).length ? out : null;
  }

  // The plain background/filler node key (passable normal, no trap/icon) — used
  // when a payload is removed (drain) or vacated (shatter).
  _resolveFillKey() {
    const entries = Object.entries(this.nodeTypes);
    const normals = entries.filter(([, d]) => d.role === 'normal' && d.passable !== false && !d.failsOnPass);
    return (normals.find(([, d]) => !d.icon && !d.label) ?? normals[0])?.[0];
  }

  _isOnPath(x, y) { return this.state.path.some((c) => c.x === x && c.y === y); }

  // DRAIN: each payload of the decay type vanishes on a timer — closest-to-start
  // first (base), each further one +stepMs. Crossing a payload secures it.
  _setupDecay() {
    if (!this._mods?.decay) return;
    const { type, baseMs, stepMs } = this._mods.decay;
    const cells = [];
    for (let y = 0; y < this.level.rows; y++) {
      for (let x = 0; x < this.level.cols; x++) {
        if (this.level.cells[y][x] === type) {
          cells.push({ x, y, d: Math.abs(x - this.level.start.x) + Math.abs(y - this.level.start.y) });
        }
      }
    }
    cells.sort((a, b) => a.d - b.d);
    this._decayTimers = new Map();
    cells.forEach((c, i) => {
      const expiry = baseMs + i * stepMs;
      this._decayTimers.set(`${c.x},${c.y}`, { x: c.x, y: c.y, expiry, done: false });
      this.renderer?.startDecay(c.x, c.y, expiry);
    });
  }

  _tickDecay() {
    if (!this._decayTimers) return;
    for (const t of this._decayTimers.values()) {
      if (t.done) continue;
      if (this._isOnPath(t.x, t.y)) continue; // secured by crossing (also handled in _afterChange)
      if (this.state.elapsedMs >= t.expiry) {
        t.done = true;
        this.level.cells[t.y][t.x] = this._fillKey;
        this.renderer?.updateCell(t.x, t.y, this._fillKey);
        this.renderer?.clearDecay(t.x, t.y);
        this._fire('onDecay', 'decay', { x: t.x, y: t.y, type: this._mods.decay.type });
        this._afterChange(); // refresh objective + canReachGoal (path unchanged)
      }
    }
  }

  // Stop the timer (and its ring) on any decay payload now on the path.
  _secureCrossedPayloads() {
    if (!this._decayTimers) return;
    for (const t of this._decayTimers.values()) {
      if (!t.done && this._isOnPath(t.x, t.y)) { t.done = true; this.renderer?.clearDecay(t.x, t.y); }
    }
  }

  _clearDecay() {
    if (this._decayTimers) for (const t of this._decayTimers.values()) this.renderer?.clearDecay(t.x, t.y);
    this._decayTimers = null;
  }

  // SHATTER: with `wander.chance`, relocate one random un-crossed payload to a
  // random empty (plain filler) adjacent cell. Called once per step added.
  _maybeWander() {
    const w = this._mods?.wander;
    if (!w || this._rng() >= w.chance) return;
    const payloads = [];
    for (let y = 0; y < this.level.rows; y++) {
      for (let x = 0; x < this.level.cols; x++) {
        if (this.level.cells[y][x] === w.type && !this._isOnPath(x, y)) payloads.push({ x, y });
      }
    }
    if (!payloads.length) return;
    const p = payloads[Math.floor(this._rng() * payloads.length)];
    const empties = neighbors4(p.x, p.y).filter((n) => inBounds(this.level, n.x, n.y)
      && this.level.cells[n.y][n.x] === this._fillKey && !this._isOnPath(n.x, n.y));
    if (!empties.length) return;
    const dest = empties[Math.floor(this._rng() * empties.length)];
    this.level.cells[p.y][p.x] = this._fillKey;
    this.level.cells[dest.y][dest.x] = w.type;
    this.renderer?.updateCell(p.x, p.y, this._fillKey);
    this.renderer?.updateCell(dest.x, dest.y, w.type);
    this._fire('onShatter', 'shatter', { from: { x: p.x, y: p.y }, to: dest, type: w.type });
  }

  // ---- FREEZE: icy preview (cursor) + slow solid fill (state.path) ----------
  // The cursor drags the preview instantly; the solid path catches up at
  // FREEZE_BASE_CPS * slow cells/sec in _loop. ALL gameplay reads state.path.
  _previewMoveTo(cell) {
    const head = this._previewPath[this._previewPath.length - 1];
    if (cell.x === head.x && cell.y === head.y) return;
    const bi = backtrackIndex(this._previewPath, cell);
    if (bi >= 0) {
      this._previewPath = this._previewPath.slice(0, bi + 1);
      this._freezeReleasing = false; // dragging again
      this._trimSolidToPreview();
      this.renderer?.setPreview(this._previewPath);
      this._afterChange();
      return;
    }
    let guard = 0;
    while (guard++ < 256) {
      const h = this._previewPath[this._previewPath.length - 1];
      if (h.x === cell.x && h.y === cell.y) break;
      if (this.level.moveBudget != null && this._previewPath.length + 1 > this.level.moveBudget) break;
      const step = this._stepToward(h, cell, this._previewPath); // legal walls/revisits; traps don't fail here
      if (!step) break;
      this._previewPath.push(step);
    }
    this.renderer?.setPreview(this._previewPath);
  }

  // Keep the solid path a prefix of the preview (after a preview backtrack).
  _trimSolidToPreview() {
    if (this._previewPath && this.state.path.length > this._previewPath.length) {
      this.state.path = this.state.path.slice(0, this._previewPath.length);
      this.state.pendingFail = false;
      this.renderer?.update(this.state.path, { status: this.state.status });
    }
  }

  // Advance the solid head along the preview at the frozen rate (called per frame).
  _advanceFreeze() {
    if (!this._previewPath || this.state.status !== 'drawing') return;
    if (!this.state.pendingFail) {
      const interval = 1000 / (FREEZE_BASE_CPS * this._mods.slow);
      while (this.state.path.length < this._previewPath.length && (this.state.elapsedMs - this._lastFillAt) >= interval) {
        this._lastFillAt += interval;
        const next = this._previewPath[this.state.path.length];
        this.state.path.push(next);
        this._maybeWander();
        const def = this.nodeTypes[this.level.cells[next.y][next.x]];
        if (def.failsOnPass) { this.state.pendingFail = true; this._afterChange(); break; }
        this._afterChange();
      }
    }
    if (this._freezeReleasing && (this.state.pendingFail || this.state.path.length >= this._previewPath.length)) {
      this._resolveFreezeEnd();
    }
  }

  // Resolve the drag once the slow fill has caught up (or hit a trap) post-release.
  _resolveFreezeEnd() {
    this._freezeReleasing = false;
    if (this.state.pendingFail) { this._fail('trap'); return; }
    if (reachedGoal(this.state.path, this.level, this.nodeTypes)) {
      if (this._objectiveMet()) this._commit('goal');
      else this._fireObjectiveBlocked();
    }
    // else: released short of the goal — leave the (solid) path drawn.
  }

  _clearFreeze() {
    this._previewPath = null;
    this._freezeReleasing = false;
    this.renderer?.setPreview([]);
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
    // No GO pause (or already drawing): start immediately. If flashing is on and
    // play hasn't begun, flash START until the first drag (cleared in tryBegin).
    if (this.options.flashStart && this.state.status !== 'drawing') this.renderer?.setStartFlash(true);
    this._beginTimer();
    return this;
  }

  _beginTimer() {
    this._timerRunning = true;
    this._timerStart = now() - this.state.elapsedMs;
    // Reset the tick-throttle baseline; otherwise a re-start (after reset/loadLevel)
    // keeps the previous run's high `_lastTickEmit`, suppressing `tick` until real
    // time passes that old mark — the timer would appear frozen at "—".
    this._lastTickEmit = -Infinity;
    if (this._mods?.decay && !this._decayTimers) this._setupDecay(); // start payload drain timers
    if (typeof requestAnimationFrame === 'function') this._loop();
  }

  // Called when the "GO" pause ends: clear the overlay and start the timer/play.
  // The START keeps flashing past this point — it stops only when the first drag
  // begins (see tryBegin) — so the player can still spot START after "GO".
  _beginAfterCountdown() {
    this._countdownTimer = null;
    this.renderer?.hideCountdown();
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
    if (this._decayTimers) this._tickDecay();
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
    if (this._mods?.slow) this._advanceFreeze();
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
    this.renderer?.setStartFlash(false); // first drag begun — stop flashing START
    if (this._mods?.slow) { // FREEZE: seed the icy preview at START
      this._previewPath = [{ x: cell.x, y: cell.y }];
      this._freezeReleasing = false;
      this._lastFillAt = this.state.elapsedMs;
      this.renderer?.setPreview(this._previewPath);
    }
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
    if (this._mods?.slow) { // FREEZE: resume re-attaches to the icy preview
      const i = this._previewPath.findIndex((c) => c.x === cell.x && c.y === cell.y);
      if (i < 0) return false;
      this._previewPath = this._previewPath.slice(0, i + 1);
      this._freezeReleasing = false;
      this._trimSolidToPreview();
      this.renderer?.setPreview(this._previewPath);
      this._afterChange();
      return true;
    }
    const idx = this.state.path.findIndex((c) => c.x === cell.x && c.y === cell.y);
    if (idx < 0) return false; // pressed off the path — not a resume
    this.state.path = this.state.path.slice(0, idx + 1);
    this.state.pendingFail = false;
    this._afterChange();
    return true;
  }

  tryMoveTo(cell) {
    if (this.state.status !== 'drawing') return;
    if (this._mods?.slow) { this._previewMoveTo(cell); return; } // FREEZE: drag the preview
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
      this._maybeWander(); // SHATTER: chance to relocate an un-crossed payload each step
    }
    finish();
  }

  // Candidate next cells that reduce distance to target, preferring the longer
  // axis; returns the first that passes the shared canExtend rules, else null.
  _stepToward(head, target, path = this.state.path) {
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
    // CONFUSED: sometimes veer to a random SAFE (non-hazard) legal neighbor — a
    // DIFFERENT direction than intended when one exists. Never a trap/burning.
    if (this._mods?.confusion && this._rng() < this._mods.confusion) {
      const intended = cands[0];
      const safe = neighbors4(head.x, head.y).filter((c) =>
        canExtend(path, c, this.level, this.nodeTypes)
        && !this.nodeTypes[this.level.cells[c.y][c.x]].failsOnPass);
      const wrong = safe.filter((c) => !intended || c.x !== intended.x || c.y !== intended.y);
      const pool = wrong.length ? wrong : safe;
      if (pool.length) return pool[Math.floor(this._rng() * pool.length)];
    }
    for (const c of cands) {
      if (canExtend(path, c, this.level, this.nodeTypes)) return c;
    }
    return null;
  }

  endDrag() {
    if (this.state.status !== 'drawing') return;
    if (this.state.pendingFail) { this._fail('trap'); return; }
    if (this._mods?.slow) { // FREEZE: defer — let the slow fill catch up, then resolve
      this._freezeReleasing = true;
      this._advanceFreeze();
      return;
    }
    if (reachedGoal(this.state.path, this.level, this.nodeTypes)) {
      if (this._objectiveMet()) { this._commit('goal'); return; }
      // At the goal but the objective isn't met — BLOCK (not a fail): leave the
      // path drawn so the player can reroute to collect more, and prompt them.
      this._afterChange();
      this._fireObjectiveBlocked();
      return;
    }
    this._afterChange(); // released short of the goal — leave the path drawn
  }

  /** Host "Execute / See results" button: commit if the head is on the goal. */
  execute() {
    if (this.state.pendingFail) { this._fail('trap'); return; }
    if (reachedGoal(this.state.path, this.level, this.nodeTypes)) {
      if (this._objectiveMet()) { this._commit('goal'); return; }
      this._fireObjectiveBlocked();
    }
  }

  // ---- outcomes -----------------------------------------------------------
  _commit(reason) {
    this._stopTimer();
    this._clearFreeze();
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
    this._clearFreeze();
    this.state.status = 'failed';
    this.renderer.update(this.state.path, { pendingFail: this.state.pendingFail, status: 'failed' });
    if (this.options.failText) this.renderer?.showFail(this.options.failText);
    this._fire('onFail', 'fail', {
      reason,
      path: describePath(this.state.path, this.level),
      runState: runEffects(this.state.path, this.level, this.nodeTypes, this.state.baseRunState),
    });
  }

  // Re-render + broadcast a live preview after any path change. `added` (cells
  // appended by this move) is forwarded to the renderer for pass animations.
  _afterChange({ added = [], ...extra } = {}) {
    this._secureCrossedPayloads(); // a crossed decay payload stops draining
    this.renderer.update(this.state.path, { pendingFail: this.state.pendingFail, status: this.state.status, added });
    this._fire('onPathChange', 'pathChange', {
      path: describePath(this.state.path, this.level),
      steps: this.state.path.length,
      previewRunState: runEffects(this.state.path, this.level, this.nodeTypes, this.state.baseRunState),
      budget: { used: this.state.path.length, max: this.level.moveBudget ?? null },
      canReachGoal: this._canReachGoal(),
      ...extra,
    });
    if (this._objective) {
      const have = this._objectiveCount();
      const met = have >= this._objective.min;
      this.renderer?.updateObjective(have, this._objective.min, met);
      this._fire('onObjectiveProgress', 'objectiveProgress', { type: this._objective.type, have, need: this._objective.min, met });
    }
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
