// =============================================================================
//  combat/statuses.js — the 5 offensive statuses + the 3 v1 attack synergies
// =============================================================================
//
//  Statuses are stored on a component as { key: {turns, potency, dot} } and last
//  whole TURNS (resolves). DESIGN §3.6 v1 synergies:
//    • Shatter = +50% damage to the focus     (shatterAmp)
//    • Frozen  = brittle, bonus damage         (frozenBrittle)
//    • Wildfire = Burning + Confused → spreads Burning to a neighbour
//  The full pairwise matrix is parked as v2.
// =============================================================================

import { hasStatus, isAlive } from '../core/components.js';
import { logEvent } from '../core/state.js';

// Fire ⊗ Freeze can't co-exist — applying one to a part that has the other wipes both (steam).
const OPPOSITE = { freeze: 'burning', burning: 'freeze' };

/**
 * Add or refresh a status (refresh = keep the stronger of turns/dot/potency).
 * Returns { canceled } if it annulled the opposite status instead of applying.
 */
export function applyStatus(component, key, { turns = 1, potency = 0, dot = 0 } = {}) {
  const opp = OPPOSITE[key];
  if (opp && component.statuses[opp]) { delete component.statuses[opp]; return { canceled: opp }; }
  const cur = component.statuses[key];
  if (cur) {
    cur.turns = Math.max(cur.turns, turns);
    cur.potency = Math.max(cur.potency || 0, potency);
    cur.dot = Math.max(cur.dot || 0, dot);
  } else {
    component.statuses[key] = { turns, potency, dot };
  }
  return { applied: key };
}

/** Remove all (offensive) debuffs from a component — what Cleanse does. */
export function cleanseComponent(component) {
  for (const key of ['freeze', 'confuse', 'burning', 'shatter', 'drain']) delete component.statuses[key];
}

/**
 * End-of-round tick on one aircraft: apply Burning DoT (+ Meltdown core-funnel for
 * Shattered+Burning parts), then decay every status and drop the expired ones.
 * Returns { dot, meltdown } — DoT dealt to parts, and extra funnelled into the Core.
 */
export function tickAircraftStatuses(aircraft, config) {
  let dot = 0;
  let meltdown = 0;
  const coreFrac = config?.effects?.synergy?.combos?.meltdown?.coreFrac || 0;
  const core = aircraft.components.core;
  for (const comp of Object.values(aircraft.components)) {
    const burn = comp.statuses.burning;
    // Burning bypasses the Reactor shield (DESIGN §1) — DoT ticks even on a shielded Core.
    if (burn && burn.turns > 0 && burn.dot > 0) {
      comp.hp -= burn.dot;
      dot += burn.dot;
      // Meltdown — a Shattered + Burning NON-core part funnels heat into the Core (bypasses shield).
      if (coreFrac > 0 && comp.id !== 'core' && hasStatus(comp, 'shatter') && core && core.hp > 0) {
        const funnel = burn.dot * coreFrac;
        core.hp -= funnel;
        meltdown += funnel;
      }
    }
    for (const [key, s] of Object.entries(comp.statuses)) {
      s.turns -= 1;
      if (s.turns <= 0) delete comp.statuses[key];
    }
  }
  return { dot, meltdown };
}

/**
 * Damage multiplier on the focus from its Frozen/Shattered statuses.
 * Both present = GLASS (clean ×mult); otherwise the single-status bonuses.
 */
export function attackSynergyMult(focus, config) {
  const syn = config.effects.synergy;
  const combos = syn.combos || {};
  const fr = hasStatus(focus, 'freeze');
  const sh = hasStatus(focus, 'shatter');
  if (fr && sh) return combos.glass?.mult ?? 2.0;     // Glass
  let m = 1;
  if (sh) m *= 1 + (syn.shatterAmp || 0);
  if (fr) m *= 1 + (syn.frozenBrittle || 0);
  return m;
}

/**
 * v2 pairwise combos that resolve at attack-resolve, wherever BOTH statuses of a pair
 * sit on the same component, across ALL enemies. (Glass is the one exception — it's a
 * focus-fire multiplier handled in attackSynergyMult; Meltdown ticks at end-of-round.)
 * Mutates state and logs each combo. Order matters: damage combos first, Collapse last.
 */
