// =============================================================================
//  strategy.test.mjs — headless logic tests for the v1 battle loop
// =============================================================================
//  Config loaded from game.json via fs. The grid-path module is replaced by a
//  FakePuzzle so the bridge is testable without a browser; the REAL ComboEngine
//  and REAL generator are exercised for the combo/board wiring.
// =============================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, assert } from './harness.mjs';

import { createState, PHASES } from '../core/state.js';
import { isEffectValidOn } from '../core/components.js';
import { startAttackBuild, commitAttack, startDefenseBuild, commitDefense } from '../core/phases.js';
import { combatCondition, firepowerMult, totalFirepower } from '../core/firepower.js';
import { systemState } from '../core/cascade.js';
import { applyStatus, tickAircraftStatuses, attackSynergyMult, resolveCombos } from '../combat/statuses.js';
import { makePendingAttack, finalizeAttackTarget, validAttackTargets, resolveAttack, comboPotency } from '../combat/attack.js';
import { makePendingDefense, finalizeDefenseTarget, resolveDefense } from '../combat/defense.js';
import { planAttack, currentBudget } from '../combat/enemyAI.js';
import { resolveChain, OFFENSE_COMBOS, pairKey } from '../combat/combos.js';
import { offensivePalette, defensivePalette, catalogFromConfig } from '../puzzle/palettes.js';
import { createBridge } from '../puzzle/bridge.js';
import { evaluate } from '../../grid-path-puzzle/combo/ComboEngine.js';
import { generate } from '../../grid-path-puzzle/module/core/generator.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(resolve(__dir, '../config/game.json'), 'utf8'));
const fresh = (ui = {}) => { const s = createState(CONFIG, { seed: 7, ...ui }); startAttackBuild(s); return s; };
const combo = (value) => ({ items: [{ value }] });
const near = (a, b, eps = 0.5) => Math.abs(a - b) <= eps;
// helpers that mimic the UI: solve a weapon, then apply its status to a target
const attack = (s, comp, value, target, eid = 0) => { makePendingAttack(s, comp, combo(value)); finalizeAttackTarget(s, eid, target); };
const defend = (s, comp, value, target) => { makePendingDefense(s, comp, combo(value)); finalizeDefenseTarget(s, target); };
// drop enough shield-linked parts (per config) to break an aircraft's Core shield
const exposeCore = (ac) => { let sum = 0; for (const [id, pct] of Object.entries(CONFIG.coreShield.contributors)) { ac.components[id].hp = 0; sum += pct; if (sum >= CONFIG.coreShield.threshold) break; } };

// --- combo engine (pure chain resolution) ------------------------------------
const F = (key) => ({ key, fresh: true });
const A = (key) => ({ key, fresh: false });
const BRK = { brk: true };
const names = (r) => r.combos.map((c) => c.def.name);
const lefts = (r) => r.leftovers.map((e) => e.key);

test('combo engine: greedy left-to-right, consume-and-advance ([A,B,C] → A+B only)', () => {
  const r = resolveChain([F('freeze'), F('shatter'), F('confuse')], OFFENSE_COMBOS);
  assert(names(r).join() === 'Glass', `only Glass forms, got ${names(r)}`);
  assert(lefts(r).join() === 'confuse', `confuse left over, got ${lefts(r)}`);
});

test('combo engine: a break cuts adjacency (opt out)', () => {
  const r = resolveChain([F('freeze'), BRK, F('shatter')], OFFENSE_COMBOS);
  assert(r.combos.length === 0, 'no combo across the break');
  assert(lefts(r).sort().join() === 'freeze,shatter', 'both kept as bases');
});

test('combo engine: a combo needs ≥1 fresh entry (C2 — no carried+carried)', () => {
  assert(resolveChain([A('freeze'), A('shatter')], OFFENSE_COMBOS).combos.length === 0, 'two carried → no combo');
  assert(resolveChain([A('freeze'), F('shatter')], OFFENSE_COMBOS).combos.length === 1, 'one fresh → combo');
});

