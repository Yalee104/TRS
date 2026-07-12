// =============================================================================
//  tutorial.test.mjs — Training Sortie director + script (headless)
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, assert } from './harness.mjs';

import { PHASES } from '../core/state.js';
import { generateMap, reachableNext } from '../core/map.js';
import { createTutorialDirector, DONE_KEY, HINTS_KEY } from '../view/tutorial/director.js';
import { TUTORIAL_STEPS, TUTORIAL_MOMENTS, TUTORIAL_HINTS } from '../view/tutorial/script.js';
import { CATALOGS_FOR_TEST } from '../i18n/index.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(resolve(__dir, '../config/game.json'), 'utf8'));

const fakeStorage = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), m }; };
const director = (storage = fakeStorage()) => createTutorialDirector({
  steps: TUTORIAL_STEPS, moments: TUTORIAL_MOMENTS, hints: TUTORIAL_HINTS, storage,
});

/** Synthetic ctx builder — only the fields the script's predicates read. */
function ctx({
  screen = 'battle', phase = PHASES.ATTACK_BUILD, queue = 0, pendingAction = false,
  pendingDefense = false, pickFocus = false, activePuzzle = false, weaponCooldown = 0,
  credit = 9000, foeGenHp = 35, foeCoreHp = 70, run = {},
} = {}) {
  return {
    screen,
    state: {
      phase,
      queue: Array.from({ length: queue }, () => ({})),
      pendingAction: pendingAction ? {} : null,
      pendingDefense: pendingDefense ? {} : null,
      pickFocus,
      activePuzzle: activePuzzle ? {} : null,
      cooldowns: { weapon: weaponCooldown },
      creditLeftMs: credit,
      enemies: [{ components: { core: { hp: foeCoreHp }, generator: { hp: foeGenHp } } }],
    },
    run: run === null ? null : { status: 'inBattle', ...run },
  };
}
const stepId = (d, c) => d.sync(c).step?.id ?? null;

test('tutorial: first-run prompt shows only while idle on the loadout screen', () => {
  const d = director();
  assert(d.sync(ctx({ screen: 'loadout' })).promptVisible === true, 'prompt on loadout');
  assert(d.sync(ctx({ screen: 'battle' })).promptVisible === false, 'no prompt off-loadout');
  const st = fakeStorage(); st.set(DONE_KEY, '1');
  assert(director(st).sync(ctx({ screen: 'loadout' })).promptVisible === false, 'done flag silences the prompt');
});

test('tutorial: happy-path walks every step in order', () => {
  const d = director();
  d.start();
  const seen = [];
  const see = (c) => { const id = stepId(d, c); if (id && seen[seen.length - 1] !== id) seen.push(id); return id; };

  assert(see(ctx({ screen: 'loadout', run: null })) === 'brief', 'brief first');
  d.next();
  assert(see(ctx({ screen: 'loadout', run: null })) === 'loadout', 'loadout step');
  // run begins (done predicate) → map
  assert(see(ctx({ screen: 'map', run: { status: 'map' } })) === 'mapFirst', 'map step');
  // battle starts
  assert(see(ctx()) === 'coreShield', 'core shield brief');
  d.next();
  assert(see(ctx()) === 'openWeapon', 'open weapon');
  assert(see(ctx({ activePuzzle: true })) === 'solve', 'solve while puzzle open');
  // puzzle solved → pending status; failRecover must NOT appear
  assert(see(ctx({ pendingAction: true })) === 'placeStatus', 'place the status');
  assert(see(ctx({ queue: 1 })) === 'secondPart', 'second part');
  assert(see(ctx({ queue: 2 })) === 'breakNote', 'break note');
  d.next();
  assert(see(ctx({ queue: 2 })) === 'resolveAttack', 'resolve attack');
  assert(see(ctx({ queue: 2, pickFocus: true })) === 'pickFocus', 'focus pick');
  assert(see(ctx({ phase: PHASES.DEFENSE_BUILD })) === 'defenseIntro', 'defense intro');
  d.next();
  assert(see(ctx({ phase: PHASES.DEFENSE_BUILD })) === 'defenseVerb', 'defense verb');
  assert(see(ctx({ phase: PHASES.DEFENSE_BUILD, pendingDefense: true })) === 'protect', 'protect');
  assert(see(ctx({ phase: PHASES.DEFENSE_BUILD, queue: 1 })) === 'resolveDefense', 'resolve defense');
  assert(see(ctx({ phase: PHASES.ATTACK_BUILD })) === 'roundTick', 'round 2 tick');
  d.next();
  assert(see(ctx({ foeGenHp: 0 })) === 'killCore', 'kill core');
  const won = ctx({ screen: 'reward', run: { status: 'reward', lastBattleReport: { fastWin: true, rounds: 3, par: 5 } } });
  const vmReward = d.sync(won);
  assert(vmReward.step?.id === 'reward', 'reward step');
  assert(vmReward.step.textKey === 'tutorial.step.rewardFast', 'fast-win variant');
  assert(vmReward.step.params.rounds === 3 && vmReward.step.params.par === 5, 'params from report');
  assert(see(ctx({ screen: 'map', run: { status: 'map' } })) === 'mapPlan', 'final map step');
  d.next();                                                    // final → complete
  assert(d.status === 'done', 'completed');
  assert(d.sync(ctx({ screen: 'map', run: { status: 'map' } })).step === null, 'no more steps');
});

