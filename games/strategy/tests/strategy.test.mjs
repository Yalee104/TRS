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
import { isEffectValidOn, ATTACK_EFFECT, DEFENSE_VERB } from '../core/components.js';
import { startAttackBuild, commitAttack, startDefenseBuild, commitDefense } from '../core/phases.js';
import { combatCondition, firepowerMult, totalFirepower } from '../core/firepower.js';
import { systemState } from '../core/cascade.js';
import { applyStatus, tickAircraftStatuses, attackSynergyMult, resolveOffenseChains } from '../combat/statuses.js';
import { makePendingAttack, finalizeAttackTarget, validAttackTargets, resolveAttack, comboPotency } from '../combat/attack.js';
import { makePendingDefense, finalizeDefenseTarget, resolveDefense } from '../combat/defense.js';
import { planAttack, currentBudget } from '../combat/enemyAI.js';
import { resolveChain, OFFENSE_COMBOS, pairKey } from '../combat/combos.js';
import { offensivePalette, defensivePalette, catalogFromConfig } from '../puzzle/palettes.js';
import { createBridge, statusFriction } from '../puzzle/bridge.js';
import { ATTACK_EFFECT as PRESET_ATTACK_EFFECT, DEFENSE_VERB as PRESET_DEFENSE_VERB } from '../../grid-path-puzzle/presets/trs.js';
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