test('combo engine: consume-advance picks the earlier pair ([burn,confuse,drain] → Wildfire, drain left)', () => {
  const r = resolveChain([F('burning'), F('confuse'), F('drain')], OFFENSE_COMBOS);
  assert(names(r).join() === 'Wildfire' && lefts(r).join() === 'drain', `got ${names(r)} / ${lefts(r)}`);
});

test('combo engine: pairKey is order-independent', () => {
  assert(pairKey('shatter', 'freeze') === pairKey('freeze', 'shatter'), 'order-independent');
});

// --- firepower / condition ---------------------------------------------------
test('combatCondition is 1.0 at full health; firepowerMult floors at 0.4', () => {
  const s = fresh();
  assert(near(combatCondition(s.player, CONFIG), 1.0, 0.001), 'full condition = 1');
  assert(near(firepowerMult(1.0, CONFIG), 1.0, 0.001), 'mult at full = 1.0');
  assert(near(firepowerMult(0.0, CONFIG), 0.4, 0.001), 'mult floor = 0.4');
});

test('destroying the Generator drops condition AND browns out firepower', () => {
  const s = fresh();
  s.player.components.generator.hp = 0;
  assert(near(combatCondition(s.player, CONFIG), 0.6, 0.001), 'condition loses generator weight');
  assert(systemState(s.player, CONFIG).brownout === 0.5, 'brownout active');
});

test('a Frozen offence part chokes firepower (debuffFactor 0)', () => {
  const s = fresh();
  applyStatus(s.player.components.weapon, 'freeze', { turns: 2 });
  assert(near(combatCondition(s.player, CONFIG), 0.65, 0.001), 'frozen weapon contributes 0');
});

// --- cascade -----------------------------------------------------------------
test('cascade cliffs: tower→blind, engine→no initiative, launchpad→congested TRS', () => {
  const s = fresh();
  s.player.components.tower.hp = 0; s.player.components.engine.hp = 0; s.player.components.launchpad.hp = 0;
  const sys = systemState(s.player, CONFIG);
  assert(sys.telegraphVisible === false, 'tower dead → blind');
  assert(sys.hasInitiative === false && sys.evasion === 0, 'engine dead → no initiative/evasion');
  assert(sys.trsMods.sizeDelta === 2, 'launchpad dead → bigger congested grid');
  assert(sys.trsMods.blockerBonus > 0, 'launchpad dead → more blockers');
});

test('a healthy Launch Pad EASES the TRS grid (fewer blockers/traps); damaged fades to baseline', () => {
  const s = fresh();
  const full = systemState(s.player, CONFIG).trsMods;
  assert(full.blockerBonus < 0 && full.trapBonus < 0, 'full HP → eased grid (negative density bonus)');
  s.player.components.launchpad.hp = s.player.components.launchpad.maxHp * 0.5;
  const half = systemState(s.player, CONFIG).trsMods;
  assert(half.blockerBonus > full.blockerBonus && half.blockerBonus < 0, 'damaged → bonus fades toward baseline');
});

test('Launch Pad now carries attack strength: destroying it drops Combat Condition', () => {
  const s = fresh();
  s.player.components.launchpad.hp = 0;
  assert(near(combatCondition(s.player, CONFIG), 1 - CONFIG.firepower.weights.launchpad, 0.001), 'condition loses the launchpad weight');
});

// --- enemy AI: shielded-core avoidance + tower-gated aim ---------------------
test('enemy never targets the player Core while its shield is UP; targets it once exposed', () => {
  const s = fresh();
  const shielded = planAttack(s, s.enemies[0]);
  assert(!shielded.entries.some((e) => e.component === 'core'), 'shielded core is not targeted');
  exposeCore(s.player);          // drop the Core shield (per config)
  // saboteur priority is [generator(dead), weapon, core] → core becomes a valid target
  const exposed = planAttack(s, s.enemies[0]);
  assert(exposed.entries.some((e) => e.component === 'core'), 'exposed core can be targeted');
});

test('destroying the enemy Tower scatters its aim and softens the blow', () => {
  const s = fresh();
  const before = currentBudget(s, s.enemies[0]);
  s.enemies[0].components.tower.hp = 0;
  const plan = planAttack(s, s.enemies[0]);
  assert(plan.scattered === true, 'tower down → scattered aim');
  assert(currentBudget(s, s.enemies[0]) < before, 'tower down → smaller budget (lost accuracy)');
});

