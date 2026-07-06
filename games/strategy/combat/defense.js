// =============================================================================
//  combat/defense.js — build (defer to chain) + defense resolve (Table E v2)
// =============================================================================
//
//  Flow (DESIGN §4 / §3.7): play a part's TRS → pick which of YOUR parts gets the
//  verb → it's QUEUED (not applied yet). At resolve, each part's defensive chain
//  (carried states + this-phase verbs + breaks) is greedy-resolved into a profile
//  (shield/reduction/cap/reflect/immunity/dodge/repair/cleanse), then the enemies'
//  telegraphed strikes land through it. Overclock banks build-credit for next
//  attack. Sustain/Bastion/Reactive-Plating shields and Field Repair carry to the
//  next defense resolve.
// =============================================================================

import { DEFENSE_VERB, isAlive, isOwned } from '../core/components.js';
import { systemState, coreShieldUp, effectiveEvasion } from '../core/cascade.js';
import { conditionReport } from '../core/firepower.js';
import { logEvent } from '../core/state.js';
import { applyStatus, cleanseComponent, cleanseOldest } from './statuses.js';
import { comboPotency } from './attack.js';
import { planAttack, currentBudget } from './enemyAI.js';
import { resolveChain, DEFENSE_COMBOS } from './combos.js';

const NAME = (state, id) => state.player.components[id].name;

/** A part's TRS was solved — hold a pending defensive action awaiting a target. */
export function makePendingDefense(state, componentId, combo) {
  const verb = DEFENSE_VERB[componentId];
  if (!verb) return null;
  // count this phase's plays of the part — replays get a congested TRS (bridge reads this)
  state.defensePlays = state.defensePlays || {};
  state.defensePlays[componentId] = (state.defensePlays[componentId] || 0) + 1;
  state.pendingDefense = { side: 'defense', component: componentId, verb, potency: comboPotency(combo), label: combo?.label || verb, target: null };
  logEvent(state, `Solved ${state.player.components[componentId].name} TRS → ${verb} (potency ${state.pendingDefense.potency.toFixed(1)}). Pick a part to protect.`);
  return state.pendingDefense;
}

/** Queue the pending defense onto a chosen own component (resolved at defense-resolve). */
export function finalizeDefenseTarget(state, targetId) {
  const p = state.pendingDefense;
  const target = state.player.components[targetId];
  if (!p || !target || !isAlive(target)) return null;
  p.target = targetId;
  state.queue.push(p);
  state.pendingDefense = null;
  logEvent(state, `Queued ${p.verb} (potency ${p.potency.toFixed(1)}) → ${NAME(state, targetId)}.`);
  return p;
}

/** Magnitude of a queued defensive verb (shield absorb / repair HP / harden %). */
function defMag(verb, potency, D) {
  if (verb === 'shield') return potency * D.shield.absorbPerPotency;
  if (verb === 'repair') return potency * D.repair.hpPerPotency;
  if (verb === 'harden') return Math.min(D.harden.maxReduction, potency * D.harden.reductionPerPotency);
  return 0;
}

/** Resolve one part's defensive chain into a profile (and run its cleanse). */
function buildDefenseProfile(state, comp, queued) {
  const D = state.config.defense;
  const K = D.combos || {};
  const profile = { shield: 0, repair: 0, hardenFrac: 0, capFrac: 0, reflectFrac: 0, immune: false, dodge: false, hotNext: 0, persistShield: false, cleanseMode: null, firstHit: false, lossSoFar: 0, names: [] };

  const active = [];
  if (comp.carry && comp.carry.shield > 0) active.push({ key: 'shield', fresh: false, mag: comp.carry.shield, carried: true });
  const queuedEntries = queued.map((a) => (a.brk ? { brk: true } : { key: a.verb, fresh: true, potency: a.potency, mag: defMag(a.verb, a.potency, D) }));
  const chain = [...active, ...queuedEntries];
  comp.carry = null; // consumed into this resolve (re-set below if a combo persists)
  if (!chain.length) return profile;

  const { combos, leftovers } = resolveChain(chain, DEFENSE_COMBOS);

  for (const c of combos) {
    const get = (k) => (c.a.key === k ? c.a : (c.b.key === k ? c.b : null));
    profile.names.push(c.def.name);
    switch (c.def.name) {
      case 'Sustain': profile.shield += get('shield').mag; profile.persistShield = true; break;  // shield persists; Repair's heal is consumed (no HP)
      case 'Purified Barrier': profile.shield += get('shield').mag; profile.immune = true; break;
      case 'Bastion': profile.shield += get('shield').mag; profile.capFrac = K.bastion?.capFrac || 0; profile.persistShield = true; break;
      case 'Reactive Plating': profile.shield += get('shield').mag; profile.reflectFrac = K.reactivePlating?.reflectFrac || 0; profile.persistShield = true; break;
      case 'Field Repair': profile.repair += get('repair').mag; profile.hotNext += get('repair').mag; break;
      case 'Deflect': profile.dodge = true; break;        // no cleanse (replaces Cleanse base)
      case 'Reboot': profile.cleanseMode = 'all'; break;  // no credit (replaces Overclock base)
      default: break;
    }
  }
  for (const e of leftovers) {
    if (e.brk) continue;
    if (e.key === 'shield') profile.shield += e.mag;
    else if (e.key === 'repair') profile.repair += e.mag;
    else if (e.key === 'harden') profile.hardenFrac = Math.min(D.harden.maxReduction, profile.hardenFrac + e.mag);
    else if (e.key === 'overclock') state.creditBonusMs = (state.creditBonusMs || 0) + (D.overclock.creditBonusMs || 0);
    else if (e.key === 'cleanse') profile.cleanseMode = profile.cleanseMode || 'oldest';
  }

  if (profile.names.length) logEvent(state, `${comp.name}: ${profile.names.join(' + ')} formed.`);

  // cleanse happens before the strikes land
  if (profile.cleanseMode === 'all') cleanseComponent(comp);
  else if (profile.cleanseMode === 'oldest') cleanseOldest(comp);

  return profile;
}

