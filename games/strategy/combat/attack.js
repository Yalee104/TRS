// =============================================================================
//  combat/attack.js — build (status per action) + attack resolve (firepower Focus)
// =============================================================================
//
//  Flow (DESIGN §3.2/§3.3, revised):
//    • Each solved weapon makes a PENDING action; the player then picks which ENEMY
//      part gets its status (valid targets only). The action also adds potency to a
//      shared firepower pool.
//    • At Resolve the player picks ONE enemy component as the Focus. The firepower
//      pool detonates there (× condition × synergy × armor); the queued statuses
//      land on their chosen parts (and cripple the enemy's defense-phase attack).
//  HP changes ONLY at resolve. Status ticking happens once per round (phases).
// =============================================================================

import { ATTACK_EFFECT, isEffectValidOn, statusTurns, hasStatus, isAlive } from '../core/components.js';
import { totalFirepower, conditionReport } from '../core/firepower.js';
import { coreShieldUp, effectiveEvasion } from '../core/cascade.js';
import { logEvent } from '../core/state.js';
import { applyStatus, attackSynergyMult, maybeWildfire } from './statuses.js';

const eAircraft = (state, eid) => state.enemies[eid];
const eName = (state, eid, id) => `${state.enemies[eid].label} · ${state.enemies[eid].components[id].name}`;

/** Sum the routing-quality `value` across a combo result's items (= potency). */
export function comboPotency(combo) {
  if (!combo) return 0;
  if (combo.special) return 8; // v1 palettes don't produce specials; safe fallback
  return (combo.items || []).reduce((s, it) => s + (it.value || 0), 0);
}

/** A weapon's TRS was solved — hold a pending action awaiting an enemy target. */
export function makePendingAttack(state, componentId, combo) {
  const effect = ATTACK_EFFECT[componentId];
  if (!effect) return null;
  state.usedComponents[componentId] = true; // one use per phase
  state.pendingAction = { side: 'attack', component: componentId, effect, potency: comboPotency(combo), label: combo?.label || effect, target: null };
  logEvent(state, `Solved ${state.player.components[componentId].name} TRS → ${effect} (potency ${state.pendingAction.potency.toFixed(1)}). Pick an enemy part to apply it.`);
  return state.pendingAction;
}

/** Which enemy parts (across all living enemies) the pending effect may target → [{eid, component}]. */
export function validAttackTargets(state) {
  if (!state.pendingAction) return [];
  const out = [];
  state.enemies.forEach((e, eid) => {
    if (!isAlive(e.components.core)) return; // defeated enemy — skip
    for (const id of Object.keys(e.components)) {
      if (isAlive(e.components[id]) && isEffectValidOn(state.pendingAction.effect, id)) out.push({ eid, component: id });
    }
  });
  return out;
}

/** Assign the pending action's status to a specific enemy's component and queue it. */
export function finalizeAttackTarget(state, eid, targetId) {
  const p = state.pendingAction;
  if (!p || !state.enemies[eid] || !isEffectValidOn(p.effect, targetId)) return null;
  p.target = { eid, component: targetId };
  state.queue.push(p);
  state.pendingAction = null;
  logEvent(state, `Queued ${p.effect} → ${eName(state, eid, targetId)}.`);
  return p;
}

/** Resolve the attack: place statuses (across enemies), then detonate the pool on the Focus. */
export function resolveAttack(state, eid, focusId) {
  const { config, player } = state;
  const enemy = eAircraft(state, eid);
  state.focus = { eid, component: focusId };
  const focus = enemy?.components[focusId];
  const summary = { eid, focus: focusId, damage: 0, healed: 0, wildfire: null };
  if (!focus) return summary;

  // 1) place each queued status on its (eid, component) target; accumulate firepower + drain heal.
  let addon = 0;
  let healed = 0;
  for (const a of state.queue) {
    const ec = config.effects[a.effect] || {};
    addon += a.potency * (ec.dmgPerPotency || 1);
    if (a.effect === 'drain') healed += a.potency * (ec.healPerPotency || 0);
    const te = state.enemies[a.target.eid];
    const tgt = te?.components[a.target.component];
    if (!tgt || !isEffectValidOn(a.effect, a.target.component)) continue;
    if (a.effect === 'burning') applyStatus(tgt, 'burning', { turns: statusTurns(a.potency, ec.turns), dot: a.potency * (ec.dotPerPotency || 0) });
    else applyStatus(tgt, a.effect, { turns: statusTurns(a.potency, ec.turns) });
  }

  // 2) the whole firepower pool → the single Focus, with synergy. The enemy Core is
  //    invulnerable while its shield is UP (DESIGN §1): statuses land, but it loses no HP.
  const rawFire = totalFirepower(player, addon, config);
  const synergy = attackSynergyMult(focus, config);
  const shielded = focusId === 'core' && coreShieldUp(enemy, config);
  const enemyEvasion = effectiveEvasion(enemy, config); // healthy, un-frozen enemy Engine dodges some fire
  const damage = shielded ? 0 : rawFire * synergy * (1 - enemyEvasion);
  focus.hp -= damage;

  if (healed) { const core = player.components.core; core.hp = Math.min(core.maxHp, core.hp + healed); }

  // 3) Wildfire on any enemy part (any enemy) that ended Burning + Confused.
  for (const e of state.enemies) {
    for (const c of Object.values(e.components)) {
      if (hasStatus(c, 'burning') && hasStatus(c, 'confuse')) { summary.wildfire = { eid: e.eid, id: maybeWildfire(e, c, config, state.rng) }; break; }
    }
    if (summary.wildfire) break;
  }

  // firepower breakdown so the player sees how their own condition/statuses scaled it
  const rep = conditionReport(player, config);
  logEvent(state, `Your firepower ${Math.round(rawFire)} = (base + ${Math.round(addon)} add-ons) × condition ${Math.round(rep.condition * 100)}%${rep.chokes.length ? ` (choked: ${rep.chokes.join(', ')})` : ''}.`);

  if (shielded) {
    logEvent(state, `RESOLVE → Focus ${eName(state, eid, focusId)}: ${Math.round(rawFire * synergy)} firepower BLOCKED by the Reactor shield (0 dmg). Destroy its shield-linked parts to expose the Core.`);
  } else {
    const syn = [];
    if (hasStatus(focus, 'shatter')) syn.push('Shatter +50%');
    if (hasStatus(focus, 'freeze')) syn.push('Frozen-brittle +40%');
    const evaNote = enemyEvasion > 0 ? ` × evade ${Math.round((1 - enemyEvasion) * 100)}% (enemy Engine)` : '';
    logEvent(state, `RESOLVE → Focus ${eName(state, eid, focusId)}: ${Math.round(rawFire)} firepower × synergy ${synergy.toFixed(2)}${syn.length ? ` (${syn.join(', ')})` : ''}${evaNote} = ${Math.round(damage)} dmg${isAlive(focus) ? '' : ' — DESTROYED'}.`);
  }
  if (healed) logEvent(state, `Drain healed your Core +${Math.round(healed)}.`);
  if (summary.wildfire && summary.wildfire.id) logEvent(state, `Wildfire spread Burning to ${eName(state, summary.wildfire.eid, summary.wildfire.id)}.`);

  summary.damage = damage; summary.healed = healed; summary.synergy = synergy; summary.shielded = shielded; summary.armor = 0;
  summary.destroyed = !isAlive(focus);
  return summary;
}