test('tutorial: manual steps hold until next(); held on the wrong screen', () => {
  const d = director();
  d.start();
  d.sync(ctx({ screen: 'loadout', run: null }));
  assert(stepId(d, ctx({ screen: 'loadout', run: null })) === 'brief', 'manual step shows');
  assert(stepId(d, ctx({ screen: 'loadout', run: null })) === 'brief', 'still brief without next()');
  const vm = d.sync(ctx({ screen: 'map' }));
  assert(vm.step === null && vm.active === true, 'held (hidden) on another screen, still active');
});

test('tutorial: failRecover materializes only after a real first-solve fail', () => {
  const d = director();
  d.start();
  d.next();                                                   // brief →
  d.sync(ctx({ screen: 'map', run: { status: 'map' } }));      // loadout auto-done (run exists)
  d.sync(ctx());                                              // mapFirst done → coreShield
  d.next();                                                   // coreShield →
  d.sync(ctx({ activePuzzle: true }));                        // openWeapon done → solve
  // fail: puzzle gone, nothing queued, weapon cooling down
  assert(stepId(d, ctx({ weaponCooldown: 2 })) === 'failRecover', 'fail path shows recovery step');
  // reopening a puzzle completes the recovery step; the next card holds until the solve lands
  assert(stepId(d, ctx({ weaponCooldown: 2, activePuzzle: true })) === null, 'coach held while the retry puzzle is open');
  assert(stepId(d, ctx({ weaponCooldown: 2, pendingAction: true })) === 'placeStatus', 'solved retry → place the status');
});

test('tutorial: killCore text branches on the enemy generator being alive', () => {
  const d = director();
  d.start();
  // fast-forward to killCore by feeding a ctx where all earlier gates already hold
  const late = (over = {}) => ctx({ queue: 2, phase: PHASES.ATTACK_BUILD, ...over });
  d.next();                                                    // brief
  d.sync(ctx({ screen: 'map', run: { status: 'map' } }));
  d.sync(ctx({ pickFocus: true }));                            // eats coreShield? no — manual
  d.next();                                                    // coreShield
  d.sync(ctx({ phase: PHASES.DEFENSE_BUILD, queue: 1 }));      // attack steps all done/skipped
  d.next();                                                    // defenseIntro
  d.sync(ctx({ phase: PHASES.ATTACK_BUILD }));                 // defense steps done → roundTick
  d.next();                                                    // roundTick
  const alive = d.sync(late({ foeGenHp: 20 }));
  assert(alive.step?.id === 'killCore' && alive.step.textKey === 'tutorial.step.breachFirst', 'generator alive → breach-first copy');
  const dead = d.sync(late({ foeGenHp: 0 }));
  assert(dead.step.textKey === 'tutorial.step.killCore', 'generator dead → kill-core copy');
});

