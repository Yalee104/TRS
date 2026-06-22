// =============================================================================
//  puzzle/palettes.js — adapter over the shared TRS preset (single source of truth)
// =============================================================================
//
//  Strategy used to author its own per-component palettes + route plans here. That
//  logic now lives in the package-level preset `grid-path-puzzle/presets/trs.js`,
//  which the standalone playground also consumes — so the two can never drift.
//
//  This file is a thin re-export adapter. The bridge builds the generation `knobs`
//  (from config/game.json#puzzle.gen + the per-solve burningDensity) and the
//  gradient `trsMods` (from core/cascade.js) and passes them straight through to
//  the preset's `offensivePalette`/`defensivePalette`. The preset still honours
//  `trsMods.{sizeDelta,blockerBonus,trapBonus}`, so strategy keeps its HP-scaled
//  Launch Pad easing/congestion while sharing the generation code.
//
//  NOTE: ATTACK_EFFECT / DEFENSE_VERB stay authoritative in core/components.js
//  (which also owns EFFECT_VALID_TARGETS); the preset mirrors them. A test asserts
//  the two stay in sync so the single-source split can't drift.
// =============================================================================

export {
  offensivePalette,
  defensivePalette,
  catalogFromConfig,
  BASE_CELLS,
  OFFENSE_META,
  DEFENSE_META,
  MIN_CHAIN,
} from '../../grid-path-puzzle/presets/trs.js';
