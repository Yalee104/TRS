// =============================================================================
//  puzzle/palettes.js — build a per-component TRS combo config on the fly
// =============================================================================
//
//  Each component fires a DIFFERENT effect (Table A), so each gets its own combo
//  config: a single payload skill (+ a Chain amplifier on offense) plus a route
//  plan that seeds the grid. The ComboEngine then turns the drawn route into a
//  result whose `value` we read as "potency". We generate these instead of
//  authoring 10 JSON files — same skills the engine understands, different mix.
//  The grid-path module + ComboEngine are imported, never modified.
// =============================================================================

import { ATTACK_EFFECT, DEFENSE_VERB } from '../core/components.js';

// Defaults if no potency config is supplied (kept in sync with config/game.json#potency).
const STACK_CURVE = [1.0, 2.5, 4.5, 7.0, 10.0];
const CHAIN_MULT = 1.5;

const BASE_CELLS = {
  start:   { role: 'start',  passable: true,  color: '#eef2f7', label: 'START' },
  goal:    { role: 'goal',   passable: true,  color: '#2fae62', icon: '🏁', label: 'Goal' },
  normal:  { role: 'normal', passable: true,  color: '#39404e' },
  blocker: { role: 'normal', passable: false, color: '#2a2e39', icon: '⛔' },
  trap:    { role: 'normal', passable: true,  color: '#d04a4a', icon: '☠️', label: 'Trap', failsOnPass: true },
};

const OFFENSE_META = {
  freeze:  { icon: '❄️', color: '#56c5e6', name: 'Freeze' },
  confuse: { icon: '🌀', color: '#c58cff', name: 'Confuse' },
  drain:   { icon: '🩸', color: '#7fd66b', name: 'Drain' },
  burning: { icon: '🔥', color: '#ff7043', name: 'Burning' },
  shatter: { icon: '💥', color: '#e6a24a', name: 'Shatter' },
};

const DEFENSE_META = {
  shield:    { icon: '🛡️', color: '#5b8def', name: 'Shield' },
  repair:    { icon: '🔧', color: '#7fd66b', name: 'Repair' },
  cleanse:   { icon: '🧹', color: '#56c5e6', name: 'Cleanse' },
  harden:    { icon: '🪨', color: '#9b8d7a', name: 'Harden' },
  overclock: { icon: '⚡', color: '#e6c84a', name: 'Overclock' },
};

const CHAIN = { class: 'amplifier', icon: '🔗', color: '#e6a24a', op: 'multiply', potency: CHAIN_MULT };

function genPlan(skillKey, withChain, trsMods = {}) {
  const place = [
    { type: skillKey, count: { min: 2, max: 4 }, placement: 'onPrimaryRoute', cluster: true, order: 0 },
    { type: skillKey, count: { exact: 1 }, placement: 'onPrimaryRoute', order: 1 },
  ];
  if (withChain) place.push({ type: 'chain', count: { exact: 1 }, placement: 'lateOnRoute', order: 10 });
  return {
    place,
    alternateRoutes: 1,
    primaryLengthTarget: 'long',
    safeLengthMode: 'shortest',
    // Launch Pad eases (healthy) or congests (damaged/destroyed) the grid via these densities.
    trapDensity: Math.max(0, 0.2 + (trsMods.trapBonus || 0)),
    blockerDensity: Math.max(0, 0.18 + (trsMods.blockerBonus || 0)),
    channeling: 'strong',
    lateGap: { min: 1, max: 2 },
    endpointMode: 'edgeRandom',
  };
}

/** Offensive palette config for a component (its effect = ATTACK_EFFECT[id]). */
export function offensivePalette(componentId, trsMods = {}, potencyCfg = {}) {
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
    generation: genPlan(effect, true, trsMods),
  };
}

/** Defensive palette config for a component (its verb = DEFENSE_VERB[id]). */
export function defensivePalette(componentId, trsMods = {}, potencyCfg = {}) {
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
    generation: genPlan(verb, false, trsMods),
  };
}

/** Build the grid-path-puzzle nodeTypes catalog from a palette config. */
export function catalogFromConfig(cfg) {
  const nt = { ...cfg.base };
  for (const [k, d] of Object.entries(cfg.skills)) nt[k] = { role: 'normal', passable: true, ...d };
  return nt;
}
