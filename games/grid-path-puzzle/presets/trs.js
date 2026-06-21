// =============================================================================
//  presets/trs.js — the TRS Command palette/genPlan preset (shared, reusable)
// =============================================================================
//
//  A package-level preset (NOT part of the generic `module/`, and with NO import
//  from `games/strategy/`) that builds the per-component combo palettes + route
//  plans the TRS strategy game uses. The standalone playground imports this to
//  reproduce strategy puzzles faithfully; strategy's bridge can adopt it later
//  (the "reflect back" step) so the two never drift.
//
//  Mirrors `games/strategy/puzzle/palettes.js` + the component→effect/verb maps in
//  `games/strategy/core/components.js`, with one addition: `genPlan` takes an
//  optional `knobs` override so the playground can tweak generation live. With
//  `knobs = {}` the output is byte-identical to strategy's current palettes.
// =============================================================================

// component → offensive effect (attack) / defensive verb (defense)
export const ATTACK_EFFECT = { weapon: 'freeze', tower: 'confuse', generator: 'drain', launchpad: 'burning', engine: 'shatter' };
export const DEFENSE_VERB = { weapon: 'shield', generator: 'repair', tower: 'cleanse', engine: 'harden', launchpad: 'overclock' };

// min payload icons that must be chained for a successful solve (game.json mirror).
export const MIN_CHAIN = { freeze: 1, confuse: 1, drain: 1, burning: 1, shatter: 1, shield: 1, repair: 1, harden: 1, cleanse: 3, overclock: 3 };

export const STACK_CURVE = [1.0, 2.5, 4.5, 7.0, 10.0];
export const CHAIN_MULT = 1.5;

export const BASE_CELLS = {
  start:   { role: 'start',  passable: true,  color: '#eef2f7', label: 'START' },
  goal:    { role: 'goal',   passable: true,  color: '#2fae62', icon: '🏁', label: 'Goal' },
  normal:  { role: 'normal', passable: true,  color: '#39404e' },
  blocker: { role: 'normal', passable: false, color: '#2a2e39', icon: '⛔' },
  trap:    { role: 'normal', passable: true,  color: '#d04a4a', icon: '☠️', label: 'Trap', failsOnPass: true },
  // A SECOND hazard (the "burning" status): like a trap (fails on entry) but with
  // its own density + an animated flame icon. Placed only when burningDensity > 0.
  burning: { role: 'normal', passable: true,  color: '#7a2d18', icon: '🔥', label: 'Burning', failsOnPass: true, anim: 'flame', effectKind: 'danger' },
};

export const OFFENSE_META = {
  freeze:  { icon: '❄️', color: '#56c5e6', name: 'Freeze' },
  confuse: { icon: '🌀', color: '#c58cff', name: 'Confuse' },
  drain:   { icon: '🩸', color: '#7fd66b', name: 'Drain' },
  burning: { icon: '🔥', color: '#ff7043', name: 'Burning' },
  shatter: { icon: '💥', color: '#e6a24a', name: 'Shatter' },
};

export const DEFENSE_META = {
  shield:    { icon: '🛡️', color: '#5b8def', name: 'Shield' },
  repair:    { icon: '🔧', color: '#7fd66b', name: 'Repair' },
  cleanse:   { icon: '🧹', color: '#56c5e6', name: 'Cleanse' },
  harden:    { icon: '🪨', color: '#9b8d7a', name: 'Harden' },
  overclock: { icon: '⚡', color: '#e6c84a', name: 'Overclock' },
};

const CHAIN = { class: 'amplifier', icon: '🔗', color: '#e6a24a', op: 'multiply', potency: CHAIN_MULT };

// The player's LAUNCH-PAD health gates everyone's TRS quality (`trsMods`): a
// healthy pad is the easy baseline, and damage congests the grid (bigger + more
// blockers). Trap density is NOT modified by the pad.
export const LAUNCHPAD_MODS = {
  baseline:  {},                                  // full HP — no modifier
  damaged:   { sizeDelta: 1, blockerBonus: 0.10 }, // <= 50% HP
  destroyed: { sizeDelta: 2, blockerBonus: 0.20 }, // the cliff
};

// Recommended base grid size for a TRS board (the host adds the pad's sizeDelta).
export const DEFAULT_GRID_SIZE = 6;

/**
 * Build the routePlan for a skill. `knobs` overrides individual generation fields
 * (used by the playground); omit it (default {}) for the exact strategy behaviour.
 */
