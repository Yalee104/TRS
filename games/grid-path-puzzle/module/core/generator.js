// =============================================================================
//  core/generator.js  —  procedural level generation (PURE JS, ZERO DEPS)
// =============================================================================
//
//  IMPORTANT: there is NO AI and NO external library here, and this is NOT Yuka.
//  (Yuka, in the fighting game, drives an agent's behavior every frame at
//  runtime. This is a ONE-TIME layout computation.) It's classic procedural
//  content generation built from three textbook pieces:
//
//    1. mulberry32  — a tiny seeded pseudo-random number generator, so the same
//                     seed always rebuilds the same level (reproducible/shareable).
//    2. self-avoiding walk — carve a guaranteed START->GOAL "spine" (the answer),
//                     with an L-shaped fallback that is ALWAYS valid on an open grid.
//    3. BFS (findAnyPath) — a breadth-first search used to ASSERT solvability.
//
//  The trick to "always solvable": we carve the solution FIRST, only ever put
//  safe (passable, non-trap) nodes on that spine, then decorate everything else.
//
//  A fancier alternative (Wave Function Collapse) is intentionally out of scope.
// =============================================================================

import { clampGridSize } from '../util/clamp.js';
import { neighbors4, manhattan, sameCell, cellKey, isSolvable } from './gridModel.js';

// ---- 1. Seeded RNG ----------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const s = seed == null ? (Math.floor(Math.random() * 0xffffffff) >>> 0) : (seed >>> 0);
  const fn = mulberry32(s);
  fn.seed = s; // remember it so the level can be reproduced
  return fn;
}

function within(x, y, cols, rows) {
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

// ---- weighted random pick over a list of node-type keys ---------------------
function weightedPick(rng, keys, weights) {
  if (keys.length === 0) return null;
  const ws = keys.map((k) => Math.max(0, weights[k] ?? 1));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return keys[Math.floor(rng() * keys.length)];
  let r = rng() * total;
  for (let i = 0; i < keys.length; i++) {
    r -= ws[i];
    if (r <= 0) return keys[i];
  }
  return keys[keys.length - 1];
}

// ---- categorize the host's node-type catalog into roles --------------------
function categorize(nodeTypes) {
  const entries = Object.entries(nodeTypes);
  const startKey = entries.find(([, d]) => d.role === 'start')?.[0];
  const goalKey = entries.find(([, d]) => d.role === 'goal')?.[0];
  if (!startKey || !goalKey) {
    throw new Error('[grid-path-puzzle] generator needs exactly one node type with role:"start" and one with role:"goal".');
  }
  // Filler/spine-safe = passable, non-trap, role:'normal'. Prefer a plain one
  // (no onPass) as the background fill.
  const normals = entries.filter(([, d]) => d.role === 'normal' && d.passable !== false && !d.failsOnPass);
  const fillKey = (normals.find(([, d]) => typeof d.onPass !== 'function') ?? normals[0])?.[0];
  if (!fillKey) {
    throw new Error('[grid-path-puzzle] generator needs at least one passable, non-trap role:"normal" node type to use as filler/spine.');
  }
  return {
    startKey,
    goalKey,
    fillKey,
    spineDecorKeys: normals.map(([k]) => k),                              // safe on the spine
    offSpineKeys: entries.filter(([k]) => k !== startKey && k !== goalKey).map(([k]) => k), // anything
  };
}

// ---- 2a. an L-shaped path: always valid on an open grid --------------------
function lPath(start, goal) {
  const path = [{ x: start.x, y: start.y }];
  let { x, y } = start;
  const sx = Math.sign(goal.x - x);
  const sy = Math.sign(goal.y - y);
  while (x !== goal.x) { x += sx; path.push({ x, y }); }
  while (y !== goal.y) { y += sy; path.push({ x, y }); }
  return path; // length = manhattan(start,goal) + 1
}

// ---- 2b. self-avoiding walk biased toward the goal -------------------------
function carveSpine({ cols, rows, start, goal, rng, difficulty, maxLen }) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const path = [start];
    const visited = new Set([cellKey(start.x, start.y)]);
    let current = start;
    let reached = false;
    while (true) {
      if (sameCell(current, goal)) { reached = true; break; }
      if (path.length >= maxLen) break;            // got too long -> abandon attempt
      const cands = neighbors4(current.x, current.y).filter(
        (n) => within(n.x, n.y, cols, rows) && !visited.has(cellKey(n.x, n.y)),
      );
      if (cands.length === 0) break;               // dead end -> abandon attempt
      // Lower difficulty => more greedy (straighter, shorter). Higher difficulty
      // => more random (meandering, tighter on budget). THAT is the difficulty knob.
      let choice;
      if (rng() > difficulty) {
        let best = Infinity;
        let bestCands = [];
        for (const c of cands) {
          const d = manhattan(c, goal);
          if (d < best) { best = d; bestCands = [c]; }
          else if (d === best) bestCands.push(c);
        }
        choice = bestCands[Math.floor(rng() * bestCands.length)];
      } else {
        choice = cands[Math.floor(rng() * cands.length)];
      }
      path.push(choice);
      visited.add(cellKey(choice.x, choice.y));
      current = choice;
    }
    if (reached && path.length <= maxLen) return path;
  }
  return lPath(start, goal); // guaranteed-valid fallback
}

