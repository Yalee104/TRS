// =============================================================================
//  core/components.js — the six components each aircraft is made of
// =============================================================================
//
//  A component is a small system with its own HP and live statuses. The *meaning*
//  of each component (what it powers, its offensive/defensive verb) lives in the
//  design doc and in the combat modules; this file is just the data + tiny helpers
//  that everything else reuses. Pure logic, no DOM — runs under plain Node.
// =============================================================================

/** Canonical component ids, in board order (Core first = the heart). */
export const COMPONENT_IDS = ['core', 'generator', 'weapon', 'tower', 'engine', 'launchpad'];

/** Which offensive verb each component fires (Table A v1). */
export const ATTACK_EFFECT = {
  weapon: 'freeze',
  tower: 'confuse',
  generator: 'drain',
  launchpad: 'burning',
  engine: 'shatter',
};

/** Which defensive verb each component provides (Defense v1 / B.0). */
export const DEFENSE_VERB = {
  weapon: 'shield',
  generator: 'repair',
  tower: 'cleanse',
  engine: 'harden',
  launchpad: 'overclock',
};

/**
 * Effect → which target components it is meaningful on. `'*'` = any part.
 * v1 simplification (parked): Table B effect-validity is dropped — ANY status can be
 * applied to ANY component (incl. the Core). The richer matching rules may return later;
 * `isEffectValidOn` stays the single gate so re-tightening only means editing this map.
 */
export const EFFECT_VALID_TARGETS = {
  freeze: '*',
  confuse: '*',
  drain: '*',
  burning: '*',
  shatter: '*',
};

/** Build a fresh component from its config entry. */
export function makeComponent(id, cfg) {
  return {
    id,
    name: cfg.name,
    hp: cfg.hp,
    maxHp: cfg.hp,
    baseArmor: cfg.armor ?? 0,
    statuses: {},   // { freeze:{turns,potency}, burning:{turns,potency,dot}, shatter:{turns}, confuse:{turns}, ... }
    defenses: {},   // pre-loaded defensive buffs for the upcoming resolve { shield, repair, cleanse, harden, overclock }
  };
}

export const isAlive = (c) => c.hp > 0;
export const hpFrac = (c) => (c.maxHp > 0 ? Math.max(0, c.hp) / c.maxHp : 0);

export const hasStatus = (c, key) => !!c.statuses[key] && c.statuses[key].turns > 0;

/** Is an effect meaningful on this target component? (Table B) */
export function isEffectValidOn(effect, componentId) {
  const valid = EFFECT_VALID_TARGETS[effect];
  if (!valid) return false;
  return valid === '*' || valid.includes(componentId);
}

/** turns = clamp(round(potency / divisor), min, max) — see effects config. */
export function statusTurns(potency, turnsCfg) {
  if (!turnsCfg) return 0;
  const t = Math.round(potency / (turnsCfg.divisor || 1));
  return Math.max(turnsCfg.min ?? 1, Math.min(turnsCfg.max ?? 3, t));
}
