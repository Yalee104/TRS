// =============================================================================
//  view/tutorial/script.js — the Training Sortie walkthrough (PURE data)
// =============================================================================
//
//  The step list, one-shot celebration MOMENTS and first-visit HINTS consumed by
//  the tutorial director. Every gate is a STATE predicate over the ctx snapshot
//  { state, run, screen } — never a click-order assumption — so the walkthrough
//  survives out-of-order play, puzzle fails, and variance in how the fight goes.
//
//  Step shape:
//    { id,                — step + i18n key suffix (tutorial.step.<id>)
//      screen,            — hold the step (hide card, no advance) unless on this screen
//      anchor,            — CSS selector (or fn(ctx) → selector) the ring highlights
//      textKey?,          — fn(ctx) → full i18n key, for branching copy (default step key)
//      params?,           — fn(ctx) → interpolation params
//      manual?,           — true: advances only via the Next button
//      nextKey?,          — i18n key for the Next button label (default tutorial.next)
//      onNext?,           — 'begin' → presenter starts the tutorial run on Next
//      final?,            — true: Next completes the tutorial
//      done?,             — fn(ctx) → true when the player performed the action
//      skipIf? }          — fn(ctx) → true to drop the step entirely (e.g. no fail happened)
//
//  This module must stay DOM-free (headless tests import it under plain Node).
// =============================================================================

import { PHASES } from '../../core/state.js';
import { isAlive } from '../../core/components.js';
import { nodeById } from '../../core/map.js';

const inBattle = (ctx) => ctx.screen === 'battle' && ctx.state && ctx.state.phase !== PHASES.CONFIG;
const foe = (ctx) => ctx.state?.enemies?.find((e) => isAlive(e.components.core)) || ctx.state?.enemies?.[0];
const foeGeneratorAlive = (ctx) => { const f = foe(ctx); return !!f && isAlive(f.components.generator); };
const queued = (ctx) => ctx.state?.queue?.filter((x) => !x.brk).length || 0;