/** Reflect target on the attacking enemy: lowest-HP part, but Core first if its shield is down. */
function reflectTarget(enemy, config) {
  const core = enemy.components.core;
  if (core && core.hp > 0 && !coreShieldUp(enemy, config)) return core;
  let best = null;
  for (const c of Object.values(enemy.components)) if (c.hp > 0 && (!best || c.hp < best.hp)) best = c;
  return best;
}

/** Resolve EVERY living enemy's telegraphed attack against the pre-loaded defenses. */
export function resolveDefense(state) {
  const { player, config } = state;
  const evasion = effectiveEvasion(player, config);
  const summary = { hits: [], totalDamage: 0 };

  // 1) resolve each part's defensive chain into a profile (runs cleanse, banks Overclock credit)
  const queuedBy = {};
  for (const x of state.queue) { (queuedBy[x.target] ||= []).push(x); }
  const profiles = {};
  for (const comp of Object.values(player.components)) profiles[comp.id] = buildDefenseProfile(state, comp, queuedBy[comp.id] || []);

  // 2) enemy strikes land through the profiles
  for (const enemy of state.enemies) {
    if (!isAlive(enemy.components.core)) continue;
    const entries = (enemy.telegraph && enemy.telegraph.entries) || planAttack(state, enemy).entries;
    const budget = currentBudget(state, enemy);
    const brownout = systemState(enemy, config).brownout;
    const rep = conditionReport(enemy, config);
    logEvent(state, `${enemy.label} attacks: budget ${Math.round(budget)} = base ${config.archetypes[enemy.archetype].damageBudget} × condition ${Math.round(rep.condition * 100)}%${brownout < 1 ? ` × brownout ${Math.round(brownout * 100)}%` : ''}${rep.chokes.length ? ` (choked: ${rep.chokes.join(', ')})` : ''}.`);

    for (const entry of entries) {
      let target = player.components[entry.component];
      if (!target || !isOwned(target) || !isAlive(target)) target = (isAlive(player.components.core) && !coreShieldUp(player, config)) ? player.components.core : null;
      if (!target) continue;
      const p = profiles[target.id];
      const incoming = entry.share * budget;
      let dmg = incoming;

      // Core shield blocks all HP damage while UP (DESIGN §1)
      if (target.id === 'core' && coreShieldUp(player, config)) {
        logEvent(state, `· ${target.name}: incoming ${Math.round(incoming)} BLOCKED by the Reactor shield.`);
        summary.hits.push({ component: target.id, damage: 0 });
        continue;
      }

      let note = '';
      if (p.dodge && !p.firstHit) {                      // Deflect: dodge the first hit entirely
        p.firstHit = true; dmg = 0; note = ', Deflect (dodged)';
      } else {
        const firstHit = !p.firstHit; p.firstHit = true;
        const reduction = evasion + (firstHit ? p.hardenFrac : 0);
        dmg *= 1 - Math.min(0.9, reduction);
        let absorbed = 0;
        if (p.shield > 0) { absorbed = Math.min(dmg, p.shield); p.shield -= absorbed; dmg -= absorbed; }
        if (p.capFrac > 0) {                              // Bastion: cap total loss this resolve
          const allowed = Math.max(0, p.capFrac * target.maxHp - p.lossSoFar);
          if (dmg > allowed) { dmg = allowed; note += ', Bastion cap'; }
        }
        p.lossSoFar += dmg;
        if (p.reflectFrac > 0 && absorbed > 0) {          // Reactive Plating: reflect the absorbed
          const rt = reflectTarget(enemy, config);
          if (rt) { const refl = absorbed * p.reflectFrac; rt.hp -= refl; note += `, reflect ${Math.round(refl)}→${enemy.label}·${rt.name}`; }
        }
        target.hp -= dmg;
        if (reduction > 0) note = `, −${Math.round(Math.min(0.9, reduction) * 100)}% reduced` + note;
        if (absorbed > 0) note += `, ${Math.round(absorbed)} shielded`;
      }

      if (entry.status && !p.immune) applyStatus(target, entry.status, { turns: 2 }, config);
      else if (entry.status && p.immune) note += `, ${entry.status} warded`;
      logEvent(state, `· ${target.name}: incoming ${Math.round(incoming)}${note} → −${Math.round(dmg)} HP${entry.status && !p.immune ? ` (+${entry.status})` : ''}${isAlive(target) ? '' : ' — DESTROYED'}.`);
      summary.hits.push({ component: target.id, damage: dmg });
      summary.totalDamage += dmg;
    }
  }

  // 3) repair pass (base + carried Field-Repair HoT) and carryover for next defense resolve
  for (const comp of Object.values(player.components)) {
    const p = profiles[comp.id];
    const heal = (p.repair || 0) + (comp.carryHeal || 0);
    if (heal > 0 && isAlive(comp)) {
      const before = comp.hp; comp.hp = Math.min(comp.maxHp, comp.hp + heal);
      if (comp.hp !== before) logEvent(state, `· repaired ${comp.name} +${Math.round(comp.hp - before)} HP.`);
    }
    comp.carryHeal = p.hotNext || 0;                       // Field Repair → next defense resolve
    comp.carry = (p.persistShield && p.shield > 0 && isAlive(comp)) ? { shield: p.shield } : null;
    comp.defenses = {};
  }
  return summary;
}
