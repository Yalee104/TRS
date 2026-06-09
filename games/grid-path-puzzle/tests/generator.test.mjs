// Asserts the headline guarantee: EVERY generated level is solvable (within its
// own budget), and that generation is reproducible from a seed.
import { test, assert } from './harness.mjs';
import { generate, findAnyPath } from '../module/core/generator.js';
import { isSolvable, manhattan, sameCell } from '../module/core/gridModel.js';
import { nodeTypes, weights } from './sampleNodeTypes.mjs';

function validatePath(level, path, budget) {
  if (!path) { assert(false, 'a path exists'); return; }
  assert(sameCell(path[0], level.start), 'path begins at start');
  assert(sameCell(path[path.length - 1], level.goal), 'path ends at goal');
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    const key = `${c.x},${c.y}`;
    assert(!seen.has(key), 'no cell revisited');
    seen.add(key);
    assert(isSolvable(nodeTypes[level.cells[c.y][c.x]]), 'every step is solvable (not blocker/trap)');
    if (i > 0) assert(manhattan(path[i - 1], c) === 1, 'each step is orthogonal');
  }
  if (budget != null) assert(path.length <= budget, `path length ${path.length} within budget ${budget}`);
}

test('every generated level (sizes 4..15, many seeds) is solvable', () => {
  for (let size = 4; size <= 15; size++) {
    for (let seed = 0; seed < 12; seed++) {
      const level = generate({ size, nodeTypes, weights, difficulty: 0.5, seed });
      const path = findAnyPath(level, nodeTypes, level.moveBudget);
      validatePath(level, path, level.moveBudget);
    }
  }
});

test('solvable even with a tight move budget and high difficulty', () => {
  for (let seed = 0; seed < 20; seed++) {
    const size = 10;
    // ask for an impossibly small budget on purpose — generator should raise it
    const level = generate({ size, nodeTypes, weights, difficulty: 0.95, moveBudget: 3, seed });
    assert(level.moveBudget >= manhattan(level.start, level.goal) + 1, 'budget raised to a feasible value');
    const path = findAnyPath(level, nodeTypes, level.moveBudget);
    validatePath(level, path, level.moveBudget);
  }
});

test('same seed + options => identical level (reproducible)', () => {
  const opts = { size: 9, nodeTypes, weights, difficulty: 0.6, seed: 12345 };
  const a = generate(opts);
  const b = generate(opts);
  assert(JSON.stringify(a.cells) === JSON.stringify(b.cells), 'cells match for same seed');
  assert(a.seed === b.seed, 'seed recorded and equal');
});

test('different seeds generally differ', () => {
  const a = generate({ size: 9, nodeTypes, weights, seed: 1 });
  const b = generate({ size: 9, nodeTypes, weights, seed: 2 });
  assert(JSON.stringify(a.cells) !== JSON.stringify(b.cells), 'different seeds produce different boards');
});
