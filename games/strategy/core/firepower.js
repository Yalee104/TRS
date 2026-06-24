// =============================================================================
//  core/firepower.js — the condition → firepower heartbeat (DESIGN §6)
// =============================================================================
//
//  Your attack-resolve damage = (base + queued add-ons) × firepowerMult × brownout.
//  firepowerMult is driven by Combat Condition: a weighted blend of your
//  offense-critical components' HP, each cut by any enemy debuff on it (Frozen
//  weapon ≈ ×0, Drained ≈ ×0.6). The curve shape + floor + weights all come from
//  config, so the feel is tunable without code.
// =============================================================================

import { hpFrac, isAlive, isOwned } from './components.js';
import { systemState } from './cascade.js';

const DEBUFF_KEYS = ['freeze', 'drain', 'confuse', 'burning', 'shatter'];

/** Worst debuff factor currently on a component (1 = no debuff choking it). */
function debuffFactorOf(component, config) {
  const table = config.firepower.debuffFactor || {};
  let factor = 1;
  for (const key of DEBUFF_KEYS) {
    const s = component.statuses[key];
    if (s && s.turns > 0 && table[key] != null) factor = Math.min(factor, table[key]);
  }
  // Stasis Lock (Frozen+Confused combo) disables the part like Freeze → ×0.
  const lock = component.statuses.stasisLock;
  if (lock && lock.turns > 0) factor = 0;
  return factor;
}

/** Combat Condition in [0,1]: Σ weight × hpFrac × debuffFactor over weighted parts. */
export function combatCondition(aircraft, config) {
  const weights = config.firepower.weights || {};
  let cond = 0;
  for (const [id, w] of Object.entries(weights)) {
    const comp = aircraft.components[id];
    if (!comp || !isOwned(comp)) continue;   // an unowned part contributes nothing (like a missing one)
    cond += w * hpFrac(comp) * debuffFactorOf(comp, config);
  }
  return Math.max(0, Math.min(1, cond));
}

/** The worst (smallest) debuff factor currently choking a component + which status. */
function worstDebuff(component, config) {
  const table = config.firepower.debuffFactor || {};
  let key = null;
  let factor = 1;
  for (const k of DEBUFF_KEYS) {
    const s = component.statuses[k];
    if (s && s.turns > 0 && table[k] != null && table[k] < factor) { factor = table[k]; key = k; }
  }
  return { key, factor };
}

/**
 * Human-readable breakdown of an aircraft's Combat Condition for the event log:
 * which weighted parts are choking firepower (destroyed / debuffed / wounded) and
 * by how much. Lets the player see exactly how statuses bled an attack.
 */
export function conditionReport(aircraft, config) {
  const weights = config.firepower.weights || {};
  const condition = combatCondition(aircraft, config);
  const mult = firepowerMult(condition, config);
  const chokes = [];
  for (const id of Object.keys(weights)) {
    const comp = aircraft.components[id];
    if (!comp) continue;
    if (!isOwned(comp)) { chokes.push(`${comp.name} not owned ×0`); continue; }
    if (!isAlive(comp)) { chokes.push(`${comp.name} destroyed ×0`); continue; }
    const wd = worstDebuff(comp, config);
    const hf = hpFrac(comp);
    if (wd.key) chokes.push(`${comp.name} ${wd.key} ×${wd.factor}`);
    else if (hf < 0.999) chokes.push(`${comp.name} ${Math.round(hf * 100)}% HP`);
  }
  return { condition, mult, chokes };
}

/** Map condition → multiplier via the configured curve (gradient | thresholds | steep). */
export function firepowerMult(condition, config) {
  const fp = config.firepower;
  const floor = fp.floor ?? 0.4;
  switch (fp.curve) {
    case 'thresholds': {
      const band = (fp.thresholds || []).find((t) => condition >= t.min);
      return band ? band.mult : floor;
    }
    case 'steep':
      return floor + (1 - floor) * condition * condition;
    case 'gradient':
    default:
      return floor + (1 - floor) * condition;
  }
}

/**
 * Total firepower an aircraft brings to an attack resolve.
 * @param addonPotency  sum of `value` potency across queued attack actions (the TRS add-ons)
 */
export function totalFirepower(aircraft, addonPotency, config) {
  const sys = systemState(aircraft, config);
  const cond = combatCondition(aircraft, config);
  const mult = firepowerMult(cond, config);
  const base = config.firepower.base * sys.baseMult;
  return (base + addonPotency) * mult * sys.brownout;
}