test('Freeze suspends the part system: frozen enemy Tower scatters aim; frozen Engine kills evasion', () => {
  const s = fresh();
  applyStatus(s.enemies[0].components.tower, 'freeze', { turns: 2 });
  assert(planAttack(s, s.enemies[0]).scattered === true, 'frozen enemy Tower → scattered aim');

  const a = fresh();
  attack(a, 'tower', 5, 'weapon');                // confuse enemy weapon, focus weapon (engine NOT frozen)
  const dodged = resolveAttack(a, 0, 'weapon').damage;
  const b = fresh();
  applyStatus(b.enemies[0].components.engine, 'freeze', { turns: 2 }); // engine frozen → no evasion
  attack(b, 'tower', 5, 'weapon');
  const full = resolveAttack(b, 0, 'weapon').damage;
  assert(full > dodged, 'frozen enemy Engine → no dodge, focus-fire lands full');
});

// --- statuses + synergies ----------------------------------------------------
test('Burning DoT ticks then statuses decay each round', () => {
  const s = fresh();
  const c = s.enemies[0].components.weapon;
  applyStatus(c, 'burning', { turns: 2, dot: 5 });
  const { dot } = tickAircraftStatuses(s.enemies[0], CONFIG);
  assert(dot === 5 && c.hp === c.maxHp - 5, 'DoT applied');
  assert(c.statuses.burning.turns === 1, 'turn decayed');
});

test('Glass: Frozen + Shattered on a part = clean ×mult focus damage', () => {
  const s = fresh();
  const c = s.enemies[0].components.generator;
  applyStatus(c, 'shatter', { turns: 1 });
  assert(near(attackSynergyMult(c, CONFIG), 1 + CONFIG.effects.synergy.shatterAmp, 0.001), 'shatter alone = +50%');
  applyStatus(c, 'freeze', { turns: 1 });
  assert(near(attackSynergyMult(c, CONFIG), CONFIG.effects.synergy.combos.glass.mult, 0.001), 'both = Glass ×mult');
});

test('Shatter is valid on ANY part now; Fire ⊗ Freeze cancel (both wiped)', () => {
  const s = fresh();
  assert(isEffectValidOn('shatter', 'weapon') && isEffectValidOn('shatter', 'tower'), 'shatter valid anywhere');
  const c = s.enemies[0].components.weapon;
  applyStatus(c, 'burning', { turns: 3, dot: 5 });
  const r = applyStatus(c, 'freeze', { turns: 2 });
  assert(r.canceled === 'burning', 'freeze onto burning reports cancel');
  assert(!c.statuses.burning && !c.statuses.freeze, 'both wiped (steam)');
});

test('Burning bypasses the Reactor shield — its DoT ticks even while the shield is UP', () => {
  const s = fresh();
  const core = s.enemies[0].components.core; // enemy generator alive → core shielded
  applyStatus(core, 'burning', { turns: 2, dot: 7 });
  const { dot } = tickAircraftStatuses(s.enemies[0], CONFIG);
  assert(dot >= 7 && core.hp === core.maxHp - 7, 'burning DoT hit the shielded core');
});

test('Meltdown: a Shattered+Burning part funnels heat into the Core (bypasses the shield)', () => {
  const s = fresh(); // single enemy, Generator alive → Core shielded
  const g = s.enemies[0].components.generator;
  applyStatus(g, 'shatter', { turns: 3 }); applyStatus(g, 'burning', { turns: 3, dot: 6 });
  const coreBefore = s.enemies[0].components.core.hp;
  const { meltdown } = tickAircraftStatuses(s.enemies[0], CONFIG);
  assert(meltdown === 6 * CONFIG.effects.synergy.combos.meltdown.coreFrac, 'funnel = dot × coreFrac');
  assert(s.enemies[0].components.core.hp === coreBefore - meltdown, 'shielded Core still took the meltdown');
});

