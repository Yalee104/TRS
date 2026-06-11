// Headless tests for the data-driven ComboEngine (offensive + defensive configs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, assert } from './harness.mjs';
import { evaluate } from '../combo/ComboEngine.js';
import { applyFormula } from '../combo/formulas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(readFileSync(resolve(__dirname, `../combo/configs/${n}.json`), 'utf8'));
const OFF = load('offensive');
const DEF = load('defensive');
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---- formulas ----
test('formulas: linear and multiply', () => {
  assert(near(applyFormula({ kind: 'linear', base: 0.4 }, 6.75), 2.7), 'linear 0.4*6.75');
  assert(near(applyFormula({ kind: 'multiply', base: 2, exp: 2 }, 3), 18), 'multiply 2*3^2');
  assert(applyFormula(undefined, 5) === null, 'no value → null');
});

// ---- OFFENSIVE ----
test('offense: stacking the locked payload climbs the curve + tiers', () => {
  const r1 = evaluate(['freeze'], OFF);
  assert(r1.items[0].tier === 'Chill' && near(r1.items[0].value, 1.0), '×1 Chill');
  const r3 = evaluate(['freeze', 'freeze', 'freeze'], OFF);
  assert(r3.items[0].tier === 'Deep Freeze' && near(r3.items[0].value, 4.5), '×3 Deep Freeze 4.5');
  assert(r3.items[0].effects.includes('shatter'), '×3 unlocks shatter');
  assert(near(r3.items[0].gameValue, 1.8), '×3 → 0.4*4.5 = 1.8s');
});

test('offense: Chain multiplies, Multihack widens targets', () => {
  const r = evaluate(['freeze', 'freeze', 'freeze', 'chain', 'multihack'], OFF);
  assert(near(r.items[0].value, 6.75), '4.5 × 1.5 = 6.75');
  assert(r.items[0].targets === 'all', 'multihack → all');
});

test('offense: a different payload breaks the run and wastes the rest', () => {
  const r = evaluate(['freeze', 'drain'], OFF);
  assert(r.items[0].skill === 'freeze' && near(r.items[0].value, 1.0), 'locked to Freeze ×1');
  const r2 = evaluate(['freeze', 'freeze', 'drain', 'multihack'], OFF);
  assert(near(r2.items[0].value, 2.5) && r2.items[0].targets === 1, 'multihack after the break is wasted');
});

test('offense: an amplifier before any payload is wasted', () => {
  const r = evaluate(['chain', 'freeze', 'freeze'], OFF);
  assert(near(r.items[0].value, 2.5), 'leading chain boosts nothing → 2.5');
});

test('offense: the Beam matches (any payload order) and near-miss falls back', () => {
  const beam = evaluate(['drain', 'freeze', 'confuse', 'chain', 'multihack'], OFF);
  assert(beam.special && beam.special.id === 'beam', 'Beam recognized in any payload order');
  const miss = evaluate(['freeze', 'confuse', 'drain', 'chain'], OFF); // no multihack
  assert(!miss.special && miss.items[0].skill === 'freeze' && near(miss.items[0].value, 1.0),
    'near-miss → lock-to-first Freeze ×1, no special');
});

// ---- DEFENSIVE ----
test('defense: every distinct payload applies (layered buffs)', () => {
  const r = evaluate(['shield', 'cleanse', 'overclock'], DEF);
  assert(r.items.length === 3, '3 buffs');
  const shield = r.items.find((i) => i.skill === 'shield');
  assert(near(shield.gameValue, 25), 'shield ×1 → 25 HP absorb');
});

test('defense: longest ADJACENT run stacks; separated copies do not', () => {
  const sep = evaluate(['shield', 'cleanse', 'shield'], DEF);
  assert(near(sep.items.find((i) => i.skill === 'shield').value, 1.0), 'separated shields → ×1');
  const adj = evaluate(['shield', 'cleanse', 'shield', 'shield'], DEF);
  assert(near(adj.items.find((i) => i.skill === 'shield').value, 2.5), 'trailing adjacent pair → ×2');
});

test('defense: amplifiers boost only buffs collected before them', () => {
  const after = evaluate(['shield', 'shield', 'amplify'], DEF);
  assert(near(after.items[0].magnitude, 3.75), '2.5 × 1.5 Amplify after the run');
  const before = evaluate(['amplify', 'shield', 'shield'], DEF);
  assert(near(before.items[0].magnitude, 2.5), 'Amplify before the run does nothing');
  const prolong = evaluate(['overclock', 'overclock', 'prolong'], DEF);
  assert(near(prolong.items[0].durationSec, 7.5), 'baseDuration 5 × 1.5 Prolong');
});

test('defense: Fortress label emerges from all 3 payloads + both amplifiers', () => {
  const r = evaluate(['shield', 'cleanse', 'overclock', 'prolong', 'amplify'], DEF);
  assert(r.label === 'Fortress / Overdrive', 'Fortress label present');
});

test('both: skills beyond maxSlots (5) are ignored', () => {
  const r = evaluate(['freeze', 'freeze', 'freeze', 'freeze', 'freeze', 'freeze'], OFF);
  assert(near(r.items[0].value, 10.0), 'only first 5 freezes count → curve[5] = 10.0');
});
