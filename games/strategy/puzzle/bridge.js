// =============================================================================
//  puzzle/bridge.js — open a component's TRS during build; queue on solve
// =============================================================================
//
//  The only entry point for "solve a component's routing puzzle". It enforces the
//  build-phase rules (right phase, component alive + off-cooldown, focus set for
//  attack, credit left, one puzzle at a time), owns the GridPathPuzzle lifecycle,
//  and on success runs the ComboEngine over the drawn path and QUEUES an action
//  (it does NOT change HP — that waits for resolve). PuzzleClass/evaluateFn are
//  injectable so this is unit-testable without a browser.
// =============================================================================

import { GridPathPuzzle } from '../../grid-path-puzzle/module/GridPathPuzzle.js';
import { evaluate } from '../../grid-path-puzzle/combo/ComboEngine.js';
import { PHASES } from '../core/state.js';
import { ATTACK_EFFECT, DEFENSE_VERB, isAlive } from '../core/components.js';
import { systemState } from '../core/cascade.js';
import { spendCredit } from '../core/phases.js';
import { logEvent } from '../core/state.js';
import { offensivePalette, defensivePalette, catalogFromConfig } from './palettes.js';
import { makePendingAttack } from '../combat/attack.js';
import { makePendingDefense } from '../combat/defense.js';

export function createBridge({ getState, overlayEl = null, PuzzleClass = GridPathPuzzle, evaluateFn = evaluate, onChange = null }) {
  function makeOverlay() {
    if (typeof document === 'undefined' || !overlayEl) {
      return { host: { appendChild() {} }, panel: null, timerEl: null, dummy: true };
    }
    const panel = document.createElement('div');
    panel.className = 'trs-panel';
    const timerEl = document.createElement('div');
    timerEl.className = 'trs-timer';
    const host = document.createElement('div');
    host.className = 'trs-host';
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
  function showTime(timerEl, ms) {
    if (!timerEl) return;
    const remain = Math.max(0, ms);
    timerEl.textContent = `${(remain / 1000).toFixed(1)}s`;
    timerEl.classList.toggle('urgent', remain <= 5000);
  }

  function canOpen(state, componentId, isAttack) {
    if (state.activePuzzle) return false;
    if (state.pendingAction || state.pendingDefense) return false; // finish placing the last status first
    if (state.pickFocus) return false;
    if (state.cooldowns[componentId] > 0) return false;
    if (!isAlive(state.player.components[componentId])) return false;
    if (isAttack) {
      if (state.phase !== PHASES.ATTACK_BUILD) return false;
      if (!ATTACK_EFFECT[componentId]) return false;
      if (state.usedComponents[componentId]) return false;       // one use per phase (attack)
    } else {
      if (state.phase !== PHASES.DEFENSE_BUILD) return false;
      if (!DEFENSE_VERB[componentId]) return false;
    }
    if (state.creditLeftMs <= 0) return false;
    return true;
  }

  function open(componentId) {
    const state = getState();
    const isAttack = state.phase === PHASES.ATTACK_BUILD;
    if (!canOpen(state, componentId, isAttack)) return false;

    const trsMods = systemState(state.player, state.config).trsMods;
    const cfg = isAttack ? offensivePalette(componentId, trsMods) : defensivePalette(componentId, trsMods);
    const size = state.config.puzzle.size + (trsMods.sizeDelta || 0);
    // Solve timer = the puzzle limit (≤10s by config), but never longer than the credit
    // you have left — so the last action can't exceed the remaining phase budget.
    const timeLimitMs = Math.max(1000, Math.min(state.config.puzzle.timeLimitMs, state.creditLeftMs));
    const ov = makeOverlay();
    const instance = new PuzzleClass({
      mount: ov.host,
      nodeTypes: catalogFromConfig(cfg),
      generate: { size, routePlan: cfg.generation },
      timeLimitMs,
      trapEntryMode: state.config.puzzle.trapEntryMode || 'commitFail',
      onComplete: (result) => finish(componentId, cfg, isAttack, result, true),
      onFail: () => finish(componentId, cfg, isAttack, null, false),
    });
    state.activePuzzle = { component: componentId, mode: isAttack ? 'attack' : 'defense', instance, overlay: ov };

    showTime(ov.timerEl, timeLimitMs);
    if (typeof instance.on === 'function') instance.on('tick', (t) => showTime(ov.timerEl, t.remainingMs));
    if (typeof instance.start === 'function') instance.start();
    return true;
  }

  function finish(componentId, cfg, isAttack, result, success) {
    const state = getState();
    if (!state.activePuzzle) return;
    const elapsed = state.activePuzzle.instance?.state?.elapsedMs ?? 0;

    if (success && result) {
      const skillSeq = result.path.map((c) => c.typeKey).filter((k) => cfg.skills[k]);
      const combo = evaluateFn(skillSeq, cfg);
      // solving makes a PENDING action; the host picks its target next (status spread / own part).
      if (isAttack) makePendingAttack(state, componentId, combo);
      else makePendingDefense(state, componentId, combo);
      // credit cost: fixed chunk (cost model) or seconds-solving (realtime model)
      const cost = state.attackTimeModel === 'realtime' ? elapsed : state.config.phase.actionCostMs;
      spendCredit(state, cost);
    } else {
      // fail/timeout: spend the smaller fail cost AND cool the component down.
      spendCredit(state, state.config.phase.failCostMs);
      state.cooldowns[componentId] = (state.cooldowns[componentId] || 0) + (state.config.cooldowns.failCooldownMult || 2);
      logEvent(state, `Failed ${state.player.components[componentId].name} TRS — cooled down, credit spent.`);
    }
    teardown(state);
  }

  function teardown(state) {
    if (!state.activePuzzle) return;
    try { state.activePuzzle.instance.destroy(); } catch { /* idempotent */ }
    removeOverlay(state.activePuzzle.overlay);
    state.activePuzzle = null;
    if (typeof onChange === 'function') onChange(); // async solve finished → host redraws
  }

  function abort() {
    const state = getState();
    if (state.activePuzzle) teardown(state);
  }

  return { open, abort, canOpen: (id, isAttack) => canOpen(getState(), id, isAttack) };
}