// --- attack flow (pending → target) + resolve --------------------------------
test('solving holds a pending action; Table B gates valid targets', () => {
  const s = fresh();
  makePendingAttack(s, 'tower', combo(5)); // confuse — valid only on weapon/tower
  assert(s.pendingAction && s.pendingAction.effect === 'confuse', 'pending confuse held');
  const valid = validAttackTargets(s).filter((t) => t.eid === 0).map((t) => t.component).sort();
  assert(valid.join() === ['tower', 'weapon'].join(), `confuse valid on weapon/tower, got ${valid}`);
  assert(finalizeAttackTarget(s, 0, 'generator') === null, 'cannot apply confuse to generator');
  finalizeAttackTarget(s, 0, 'weapon');
  assert(s.queue.length === 1 && s.pendingAction === null, 'queued + pending cleared');
});

test('attack resolve damages the Focus; Drain heals + pierces armor', () => {
  const s = fresh();
  attack(s, 'generator', 5, 'generator'); // drain on enemy generator
  const before = s.enemies[0].components.generator.hp;
  const sum = resolveAttack(s, 0, 'generator');
  assert(s.enemies[0].components.generator.hp < before, 'focus took damage');
  assert(sum.healed > 0, 'drain healed the player');
});

test('Reactor Core shield blocks all damage while its shield-linked parts live', () => {
  const s = fresh();
  attack(s, 'engine', 6, 'core'); // shatter, valid on core
  const before = s.enemies[0].components.core.hp;
  const sum = resolveAttack(s, 0, 'core');
  assert(sum.shielded === true && sum.damage === 0, 'shield blocked the focus damage');
  assert(s.enemies[0].components.core.hp === before, 'core lost no HP while shielded');
  assert(s.enemies[0].components.core.statuses.shatter, 'status still applied to the shielded core');
});

test('destroying enough shield-linked parts drops the Core shield', () => {
  const s = fresh();
  exposeCore(s.enemies[0]);     // drop the Core shield (per config)
  attack(s, 'engine', 6, 'core');          // shatter exposed core
  const before = s.enemies[0].components.core.hp;
  const sum = resolveAttack(s, 0, 'core');
  assert(sum.shielded === false && sum.damage > 0, 'shield down → damage gets through');
  assert(s.enemies[0].components.core.hp < before, 'exposed core takes damage');
  assert(sum.synergy > 1, 'shatter amp still applies');
});

test('Wildfire: Burning + Confused on a part spreads Burning to a neighbour', () => {
  const s = fresh();
  attack(s, 'launchpad', 8, 'weapon'); // burning → enemy weapon
  attack(s, 'tower', 8, 'weapon');     // confuse → enemy weapon
  resolveAttack(s, 0, 'weapon');
  const spread = Object.values(s.enemies[0].components).some((c) => c.id !== 'weapon' && c.statuses.burning);
  assert(spread, 'burning spread to a neighbour');
});

test('v2 combos resolve where both statuses co-exist (Backfire/Vaporize/Stasis/Collapse)', () => {
  const C = CONFIG.effects.synergy.combos;
  // Backfire — Shatter + Confuse → self-damage
  let s = fresh();
  let w = s.enemies[0].components.weapon;
  applyStatus(w, 'shatter', { turns: 2 }); applyStatus(w, 'confuse', { turns: 2 });
  let before = w.hp; resolveCombos(s);
  assert(w.hp === before - C.backfire.selfDamage, 'Backfire self-damage');

  // Vaporize — Burning + Drain → detonate remaining burn now + heal, burn cleared
  s = fresh(); s.player.components.core.hp = 100;
  let g = s.enemies[0].components.generator;
  applyStatus(g, 'burning', { turns: 2, dot: 5 }); applyStatus(g, 'drain', { turns: 1, potency: 4 });
  before = g.hp; resolveCombos(s);
  assert(g.hp === before - 10 && !g.statuses.burning, 'Vaporize detonates the remaining burn');
  assert(s.player.components.core.hp === 100 + 10 * C.vaporize.healFrac, 'Vaporize heals your Core');

  // Stasis Lock — Frozen + Confuse → extend freeze
  s = fresh(); let t = s.enemies[0].components.tower;
  applyStatus(t, 'freeze', { turns: 2 }); applyStatus(t, 'confuse', { turns: 2 });
  resolveCombos(s);
  assert(t.statuses.freeze.turns === 2 + C.stasisLock.extendTurns, 'Stasis extends the freeze');

  // Collapse — Shatter + Drain below the HP threshold → destroyed
  s = fresh(); let gg = s.enemies[0].components.generator;
  applyStatus(gg, 'shatter', { turns: 2 }); applyStatus(gg, 'drain', { turns: 1, potency: 3 });
  gg.hp = gg.maxHp * C.collapse.hpThreshold - 1;
  resolveCombos(s);
  assert(gg.hp === 0, 'Collapse executes a low shattered+drained part');
});