// ---- 3. BFS solvability check (shared by loader + tests) -------------------
/**
 * Find ANY valid path from start to goal (orthogonal, only through cells that
 * are passable && !failsOnPass), optionally capped at `budget` cells.
 * Returns the path array, or null if none exists. BFS => shortest, so if a path
 * within budget exists this finds it.
 */
export function findAnyPath(level, nodeTypes, budget = null) {
  const { cols, rows, start, goal } = level;
  const queue = [[start]];
  const seen = new Set([cellKey(start.x, start.y)]);
  while (queue.length) {
    const path = queue.shift();
    const head = path[path.length - 1];
    if (sameCell(head, goal)) return path;
    if (budget != null && path.length >= budget) continue;
    for (const n of neighbors4(head.x, head.y)) {
      if (!within(n.x, n.y, cols, rows)) continue;
      const key = cellKey(n.x, n.y);
      if (seen.has(key)) continue;
      if (!isSolvable(nodeTypes[level.cells[n.y][n.x]])) continue;
      seen.add(key);
      queue.push([...path, n]);
    }
  }
  return null;
}

// ---- the public entry point -------------------------------------------------
/**
 * generate({ size|cols|rows, nodeTypes, weights, difficulty, moveBudget, timeLimitMs, seed })
 * -> a normalized `level` object (same shape as an authored level), guaranteed
 *    solvable within its own moveBudget.
 */
export function generate(opts = {}) {
  const { nodeTypes, weights = {}, difficulty = 0.5, seed } = opts;
  if (!nodeTypes) throw new Error('[grid-path-puzzle] generate() requires a nodeTypes catalog.');

  const cols = clampGridSize(opts.cols ?? opts.size ?? 8, 'generate.cols');
  const rows = clampGridSize(opts.rows ?? opts.size ?? 8, 'generate.rows');
  const rng = makeRng(seed);
  const { startKey, goalKey, fillKey, spineDecorKeys, offSpineKeys } = categorize(nodeTypes);

  const start = { x: 0, y: 0 };
  const goal = { x: cols - 1, y: rows - 1 };

  // A budget must at least allow the shortest path. If the caller asked for less,
  // bump it (and warn) so the generated level stays self-consistent/solvable.
  const minBudget = manhattan(start, goal) + 1;
  let moveBudget = opts.moveBudget ?? null;
  if (moveBudget != null && moveBudget < minBudget) {
    // eslint-disable-next-line no-console
    console.warn(`[grid-path-puzzle] moveBudget ${moveBudget} < shortest path ${minBudget}; raised to ${minBudget}.`);
    moveBudget = minBudget;
  }

  const spine = carveSpine({
    cols, rows, start, goal, rng, difficulty,
    maxLen: moveBudget ?? cols * rows,
  });
  const onSpine = new Set(spine.map((c) => cellKey(c.x, c.y)));

  // Fill the board, place start/goal, decorate spine (safe types only), then
  // decorate everything off-spine (may include blockers/traps).
  const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => fillKey));
  cells[start.y][start.x] = startKey;
  cells[goal.y][goal.x] = goalKey;

  for (const c of spine) {
    if (sameCell(c, start) || sameCell(c, goal)) continue;
    cells[c.y][c.x] = weightedPick(rng, spineDecorKeys, weights) ?? fillKey;
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (onSpine.has(cellKey(x, y))) continue;
      cells[y][x] = weightedPick(rng, offSpineKeys, weights) ?? fillKey;
    }
  }

  const level = { cols, rows, cells, start, goal, moveBudget, timeLimitMs: opts.timeLimitMs ?? null, seed: rng.seed };

  // Defense-in-depth: the spine guarantees solvability, but assert it. If some
  // logic bug ever broke it, clear the spine back to filler and re-check.
  if (!findAnyPath(level, nodeTypes, moveBudget)) {
    for (const c of spine) {
      if (!sameCell(c, start) && !sameCell(c, goal)) cells[c.y][c.x] = fillKey;
    }
    if (!findAnyPath(level, nodeTypes, moveBudget)) {
      throw new Error('[grid-path-puzzle] internal generator error: produced an unsolvable level.');
    }
  }
  return level;
}
