// Effect tests: feed REAL ComboEngine results into applyComboResult and assert
// the game-state mutations + target selection.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, assert } from './harness.mjs';
import { evaluate } from '../../grid-path-puzzle/combo/ComboEngine.js';
import { applyComboResult, applyPowerup } from '../effects/apply.js';
import { createState, bossOf, hasStatus } from '../core/state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(resolve(__dirname, p), 'utf8'));
const CONFIG = readJson('../config/game.json');
const OFF = readJson('../../grid-path-puzzle/combo/configs/offensive.json');
const DEF = readJson('../../grid-path-puzzle/combo/configs/defensive.json');
const fresh = () => createState(CONFIG);

test('offensive Freeze stack freezes ONLY the boss (single target)', () => {
  const state = fresh();
  applyComboResult(state, evaluate(['freeze', 'freeze', 'freeze'], OFF), 'offensive');
  assert(hasStatus(bossOf(state), 'freeze'), 'boss frozen');
  assert(!state.enemies.filter((e) => e.kind === 'small').some((e) => hasStatus(e, 'freeze')), 'smalls not frozen');
});

test('Multihack widens to ALL enemies', () => {
  const state = fresh();
  applyComboResult(state, evaluate(['freeze', 'freeze', 'freeze', 'chain', 'multihack'], OFF), 'offensive');
  assert(state.enemies.every((e) => hasStatus(e, 'freeze')), 'every enemy frozen');
});

test('Beam applies freeze + confuse to all enemies', () => {
  const state = fresh();
  applyComboResult(state, evaluate(['freeze', 'confuse', 'drain', 'chain', 'multihack'], OFF), 'offensive');
  assert(state.enemies.every((e) => hasStatus(e, 'freeze') && hasStatus(e, 'confuse')), 'all frozen + confused');
});

test('offensive Drain bypasses the enemy shield and hits HP', () => {
  const state = fresh();
  const boss = bossOf(state);
  const hp0 = boss.hp, sh0 = boss.shield.amount;
  assert(sh0 > 0, 'boss starts with a shield');
  applyComboResult(state, evaluate(['drain', 'drain', 'drain'], OFF), 'offensive');
  assert(boss.hp < hp0, 'boss HP dropped despite a full shield');
  assert(boss.shield.amount === sh0, 'shield left untouched by drain');
});

test('defensive Shield grants the player a shield pool', () => {
  const state = fresh();
  applyComboResult(state, evaluate(['shield', 'shield', 'amplify'], DEF), 'defensive');
  // 2-stack Value 2.5 × 1.5 amplify = 3.75 magnitude; base 25 → ~93.75 HP absorb
  assert(Math.abs(state.player.shield.amount - 93.75) < 1e-6, `shield ≈ 93.75 (got ${state.player.shield.amount})`);
  assert(state.player.shield.remainingMs > 0, 'shield has a duration');
});

test('repair power-up heals the player', () => {
  const state = fresh();
  state.player.hp = 50;
  applyPowerup(state, 'repair', DEF.powerups.repair); // base 30
  assert(state.player.hp === 80, 'healed 50→80');
});

test('unknown effect key does not throw', () => {
  const state = fresh();
  applyComboResult(state, { mode: 'offensive', items: [{ skill: 'freeze', tier: 'x', gameValue: 1, targets: 1, effects: ['nonsenseEffect'] }] }, 'offensive');
  assert(true, 'survived unknown effect');
});