export const TUTORIAL_STEPS = [
  // --- A. briefing (loadout screen) -----------------------------------------
  {
    id: 'brief', screen: 'loadout', anchor: null, manual: true,
  },
  {
    id: 'loadout', screen: 'loadout', anchor: '.rs-chips', manual: true,
    nextKey: 'tutorial.launch', onNext: 'begin',
    done: (ctx) => !!ctx.run,                       // safety: if a run already exists, move on
  },

  // --- B. map ----------------------------------------------------------------
  {
    id: 'mapFirst', screen: 'map', anchor: '.rs-mapnode.reachable',
    done: (ctx) => ctx.screen === 'battle' || ctx.run?.status === 'inBattle',
  },

  // --- C. round 1 — attack ----------------------------------------------------
  {
    id: 'coreShield', screen: 'battle', anchor: '.comp[data-side="enemy"][data-id="core"]', manual: true,
  },
  {
    id: 'openWeapon', screen: 'battle', anchor: '.comp[data-side="player"][data-id="weapon"]',
    done: (ctx) => !!ctx.state?.activePuzzle || !!ctx.state?.pendingAction || queued(ctx) > 0,
  },
  {
    id: 'solve', screen: 'battle', anchor: '#puzzle-overlay .trs-panel',
    skipIf: (ctx) => !ctx.state?.activePuzzle && (queued(ctx) > 0 || !!ctx.state?.pendingAction),
    done: (ctx) => !ctx.state?.activePuzzle,
  },
  {
    id: 'failRecover', screen: 'battle', anchor: '.comp[data-side="player"][data-id="weapon"]',
    // only materializes when the FIRST solve actually failed (cooldown, nothing queued)
    skipIf: (ctx) => !((ctx.state?.cooldowns?.weapon || 0) > 0 && queued(ctx) === 0 && !ctx.state?.pendingAction),
    done: (ctx) => !!ctx.state?.activePuzzle || !!ctx.state?.pendingAction || queued(ctx) > 0,
  },
  {
    id: 'placeStatus', screen: 'battle', anchor: '.comp[data-side="enemy"][data-id="generator"]',
    skipIf: (ctx) => queued(ctx) >= 1 && !ctx.state?.pendingAction,
    done: (ctx) => queued(ctx) >= 1 && !ctx.state?.pendingAction,
  },
  {
    id: 'secondPart', screen: 'battle', anchor: '.comp[data-side="player"][data-id="engine"]',
    done: (ctx) => queued(ctx) >= 2 || !!ctx.state?.pickFocus
      || ctx.state?.phase !== PHASES.ATTACK_BUILD || (ctx.state?.creditLeftMs || 0) <= 0,
  },
  {
    id: 'breakNote', screen: 'battle', anchor: '.breakbtn', manual: true,
    skipIf: (ctx) => ctx.state?.phase !== PHASES.ATTACK_BUILD,
  },
  {
    id: 'resolveAttack', screen: 'battle', anchor: '#resolve',
    done: (ctx) => !!ctx.state?.pickFocus || ctx.state?.phase !== PHASES.ATTACK_BUILD,
  },
  {
    id: 'pickFocus', screen: 'battle', anchor: '.comp[data-side="enemy"][data-id="generator"]',
    skipIf: (ctx) => ctx.state?.phase !== PHASES.ATTACK_BUILD,
    done: (ctx) => ctx.state?.phase !== PHASES.ATTACK_BUILD,
  },

  // --- D. round 1 — defense ----------------------------------------------------
  {
    id: 'defenseIntro', screen: 'battle', anchor: '#infobar', manual: true,
    skipIf: (ctx) => ctx.state?.phase !== PHASES.DEFENSE_BUILD,
  },
  {
    id: 'defenseVerb', screen: 'battle', anchor: '.comp[data-side="player"][data-id="weapon"]',
    skipIf: (ctx) => ctx.state?.phase !== PHASES.DEFENSE_BUILD,
    done: (ctx) => !!ctx.state?.activePuzzle || !!ctx.state?.pendingDefense || queued(ctx) > 0,
  },
  {
    id: 'protect', screen: 'battle', anchor: '.comp[data-side="player"][data-id="generator"]',
    skipIf: (ctx) => ctx.state?.phase !== PHASES.DEFENSE_BUILD,
    done: (ctx) => queued(ctx) >= 1 && !ctx.state?.pendingDefense,
  },
  {
    id: 'resolveDefense', screen: 'battle', anchor: '#resolve',
    skipIf: (ctx) => ctx.state?.phase !== PHASES.DEFENSE_BUILD,
    done: (ctx) => ctx.state?.phase !== PHASES.DEFENSE_BUILD,
  },

  // --- E. round 2 — the kill ----------------------------------------------------
  {
    id: 'roundTick', screen: 'battle', anchor: '.phase-banner', manual: true,
    skipIf: (ctx) => ctx.state?.phase === PHASES.WON || ctx.screen !== 'battle',
  },
  {
    id: 'killCore', screen: 'battle',
    anchor: (ctx) => foeGeneratorAlive(ctx)
      ? '.comp[data-side="enemy"][data-id="generator"]'
      : '.comp[data-side="enemy"][data-id="core"]',
    textKey: (ctx) => foeGeneratorAlive(ctx) ? 'tutorial.step.breachFirst' : 'tutorial.step.killCore',
    done: (ctx) => ctx.state?.phase === PHASES.WON || ctx.screen !== 'battle',
  },

  // --- F. spoils & sector ---------------------------------------------------------
  {
    id: 'reward', screen: 'reward', anchor: '.rs-rewards',
    skipIf: (ctx) => !!ctx.run?.offerFree,          // upgrade-node offers have their own hint
    textKey: (ctx) => ctx.run?.lastBattleReport?.fastWin ? 'tutorial.step.rewardFast' : 'tutorial.step.reward',
    params: (ctx) => ({ rounds: ctx.run?.lastBattleReport?.rounds ?? 0, par: ctx.run?.lastBattleReport?.par ?? 0 }),
    done: (ctx) => ctx.screen === 'map',
  },
  {
    id: 'mapPlan', screen: 'map', anchor: '.rs-maprows', manual: true,
    nextKey: 'tutorial.done', final: true,
  },
];

// One-shot celebration toasts, arrival-gated on live state (independent of step order).
export const TUTORIAL_MOMENTS = [
  {
    id: 'breach', textKey: 'tutorial.moment.breach',
    when: (ctx) => inBattle(ctx) && !!foe(ctx) && !isAlive(foe(ctx).components.generator)
      && isAlive(foe(ctx).components.core),
  },
];

// First-visit hints: fire ONCE EVER (persisted), in any run, even after the tutorial.
export const TUTORIAL_HINTS = [
  {
    id: 'shop', anchor: '.rs-wrap', textKey: 'tutorial.hint.shop',
    when: (ctx) => ctx.screen === 'shop',
  },
  {
    id: 'heal', anchor: '#left', textKey: 'tutorial.hint.heal',
    when: (ctx) => ctx.screen === 'map' && !!ctx.run?.map
      && nodeById(ctx.run.map, ctx.run.mapPos)?.type === 'heal',
  },
  {
    id: 'upgrade', anchor: '.rs-rewards', textKey: 'tutorial.hint.upgrade',
    when: (ctx) => ctx.screen === 'reward' && !!ctx.run?.offerFree,
  },
];
