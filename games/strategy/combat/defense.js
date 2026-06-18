// =============================================================================
//  combat/defense.js — build (TRS first, then pick own part) + defense resolve
// =============================================================================
//
//  Flow (DESIGN §4, revised to mirror attack):
//    • Play a component's TRS → on success pick which of YOUR parts receives the
//      defensive verb (dead parts greyed). Reusable; verbs STACK additively.
//    • Resolve: the enemy's telegraphed attack lands through the pre-loaded
//      defenses, in order: Cleanse → Harden/Evade → Shield → Repair → HP.
//  HP changes ONLY at resolve.
// =============================================================================

import { DEFENSE_VERB, isAlive } from '../core/components.js';
import { systemState, coreShieldUp, effectiveEvasion } from '../core/cascade.js';
import { conditionReport } from '../core/firepower.js';
import { logEvent } from '../core/state.js';
import { applyStatus, cleanseComponent } from './statuses.js';
import { comboPotency } from './attack.js';
import { planAttack, currentBudget } from './enemyAI.js';

const NAME = (state, id) => state.player.components[id].name;

/** A component's TRS was solved — hold a pending defensive action awaiting a target. */
export function makePendingDefense(state, componentId, combo) {
  const verb = DEFENSE_VERB[componentId];
  if (!verb) return null;
  state.pendingDefense = { side: 'defense', component: componentId, verb, potency: comboPotency(combo), label: combo?.label || verb, target: null };
  logEvent(state, `Solved ${state.player.components[componentId].name} TRS → ${verb} (potency ${state.pendingDefense.potency.toFixed(1)}). Pick a part to protect.`);
  return state.pendingDefense;
}

/** Pre-load the pending defense onto a chosen own component (stacks additively). */
export function finalizeDefenseTarget(state, targetId) {
  const p = state.pendingDefense;
  const target = state.player.components[targetId];
  if (!p || !target || !isAlive(target)) return null;
  const d = state.config.defense;
  const def = target.defenses;
  let added; // a human breakdown of how much this solve contributed
  if (p.verb === 'shield') {
    const amt = p.potency * d.shield.absorbPerPotency;
    def.shield = (def.shield || 0) + amt;
    added = `+${Math.round(amt)} absorb (potency ${p.potency.toFixed(1)} × ${d.shield.absorbPerPotency})`;
  } else if (p.verb === 'repair') {
    const amt = p.potency * d.repair.hpPerPotency;
    def.repair = (def.repair || 0) + amt;
    added = `+${Math.round(amt)} HP (potency ${p.potency.toFixed(1)} × ${d.repair.hpPerPotency})`;
  } else if (p.verb === 'cleanse') {
    def.cleanse = true;
    added = '(removes already-active statuses at resolve)';
  } else if (p.verb === 'harden') {
    def.harden = Math.min(d.harden.maxReduction, (def.harden || 0) + p.potency * d.harden.reductionPerPotency);
    added = `+${Math.round(p.potency * d.harden.reductionPerPotency * 100)}% reduction (cap ${Math.round(d.harden.maxReduction * 100)}%)`;
  } else if (p.verb === 'overclock') {
    def.overclock = (def.overclock || 0) + p.potency * d.overclock.boostPerPotency;
    added = `+${Math.round(p.potency * d.overclock.boostPerPotency * 100)}% reduction`;
  }

  p.target = targetId;
  state.queue.push(p);
  state.pendingDefense = null;
  logEvent(state, `Queued ${p.verb} ${added} → ${NAME(state, targetId)} (now ${describeDefenses(def)}).`);
  return p;
}

function describeDefenses(def) {
  const parts = [];
  if (def.shield) parts.push(`shield ${Math.round(def.shield)}`);
  if (def.repair) parts.push(`repair ${Math.round(def.repair)}`);
  if (def.harden) parts.push(`harden ${Math.round(def.harden * 100)}%`);
  if (def.overclock) parts.push(`overclock ${Math.round(def.overclock * 100)}%`);
  if (def.cleanse) parts.push('cleanse');
  return parts.join(', ') || 'none';
}