test('Feedback Cascade chains drain to the same part on an adjacent enemy', () => {
  const s = createState(CONFIG, { seed: 7, enemies: ['saboteur', 'brute'] });
  startAttackBuild(s);
  const w0 = s.enemies[0].components.weapon;
  applyStatus(w0, 'confuse', { turns: 2 }); applyStatus(w0, 'drain', { turns: 1, potency: 5 });
  const before = s.enemies[1].components.weapon.hp;
  resolveCombos(s);
  const chain = 5 * CONFIG.effects.drain.dmgPerPotency * CONFIG.effects.synergy.combos.feedback.chainFrac;
  assert(near(s.enemies[1].components.weapon.hp, before - chain, 0.001), 'drain chained to enemy 1');
});

test('a healthy enemy Engine dodges part of your focus-fire; destroying it lands full damage', () => {
  const a = fresh();
  attack(a, 'weapon', 5, 'weapon');               // freeze enemy weapon, focus weapon
  const dodged = resolveAttack(a, 0, 'weapon').damage;
  const b = fresh();
  b.enemies[0].components.engine.hp = 0;               // enemy has no evasion now
  attack(b, 'weapon', 5, 'weapon');
  const full = resolveAttack(b, 0, 'weapon').damage;
  assert(full > dodged, 'no-Engine enemy takes more focus damage');
});

// --- defense flow + stacking -------------------------------------------------
test('defense: shield absorbs, repair heals, through the mitigation order', () => {
  const s = fresh();
  startDefenseBuild(s);
  s.player.components.weapon.hp = 40;
  defend(s, 'weapon', 6, 'core');      // shield → core
  defend(s, 'generator', 6, 'weapon'); // repair → weapon
  resolveDefense(s);
  assert(s.player.components.core.hp === 200, 'core fully shielded');
  assert(s.player.components.weapon.hp > 40, 'weapon repaired');
});

test('defenses stack additively on the same part (reusable in defense)', () => {
  const s = fresh();
  startDefenseBuild(s);
  defend(s, 'weapon', 4, 'core');
  defend(s, 'weapon', 4, 'core'); // weapon reused — defense has no one-use cap
  assert(s.player.components.core.defenses.shield === 2 * 4 * CONFIG.defense.shield.absorbPerPotency, 'shield stacked');
});

// --- phases / win-lose -------------------------------------------------------
test('full round advances Attack→Defense→next round', () => {
  const s = fresh();
  attack(s, 'weapon', 3, 'tower'); // freeze valid on tower
  commitAttack(s, 0, 'tower');
  assert(s.phase === PHASES.DEFENSE_BUILD, 'after attack → defense build');
  commitDefense(s);
  assert(s.phase === PHASES.ATTACK_BUILD && s.round === 2, 'after defense → next round');
});

test('killing the enemy Core wins the battle (shield must be down first)', () => {
  const s = fresh();
  exposeCore(s.enemies[0]); // drop the Core shield (per config)
  s.enemies[0].components.core.hp = 1;
  attack(s, 'engine', 6, 'core');      // shatter on the now-exposed core
  commitAttack(s, 0, 'core');
  assert(s.phase === PHASES.WON, 'enemy core destroyed → WON');
});

test('losing your Core loses the battle (shield down first)', () => {
  const s = fresh();
  startDefenseBuild(s);
  exposeCore(s.player); // drop your Core shield (per config)
  s.player.components.core.hp = 1;
  commitDefense(s);
  assert(s.phase === PHASES.LOST, 'player core destroyed → LOST');
});

