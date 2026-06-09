// =============================================================================
//  core/levelLoader.js  —  validate & normalize an AUTHORED level
// =============================================================================
//
//  An authored level (hand-designed by a developer) comes in as:
//    { grid: [[typeKey,...], ...], start:{x,y}, goal:{x,y}, moveBudget?, timeLimitMs? }
//
//  We validate it strictly and FAIL FAST with descriptive errors (this is a
//  learning module — a clear message beats a silent broken board), then return
//  the SAME normalized shape the generator produces, so all downstream code
//  (rules, effects, renderer) treats authored and generated levels identically.
// =============================================================================

import { findAnyPath } from './generator.js';
import { MIN_SIZE, MAX_SIZE } from '../util/clamp.js';

export function loadLevel(input, nodeTypes) {
  if (!input || !Array.isArray(input.grid) || input.grid.length === 0) {
    throw new Error('[grid-path-puzzle] level.grid must be a non-empty 2D array of node-type keys.');
  }
  const rows = input.grid.length;
  const cols = input.grid[0].length;

  // rectangular + every key known to the catalog
  for (let y = 0; y < rows; y++) {
    if (!Array.isArray(input.grid[y]) || input.grid[y].length !== cols) {
      throw new Error(`[grid-path-puzzle] level.grid must be rectangular (row ${y} has wrong length).`);
    }
    for (let x = 0; x < cols; x++) {
      const k = input.grid[y][x];
      if (!nodeTypes[k]) {
        throw new Error(`[grid-path-puzzle] cell (${x},${y}) uses unknown node type "${k}".`);
      }
    }
  }

  if (cols < MIN_SIZE || cols > MAX_SIZE || rows < MIN_SIZE || rows > MAX_SIZE) {
    // eslint-disable-next-line no-console
    console.warn(`[grid-path-puzzle] authored grid ${cols}x${rows} is outside the supported ${MIN_SIZE}..${MAX_SIZE} range; rendering anyway.`);
  }

  // exactly one start-role and one goal-role cell
  const starts = [];
  const goals = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const role = nodeTypes[input.grid[y][x]].role;
      if (role === 'start') starts.push({ x, y });
      if (role === 'goal') goals.push({ x, y });
    }
  }
  if (starts.length !== 1) throw new Error(`[grid-path-puzzle] need exactly one role:"start" cell, found ${starts.length}.`);
  if (goals.length !== 1) throw new Error(`[grid-path-puzzle] need exactly one role:"goal" cell, found ${goals.length}.`);

  const start = input.start ?? starts[0];
  const goal = input.goal ?? goals[0];
  if (nodeTypes[input.grid[start.y]?.[start.x]]?.role !== 'start') {
    throw new Error('[grid-path-puzzle] level.start must point at the start cell.');
  }
  if (nodeTypes[input.grid[goal.y]?.[goal.x]]?.role !== 'goal') {
    throw new Error('[grid-path-puzzle] level.goal must point at the goal cell.');
  }

  const level = {
    cols,
    rows,
    cells: input.grid.map((r) => r.slice()), // defensive copy
    start,
    goal,
    moveBudget: input.moveBudget ?? null,
    timeLimitMs: input.timeLimitMs ?? null,
  };

  if (!findAnyPath(level, nodeTypes, level.moveBudget)) {
    throw new Error('[grid-path-puzzle] authored level is unsolvable: no path from start to goal within the move budget.');
  }
  return level;
}
