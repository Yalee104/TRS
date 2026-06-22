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

import { clampGridSize, clamp } from '../util/clamp.js';
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
// Extended (backward-compatible) for the route-first generator:
//   - `forbidden` : a Set of "x,y" keys the walk may NOT enter (used to force a
//                   second route through different cells).
//   - `targetLen` : a preferred minimum length; while under it the walk meanders
//                   (and avoids stepping onto the goal early) so the route is long.
function carveSpine({ cols, rows, start, goal, rng, difficulty, maxLen, forbidden = null, targetLen = null }) {
  const isForbidden = (n) => (forbidden ? forbidden.has(cellKey(n.x, n.y)) : false);
  let best = null; // longest reaching path seen (fallback when no attempt hits targetLen)
  for (let attempt = 0; attempt < 12; attempt++) {
    const path = [start];
    const visited = new Set([cellKey(start.x, start.y)]);
    let current = start;
    let reached = false;
    while (true) {
      if (sameCell(current, goal)) { reached = true; break; }
      if (path.length >= maxLen) break;            // got too long -> abandon attempt
      let cands = neighbors4(current.x, current.y).filter(
        (n) => within(n.x, n.y, cols, rows) && !visited.has(cellKey(n.x, n.y)) && !isForbidden(n),
      );
      if (cands.length === 0) break;               // dead end -> abandon attempt
      const wantLonger = targetLen != null && path.length < targetLen;
      // While still building length, don't step onto the goal yet (unless forced).
      if (wantLonger) {
        const nonGoal = cands.filter((c) => !sameCell(c, goal));
        if (nonGoal.length) cands = nonGoal;
      }
      // Lower difficulty => greedy/straight; higher => meander. (While under the
      // target we already steer away from the goal above; the meander rate itself
      // is the mode's `difficulty`, so 'short' can stay genuinely greedy.)
      const eff = difficulty;
      let choice;
      if (rng() > eff) {
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
    if (reached && path.length <= maxLen) {
      if (targetLen == null || path.length >= targetLen) return path; // meets the length target
      if (!best || path.length > best.length) best = path;            // keep the longest near-miss
    }
  }
  // Fallback: the longest reaching path we found (closest to the target); the
  // L-path if we never reached; for a forbidden walk, a distinct shortest route.
  if (!forbidden) return best || lPath(start, goal);
  return bfsGridPath(cols, rows, start, goal, forbidden) || lPath(start, goal);
}

// Pure-grid shortest path (ignores node types) avoiding a `forbidden` set.
function bfsGridPath(cols, rows, start, goal, forbidden) {
  const goalK = cellKey(goal.x, goal.y);
  const queue = [[start]];
  const seen = new Set([cellKey(start.x, start.y)]);
  while (queue.length) {
    const path = queue.shift();
    const head = path[path.length - 1];
    if (sameCell(head, goal)) return path;
    for (const n of neighbors4(head.x, head.y)) {
      if (!within(n.x, n.y, cols, rows)) continue;
      const k = cellKey(n.x, n.y);
      if (seen.has(k)) continue;
      if (forbidden && forbidden.has(k) && k !== goalK) continue;
      seen.add(k);
      queue.push([...path, n]);
    }
  }
  return null;
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
  // The route-first "designer" generator opts in via a routePlan (see below).
  if (opts.routePlan) return generateRouteFirst(opts);

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

// =============================================================================
//  ROUTE-FIRST "DESIGNER" GENERATOR
// =============================================================================
//
//  The simple generator above carves one spine and sprinkles random decoration —
//  fine, but it offers no real *choice*. This one DESIGNS a board:
//    1. an intended high-reward PRIMARY route, with valuable nodes placed along
//       it in a chosen order (clustered runs, amplifiers reserved near the goal);
//    2. a shorter, SAFE alternate route that carries no rewards (the low-risk,
//       low-reward option);
//    3. hazards painted only OFF both routes, biased to "channel" the player into
//       a genuine risk/reward decision.
//
//  It stays GENERIC: it only understands a placement vocabulary (the `routePlan`),
//  never combo semantics. The host derives the routePlan from its own config, so
//  the same generator serves offense, defense, or any future game.
// =============================================================================

const ROUTE_ATTEMPTS = 40;

export function generateRouteFirst(opts = {}) {
  const { nodeTypes, seed } = opts;
  if (!nodeTypes) throw new Error('[grid-path-puzzle] generateRouteFirst() requires a nodeTypes catalog.');
  const cols = clampGridSize(opts.cols ?? opts.size ?? 8, 'generate.cols');
  const rows = clampGridSize(opts.rows ?? opts.size ?? 8, 'generate.rows');
  const cats = categorize(nodeTypes);
  const baseSeed = seed == null ? makeRng().seed : (seed >>> 0);

  let plan = normalizePlan(opts.routePlan || {});
  for (let attempt = 0; attempt < ROUTE_ATTEMPTS; attempt++) {
    const rng = makeRng((baseSeed ^ Math.imul(attempt, 0x9e3779b1)) >>> 0);
    const level = tryBuildRouteLevel({ cols, rows, nodeTypes, cats, plan, rng, opts });
    if (level) { level.seed = baseSeed; return level; }
    plan = relaxPlan(plan, attempt);
  }
  // Terminal fallback: never fail to return a solvable board.
  // eslint-disable-next-line no-console
  console.warn(`[grid-path-puzzle] route-first constraints unsatisfiable at ${cols}x${rows} (seed ${baseSeed}); fell back to single-route generation.`);
  return generate({ ...opts, routePlan: undefined, seed: baseSeed });
}

function normalizePlan(rp) {
  return {
    place: (rp.place || []).map((p) => ({ ...p })),
    alternateRoutes: rp.alternateRoutes ?? 1,
    primaryLengthTarget: rp.primaryLengthTarget ?? 'long',
    safeLengthMode: rp.safeLengthMode ?? 'shortest',
    trapDensity: clamp(rp.trapDensity ?? 0.15, 0, 0.6),
    blockerDensity: clamp(rp.blockerDensity ?? 0.18, 0, 0.6),
    burningType: rp.burningType ?? null,
    burningDensity: clamp(rp.burningDensity ?? 0, 0, 1),
    channeling: rp.channeling ?? 'soft',
    lateGap: { min: rp.lateGap?.min ?? 1, max: rp.lateGap?.max ?? 2 },
    endpointMode: rp.endpointMode ?? 'edgeRandom',
    moveBudget: rp.moveBudget ?? null,
  };
}

function tryBuildRouteLevel({ cols, rows, nodeTypes, cats, plan, rng, opts }) {
  const { startKey, goalKey, fillKey } = cats;

  // 1) varied endpoints
  const { start, goal } = pickEndpoints(cols, rows, plan.endpointMode, rng);

  // 2) the long primary route (the intended high-combo path)
  const { targetLen, difficulty } = primarySpineParams(plan.primaryLengthTarget, start, goal, cols, rows);
  const primary = carveSpine({ cols, rows, start, goal, rng, difficulty, maxLen: cols * rows, targetLen });
  if (primary.length < 3) return null;
  const onPrimary = new Set(primary.map((c) => cellKey(c.x, c.y)));

  // 3) plan where the valuable nodes go along the primary interior.
  //    resolvePlace turns generic `{oneOf}`/`{min,max}` constraints into concrete
  //    types/counts (seeded) so each board features DIFFERENT skills.
  const interior = primary.slice(1, -1);
  const resolvedPlace = resolvePlace(plan.place, rng);
  const slots = planRouteSlots(interior, resolvedPlace, plan.lateGap, rng);
  if (!slots.ok) return null;

  // 4) a shorter, safe alternate route through DIFFERENT cells
  let safe = null;
  if (plan.alternateRoutes >= 1) {
    const forbidden = new Set([...onPrimary]);
    forbidden.delete(cellKey(start.x, start.y));
    forbidden.delete(cellKey(goal.x, goal.y));
    safe = bfsGridPath(cols, rows, start, goal, forbidden);
    if (!safe || safe.length >= primary.length) return null; // must exist and be shorter
  }
  const onSafe = new Set((safe || []).map((c) => cellKey(c.x, c.y)));

  // 5) budget must at least admit the primary
  let moveBudget = plan.moveBudget ?? opts.moveBudget ?? null;
  if (moveBudget == null || moveBudget < primary.length) moveBudget = primary.length;

  // 6) paint the board
  const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => fillKey));
  cells[start.y][start.x] = startKey;
  cells[goal.y][goal.x] = goalKey;
  for (const [k, type] of slots.assignments) {
    const [x, y] = k.split(',').map(Number);
    cells[y][x] = type;
  }
  // eligible = cells on neither route, not start/goal
  const eligible = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const k = cellKey(x, y);
      if (onPrimary.has(k) || onSafe.has(k)) continue;
      eligible.push({ x, y });
    }
  }
  shuffle(eligible, rng);
  // place off-route bait valuables, then hazards on what remains
  const used = new Set();
  for (const p of slots.offRoute) {
    const n = p.count?.exact ?? p.count?.min ?? 1;
    for (let i = 0; i < n; i++) {
      const cell = eligible.find((c) => !used.has(cellKey(c.x, c.y)));
      if (!cell) break;
      cells[cell.y][cell.x] = p.type;
      used.add(cellKey(cell.x, cell.y));
    }
  }
  const remaining = eligible.filter((c) => !used.has(cellKey(c.x, c.y)));
  paintHazards(cells, remaining, plan, nodeTypes, rng, onPrimary);

  // 7) validate everything
  const level = {
    cols, rows, cells, start, goal, moveBudget, timeLimitMs: opts.timeLimitMs ?? null,
    // metadata (ignored by loader/renderer) — the intended routes, handy for tests/debug:
    primaryRoute: primary, safeRoute: safe,
  };
  if (!findAnyPath(level, nodeTypes, moveBudget)) return null;
  if (safe && !secondRouteExists(level, nodeTypes, onSafe, moveBudget)) return null;
  return level;
}

