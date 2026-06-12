// =============================================================================
//  puzzle/bridge.js — opens the grid-path-puzzle as the "hack" overlay
// =============================================================================
//
//  The ONLY entry point for Hack/Protect. It enforces the rules (one puzzle at a
//  time, per-side cooldown), owns the GridPathPuzzle lifecycle, flips the game
//  into slow-motion, and on success runs the ComboEngine over the drawn path and
//  applies the result to the game. The GridPathPuzzle + ComboEngine are injectable
//  so this is unit-testable without a browser.
// =============================================================================

import { GridPathPuzzle } from '../../grid-path-puzzle/module/GridPathPuzzle.js';
import { evaluate } from '../../grid-path-puzzle/combo/ComboEngine.js';
import { catalogFromConfig } from './catalog.js';
import { applyComboResult, applyPowerup } from '../effects/apply.js';

// `configs` (the offensive/defensive JSON objects) are passed in by the caller —
// main.js imports them (Vite resolves JSON natively); keeping the JSON import out
// of this module lets it load under plain Node for tests.
export function createBridge({
  getState,
  overlayEl = null,
  configs = {},
  PuzzleClass = GridPathPuzzle,
  evaluateFn = evaluate,
}) {
  // Build the side panel: a big countdown timer above the puzzle mount. Returns
  // { host, panel, timerEl }; `host` is what the GridPathPuzzle mounts into.
  function makeOverlay() {
    if (typeof document === 'undefined' || !overlayEl) {
      return { host: { appendChild() {} }, panel: null, timerEl: null, dummy: true };
    }
    const panel = document.createElement('div');
    panel.className = 'gpp-panel';
    const timerEl = document.createElement('div');
    timerEl.className = 'gpp-timer';
    const host = document.createElement('div');
    host.className = 'gpp-host';
    panel.appendChild(timerEl);
    panel.appendChild(host);
    overlayEl.appendChild(panel);
    overlayEl.style.display = 'flex';
    return { host, panel, timerEl };
  }
  function removeOverlay(ov) {
    if (ov && ov.panel && ov.panel.remove) ov.panel.remove();
    if (overlayEl) overlayEl.style.display = 'none';
  }

  // Countdown text (one decimal); flashes 'urgent' under 5s remaining.
  function showTime(timerEl, ms) {
    if (!timerEl) return;
    const remain = Math.max(0, ms);
    timerEl.textContent = `${(remain / 1000).toFixed(1)}s`;
    timerEl.classList.toggle('urgent', remain <= 5000);
  }

  function open(mode) {
    const state = getState();
    if (state.phase !== 'playing') return false;     // not during win/lose/another puzzle
    if (state.activePuzzle) return false;             // one at a time
    if (state.cooldowns[mode] > 0) return false;      // on cooldown
    const cfg = configs[mode];
    const refs = state.config.puzzle[mode];
    const ov = makeOverlay();
    const instance = new PuzzleClass({
      mount: ov.host,
      nodeTypes: catalogFromConfig(cfg),
      generate: { size: refs.size, routePlan: cfg.generation },
      timeLimitMs: refs.timeLimitMs,
      trapEntryMode: 'commitFail',
      onComplete: (result) => finish(mode, cfg, result, true),
      onFail: () => finish(mode, cfg, null, false),
    });
    state.activePuzzle = { mode, instance, overlay: ov };
    state.phase = 'puzzle';
    state.timeScale = state.config.slowFps / state.config.normalFps;

    // Run the countdown immediately (wall-clock, independent of slow-mo) so the
    // timer is live the moment the puzzle opens — idling still times out.
    showTime(ov.timerEl, refs.timeLimitMs);
    if (typeof instance.on === 'function') instance.on('tick', (t) => showTime(ov.timerEl, t.remainingMs));
    if (typeof instance.start === 'function') instance.start();
    return true;
  }

  function finish(mode, cfg, result, success) {
    const state = getState();
    if (!state.activePuzzle) return;
    if (success && result) {
      const skillSeq = result.path.map((c) => c.typeKey).filter((k) => cfg.skills[k]);
      applyComboResult(state, evaluateFn(skillSeq, cfg), mode);
      if (cfg.powerups) {
        for (const c of result.path) {
          const def = cfg.powerups[c.typeKey];
          if (def) applyPowerup(state, c.typeKey, def);
        }
      }
      // Hacking the system drops EVERY enemy's shield for a few seconds — the main
      // window to actually burn HP down (the core strategic payoff of the puzzle).
      if (mode === 'offensive') {
        const ms = state.config.tuning.shieldDisableMs ?? 0;
        for (const e of state.enemies) {
          if (!e.shield || e.shield.amount <= 0) continue;
          e.shield.disabledMs = ms;
          state.fx.push({ kind: 'shieldBreak', pos: { x: e.pos.x, y: e.pos.y }, radius: e.radius, remainingMs: 520 });
        }
      }
    }
    // Fail (incl. timeout) doubles the cooldown as a penalty (mult is configurable).
    const cds = state.config.cooldowns;
    const successMs = cds[`${mode}SuccessMs`];
    const cd = success ? successMs : successMs * (cds.failCooldownMult ?? 2);
    state.cooldowns[mode] = cd;
    state.cooldownMax[mode] = cd || 1;
    teardown(state);
  }

  function teardown(state) {
    if (!state.activePuzzle) return;
    try { state.activePuzzle.instance.destroy(); } catch { /* idempotent */ }
    removeOverlay(state.activePuzzle.overlay);
    state.activePuzzle = null;
    if (state.phase === 'puzzle') state.phase = 'playing';
    state.timeScale = 1;
  }

  // Called when the encounter ends mid-puzzle: tear down, no cooldown.
  function abort() {
    const state = getState();
    if (!state.activePuzzle) return;
    teardown(state);
  }

  return { open, openOffensive: () => open('offensive'), openDefensive: () => open('defensive'), abort };
}