test('tutorial: breach moment fires once, on generator death, and only once', () => {
  const d = director();
  assert(d.sync(ctx()).moment === null, 'no moment while generator lives');
  const vm = d.sync(ctx({ foeGenHp: 0 }));
  assert(vm.moment?.id === 'breach', 'breach fires when the generator dies');
  d.dismissMoment();
  assert(d.sync(ctx({ foeGenHp: 0 })).moment === null, 'never re-fires');
});

test('tutorial: hints fire once ever, persist, and work while the tutorial is done', () => {
  const st = fakeStorage();
  st.set(DONE_KEY, '1');                                       // tutorial completed long ago
  const d = director(st);
  const vm = d.sync(ctx({ screen: 'shop', run: { status: 'shop' } }));
  assert(vm.hint?.id === 'shop', 'shop hint fires post-tutorial');
  d.dismissHint();
  assert(d.sync(ctx({ screen: 'shop', run: { status: 'shop' } })).hint === null, 'one-shot');
  assert(String(st.get(HINTS_KEY)).includes('shop'), 'persisted');
  const d2 = director(st);                                     // a later session
  assert(d2.sync(ctx({ screen: 'shop', run: { status: 'shop' } })).hint === null, 'persists across sessions');
  const up = d2.sync(ctx({ screen: 'reward', run: { status: 'reward', offerFree: true } }));
  assert(up.hint?.id === 'upgrade', 'other hints still fire');
});

test('tutorial: skip silences everything and sets the done flag', () => {
  const st = fakeStorage();
  const d = director(st);
  d.start();
  d.skip();
  assert(d.status === 'done' && st.get(DONE_KEY) === '1', 'flag set');
  const vm = d.sync(ctx());
  assert(vm.step === null && vm.active === false && vm.promptVisible === false, 'silent');
});

test('tutorial: seed lock — every reachable first node is a lone Saboteur; kit has no Tower', () => {
  const tut = CONFIG.run.tutorial;
  assert(tut && typeof tut.seed === 'number', 'tutorial config exists');
  const map = generateMap(CONFIG, tut.seed * 7919 + 101);
  const first = reachableNext(map, map.startId);
  assert(first.length >= 1, 'start has reachable nodes');
  for (const n of first) {
    assert(n.encounter && n.encounter.enemies.join() === 'saboteur', `first node ${n.id} is a lone saboteur`);
  }
  const kit = CONFIG.run.loadouts[tut.loadout];
  assert(kit && Array.isArray(kit.components), 'tutorial loadout exists');
  assert(!kit.components.includes('tower'), 'tutorial kit has no Tower (the blind-telegraph lesson)');
});

test('tutorial: every textKey used by the script resolves in the en catalog', () => {
  const en = CATALOGS_FOR_TEST.en;
  const get = (key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), en);
  const keys = new Set();
  const sampleCtxs = [ctx(), ctx({ foeGenHp: 0 }), ctx({ screen: 'reward', run: { lastBattleReport: { fastWin: true, rounds: 3, par: 5 } } })];
  for (const s of TUTORIAL_STEPS) {
    if (typeof s.textKey === 'function') sampleCtxs.forEach((c) => keys.add(s.textKey(c)));
    else keys.add(s.textKey || `tutorial.step.${s.id}`);
    keys.add(s.nextKey || 'tutorial.next');
  }
  for (const m of TUTORIAL_MOMENTS) keys.add(m.textKey);
  for (const h of TUTORIAL_HINTS) keys.add(h.textKey);
  ['tutorial.ops', 'tutorial.skip', 'tutorial.replay', 'tutorial.gotIt',
    'tutorial.prompt.title', 'tutorial.prompt.body', 'tutorial.prompt.start', 'tutorial.prompt.skip'].forEach((k) => keys.add(k));
  for (const k of keys) {
    const v = get(k);
    assert(typeof v === 'string' && v.length > 0, `en catalog resolves ${k}`);
  }
});

test('tutorial: TRS Command (strategy/main.js) does not import the tutorial', () => {
  const src = readFileSync(resolve(__dir, '../main.js'), 'utf8');
  assert(!src.includes('view/tutorial'), 'single-battle game stays tutorial-free');
});
