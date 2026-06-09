// Asserts node effects apply in path order and produce the expected run-state.
import { test, assert } from './harness.mjs';
import { runEffects, buildResult } from '../module/core/effects.js';
import { nodeTypes } from './sampleNodeTypes.mjs';

// S - blue - yellow - purple - goal  (a straight 5-cell path)
const level = {
  cols: 5, rows: 1,
  cells: [['start', 'blue', 'yellow', 'purple', 'goal']],
  start: { x: 0, y: 0 }, goal: { x: 4, y: 0 }, moveBudget: null, timeLimitMs: null,
};
const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }];
const base = { multiplier: 1, skills: [], fail: false };

test('runEffects applies onPass in path order', () => {
  const s = runEffects(path, level, nodeTypes, base);
  // blue: +0.5 => 1.5 ; purple: *1.25 => 1.875
  assert(Math.abs(s.multiplier - 1.875) < 1e-9, `multiplier 1.875, got ${s.multiplier}`);
  assert(s.skills.length === 1 && s.skills[0] === 'Freeze', 'collected Freeze skill');
  assert(s.fail === false, 'no fail');
});

test('runEffects does not mutate the base run-state', () => {
  runEffects(path, level, nodeTypes, base);
  assert(base.multiplier === 1 && base.skills.length === 0, 'base untouched (cloned)');
});

test('a fail-on-pass trap flags failure', () => {
  const trapLevel = { ...level, cells: [['start', 'trapFail', 'goal']], goal: { x: 2, y: 0 } };
  const s = runEffects([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], trapLevel, nodeTypes, base);
  assert(s.fail === true, 'fail flag set by trap');
});

test('buildResult assembles the public result shape', () => {
  const r = buildResult({ path, level, nodeTypes, baseRunState: base, reason: 'goal', success: true, elapsedMs: 1234 });
  assert(r.success === true && r.reason === 'goal', 'success/reason');
  assert(r.steps === 5, 'steps counted');
  assert(r.path[1].typeKey === 'blue', 'path describes type keys');
  assert(r.time.elapsedMs === 1234, 'elapsed time carried');
});
