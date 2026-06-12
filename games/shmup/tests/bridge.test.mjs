// Bridge tests: cooldown / one-at-a-time gating + the path→skillSeq→effect
// contract. GridPathPuzzle is replaced with a fake so no DOM is needed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, assert } from './harness.mjs';
import { createBridge } from '../puzzle/bridge.js';
import { evaluate } from '../../grid-path-puzzle/combo/ComboEngine.js';
import { createState, bossOf, hasStatus } from '../core/state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(resolve(__dirname, p), 'utf8'));
const CONFIG = readJson('../config/game.json');
const OFF = readJson('../../grid-path-puzzle/combo/configs/offensive.json');
const DEF = readJson('../../grid-path-puzzle/combo/configs/defensive.json');

class FakePuzzle {
  constructor(opts) { this.opts = opts; FakePuzzle.last = this; this.destroyed = false; this.started = false; this.handlers = {}; }
  start() { this.started = true; }
  on(evt, fn) { this.handlers[evt] = fn; }
  destroy() { this.destroyed = true; }
}
const mkBridge = (state) => createBridge({
  getState: () => state, overlayEl: null,
  configs: { offensive: OFF, defensive: DEF }, PuzzleClass: FakePuzzle, evaluateFn: evaluate,
});
const skillPath = (keys) => keys.map((k) => ({ x: 0, y: 0, typeKey: k }));

test('open() flips to slow-mo puzzle phase; one puzzle at a time', () => {
  const state = createState(CONFIG);
  const bridge = mkBridge(state);
  assert(bridge.open('offensive') === true, 'opened offensive');
  assert(state.phase === 'puzzle', 'phase = puzzle');
  assert(state.timeScale < 1, 'slow-mo engaged');
  assert(!!state.activePuzzle, 'activePuzzle set');
  assert(bridge.open('defensive') === false, 'second puzzle blocked while one is active');
});

test('open() starts the countdown immediately and subscribes to ticks', () => {
  const state = createState(CONFIG);
  const bridge = mkBridge(state);
  bridge.open('offensive');
  assert(FakePuzzle.last.started === true, 'timer started on open (idling still times out)');
  assert(typeof FakePuzzle.last.handlers.tick === 'function', 'subscribed to tick for the live countdown');
});

test('success: combo applied, success cooldown set, state restored', () => {
  const state = createState(CONFIG);
  const bridge = mkBridge(state);
  bridge.open('offensive');
  FakePuzzle.last.opts.onComplete({ path: skillPath(['freeze', 'freeze', 'freeze', 'chain', 'multihack']) });
  assert(hasStatus(bossOf(state), 'freeze'), 'boss frozen by the combo');
  assert(state.cooldowns.offensive === CONFIG.cooldowns.offensiveSuccessMs, 'success cooldown applied');
  assert(state.phase === 'playing' && state.timeScale === 1 && !state.activePuzzle, 'state restored');
  assert(FakePuzzle.last.destroyed, 'puzzle instance destroyed');
});

test('offensive success disables ALL enemy shields for the configured window', () => {
  const state = createState(CONFIG);
  const bridge = mkBridge(state);
  bridge.open('offensive');
  FakePuzzle.last.opts.onComplete({ path: skillPath(['freeze', 'freeze', 'freeze']) });
  assert(state.enemies.length > 1 && state.enemies.every((e) => e.shield.disabledMs === CONFIG.tuning.shieldDisableMs),
    'every enemy shield disabled for shieldDisableMs');
});

test('defensive success does NOT disable enemy shields', () => {
  const state = createState(CONFIG);
  const bridge = mkBridge(state);
  bridge.open('defensive');
  FakePuzzle.last.opts.onComplete({ path: skillPath(['shield', 'shield']) });
  assert(state.enemies.every((e) => e.shield.disabledMs === 0), 'enemy shields untouched by the defensive puzzle');
});

test('cooldown gates re-opening', () => {
  const state = createState(CONFIG);
  state.cooldowns.offensive = 3000;
  const bridge = mkBridge(state);
  assert(bridge.open('offensive') === false, 'cannot open while cooling down');
});

test('fail: no effect applied, fail cooldown set', () => {
  const state = createState(CONFIG);
  const before = state.player.hp;
  const bridge = mkBridge(state);
  bridge.open('defensive');
  FakePuzzle.last.opts.onFail({ reason: 'timeout' });
  const expectedFailCd = CONFIG.cooldowns.defensiveSuccessMs * (CONFIG.cooldowns.failCooldownMult ?? 2);
  assert(state.cooldowns.defensive === expectedFailCd, 'fail cooldown = success x mult (doubled)');
  assert(state.player.hp === before && state.player.shield.amount === 0, 'no buff applied on fail');
  assert(state.phase === 'playing' && state.timeScale === 1, 'state restored');
});
