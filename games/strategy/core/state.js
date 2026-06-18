// =============================================================================
//  core/state.js — the whole battle in one plain object
// =============================================================================
//
//  createState(config, ui) builds two mirror-identical aircraft and the turn
//  bookkeeping. The `ui` overrides (from the left-rail config panel, B.6) let a
//  playtester change archetype / phase length / time-model before Start without
//  editing the file. No DOM here — main.js owns rendering.
// =============================================================================

import { COMPONENT_IDS, makeComponent } from './components.js';
import { resolveArchetype } from '../combat/enemyAI.js';

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
 * @param config  the parsed game.json
 * @param ui      optional overrides from the config panel:
 *                { archetype, creditSeconds, attackTimeModel, telegraphMode, seed }
 */
export function createState(config, ui = {}) {
  const u = { ...config.ui, ...ui };
  const creditMs = (u.creditSeconds != null ? u.creditSeconds * 1000 : config.phase.creditMs);
  const rng = makeRng(u.seed || 0);

  return {
    config,
    ui: u,
    rng,
    archetype: resolveArchetype(u.archetype, rng),

    phase: PHASES.ATTACK_BUILD,
    round: 1,
    creditMs,                    // per-phase build budget (resolved from ui)
    creditLeftMs: creditMs,
    attackTimeModel: u.attackTimeModel || config.phase.attackTimeModel,

    player: makeAircraft('player', config),
    enemy: makeAircraft('enemy', config),

    // current build session
    queue: [],                   // attack: {component, effect, potency, target}; defense: {component, verb, potency, target}
    pendingAction: null,         // attack: solved-but-not-yet-targeted action awaiting an enemy pick
    pendingDefense: null,        // defense: solved-but-not-yet-targeted action awaiting an own-part pick
    focus: null,                 // attack: the firepower Focus, chosen at Resolve
    pickFocus: false,            // attack: true while waiting for the player to click the Focus
    usedComponents: {},          // attack: one-use-per-phase guard { weapon:true, ... }
    cooldowns: {},               // per-component fail cooldown (turns remaining)

    activePuzzle: null,          // { component, side, mode, instance, overlay }
    telegraph: null,             // enemy's declared next attack { entries:[{component,dmg,status}], visible }

    log: [],
  };
}

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

export const aircraftOf = (state, side) => (side === 'player' ? state.player : state.enemy);
export const opponentOf = (state, side) => (side === 'player' ? state.enemy : state.player);

export function logEvent(state, msg) {
  state.log.push({ round: state.round, phase: state.phase, msg });
  if (state.log.length > 80) state.log.shift();
}