export function resolveCombos(state) {
  const c = state.config.effects.synergy.combos || {};
  const eff = state.config.effects;
  for (const enemy of state.enemies) {
    if (!isAlive(enemy.components.core)) continue;
    for (const comp of Object.values(enemy.components)) {
      if (!isAlive(comp)) continue;
      const has = (k) => hasStatus(comp, k);
      const at = `${enemy.label}·${comp.name}`;

      // Backfire — Shattered + Confused → self-damage burst (the enemy's own misfire)
      if (has('shatter') && has('confuse') && c.backfire?.selfDamage > 0) {
        comp.hp -= c.backfire.selfDamage;
        logEvent(state, `Backfire: ${at} misfires on its cracked armor → −${Math.round(c.backfire.selfDamage)} HP${isAlive(comp) ? '' : ' — DESTROYED'}.`);
      }
      // Vaporize — Burning + Drained → detonate the remaining Burn now + heal a fraction
      if (has('burning') && has('drain') && c.vaporize) {
        const b = comp.statuses.burning;
        const burst = (b.dot || 0) * (b.turns || 0);
        if (burst > 0) {
          comp.hp -= burst;
          const heal = burst * (c.vaporize.healFrac || 0);
          if (heal > 0) { const core = state.player.components.core; core.hp = Math.min(core.maxHp, core.hp + heal); }
          delete comp.statuses.burning;
          logEvent(state, `Vaporize: ${at} boils off — ${Math.round(burst)} burst${heal ? `, heal +${Math.round(heal)}` : ''}${isAlive(comp) ? '' : ' — DESTROYED'}.`);
        }
      }
      // Feedback Cascade — Confused + Drained → chain drain to the same part on an adjacent enemy
      if (has('confuse') && has('drain') && c.feedback) {
        const chain = (comp.statuses.drain?.potency || 0) * (eff.drain?.dmgPerPotency || 0) * (c.feedback.chainFrac || 0);
        const other = nextAliveEnemy(state, enemy.eid);
        const oc = other && other.components[comp.id];
        if (chain > 0 && oc && isAlive(oc)) {
          oc.hp -= chain;
          logEvent(state, `Feedback Cascade: ${at} misroutes → ${other.label}·${oc.name} −${Math.round(chain)} HP${isAlive(oc) ? '' : ' — DESTROYED'}.`);
        }
      }
      // Stasis Lock — Frozen + Confused → extend the freeze (deep lockdown)
      if (has('freeze') && has('confuse') && c.stasisLock?.extendTurns > 0) {
        comp.statuses.freeze.turns += c.stasisLock.extendTurns;
        logEvent(state, `Stasis Lock: ${at} held — freeze +${c.stasisLock.extendTurns} turn(s).`);
      }
      // Wildfire — Burning + Confused → spread Burning to a neighbour
      if (has('burning') && has('confuse') && c.wildfire) {
        const victimId = maybeWildfire(enemy, comp, state.config, state.rng);
        if (victimId) logEvent(state, `Wildfire: Burning spreads to ${enemy.label}·${enemy.components[victimId].name}.`);
      }
      // Collapse — Shattered + Drained → execute a part already below the HP threshold (LAST)
      if (has('shatter') && has('drain') && c.collapse && isAlive(comp)) {
        if (comp.hp < (c.collapse.hpThreshold || 0) * comp.maxHp) {
          comp.hp = 0;
          logEvent(state, `Collapse: ${at} ruptures (below ${Math.round((c.collapse.hpThreshold || 0) * 100)}% HP) — DESTROYED.`);
        }
      }
    }
  }
}

/** The next living enemy after `eid` (cyclic), or null — used by Feedback Cascade. */
function nextAliveEnemy(state, eid) {
  for (let i = 1; i < state.enemies.length; i++) {
    const e = state.enemies[(eid + i) % state.enemies.length];
    if (isAlive(e.components.core)) return e;
  }
  return null;
}

/** Wildfire: a Burning + Confused part spreads Burning to a random living neighbour. */
export function maybeWildfire(aircraft, focus, config, rng) {
  if (!(hasStatus(focus, 'burning') && hasStatus(focus, 'confuse'))) return null;
  const others = Object.values(aircraft.components).filter((c) => c !== focus && isAlive(c));
  if (!others.length) return null;
  const victim = others[Math.floor((rng ? rng() : Math.random()) * others.length)];
  const frac = config.effects.synergy.combos?.wildfire?.spreadFrac ?? 0.5;
  const dot = (focus.statuses.burning.dot || 0) * frac;
  applyStatus(victim, 'burning', { turns: focus.statuses.burning.turns, dot });
  return victim.id;
}
