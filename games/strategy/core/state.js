// =============================================================================
//  core/state.js — the whole battle in one plain object
// =============================================================================
//
//  createState(config, ui) builds two mirror-identical aircraft and the turn
//  bookkeeping. The `ui` overrides (from the left-rail config panel, B.6) let a
//  playtester change archetype / phase length / time-model before Start without
//  editing the file. No DOM here — main.js owns rendering.
// =============================================================================

import { COMPONENT_IDS, makeComponent, isAlive } from './components.js';
import { resolveArchetype, archetypeKeys } from '../combat/enemyAI.js';

/** Phases of the loop (see DESIGN §2). */
export const PHASES = {
  CONFIG: 'config',          // pre-game left-rail setup
  ATTACK_BUILD: 'attackBuild',
  ATTACK_RESOLVE: 'attackResolve',
  DEFENSE_BUILD: 'defenseBuild',
  DEFENSE_RESOLVE: 'defenseResolve',
  WON: 'won',
  LOST: 'lost',
};

function makeAircraft(side, config) {
  const components = {};
  for (const id of COMPONENT_IDS) components[id] = makeComponent(id, config.components[id]);
  return { side, components };
}

/**
 * Build the enemy roster (1..maxEnemies aircraft). Each enemy carries its own
 * archetype, label, and per-enemy telegraph. Duplicate archetypes get numbered
 * labels (e.g. "Saboteur 1", "Saboteur 2").
 */
function buildEnemies(config, roster, rng) {
  const keys = archetypeKeys(config);
  const enemies = roster.map((key, i) => {
    const ac = makeAircraft('enemy', config);
    ac.eid = i;
    ac.archetype = resolveArchetype(key, rng, keys);
    ac.telegraph = null;
    return ac;
  });
  const counts = {};
  for (const e of enemies) counts[e.archetype] = (counts[e.archetype] || 0) + 1;
  const seen = {};
  for (const e of enemies) {
    const base = config.archetypes[e.archetype]?.label || e.archetype;
    if (counts[e.archetype] > 1) { seen[e.archetype] = (seen[e.archetype] || 0) + 1; e.num = seen[e.archetype]; e.label = `${base} ${e.num}`; }
    else { e.num = null; e.label = base; }
  }
  return enemies;
}

/**
 * @param config  the parsed game.json
 * @param ui      optional overrides from the config panel:
 *                { enemies:[archetype...], creditSeconds, seed }  (attackTimeModel defaults to config.phase = realtime)
 */
export function createState(config, ui = {}) {
  const u = { ...config.ui, ...ui };
  const creditMs = (u.creditSeconds != null ? u.creditSeconds * 1000 : config.phase.creditMs);
  const rng = makeRng(u.seed || 0);
  const roster = (Array.isArray(u.enemies) && u.enemies.length)
    ? u.enemies.slice(0, u.maxEnemies || 4)
    : [u.archetype || 'saboteur'];   // back-compat: single-archetype callers

  return {
    config,
    ui: u,
    rng,

    phase: PHASES.ATTACK_BUILD,
    round: 1,
    creditMs,                    // per-phase build budget (resolved from ui)
    creditLeftMs: creditMs,
    creditBonusMs: 0,            // banked by Overclock; spent on the next attack build
    attackTimeModel: u.attackTimeModel || config.phase.attackTimeModel,

    player: makeAircraft('player', config),
    enemies: buildEnemies(config, roster, rng),   // 1..4 enemy aircraft

    // current build session
    queue: [],                   // attack: {component, effect, potency, target:{eid,component}}; defense: {component, verb, potency, target}
    pendingAction: null,         // attack: solved-but-not-yet-targeted action awaiting an enemy pick
    pendingDefense: null,        // defense: solved-but-not-yet-targeted action awaiting an own-part pick
    focus: null,                 // attack: the firepower Focus {eid, component}, chosen at Resolve
    pickFocus: false,            // attack: true while waiting for the player to click the Focus
    usedComponents: {},          // attack: one-use-per-phase guard { weapon:true, ... }
    cooldowns: {},               // per-component fail cooldown (turns remaining)

    activePuzzle: null,          // { component, side, mode, instance, overlay }

    log: [],
  };
}

/** Enemies that are still in the fight (Core alive). */
export const aliveEnemies = (state) => state.enemies.filter((e) => isAlive(e.components.core));

/** Tiny seeded RNG (mulberry32) so a seed makes a run reproducible. */
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function logEvent(state, msg) {
  state.log.push({ round: state.round, phase: state.phase, msg });
  if (state.log.length > 80) state.log.shift();
}