export function genPlan(skillKey, withChain, trsMods = {}, knobs = {}) {
  const cluster = knobs.cluster !== undefined ? knobs.cluster : false;
  const count = knobs.count || { min: 3, max: 5 };
  const placement = knobs.placement || 'onPrimaryRoute';
  // One payload group — its size is exactly `count` (min..max). (NOTE: this drops
  // the legacy extra "+1" singleton, so for verbs with MIN_CHAIN > 1 — Cleanse /
  // Overclock (3) — the caller must keep count.min high enough to be solvable.)
  const place = [
    { type: skillKey, count, placement, cluster, order: 0 },
  ];
  if (withChain) {
    // The chain 🔗 amplifier: placement + an optional appearance probability are
    // tunable. `chainPlacement` 'lateOnRoute' = near the goal, 'onPrimaryRoute' =
    // a random spot along the route. `chainChance` (0..1) defaults to 1 (100% —
    // always appears); < 1 means it may be absent.
    const chainChance = knobs.chainChance ?? 1;
    const chain = { type: 'chain', count: { exact: 1 }, placement: knobs.chainPlacement || 'lateOnRoute', order: 10 };
    if (chainChance < 1) chain.chance = chainChance;
    place.push(chain);
  }
  return {
    place,
    alternateRoutes: knobs.alternateRoutes ?? 1,
    primaryLengthTarget: knobs.primaryLengthTarget || 'long',
    safeLengthMode: 'shortest',
    // Launch Pad eases (healthy) or congests (damaged/destroyed) the grid: its
    // bonus layers ON TOP of the base density (or the playground's knob override),
    // so the preset still shifts density even when knobs set the base. With
    // knobs = {} this is identical to the strategy default (0.2 / 0.18 + bonus).
    trapDensity: Math.max(0, (knobs.trapDensity ?? 0) + (trsMods.trapBonus || 0)),
    blockerDensity: Math.max(0, (knobs.blockerDensity ?? 0.4) + (trsMods.blockerBonus || 0)),
    channeling: knobs.channeling || 'strong',
    lateGap: knobs.lateGap || { min: 1, max: 2 },
    endpointMode: 'edgeRandom',
    // "Burning" status: a second off-route hazard type at its own density (0 = off).
    burningType: 'burning',
    burningDensity: knobs.burningDensity ?? 0,
  };
}

/** Offensive palette config for a component (its effect = ATTACK_EFFECT[id]). */
export function offensivePalette(componentId, trsMods = {}, potencyCfg = {}, knobs = {}) {
  const effect = ATTACK_EFFECT[componentId];
  const meta = OFFENSE_META[effect];
  return {
    mode: 'offensive',
    rules: { maxSlots: 5, lockToFirstPayload: true, leadingRunOnly: true, amplifierOrderMatters: true, multiplicativeAmplifiers: true },
    stackCurve: potencyCfg.stackCurve || STACK_CURVE,
    base: BASE_CELLS,
    skills: {
      [effect]: { class: 'payload', icon: meta.icon, color: meta.color, value: { kind: 'linear', base: 1, unit: '' }, tiers: [{ atStack: 1, name: meta.name }] },
      chain: { ...CHAIN, potency: potencyCfg.chainMultiplier ?? CHAIN_MULT },
    },
    generation: genPlan(effect, true, trsMods, knobs),
  };
}

/** Defensive palette config for a component (its verb = DEFENSE_VERB[id]). */
export function defensivePalette(componentId, trsMods = {}, potencyCfg = {}, knobs = {}) {
  const verb = DEFENSE_VERB[componentId];
  const meta = DEFENSE_META[verb];
  return {
    mode: 'defensive',
    rules: { maxSlots: 5, lockToFirstPayload: false, stacking: 'longestAdjacentRun' },
    stackCurve: potencyCfg.stackCurve || STACK_CURVE,
    base: BASE_CELLS,
    skills: {
      [verb]: { class: 'payload', icon: meta.icon, color: meta.color, value: { kind: 'linear', base: 1, unit: '' }, tiers: [{ atStack: 1, name: meta.name }] },
    },
    generation: genPlan(verb, false, trsMods, knobs),
  };
}

/** Build the grid-path-puzzle nodeTypes catalog from a palette config. */
export function catalogFromConfig(cfg) {
  const nt = { ...cfg.base };
  for (const [k, d] of Object.entries(cfg.skills)) nt[k] = { role: 'normal', passable: true, ...d };
  return nt;
}

/** Convenience: build the full palette for {phase, component, ...}. */
export function buildPalette({ phase, component, preset = 'baseline', potencyCfg = {}, knobs = {} }) {
  const trsMods = LAUNCHPAD_MODS[preset] || {};
  return phase === 'attack'
    ? offensivePalette(component, trsMods, potencyCfg, knobs)
    : defensivePalette(component, trsMods, potencyCfg, knobs);
}
