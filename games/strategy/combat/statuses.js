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

/** Add or refresh a status (refresh = keep the stronger of turns/dot). */
export function applyStatus(component, key, { turns = 1, potency = 0, dot = 0 } = {}) {
  const cur = component.statuses[key];
  if (cur) {
    cur.turns = Math.max(cur.turns, turns);
    cur.potency = Math.max(cur.potency || 0, potency);
    cur.dot = Math.max(cur.dot || 0, dot);
  } else {
    component.statuses[key] = { turns, potency, dot };
  }
}

/** Remove all (offensive) debuffs from a component — what Cleanse does. */
export function cleanseComponent(component) {
  for (const key of ['freeze', 'confuse', 'burning', 'shatter', 'drain']) delete component.statuses[key];
}

/**
 * End-of-resolve tick on one aircraft: apply Burning DoT, then decay every
 * status by a turn and drop the expired ones. Returns total DoT dealt.
 */
export function tickAircraftStatuses(aircraft) {
  let dot = 0;
  for (const comp of Object.values(aircraft.components)) {
    const burn = comp.statuses.burning;
    // Burning is the ONE thing that bypasses the Reactor shield (DESIGN §1) — its DoT
    // ticks on the Core even while shielded, making it the anti-shield tool.
    if (burn && burn.turns > 0 && burn.dot > 0) {
      comp.hp -= burn.dot;
      dot += burn.dot;
    }
    for (const [key, s] of Object.entries(comp.statuses)) {
      s.turns -= 1;
      if (s.turns <= 0) delete comp.statuses[key];
    }
  }
  return dot;
}

/** Damage multiplier on the focus from its current Frozen/Shattered statuses. */
export function attackSynergyMult(focus, config) {
  const syn = config.effects.synergy;
  let m = 1;
  if (hasStatus(focus, 'shatter')) m *= 1 + (syn.shatterAmp || 0);
  if (hasStatus(focus, 'freeze')) m *= 1 + (syn.frozenBrittle || 0);
  return m;
}

/** Wildfire: a Burning + Confused focus spreads Burning to a random living neighbour. */
export function maybeWildfire(aircraft, focus, config, rng) {
  if (!(hasStatus(focus, 'burning') && hasStatus(focus, 'confuse'))) return null;
  const others = Object.values(aircraft.components).filter((c) => c !== focus && isAlive(c));
  if (!others.length) return null;
  const victim = others[Math.floor((rng ? rng() : Math.random()) * others.length)];
  const dot = (focus.statuses.burning.dot || 0) * (config.effects.synergy.wildfireSpreadFrac || 0.5);
  applyStatus(victim, 'burning', { turns: focus.statuses.burning.turns, dot });
  return victim.id;
}