test('Confuse on YOUR Tower makes the telegraph UNRELIABLE (visible but uncertain), true plan intact', () => {
  const s = fresh();
  const clean = planAttack(s, s.enemies[0]);
  assert(clean.visible === true && !clean.confused && clean.display.every((d) => !d.uncertain), 'clean: visible, all certain');

  applyStatus(s.player.components.tower, 'confuse', { turns: 2 });
  const jammed = planAttack(s, s.enemies[0]);
  assert(jammed.visible === true && jammed.confused === true, 'confused Tower → still visible, flagged confused');
  assert(jammed.display.length && jammed.display.every((d) => d.uncertain), 'every shown prediction is uncertain');
  assert(jammed.display.length === jammed.entries.length, 'display is 1:1 with the true plan');
  assert(jammed.entries.length > 0, 'the TRUE entries (used at resolve) still exist');

  const e = fresh();
  applyStatus(e.enemies[0].components.tower, 'confuse', { turns: 2 });
  assert(planAttack(e, e.enemies[0]).scattered === false, 'confused ENEMY Tower still aims (no scatter — that is Freeze)');
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

test('stacking policy: Burning adds DoT + extends duration (capped); others refresh (MAX)', () => {
  const s = fresh();
  const c = s.enemies[0].components.weapon;
  applyStatus(c, 'burning', { turns: 3, dot: 5 }, CONFIG);
  applyStatus(c, 'burning', { turns: 3, dot: 5 }, CONFIG);
  assert(c.statuses.burning.dot === 10, 'Burning DoT adds (5+5)');
  assert(c.statuses.burning.turns === 6, 'Burning turns extend (3+3, cap 6)');
  applyStatus(c, 'burning', { turns: 10, dot: 30 }, CONFIG);
  assert(c.statuses.burning.dot === CONFIG.effects.burning.dotCap, 'DoT capped at dotCap');
  assert(c.statuses.burning.turns === CONFIG.effects.burning.turns.stackMax, 'turns capped at stackMax');
  // Freeze just refreshes — keeps the stronger, never extends
  const t = s.enemies[0].components.tower;
  applyStatus(t, 'freeze', { turns: 2 }, CONFIG);
  applyStatus(t, 'freeze', { turns: 1 }, CONFIG);
  assert(t.statuses.freeze.turns === 2, 'Freeze refreshes (MAX), no extend');
});

test('Glass: Frozen + Shattered on the Focus → ×mult, consumes both (replaces singles)', () => {
  // single-status synergy still works through attackSynergyMult
  const s = fresh();
  applyStatus(s.enemies[0].components.generator, 'shatter', { turns: 1 });
  assert(near(attackSynergyMult(s.enemies[0].components.generator, CONFIG), 1 + CONFIG.effects.synergy.shatterAmp, 0.001), 'shatter alone = +50%');
  // Glass forms in the chain resolver on the Focus and returns its mult, consuming both
  const s2 = fresh();
  attack(s2, 'engine', 6, 'generator');   // shatter (fresh) → enemy generator
  attack(s2, 'weapon', 6, 'generator');   // freeze (fresh) → enemy generator
  const { focusMult } = resolveOffenseChains(s2, 0, 'generator');
  const g = s2.enemies[0].components.generator;
  assert(focusMult === CONFIG.effects.synergy.combos.glass.mult, `Glass focus mult, got ${focusMult}`);
  assert(!g.statuses.freeze && !g.statuses.shatter, 'Glass consumed both ingredients');
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

test('Meltdown: Shatter+Burning forms a meltdown status that funnels into the shielded Core', () => {
  const s = fresh(); // single enemy, Generator alive → Core shielded
  attack(s, 'engine', 6, 'generator');    // shatter (fresh)
  attack(s, 'launchpad', 6, 'generator'); // burning (fresh)
  resolveOffenseChains(s, 0, 'core');     // forms Meltdown on the generator
  const g = s.enemies[0].components.generator;
  assert(g.statuses.meltdown && !g.statuses.shatter && !g.statuses.burning, 'meltdown formed, ingredients consumed');
  const dot = g.statuses.meltdown.dot;
  const coreBefore = s.enemies[0].components.core.hp;
  const { meltdown } = tickAircraftStatuses(s.enemies[0], CONFIG);
  assert(near(meltdown, dot * CONFIG.effects.synergy.combos.meltdown.coreFrac, 0.001), 'funnel = dot × coreFrac');
  assert(near(s.enemies[0].components.core.hp, coreBefore - meltdown, 0.001), 'shielded Core still took the meltdown');
});

// --- attack flow (pending → target) + resolve --------------------------------
test('solving holds a pending action; any status applies to any component (Table B dropped)', () => {
  const s = fresh();
  makePendingAttack(s, 'tower', combo(5)); // confuse — now valid on ANY part
  assert(s.pendingAction && s.pendingAction.effect === 'confuse', 'pending confuse held');
  const valid = validAttackTargets(s).filter((t) => t.eid === 0).map((t) => t.component).sort();
  const allAlive = Object.keys(s.enemies[0].components).sort();
  assert(valid.join() === allAlive.join(), `confuse valid on every alive part, got ${valid}`);
  assert(finalizeAttackTarget(s, 0, 'generator') !== null, 'confuse now applies to the generator');
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

test('v2 combos resolve via the chain (Backfire/Vaporize/Stasis/Collapse)', () => {
  const C = CONFIG.effects.synergy.combos;
  // Backfire — Shatter + Confuse → self-damage (burst, not focus-only)
  let s = fresh();
  attack(s, 'engine', 6, 'weapon'); attack(s, 'tower', 6, 'weapon');
  let w = s.enemies[0].components.weapon; const wBefore = w.hp;
  resolveOffenseChains(s, 0, 'core');
  assert(w.hp === wBefore - C.backfire.selfDamage && !w.statuses.shatter && !w.statuses.confuse, 'Backfire self-damage + consume');

  // Vaporize — Burning + Drain → detonate remaining burn now + heal, burn cleared
  s = fresh();
  attack(s, 'launchpad', 8, 'generator'); attack(s, 'generator', 8, 'generator');
  const g = s.enemies[0].components.generator; const gBefore = g.hp;
  const vapor = resolveOffenseChains(s, 0, 'core'); // resolver returns heal; resolveAttack applies it
  assert(g.hp < gBefore && !g.statuses.burning, 'Vaporize detonated the burn');
  assert(vapor.healed > 0, 'Vaporize returns lifesteal');

  // Stasis Lock — Frozen + Confuse → a stasisLock combo-status (disable)
  s = fresh();
  attack(s, 'weapon', 8, 'tower'); attack(s, 'tower', 8, 'tower'); // freeze + confuse → enemy tower
  resolveOffenseChains(s, 0, 'core');
  const t = s.enemies[0].components.tower;
  assert(t.statuses.stasisLock && t.statuses.stasisLock.turns > 0 && !t.statuses.freeze && !t.statuses.confuse, 'Stasis Lock formed');

  // Collapse — Shatter + Drain below the HP threshold → destroyed
  s = fresh();
  attack(s, 'engine', 6, 'generator'); attack(s, 'generator', 6, 'generator');
  const gg = s.enemies[0].components.generator;
  gg.hp = gg.maxHp * C.collapse.hpThreshold - 1;
  resolveOffenseChains(s, 0, 'core');
  assert(gg.hp === 0, 'Collapse executed a low shattered+drained part');
});

test('Feedback Cascade keeps the Drain + arcs to every other living enemy', () => {
  const s = createState(CONFIG, { seed: 7, enemies: ['saboteur', 'brute', 'brute'] });
  startAttackBuild(s);
  attack(s, 'tower', 5, 'weapon', 0); attack(s, 'generator', 5, 'weapon', 0); // confuse + drain → enemy 0 weapon
  const b1 = s.enemies[1].components.weapon.hp;
  const b2 = s.enemies[2].components.weapon.hp;
  const r = resolveOffenseChains(s, 0, 'core');
  const arc = 5 * CONFIG.effects.drain.dmgPerPotency * CONFIG.effects.synergy.combos.feedback.chainFrac;
  assert(near(s.enemies[1].components.weapon.hp, b1 - arc, 0.001), 'arced to enemy 1');
  assert(near(s.enemies[2].components.weapon.hp, b2 - arc, 0.001), 'arced to ALL other enemies (enemy 2)');
  assert(s.enemies[0].components.weapon.statuses.drain, 'target KEEPS the Drain choke');
  assert(r.healed > 0, 'Feedback heals (drain heal + cascade heal)');
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

test('defenses stack additively on the same part (bigger pool absorbs more)', () => {
  const oneShield = (n) => {
    const s = createState(CONFIG, { seed: 7, enemies: ['saboteur'] });
    startDefenseBuild(s);
    s.enemies[0].telegraph = { entries: [{ component: 'weapon', share: 1 }], visible: true }; // all on weapon
    for (let i = 0; i < n; i++) defend(s, 'weapon', 4, 'weapon'); // n shields, reusable
    resolveDefense(s);
    return s.player.components.weapon.hp;
  };
  assert(oneShield(2) > oneShield(1), 'two shields absorb more than one (additive pool)');
});

// --- defensive combos (Table E v2) -------------------------------------------
const defScene = () => { const s = createState(CONFIG, { seed: 7, enemies: ['saboteur'] }); startDefenseBuild(s); return s; };
const tele = (s, entries) => { s.enemies[0].telegraph = { entries, visible: true }; };
const enemyTotalHp = (s) => Object.values(s.enemies[0].components).reduce((t, c) => t + c.hp, 0);

test('Overclock banks build-credit (alone); a combo grants none', () => {
  const s = defScene();
  defend(s, 'launchpad', 5, 'weapon');       // lone Overclock
  tele(s, [{ component: 'weapon', share: 1 }]);
  resolveDefense(s);
  assert(s.creditBonusMs === CONFIG.defense.overclock.creditBonusMs, 'lone overclock banked credit');

  const s2 = defScene();
  defend(s2, 'weapon', 6, 'weapon'); defend(s2, 'launchpad', 6, 'weapon'); // Reactive Plating
  tele(s2, [{ component: 'weapon', share: 1 }]);
  resolveDefense(s2);
  assert(s2.creditBonusMs === 0, 'overclock consumed by a combo grants no credit');
});

test('Bastion caps total loss to a part this resolve', () => {
  const s = defScene();
  s.player.components.weapon.hp = 70;
  defend(s, 'weapon', 1, 'weapon');   // small shield
  defend(s, 'engine', 6, 'weapon');   // harden → Bastion
  tele(s, [{ component: 'weapon', share: 1 }]);
  resolveDefense(s);
  const loss = 70 - s.player.components.weapon.hp;
  assert(loss <= CONFIG.defense.combos.bastion.capFrac * 70 + 0.5, `loss ${loss} capped at ${CONFIG.defense.combos.bastion.capFrac * 70}`);
});

test('Reactive Plating reflects absorbed damage back at the attacker', () => {
  const s = defScene();
  defend(s, 'weapon', 6, 'weapon'); defend(s, 'launchpad', 6, 'weapon'); // Reactive Plating
  tele(s, [{ component: 'weapon', share: 1 }]);
  const before = enemyTotalHp(s);
  resolveDefense(s);
  assert(enemyTotalHp(s) < before, 'the attacker took reflected damage');
});

test('Sustain shield persists to the next defense resolve; Repair grants NO heal (option B)', () => {
  const s = defScene();
  s.player.components.weapon.hp = 40;             // damaged, so any heal would show
  defend(s, 'weapon', 6, 'weapon'); defend(s, 'generator', 6, 'weapon'); // Sustain on weapon
  tele(s, [{ component: 'engine', share: 1 }]);  // strike elsewhere so the weapon shield survives untouched
  resolveDefense(s);
  const w = s.player.components.weapon;
  assert(w.carry && w.carry.shield > 0, 'shield carried over');
  assert(w.hp === 40, 'Sustain healed no HP — the Repair was consumed by the combo');
});

test('Cleanse strips only the oldest (lone); Reboot strips all', () => {
  const lone = defScene();
  applyStatus(lone.player.components.weapon, 'freeze', { turns: 2 });
  applyStatus(lone.player.components.weapon, 'drain', { turns: 2 });
  defend(lone, 'tower', 5, 'weapon');  // lone Cleanse
  tele(lone, [{ component: 'core', share: 1 }]);
  resolveDefense(lone);
  assert(!lone.player.components.weapon.statuses.freeze && lone.player.components.weapon.statuses.drain, 'lone cleanse removed only the oldest');

  const reboot = defScene();
  applyStatus(reboot.player.components.weapon, 'freeze', { turns: 2 });
  applyStatus(reboot.player.components.weapon, 'drain', { turns: 2 });
  defend(reboot, 'tower', 5, 'weapon'); defend(reboot, 'launchpad', 5, 'weapon'); // Reboot
  tele(reboot, [{ component: 'core', share: 1 }]);
  resolveDefense(reboot);
  assert(!reboot.player.components.weapon.statuses.freeze && !reboot.player.components.weapon.statuses.drain, 'Reboot removed all');
});

test('Deflect dodges the first incoming hit; Purified Barrier wards a status', () => {
  const d = defScene();
  d.player.components.weapon.hp = 70;
  defend(d, 'tower', 5, 'weapon'); defend(d, 'engine', 5, 'weapon'); // Deflect
  tele(d, [{ component: 'weapon', share: 1 }]);
  resolveDefense(d);
  assert(d.player.components.weapon.hp === 70, 'Deflect dodged the only hit');

  const pb = defScene();
  defend(pb, 'weapon', 6, 'weapon'); defend(pb, 'tower', 6, 'weapon'); // Purified Barrier
  tele(pb, [{ component: 'weapon', share: 1, status: 'freeze' }]);
  resolveDefense(pb);
  assert(!pb.player.components.weapon.statuses.freeze, 'Purified Barrier warded the incoming status');
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

test('Min Chain: the bridge wires the module objective gate (Cleanse needs 3 icons)', () => {
  // Min-chain enforcement moved from a post-commit bridge check to the module's
  // OBJECTIVE GATE — so the bridge's job is to CONFIGURE the gate; the module then
  // blocks the goal until met (covered by the module's own objective.test.mjs).
  assert(CONFIG.defense.cleanse.minChain === 3, 'Cleanse minChain is 3 (non-scaled)');
  const s = fresh(); startDefenseBuild(s);
  const b = createBridge({ getState: () => s, overlayEl: null, PuzzleClass: FakePuzzle, evaluateFn: evaluate });
  b.open('tower'); // Cleanse
  const obj = s.activePuzzle.instance.opts.objective;
  assert(obj && obj.type === 'cleanse' && obj.min === 3, `gate set for cleanse min 3, got ${JSON.stringify(obj)}`);

  // A gate-passed completion (the module only fires onComplete once met) queues.
  s.activePuzzle.instance.fireComplete([{ typeKey: 'cleanse' }, { typeKey: 'cleanse' }, { typeKey: 'cleanse' }]);
  assert(s.pendingDefense && s.pendingDefense.verb === 'cleanse', 'meeting Min Chain queues the defense');

  // A scaled effect (Freeze) gates at min 1.
  const a = fresh();
  const ba = createBridge({ getState: () => a, overlayEl: null, PuzzleClass: FakePuzzle, evaluateFn: evaluate });
  ba.open('weapon');
  assert(a.activePuzzle.instance.opts.objective.min === 1, 'freeze gate min 1');
});

test('bridge passes the GO countdown + failFast + fail banner from config', () => {
  const s = fresh();
  const b = createBridge({ getState: () => s, overlayEl: null, PuzzleClass: FakePuzzle, evaluateFn: evaluate });
  b.open('weapon');
  const o = s.activePuzzle.instance.opts;
  assert(o.countdownMs === CONFIG.puzzle.countdown.ms, 'GO countdown wired');
  assert(o.flashStart === CONFIG.puzzle.countdown.flashStart, 'flashStart wired');
  assert(o.trapEntryMode === 'failFast', 'failFast hazards wired');
  assert(o.failText === 'FAIL', 'fail banner wired');
});

// --- status → route friction (the reflect-back) ------------------------------
test('statusFriction maps overlapping statuses to combined modifiers + burning flag', () => {
  const mods = CONFIG.puzzle.modifiers;
  // a clean part → no modifiers, no burning
  const clean = statusFriction({ statuses: {} }, 'freeze', mods);
  assert(clean.modifiers === null && clean.burningOn === false, 'clean part → no friction');

  // overlap: confused + drained + shattered on one part → all three modifiers at once
  const part = { statuses: { confuse: { turns: 2 }, drain: { turns: 1 }, shatter: { turns: 1 } } };
  const f = statusFriction(part, 'shield', mods);
  assert(f.modifiers.confusion === mods.confuseChance, 'confuse → confusion');
  assert(f.modifiers.decay && f.modifiers.decay.type === 'shield', 'drain → decay on the payload icon');
  assert(f.modifiers.wander && f.modifiers.wander.type === 'shield', 'shatter → wander on the payload icon');
  assert(f.modifiers.slow === undefined, 'no freeze → no slow');
  assert(f.burningOn === false, 'no burning here');

  // freeze → slow; burning → flag (never co-occur, host cancels them)
  const frozen = statusFriction({ statuses: { freeze: { turns: 2 } } }, 'freeze', mods);
  assert(frozen.modifiers.slow === mods.freezeSlow, 'freeze → slow');
  const burning = statusFriction({ statuses: { burning: { turns: 2, dot: 4 } } }, 'burning', mods);
  assert(burning.modifiers === null && burning.burningOn === true, 'burning → generation flag, no runtime modifier');
});

test('a Burning component solves on a board seeded with the firehazard density', () => {
  const s = fresh();
  applyStatus(s.player.components.launchpad, 'burning', { turns: 2, dot: 4 }); // launchpad = burning payload
  const b = createBridge({ getState: () => s, overlayEl: null, PuzzleClass: FakePuzzle, evaluateFn: evaluate });
  b.open('launchpad');
  const plan = s.activePuzzle.instance.opts.generate.routePlan;
  assert(plan.burningType === 'firehazard', 'firehazard hazard type set');
  assert(plan.burningDensity === CONFIG.puzzle.modifiers.burningDensity, 'burning density seeded from config');
  // a NON-burning component gets density 0 (no regression)
  const s2 = fresh();
  const b2 = createBridge({ getState: () => s2, overlayEl: null, PuzzleClass: FakePuzzle, evaluateFn: evaluate });
  b2.open('weapon');
  assert(s2.activePuzzle.instance.opts.generate.routePlan.burningDensity === 0, 'clean part → no fire hazards');
});

test('ATTACK_EFFECT / DEFENSE_VERB stay in sync with the shared preset', () => {
  assert(JSON.stringify(ATTACK_EFFECT) === JSON.stringify(PRESET_ATTACK_EFFECT), 'ATTACK_EFFECT matches preset');
  assert(JSON.stringify(DEFENSE_VERB) === JSON.stringify(PRESET_DEFENSE_VERB), 'DEFENSE_VERB matches preset');
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
