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

import { isAlive, isOwned, hpFrac, hasStatus } from './components.js';

/** A part provides its system only if the owner actually has it AND it's alive. */
const works = (c) => isOwned(c) && isAlive(c);

export function systemState(aircraft, config) {
  const c = aircraft.components;
  const casc = config.cascade;

  // Unowned parts (run meta-layer) behave like missing ones: no system benefit. The
  // Core *shield* is intentionally NOT gated this way (see coreShieldStatus) so an
  // early run with few parts isn't born with an exposed Core.
  const generatorAlive = works(c.generator);
  const weaponAlive = works(c.weapon);
  const towerAlive = works(c.tower);
  const engineAlive = works(c.engine);
  const launchpadAlive = works(c.launchpad);

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
  // Run-mode "Breach": enemy Cores may use a weaker threshold (cfg.enemyThreshold,
  // injected by effectiveConfig) so fights close out faster. Absent from the base
  // config, so single-battle behaviour is unchanged.
  const baseThreshold = (aircraft.side === 'enemy' && cfg && cfg.enemyThreshold != null)
    ? cfg.enemyThreshold
    : ((cfg && cfg.threshold) != null ? cfg.threshold : 100);
  // Scale the threshold to the contributor mass the aircraft actually OWNS, so a small
  // (few-component) aircraft's Core is still exposable (its owned parts may never sum to the
  // absolute threshold). Full-6 → activeMass = totalMass → threshold unchanged. Tunable off.
  const scaleToOwned = !cfg || cfg.scaleToOwned !== false;
  let downSum = 0;
  let activeMass = 0;
  let totalMass = 0;
  const remaining = [];
  for (const [id, pct] of Object.entries(contributors)) {
    totalMass += pct;
    const c = aircraft.components[id];
    if (!c || !isOwned(c)) continue;            // a part you don't own isn't part of the shield
    activeMass += pct;
    if (!isAlive(c)) downSum += pct;
    else remaining.push({ id, pct });
  }
  const threshold = (scaleToOwned && totalMass > 0)
    ? Math.round(baseThreshold * (activeMass / totalMass))
    : baseThreshold;
  const up = !!cfg && activeMass > 0 && downSum < threshold;
  return { up, downSum, threshold, scaledThreshold: threshold, activeMass, remaining, contributors };
}

/** Convenience boolean: is this aircraft's Core shield currently UP? */
export function coreShieldUp(aircraft, config) {
  return coreShieldStatus(aircraft, config).up;
}

// --- freeze-suspends-system (DESIGN §3.4): Freeze knocks a part's system offline for
//     its duration, on top of the firepower choke. Tower → aim; Engine → evasion.
//     Generator (shield/brownout) and Launch Pad (TRS) stay tied to destruction.

/** A part is "disabled" if Frozen OR Stasis-Locked (the Frozen+Confused combo). */
const isDisabled = (c) => hasStatus(c, 'freeze') || hasStatus(c, 'stasisLock');

/** Is the Tower providing its system right now? (owned, alive AND not frozen/locked) */
export function towerActive(aircraft) {
  return works(aircraft.components.tower) && !isDisabled(aircraft.components.tower);
}

/** Aim multiplier: full if the Tower is active, else the destroyed/jammed penalty. */
export function effectiveAim(aircraft, config) {
  return towerActive(aircraft) ? 1 : config.cascade.towerDestroyedAimMult;
}

/** Evasion this aircraft actually has — zero while its Engine is frozen/locked. */
export function effectiveEvasion(aircraft, config) {
  if (isDisabled(aircraft.components.engine)) return 0;
  return systemState(aircraft, config).evasion;
}