// --- multiple enemies --------------------------------------------------------
test('roster builds N enemies with deduped labels; random resolves to a real archetype', () => {
  const s = createState(CONFIG, { seed: 7, enemies: ['saboteur', 'saboteur', 'brute'] });
  assert(s.enemies.length === 3, 'three enemies fielded');
  assert(s.enemies[0].label === 'Saboteur 1' && s.enemies[1].label === 'Saboteur 2', 'duplicate archetypes numbered');
  assert(s.enemies[2].label === 'Brute', 'unique archetype keeps base label');
  const r = createState(CONFIG, { seed: 1, enemies: ['random'] });
  assert(CONFIG.archetypes[r.enemies[0].archetype], 'random → a real archetype');
});

test('archetypes are 100% config-driven: a new config entry is selectable without code changes', () => {
  const cfg = { ...CONFIG, archetypes: { ...CONFIG.archetypes, ninja: { label: 'Ninja', damageBudget: 50, priority: ['tower'], spread: 0.1, statusChance: 0.5, status: 'confuse' } } };
  const s = createState(cfg, { seed: 2, enemies: ['ninja'] });
  assert(s.enemies[0].archetype === 'ninja' && s.enemies[0].label === 'Ninja', 'config-only archetype resolves');
  // and Random can roll it
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(createState(cfg, { seed: i, enemies: ['random'] }).enemies[0].archetype);
  assert(seen.has('ninja'), 'Random can roll a config-only archetype');
});

test('roster is capped at maxEnemies (4)', () => {
  const s = createState(CONFIG, { seed: 7, enemies: ['saboteur', 'brute', 'hunter', 'swarm', 'disruptor'] });
  assert(s.enemies.length === 4, 'capped to 4');
});

test('victory needs ALL enemy Cores dead; you can focus a chosen enemy by eid', () => {
  const s = createState(CONFIG, { seed: 7, enemies: ['saboteur', 'brute'] });
  startAttackBuild(s);
  // expose + kill enemy 1's core only
  exposeCore(s.enemies[1]);
  s.enemies[1].components.core.hp = 1;
  attack(s, 'engine', 6, 'core', 1);   // shatter enemy 1's core
  commitAttack(s, 1, 'core');
  assert(s.enemies[1].components.core.hp <= 0 && s.enemies[0].components.core.hp > 0, 'enemy 1 dead, enemy 0 still alive');
  assert(s.phase !== PHASES.WON, 'not won while enemy 0 lives');
});

test('every living enemy strikes during one defense resolve', () => {
  const s = createState(CONFIG, { seed: 7, enemies: ['saboteur', 'brute'] });
  startAttackBuild(s);
  startDefenseBuild(s);
  const sum = resolveDefense(s);
  const attackers = new Set(s.log.filter((l) => /attacks: budget/.test(l.msg)).map((l) => l.msg.split(' attacks')[0]));
  assert(attackers.size === 2, `both enemies logged an attack, saw ${attackers.size}`);
  assert(sum.totalDamage > 0, 'player took damage from the pair');
});

// --- bridge (real ComboEngine, fake puzzle) ----------------------------------
class FakePuzzle {
  constructor(opts) { this.opts = opts; this.state = { elapsedMs: 0 }; this.level = { start: { x: 0, y: 0 }, goal: { x: 1, y: 0 } }; }
  on() {} start() {} destroy() {} reset() {} tryBegin() {} tryMoveTo() {} endDrag() {}
  fireComplete(path) { this.opts.onComplete({ path }); }
  fireFail() { this.opts.onFail(); }
}

