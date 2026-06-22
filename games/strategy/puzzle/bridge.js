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
import { ATTACK_EFFECT, DEFENSE_VERB, isAlive, hasStatus } from '../core/components.js';
import { systemState } from '../core/cascade.js';
import { spendCredit } from '../core/phases.js';
import { logEvent } from '../core/state.js';
import { offensivePalette, defensivePalette, catalogFromConfig, OFFENSE_META, DEFENSE_META } from './palettes.js';
import { makePendingAttack } from '../combat/attack.js';
import { makePendingDefense } from '../combat/defense.js';

/**
 * Translate the ENEMY statuses sitting on one of YOUR components into the puzzle
 * module's runtime `modifiers` + a burning-hazard flag, so a debuff is FELT while
 * you solve that component's route (the "reflect-back" of the puzzle status effects).
 * Statuses overlap (a part can be confused + drained + shattered at once); only
 * freeze+burning never co-occur (the host cancels them on apply). `payloadType` is
 * the icon you're chaining — drain (decay) and shatter (wander) act on those icons.
 * Pure + exported so it is unit-testable. Returns { modifiers|null, burningOn }.
 */
export function statusFriction(component, payloadType, mods = {}) {
  const m = {};
  if (hasStatus(component, 'freeze') && mods.freezeSlow != null) m.slow = mods.freezeSlow;
  if (hasStatus(component, 'confuse') && mods.confuseChance != null) m.confusion = mods.confuseChance;
  if (hasStatus(component, 'drain') && mods.drain) m.decay = { type: payloadType, baseMs: mods.drain.baseMs, stepMs: mods.drain.stepMs };
  if (hasStatus(component, 'shatter') && mods.shatterChance != null) m.wander = { type: payloadType, chance: mods.shatterChance };
  return { modifiers: Object.keys(m).length ? m : null, burningOn: hasStatus(component, 'burning') };
}

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
    // timer on top, grid below. The objective badge is pinned bottom-center via host
    // CSS (#puzzle-overlay .gpp-objective), so the top band is the timer's alone.
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

    const component = state.player.components[componentId];
    const payloadType = isAttack ? ATTACK_EFFECT[componentId] : DEFENSE_VERB[componentId];
    // Min payload icons to chain — now enforced by the module's OBJECTIVE GATE (it
    // blocks the goal + shows "Need X more" until met), not a post-commit fail.
    const minChain = (isAttack ? state.config.effects?.[payloadType]?.minChain : state.config.defense?.[payloadType]?.minChain) ?? 1;

    // Enemy statuses on THIS component → felt as route friction while you solve it.
    const pmods = state.config.puzzle.modifiers || {};
    const { modifiers, burningOn } = statusFriction(component, payloadType, pmods);

    const trsMods = systemState(state.player, state.config).trsMods;
    // Generation knobs: config defaults + a per-solve burning hazard density (only
    // when this component is Burning — the 🔥 firehazard node, NOT a runtime modifier).
    const knobs = { ...(state.config.puzzle.gen || {}) };
    delete knobs._comment;
    knobs.burningDensity = burningOn ? (pmods.burningDensity ?? 0) : 0;
    const cfg = isAttack
      ? offensivePalette(componentId, trsMods, state.config.potency, knobs)
      : defensivePalette(componentId, trsMods, state.config.potency, knobs);
    const size = state.config.puzzle.size + (trsMods.sizeDelta || 0);

    // Shatter makes the payload icons shake while they wander (playground recipe).
    const nt = catalogFromConfig(cfg);
    if (hasStatus(component, 'shatter')) nt[payloadType] = { ...nt[payloadType], anim: 'shake' };

    const meta = (isAttack ? OFFENSE_META : DEFENSE_META)[payloadType] || {};
    const cd = state.config.puzzle.countdown || {};

    // Solve timer = the puzzle limit (≤10s by config), but never longer than the credit
    // you have left — so the last action can't exceed the remaining phase budget.
    const timeLimitMs = Math.max(1000, Math.min(state.config.puzzle.timeLimitMs, state.creditLeftMs));
    const ov = makeOverlay();
    const instance = new PuzzleClass({
      mount: ov.host,
      nodeTypes: nt,
      generate: { size, routePlan: cfg.generation, moveBudget: size * size },
      timeLimitMs,
      trapEntryMode: state.config.puzzle.trapEntryMode || 'commitFail',
      countdownMs: cd.ms || 0,
      flashStart: !!cd.flashStart,
      countdownText: cd.text || 'GO',
      objective: { type: payloadType, min: minChain, icon: meta.icon, label: meta.name },
      failText: state.config.puzzle.failText || null,
      modifiers,
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

    // The objective gate guarantees onComplete only fires once Min Chain is met, so a
    // success here always qualifies — no post-commit chain check needed.
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
      // fail/timeout (incl. failFast hazard crossing): spend the fail cost + cool down.
      spendCredit(state, state.config.phase.failCostMs);
      state.cooldowns[componentId] = (state.cooldowns[componentId] || 0) + (state.config.cooldowns.failCooldownMult || 2);
      const name = state.player.components[componentId].name;
      logEvent(state, `Failed ${name} TRS — cooled down, credit spent.`);
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