// Resolve generic placement constraints into concrete ones (SEEDED, so it's
// reproducible but VARIED across seeds):
//   - `type: { oneOf:[...], distinctGroup? }` -> pick one; entries sharing a
//     distinctGroup pick DIFFERENT types (so a board features a different skill
//     each time, and other skills still appear).
//   - `count: { min, max }` -> pick a count in that range.
function resolvePlace(place, rng) {
  const usedByGroup = {};
  return place.map((p) => {
    // Optional probabilistic inclusion: `chance` in [0,1). Rolled with the seeded
    // rng so it's reproducible. Entries without `chance` never consume rng here.
    if (p.chance != null && rng() >= p.chance) return null;
    let type = p.type;
    if (type && typeof type === 'object' && Array.isArray(type.oneOf)) {
      let pool = type.oneOf.slice();
      const g = type.distinctGroup;
      if (g) {
        const used = usedByGroup[g] || (usedByGroup[g] = new Set());
        const fresh = pool.filter((t) => !used.has(t));
        if (fresh.length) pool = fresh;
      }
      type = pool[Math.floor(rng() * pool.length)];
      if (g) usedByGroup[g].add(type);
    }
    let count = p.count;
    if (count && count.min != null && count.max != null) count = { exact: randInt(rng, count.min, count.max) };
    return { ...p, type, count };
  }).filter(Boolean);
}

