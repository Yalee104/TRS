// Pure-system unit tests (no DOM): fire patterns, fire cadence, collision,
// status expiry, win/lose.
import { test, assert } from './harness.mjs';
import { stepEnemyAI } from '../systems/enemyAI.js';
import { stepPlayerFire } from '../systems/playerFire.js';
import { stepCollision } from '../systems/collision.js';
import { stepStatus } from '../systems/status.js';
import { stepWinLose } from '../systems/winLose.js';
import { addStatus } from '../core/state.js';

const baseConfig = { bulletDefaults: { enemyRadius: 6, enemyColor: '#f00' }, tuning: { shatterBonus: 24, drainRegenPerTick: 0 } };
const mkBoss = (patterns) => ({
  id: 1, kind: 'boss', pos: { x: 100, y: 50 }, hp: 100, radius: 20, color: '#f0f',
  statuses: [], patternState: { index: 0, phaseTimer: 0, telegraphing: false }, def: { patterns },
});

test('boss patterns emit the right bullet counts', () => {
  for (const [type, count, expect] of [['aimed', 1, 1], ['spread', 5, 5], ['radial', 8, 8]]) {
    const state = { player: { pos: { x: 100, y: 600 } }, enemies: [mkBoss([{ type, count, rateMs: 100, spreadDeg: 60, bulletSpeed: 100, bulletDmg: 5 }])], bullets: [], fx: [], config: baseConfig };
    stepEnemyAI(state, 100); // reach rateMs → fire once
    assert(state.bullets.length === expect, `${type} → ${expect} bullets (got ${state.bullets.length})`);
  }
});

test('radial bullets are evenly distributed in angle', () => {
  const state = { player: { pos: { x: 100, y: 600 } }, enemies: [mkBoss([{ type: 'radial', count: 4, rateMs: 100, bulletSpeed: 100, bulletDmg: 5 }])], bullets: [], fx: [], config: baseConfig };
  stepEnemyAI(state, 100);
  const angles = state.bullets.map((b) => Math.round(Math.atan2(b.vel.y, b.vel.x) * 180 / Math.PI)).sort((a, b) => a - b);
  assert(state.bullets.length === 4 && new Set(angles).size === 4, 'four distinct directions');
});

test('frozen enemy does not fire', () => {
  const boss = mkBoss([{ type: 'aimed', count: 1, rateMs: 100, bulletSpeed: 100, bulletDmg: 5 }]);
  addStatus(boss, 'freeze', 5000, 0, {});
  const state = { player: { pos: { x: 100, y: 600 } }, enemies: [boss], bullets: [], fx: [], config: baseConfig };
  stepEnemyAI(state, 200);
  assert(state.bullets.length === 0, 'no bullets while frozen');
});

test('playerFire spawns a bullet and sets cooldown by rate', () => {
  const player = { pos: { x: 100, y: 600 }, radius: 14, baseFireRate: 10, fireRateMult: 1, fireCooldown: 0, bulletSpeed: 500, bulletDmg: 9, bulletRadius: 4, color: '#0ff', statuses: [], input: { firing: true } };
  const state = { player, bullets: [] };
  stepPlayerFire(state, 0); // dt=0 so cooldown becomes exactly 1000/rate
  assert(state.bullets.length === 1, 'one bullet fired');
  assert(Math.abs(player.fireCooldown - 100) < 1e-6, 'cooldown = 1000/10 = 100ms');
  // overclock doubles rate → smaller cooldown
  player.fireRateMult = 2; player.fireCooldown = 0;
  stepPlayerFire(state, 0);
  assert(Math.abs(player.fireCooldown - 50) < 1e-6, 'overclocked cooldown = 50ms');
});

test('collision: player bullet damages enemy (+shatter bonus when frozen)', () => {
  const enemy = { id: 1, kind: 'boss', pos: { x: 100, y: 100 }, radius: 20, hp: 100, statuses: [] };
  const state = { player: { pos: { x: 0, y: 0 }, radius: 14, hp: 100, maxHp: 100, shield: { amount: 0, remainingMs: 0 }, statuses: [] }, enemies: [enemy], bullets: [{ owner: 'player', srcId: 'player', pos: { x: 100, y: 100 }, vel: { x: 0, y: -1 }, dmg: 10, radius: 4 }], config: baseConfig };
  stepCollision(state);
  assert(enemy.hp === 90, 'enemy hp 100→90');
  // with shatter freeze
  enemy.hp = 100; addStatus(enemy, 'freeze', 5000, 0, { shatter: true });
  state.bullets = [{ owner: 'player', srcId: 'player', pos: { x: 100, y: 100 }, vel: { x: 0, y: -1 }, dmg: 10, radius: 4 }];
  stepCollision(state);
  assert(enemy.hp === 100 - 10 - 24, 'shatter adds bonus damage');
});

test('collision: shield absorbs enemy bullet before HP', () => {
  const player = { pos: { x: 100, y: 600 }, radius: 14, hp: 100, maxHp: 100, shield: { amount: 30, remainingMs: 5000 }, statuses: [] };
  const state = { player, enemies: [], bullets: [{ owner: 'enemy', srcId: 9, pos: { x: 100, y: 600 }, vel: { x: 0, y: 1 }, dmg: 10, radius: 6 }], config: baseConfig };
  stepCollision(state);
  assert(player.hp === 100 && player.shield.amount === 20, 'shield absorbed 10, hp intact');
});

test('status expiry + overclock mult recompute', () => {
  const player = { hp: 100, maxHp: 100, shield: { amount: 0, remainingMs: 0 }, statuses: [], fireRateMult: 1 };
  addStatus(player, 'overclock', 500, 0.5);
  const state = { player, enemies: [], config: baseConfig };
  stepStatus(state, 100);
  assert(Math.abs(player.fireRateMult - 1.5) < 1e-6, 'overclock 0.5 → mult 1.5');
  stepStatus(state, 600); // expire
  assert(player.statuses.length === 0 && player.fireRateMult === 1, 'expired, mult reset');
});

test('winLose: clear enemies → won; player dead → lost', () => {
  const won = { phase: 'playing', enemies: [{ hp: 0, kind: 'small', pos: { x: 0, y: 0 } }], player: { hp: 100 }, fx: [] };
  stepWinLose(won);
  assert(won.phase === 'won', 'all enemies dead → won');
  const lost = { phase: 'playing', enemies: [{ hp: 10, kind: 'boss', pos: { x: 0, y: 0 } }], player: { hp: 0 }, fx: [] };
  stepWinLose(lost);
  assert(lost.phase === 'lost', 'player hp 0 → lost');
});
