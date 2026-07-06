// =============================================================================
//  core/phases.js — the Build→Resolve FSM that drives a round
// =============================================================================
//
//  Round = Attack Build → Attack Resolve → Defense Build → Defense Resolve →
//  end-of-round tick → next round. The UI calls commitAttack/commitDefense when
//  the player ends a build (credit spent or "End Phase"). HP only changes in the
//  resolves; statuses tick once per round here so durations read as whole rounds.
// =============================================================================

import { PHASES, logEvent } from './state.js';
import { isAlive } from './components.js';
import { resolveAttack } from '../combat/attack.js';
import { resolveDefense } from '../combat/defense.js';
import { planAttack, overheatMult } from '../combat/enemyAI.js';
import { tickAircraftStatuses } from '../combat/statuses.js';

export function startAttackBuild(state) {
  state.phase = PHASES.ATTACK_BUILD;
  state.queue = [];
  state.pendingAction = null;
  state.pendingDefense = null;
  state.focus = null;
  state.pickFocus = false;
  state.usedComponents = {};
  state.creditLeftMs = state.creditMs + (state.creditBonusMs || 0); // Overclock banked credit
  if (state.creditBonusMs) { logEvent(state, `Overclock: +${(state.creditBonusMs / 1000).toFixed(1)}s build-credit this phase.`); state.creditBonusMs = 0; }
  // each living enemy declares its next strike (visible if your Tower lives)
  for (const e of state.enemies) e.telegraph = isAlive(e.components.core) ? planAttack(state, e) : null;
  logEvent(state, `=== Round ${state.round} — ATTACK. Play a weapon's TRS, then apply its status to an enemy part.`);
  if (state.overheat) {
    if (state.round === state.overheat.par) logEvent(state, `⚠ Overheat imminent — enemy systems ramp up next round. Finish this fight!`);
    else if (state.round > state.overheat.par) logEvent(state, `🔥 OVERHEAT — enemy strikes amplified ×${overheatMult(state).toFixed(2)}.`);
  }
}

export function commitAttack(state, eid, focusId) {
  if (state.phase !== PHASES.ATTACK_BUILD || eid == null || focusId == null) return null;
  state.phase = PHASES.ATTACK_RESOLVE;
  state.pickFocus = false;
  const summary = resolveAttack(state, eid, focusId);   // logs internally
  state.lastResolve = { kind: 'attack', ...summary };
  if (checkOutcome(state)) return summary;
  startDefenseBuild(state);
  return summary;
}

export function startDefenseBuild(state) {
  state.phase = PHASES.DEFENSE_BUILD;
  state.queue = [];
  state.pendingAction = null;
  state.pendingDefense = null;
  state.pickFocus = false;
  state.defensePlays = {};       // fresh phase → replay penalty resets
  // Defense gets a tighter budget than attack (config.phase.defenseCreditMult) so
  // protection is a real choice rather than a full re-solve of every verb.
  state.creditLeftMs = Math.round(state.creditMs * (state.config.phase.defenseCreditMult ?? 1));
  logEvent(state, '=== DEFENSE. Play a part\'s TRS, then choose which part to protect.');
}

export function commitDefense(state) {
  if (state.phase !== PHASES.DEFENSE_BUILD) return null;
  state.phase = PHASES.DEFENSE_RESOLVE;
  const summary = resolveDefense(state);
  state.lastResolve = { kind: 'defense', ...summary };
  logEvent(state, `Enemy struck for ${Math.round(summary.totalDamage)} dmg across ${summary.hits.length} part(s).`);
  if (checkOutcome(state)) return summary;
  endOfRound(state);
  return summary;
}

function endOfRound(state) {
  for (const e of state.enemies) {
    const r = tickAircraftStatuses(e, state.config);
    if (r.dot) logEvent(state, `End of round: Burning dealt ${Math.round(r.dot)} to ${e.label}.`);
    if (r.meltdown) logEvent(state, `Meltdown: ${Math.round(r.meltdown)} funnelled into ${e.label}'s Reactor Core.`);
    if (r.drainHeal) {                              // ongoing Drain siphons enemy HP into your Core
      const pc = state.player.components.core;
      pc.hp = Math.min(pc.maxHp, pc.hp + r.drainHeal);
      logEvent(state, `End of round: Drain siphoned ${Math.round(r.drainHeal)} from ${e.label} into your Core.`);
    }
  }
  const rp = tickAircraftStatuses(state.player, state.config);
  if (rp.dot) logEvent(state, `End of round: Burning dealt ${Math.round(rp.dot)} to you.`);
  if (rp.meltdown) logEvent(state, `Meltdown: ${Math.round(rp.meltdown)} funnelled into your Reactor Core.`);
  if (checkOutcome(state)) return;          // DoT can finish a Core
  for (const id of Object.keys(state.cooldowns)) state.cooldowns[id] = Math.max(0, state.cooldowns[id] - 1);
  state.round += 1;
  startAttackBuild(state);
}

/** WON if ALL enemy Cores are dead, LOST if yours is. Returns true if the battle ended. */
export function checkOutcome(state) {
  if (state.enemies.every((e) => !isAlive(e.components.core))) { state.phase = PHASES.WON; logEvent(state, 'All enemy Reactor Cores destroyed — VICTORY.'); return true; }
  if (!isAlive(state.player.components.core)) { state.phase = PHASES.LOST; logEvent(state, 'Your Reactor Core destroyed — DEFEAT.'); return true; }
  return false;
}

// ---- build-phase credit -----------------------------------------------------
export function spendCredit(state, ms) {
  state.creditLeftMs = Math.max(0, state.creditLeftMs - ms);
  return state.creditLeftMs;
}

/** Can the player still afford another action this build phase? */
export function canAfford(state) {
  if (state.attackTimeModel === 'cost') return state.creditLeftMs >= state.config.phase.actionCostMs;
  return state.creditLeftMs > 0;
}