// Assign valuable node types to primary-route interior cells per the (resolved)
// constraints. The clustered run is placed at a RANDOM offset (not always near
// start), and non-clustered nodes are shuffled + spread for variety.
function planRouteSlots(interior, place, lateGap, rng) {
  const countOf = (p) => p.count?.exact ?? p.count?.min ?? 1;
  const routeNodes = place.filter((p) => p.placement === 'onPrimaryRoute').sort((a, b) => a.order - b.order);
  const lateNodes = place.filter((p) => p.placement === 'lateOnRoute').sort((a, b) => a.order - b.order);
  const offRoute = place.filter((p) => p.placement === 'offRoute' || p.placement === 'anywhere');

  const routeTotal = routeNodes.reduce((s, p) => s + countOf(p), 0);
  const lateTotal = lateNodes.reduce((s, p) => s + countOf(p), 0);
  const gap = lateTotal > 0 ? randInt(rng, lateGap.min, lateGap.max) : 0;
  if (routeTotal + lateTotal + gap > interior.length) return { ok: false };

  const assignments = new Map();
  // reserve the tail (nearest goal) for amplifiers, in order
  let li = interior.length - lateTotal;
  for (const p of lateNodes) {
    for (let i = 0; i < countOf(p); i++) {
      const c = interior[li++];
      assignments.set(cellKey(c.x, c.y), p.type);
    }
  }
  const leadEnd = interior.length - lateTotal - gap; // payloads must finish before this

  const clustered = routeNodes.filter((p) => p.cluster);
  const nonClustered = shuffleCopy(routeNodes.filter((p) => !p.cluster), rng);
  const clusteredTotal = clustered.reduce((s, p) => s + countOf(p), 0);
  const nonClusteredTotal = nonClustered.reduce((s, p) => s + countOf(p), 0);
  const leadNeed = clusteredTotal + nonClusteredTotal;
  const slack = Math.max(0, leadEnd - leadNeed);

  // clustered run starts at a random offset within the slack (position variety)
  let cursor = clusteredTotal > 0 ? randInt(rng, 0, slack) : 0;
  for (const p of clustered) {
    for (let i = 0; i < countOf(p); i++) {
      const c = interior[cursor++];
      assignments.set(cellKey(c.x, c.y), p.type);
    }
  }
  // Non-clustered payloads spread out across the remaining lead span — one cell
  // per UNIT (honoring each entry's count), not one cell per entry.
  if (nonClusteredTotal > 0) {
    const span = Math.max(1, Math.floor((leadEnd - cursor) / nonClusteredTotal));
    let pos = cursor;
    for (const p of nonClustered) {
      for (let i = 0; i < countOf(p); i++) {
        const c = interior[Math.min(pos, leadEnd - 1)];
        assignments.set(cellKey(c.x, c.y), p.type);
        pos += span;
      }
    }
  }
  return { ok: true, assignments, offRoute };
}