/** Resolve the enemy's telegraphed attack against the pre-loaded defenses. */
export function resolveDefense(state) {
  const { player } = state;
  const entries = (state.telegraph && state.telegraph.entries) || planAttack(state).entries;
  const budget = currentBudget(state);
  const evasion = effectiveEvasion(player, state.config); // 0 while your Engine is frozen
  const summary = { hits: [], totalDamage: 0 };

  // Show how the enemy's CURRENT condition (HP + your statuses on its offence) scaled
  // the budget — e.g. a Confused Weapon Storage drops the blow.
  const arch = state.config.archetypes[state.archetype];
  const brownout = systemState(state.enemy, state.config).brownout;
  const rep = conditionReport(state.enemy, state.config);
  logEvent(state, `Enemy attacks: budget ${Math.round(budget)} = base ${arch.damageBudget} × condition ${Math.round(rep.condition * 100)}%${brownout < 1 ? ` × brownout ${Math.round(brownout * 100)}%` : ''}${rep.chokes.length ? ` (choked: ${rep.chokes.join(', ')})` : ''}.`);

  for (const entry of entries) {
    let target = player.components[entry.component];
    if (!target || !isAlive(target)) {
      // a telegraphed part died before resolve — bounce to the Core only if it's EXPOSED
      target = (isAlive(player.components.core) && !coreShieldUp(player, state.config)) ? player.components.core : null;
    }
    if (!target) continue;
    const def = target.defenses;
    let dmg = entry.share * budget;
    const incoming = dmg;

    // The Core's shield blocks all HP damage while it is UP (DESIGN §1).
    if (target.id === 'core' && coreShieldUp(player, state.config)) {
      if (def.cleanse) cleanseComponent(target);
      logEvent(state, `· ${target.name}: incoming ${Math.round(incoming)} BLOCKED by the Reactor shield (0 dmg).`);
      summary.hits.push({ component: target.id, damage: 0 });
      continue;
    }

    if (def.cleanse) cleanseComponent(target);
    // build a human reason for the % reduced (which buff/system contributed how much)
    const redParts = [];
    if (def.harden) redParts.push(`harden ${Math.round(def.harden * 100)}%`);
    if (def.overclock) redParts.push(`overclock ${Math.round(def.overclock * 100)}%`);
    if (evasion) redParts.push(`evade ${Math.round(evasion * 100)}% (Engine)`);
    const rawReduction = (def.harden || 0) + (def.overclock || 0) + evasion;
    const reduction = Math.min(0.9, rawReduction);
    dmg *= 1 - reduction;
    let absorbed = 0;
    if (def.shield > 0) { absorbed = Math.min(dmg, def.shield); def.shield -= absorbed; dmg -= absorbed; }
    target.hp -= dmg;

    if (entry.status) applyStatus(target, entry.status, { turns: 2 });
    const redText = reduction ? `, −${Math.round(reduction * 100)}% reduced [${redParts.join(' + ')}${rawReduction > 0.9 ? ', capped at 90%' : ''}]` : '';
    logEvent(state, `· ${target.name}: incoming ${Math.round(incoming)}${redText}${absorbed ? `, ${Math.round(absorbed)} shielded` : ''} → −${Math.round(dmg)} HP${entry.status ? ` (+${entry.status})` : ''}${isAlive(target) ? '' : ' — DESTROYED'}.`);
    summary.hits.push({ component: target.id, damage: dmg });
    summary.totalDamage += dmg;
  }

  // Repair pass: heals every part that pre-loaded a repair (hit or not).
  for (const comp of Object.values(player.components)) {
    if (comp.defenses.repair > 0) {
      const before = comp.hp;
      comp.hp = Math.min(comp.maxHp, comp.hp + comp.defenses.repair);
      if (comp.hp !== before) logEvent(state, `· repaired ${comp.name} +${Math.round(comp.hp - before)} HP.`);
    }
    comp.defenses = {}; // defenses consumed
  }
  return summary;
}
