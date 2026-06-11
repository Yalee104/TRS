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
  constructor(opts) { this.opts = opts; FakePuzzle.last = this; this.destroyed = false; }
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
  assert(state.cooldowns.defensive === CONFIG.cooldowns.defensiveFailMs, 'fail cooldown applied');
  assert(state.player.hp === before && state.player.shield.amount === 0, 'no buff applied on fail');
  assert(state.phase === 'playing' && state.timeScale === 1, 'state restored');
});