function shuffleCopy(arr, rng) {
  const a = arr.slice();
  shuffle(a, rng);
  return a;
}

// Paint blockers/traps onto off-route cells, biased next to the primary route
// ("channeling") so detours feel risky. Never touches a route cell.
function paintHazards(cells, eligible, plan, nodeTypes, rng, onPrimary) {
  const blockerKey = Object.entries(nodeTypes).find(([, d]) => d.passable === false)?.[0];
  // Optional second hazard ("burning") named by the plan; the generic trap is the
  // first OTHER failsOnPass type, so the two never collide.
  const burnKey = plan.burningDensity > 0 && plan.burningType && nodeTypes[plan.burningType] ? plan.burningType : null;
  const trapKey = Object.entries(nodeTypes).find(([k, d]) => d.failsOnPass && k !== burnKey)?.[0];
  const adjacentToPrimary = (x, y) => neighbors4(x, y).some((n) => onPrimary.has(cellKey(n.x, n.y)));
  for (const c of eligible) {
    const boost = plan.channeling === 'strong' && adjacentToPrimary(c.x, c.y) ? 1.6 : 1;
    const r = rng();
    // Cumulative density bands over one roll: blocker, then trap, then burning.
    const blockerBand = plan.blockerDensity * boost;
    const trapBand = blockerBand + plan.trapDensity * boost;
    const burnBand = trapBand + (plan.burningDensity || 0) * boost;
    if (blockerKey && r < blockerBand) cells[c.y][c.x] = blockerKey;
    else if (trapKey && r < trapBand) cells[c.y][c.x] = trapKey;
    else if (burnKey && r < burnBand) cells[c.y][c.x] = burnKey;
    // else: stays filler
  }
}

