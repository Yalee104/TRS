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
  function makeOverlay() {
    if (typeof document === 'undefined' || !overlayEl) return { dummy: true };
    const el = document.createElement('div');
    el.className = 'gpp-host';
    overlayEl.appendChild(el);
    overlayEl.style.display = 'flex';
    return el;
  }
  function removeOverlay(el) {
    if (el && el.remove && !el.dummy) el.remove();
    if (overlayEl) overlayEl.style.display = 'none';
  }

  function open(mode) {
    const state = getState();
    if (state.phase !== 'playing') return false;     // not during win/lose/another puzzle
    if (state.activePuzzle) return false;             // one at a time
    if (state.cooldowns[mode] > 0) return false;      // on cooldown
    const cfg = configs[mode];
    const refs = state.config.puzzle[mode];
    const mount = makeOverlay();
    const instance = new PuzzleClass({
      mount,
      nodeTypes: catalogFromConfig(cfg),
      generate: { size: refs.size, routePlan: cfg.generation },
      timeLimitMs: refs.timeLimitMs,
      trapEntryMode: 'commitFail',
      onComplete: (result) => finish(mode, cfg, result, true),
      onFail: () => finish(mode, cfg, null, false),
    });
    state.activePuzzle = { mode, instance, mount };
    state.phase = 'puzzle';
    state.timeScale = state.config.slowFps / state.config.normalFps;
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
    }
    const cd = state.config.cooldowns[`${mode}${success ? 'Success' : 'Fail'}Ms`];
    state.cooldowns[mode] = cd;
    state.cooldownMax[mode] = cd || 1;
    teardown(state);
  }

  function teardown(state) {
    if (!state.activePuzzle) return;
    try { state.activePuzzle.instance.destroy(); } catch { /* idempotent */ }
    removeOverlay(state.activePuzzle.mount);
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
