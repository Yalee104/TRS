// =============================================================================
//  core/cascade.js — systemic degradation (gradient while damaged, cliff on kill)
// =============================================================================
//
//  systemState(aircraft, config) derives the "what still works" facts for one
//  aircraft from its component HP. Mirrored for both sides. DESIGN §7:
//    • Generator  — Core armor fades with HP; destroyed → armor 0 + brownout ×0.5
//    • Weapon     — destroyed → base firepower collapses
//    • Tower      — destroyed → blind (no telegraph) + aim scatters
//    • Engine     — evasion fades with HP; destroyed → no evasion + lose initiative
//    • Launch Pad — destroyed → TRS congests (bigger grid, more blockers, less budget)
// =============================================================================

import { isAlive, hpFrac } from './components.js';

export function systemState(aircraft, config) {
  const c = aircraft.components;
  const casc = config.cascade;

  const generatorAlive = isAlive(c.generator);
  const weaponAlive = isAlive(c.weapon);
  const towerAlive = isAlive(c.tower);
  const engineAlive = isAlive(c.engine);
  const launchpadAlive = isAlive(c.launchpad);

  return {
    // Generator → Core armor (gradient) + brownout (cliff)
    coreArmor: generatorAlive ? casc.coreArmorAtFullGenerator * hpFrac(c.generator) : 0,
    brownout: generatorAlive ? 1 : casc.brownoutMult,

    // Weapon → base firepower (cliff)
    baseMult: weaponAlive ? 1 : casc.weaponDestroyedBaseMult,

    // Tower → telegraph vision (self) + aim (when attacking)
    telegraphVisible: towerAlive,
    aimMult: towerAlive ? 1 : casc.towerDestroyedAimMult,

    // Engine → evasion (gradient) + initiative (cliff)
    evasion: engineAlive ? casc.evasionAtFullEngine * hpFrac(c.engine) : 0,
    hasInitiative: engineAlive,

    // Launch Pad → TRS quality (GRADIENT while alive, cliff when destroyed):
    //   healthy → eased grid (bonus × HP); damaged → fades to baseline; dead → congested.
    trsMods: launchpadAlive ? launchpadBonus(c.launchpad, casc) : { ...casc.launchpadDestroyed },
  };
}

/** Eased-grid bonus from a living Launch Pad, scaled by its HP (full HP = full bonus). */
function launchpadBonus(launchpad, casc) {
  const full = casc.launchpadFullBonus || {};
  const f = hpFrac(launchpad);
  return {
    sizeDelta: Math.round((full.sizeDelta || 0) * f),
    blockerBonus: (full.blockerBonus || 0) * f,
    trapBonus: (full.trapBonus || 0) * f,
  };
}

/**
 * Reactor-Core shield (DESIGN §1/§7). The Core is invulnerable while the shield
 * is UP; the shield drops only once the configured shield-linked parts that have
 * been DESTROYED contribute percentages summing to >= threshold. Returns a full
 * status object so the renderer/tooltip can explain it.
 */
export function coreShieldStatus(aircraft, config) {
  const cfg = (config && config.coreShield) || null;
  const contributors = (cfg && cfg.contributors) || {};
  const threshold = (cfg && cfg.threshold) != null ? cfg.threshold : 100;
  let downSum = 0;
  const remaining = [];
  for (const [id, pct] of Object.entries(contributors)) {
    const c = aircraft.components[id];
    if (c && !isAlive(c)) downSum += pct;
    else remaining.push({ id, pct });
  }
  const up = !!cfg && downSum < threshold;
  return { up, downSum, threshold, remaining, contributors };
}

/** Convenience boolean: is this aircraft's Core shield currently UP? */
export function coreShieldUp(aircraft, config) {
  return coreShieldStatus(aircraft, config).up;
}