test('bridge: solving makes a pending action via the real ComboEngine, then targeting queues it', () => {
  const s = fresh({ attackTimeModel: 'cost', creditSeconds: 120 }); // assert the fixed-chunk cost here, not realtime
  const bridge = createBridge({ getState: () => s, overlayEl: null, PuzzleClass: FakePuzzle, evaluateFn: evaluate });
  assert(bridge.open('weapon') === true, 'opened attack puzzle');
  s.activePuzzle.instance.fireComplete([{ typeKey: 'freeze' }, { typeKey: 'freeze' }, { typeKey: 'freeze' }]);
  assert(s.pendingAction && s.pendingAction.effect === 'freeze', 'pending freeze created');
  assert(s.pendingAction.potency === evaluate(['freeze', 'freeze', 'freeze'], offensivePalette('weapon', {}, CONFIG.potency)).items[0].value, 'potency from ComboEngine');
  assert(s.creditLeftMs === s.creditMs - CONFIG.phase.actionCostMs, 'credit spent on solve');
  assert(s.activePuzzle === null, 'puzzle torn down');
  assert(bridge.open('tower') === false, 'cannot open another puzzle while a target is pending');
  finalizeAttackTarget(s, 0, 'generator'); // freeze valid on generator
  assert(s.queue.length === 1, 'action queued after target picked');
  assert(bridge.open('weapon') === false, 'one-use-per-phase blocks reuse of weapon');
});

test('bridge: a failed puzzle spends fail cost and cools the component down', () => {
  const s = fresh();
  const bridge = createBridge({ getState: () => s, overlayEl: null, PuzzleClass: FakePuzzle, evaluateFn: evaluate });
  bridge.open('tower');
  s.activePuzzle.instance.fireFail();
  assert(s.cooldowns.tower === CONFIG.cooldowns.failCooldownMult, 'component cooled down');
  assert(s.creditLeftMs === s.creditMs - CONFIG.phase.failCostMs, 'fail cost spent');
  assert(s.activePuzzle === null, 'puzzle torn down on fail');
});

// --- real generator + ComboEngine (the half FakePuzzle skips) ----------------
test('potency stackCurve is config-driven: a 3-stack route reads from config.potency.stackCurve', () => {
  const three = evaluate(['freeze', 'freeze', 'freeze'], offensivePalette('weapon', {}, CONFIG.potency)).items[0].value;
  assert(three === CONFIG.potency.stackCurve[2], `3-stack potency = stackCurve[2] (${CONFIG.potency.stackCurve[2]}), got ${three}`);
  // a steeper custom curve flows straight through
  const custom = { stackCurve: [2, 4, 9], chainMultiplier: 1.5 };
  const got = evaluate(['freeze', 'freeze', 'freeze'], offensivePalette('weapon', {}, custom)).items[0].value;
  assert(got === 9, `custom stackCurve[2] = 9, got ${got}`);
});

test('each component palette generates a solvable board whose primary route yields its combo', () => {
  for (const [componentId, expected] of [['weapon', 'freeze'], ['generator', 'drain'], ['launchpad', 'burning'], ['engine', 'shatter'], ['tower', 'confuse']]) {
    const cfg = offensivePalette(componentId);
    const level = generate({ size: 6, seed: 11, nodeTypes: catalogFromConfig(cfg), routePlan: cfg.generation });
    assert(level.start && level.goal && Array.isArray(level.primaryRoute), `${componentId}: board has start/goal/route`);
    const skillSeq = level.primaryRoute.map((c) => level.cells[c.y][c.x]).filter((k) => cfg.skills[k]);
    const result = evaluate(skillSeq, cfg);
    assert(result.items[0] && result.items[0].skill === expected, `${componentId}: route yields ${expected}, got ${result.items[0]?.skill}`);
    assert(result.items[0].value > 0, `${componentId}: combo has positive potency`);
  }
});

test('defensive palettes also generate solvable boards that evaluate', () => {
  const cfg = defensivePalette('weapon');
  const level = generate({ size: 6, seed: 12, nodeTypes: catalogFromConfig(cfg), routePlan: cfg.generation });
  const seq = level.primaryRoute.map((c) => level.cells[c.y][c.x]).filter((k) => cfg.skills[k]);
  const result = evaluate(seq, cfg);
  assert(result.mode === 'defensive' && result.items.some((i) => i.skill === 'shield'), 'shield combo from defensive board');
});

test('comboPotency sums item values', () => {
  assert(comboPotency({ items: [{ value: 2 }, { value: 3 }] }) === 5, 'sum');
  assert(comboPotency(null) === 0, 'null → 0');
});
