// =============================================================================
//  core/gridModel.js  —  pure grid math (no DOM, no state)
// =============================================================================
//
//  A "level" (normalized form, produced by levelLoader or generator) looks like:
//    {
//      cols, rows,                 // dimensions
//      cells: [[typeKey, ...], ...],  // cells[y][x] = a node-type key string
//      start: {x, y}, goal: {x, y},
//      moveBudget, timeLimitMs,    // optional constraints (may be null)
//    }
//
//  Coordinates: x = column (0..cols-1), y = row (0..rows-1). cells is row-major
//  so cells[y][x]. These helpers are the SHARED vocabulary that the rules, the
//  generator, and the renderer all speak.
// =============================================================================

export function inBounds(level, x, y) {
  return x >= 0 && y >= 0 && x < level.cols && y < level.rows;
}

/** The node-type KEY at a cell (e.g. 'blue'). */
export function typeKeyAt(level, x, y) {
  return level.cells[y][x];
}

/** The node-type DEFINITION at a cell (from the host's catalog). */
export function nodeDefAt(level, nodeTypes, x, y) {
  return nodeTypes[typeKeyAt(level, x, y)];
}

/** The 4 orthogonal neighbor coords (NOT bounds-checked — caller filters). */
export function neighbors4(x, y) {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}

/** A stable string key for a cell, handy for Set/Map membership. */
export function cellKey(x, y) {
  return `${x},${y}`;
}

export function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Is a passable for *solving* (can a solution path step here)? */
export function isSolvable(nodeDef) {
  // A hard blocker can't be entered; an instant-fail trap CAN be entered but is
  // never part of a valid solution. Penalty traps (passable, no failsOnPass) DO
  // count as valid steps.
  return nodeDef.passable !== false && !nodeDef.failsOnPass;
}