// True if a start->goal route exists that AVOIDS the safe route's interior — i.e.
// a genuinely distinct second route (the primary) is reachable.
function secondRouteExists(level, nodeTypes, onSafe, budget) {
  const { cols, rows, start, goal } = level;
  const startK = cellKey(start.x, start.y);
  const goalK = cellKey(goal.x, goal.y);
  const forbidden = new Set([...onSafe].filter((k) => k !== startK && k !== goalK));
  const queue = [[start]];
  const seen = new Set([startK]);
  while (queue.length) {
    const path = queue.shift();
    const head = path[path.length - 1];
    if (sameCell(head, goal)) return true;
    if (budget != null && path.length >= budget) continue;
    for (const n of neighbors4(head.x, head.y)) {
      if (!within(n.x, n.y, cols, rows)) continue;
      const k = cellKey(n.x, n.y);
      if (seen.has(k) || forbidden.has(k)) continue;
      if (!isSolvable(nodeTypes[level.cells[n.y][n.x]])) continue;
      seen.add(k);
      queue.push([...path, n]);
    }
  }
  return false;
}

// Deterministic relaxation ladder — loosen one thing at a time, then retry.
function relaxPlan(plan, attempt) {
  const p = normalizePlan(plan);
  const step = Math.floor(attempt / 5);
  if (step >= 1) p.primaryLengthTarget = p.primaryLengthTarget === 'long' ? 'medium' : 'shortest';
  if (step >= 2) { p.blockerDensity *= 0.5; p.trapDensity *= 0.5; p.burningDensity *= 0.5; }
  if (step >= 3) p.place = p.place.map((x) => (x.cluster ? { ...x, cluster: false } : x));
  if (step >= 4) p.place = p.place.filter((x) => x.placement !== 'offRoute' && x.placement !== 'anywhere');
  if (step >= 5) p.alternateRoutes = 0;
  if (step >= 6) p.channeling = 'soft';
  return p;
}

// ---- small helpers ----------------------------------------------------------
function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
// Targets for the primary spine: a preferred length AND a meander `difficulty`
// (higher => wanderier => longer). Driving BOTH off the mode is what makes the
// long/medium/short choice actually visible — with a fixed difficulty the walk
// meanders the same regardless of the length target.
function primarySpineParams(mode, start, goal, cols, rows) {
  const min = manhattan(start, goal) + 1;
  if (typeof mode === 'number') return { targetLen: clamp(mode, min, cols * rows), difficulty: 0.85 };
  if (mode === 'long')   return { targetLen: Math.min(Math.round(min * 1.7), Math.floor(cols * rows * 0.6)),  difficulty: 0.92 };
  if (mode === 'medium') return { targetLen: Math.min(Math.round(min * 1.3), Math.floor(cols * rows * 0.45)), difficulty: 0.5 };
  return { targetLen: min, difficulty: 0.12 }; // 'short' => hug the shortest path
}
function pickEndpoints(cols, rows, mode, rng) {
  const minSep = Math.ceil((cols + rows) / 2);
  const corners = [{ x: 0, y: 0 }, { x: cols - 1, y: 0 }, { x: 0, y: rows - 1 }, { x: cols - 1, y: rows - 1 }];
  const edges = [];
  for (let x = 0; x < cols; x++) { edges.push({ x, y: 0 }); edges.push({ x, y: rows - 1 }); }
  for (let y = 1; y < rows - 1; y++) { edges.push({ x: 0, y }); edges.push({ x: cols - 1, y }); }
  const all = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) all.push({ x, y });
  const pool = mode === 'cornerRandom' ? corners : mode === 'anyRandom' ? all : edges;
  for (let t = 0; t < 40; t++) {
    const a = pool[Math.floor(rng() * pool.length)];
    const b = pool[Math.floor(rng() * pool.length)];
    if (manhattan(a, b) >= minSep) return { start: a, goal: b };
  }
  return { start: { x: 0, y: 0 }, goal: { x: cols - 1, y: rows - 1 } };
}
