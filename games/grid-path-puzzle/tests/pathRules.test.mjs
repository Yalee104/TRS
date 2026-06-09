// Asserts the path-validity rules (the single source of truth for both inputs).
import { test, assert } from './harness.mjs';
import { canExtend, isVisited, backtrackIndex, reachedGoal } from '../module/core/pathRules.js';
import { nodeTypes } from './sampleNodeTypes.mjs';

// A hand-built 4x4 level with a blocker at (1,1):
//   S . . .
//   . # . .
//   . . . .
//   . . . G
const level = {
  cols: 4, rows: 4,
  cells: [
    ['start', 'normal', 'normal', 'normal'],
    ['normal', 'blocker', 'normal', 'normal'],
    ['normal', 'normal', 'normal', 'normal'],
    ['normal', 'normal', 'normal', 'goal'],
  ],
  start: { x: 0, y: 0 }, goal: { x: 3, y: 3 }, moveBudget: null,
};

test('canExtend allows only orthogonal, unvisited, passable cells', () => {
  const path = [{ x: 0, y: 0 }];
  assert(canExtend(path, { x: 1, y: 0 }, level, nodeTypes) === true, 'right neighbor ok');
  assert(canExtend(path, { x: 0, y: 1 }, level, nodeTypes) === true, 'down neighbor ok');
  assert(canExtend(path, { x: 1, y: 1 }, level, nodeTypes) === false, 'diagonal rejected (not adjacent)');
  assert(canExtend(path, { x: 2, y: 0 }, level, nodeTypes) === false, 'two-away rejected');
  assert(canExtend(path, { x: 0, y: 0 }, level, nodeTypes) === false, 'self/visited rejected');
});

test('canExtend rejects a hard blocker', () => {
  const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }]; // head at (1,0); (1,1) is a blocker
  assert(canExtend(path, { x: 1, y: 1 }, level, nodeTypes) === false, 'blocker not enterable');
  assert(canExtend(path, { x: 2, y: 0 }, level, nodeTypes) === true, 'open neighbor still ok');
});

test('isVisited detects cells already on the path', () => {
  const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  assert(isVisited(path, { x: 1, y: 0 }) === true, 'on path');
  assert(isVisited(path, { x: 2, y: 0 }) === false, 'not on path');
});

test('backtrackIndex finds a non-head cell to truncate to', () => {
  const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
  assert(backtrackIndex(path, { x: 1, y: 0 }) === 1, 'mid cell -> its index');
  assert(backtrackIndex(path, { x: 0, y: 0 }) === 0, 'start -> 0');
  assert(backtrackIndex(path, { x: 2, y: 0 }) === -1, 'head -> -1 (not a backtrack)');
  assert(backtrackIndex(path, { x: 3, y: 3 }) === -1, 'off-path -> -1');
});

test('reachedGoal is true only when head is a goal cell', () => {
  assert(reachedGoal([{ x: 0, y: 0 }], level, nodeTypes) === false, 'start is not goal');
  assert(reachedGoal([{ x: 3, y: 3 }], level, nodeTypes) === true, 'head on goal');
});
