// =============================================================================
//  core/pathRules.js  —  the path-validity rules, as PURE predicates
// =============================================================================
//
//  This file is the SINGLE SOURCE OF TRUTH for "is this move legal". Both the
//  pointer (mouse/touch) controller and the keyboard controller call these, so
//  the two input methods can never drift apart. Pure functions = trivially
//  unit-testable with no browser.
//
//  A `path` is an ordered array of {x, y} cells: path[0] is START, the last
//  element is the HEAD (the current pen tip).
// =============================================================================

import { manhattan, sameCell, nodeDefAt, neighbors4, inBounds } from './gridModel.js';

/** Orthogonally adjacent (no diagonals): exactly one step away. */
export function isAdjacent(a, b) {
  return manhattan(a, b) === 1;
}

/** Is this cell already part of the path? (no-revisit rule) */
export function isVisited(path, cell) {
  return path.some((p) => sameCell(p, cell));
}

/** Can the path be extended INTO `cell` from its current head? */
export function canExtend(path, cell, level, nodeTypes) {
  if (path.length === 0) return false;
  const head = path[path.length - 1];
  if (!inBounds(level, cell.x, cell.y)) return false;
  if (!isAdjacent(head, cell)) return false;       // orthogonal, one step
  if (isVisited(path, cell)) return false;          // no revisits
  if (nodeDefAt(level, nodeTypes, cell.x, cell.y).passable === false) return false; // not a blocker
  return true;
}

/**
 * If `cell` already lies on the path at some index i that is NOT the head,
 * return i (so the caller can truncate the path to i+1 — i.e. "rub out" the
 * tail by dragging back over it). Otherwise return -1.
 */
export function backtrackIndex(path, cell) {
  for (let i = 0; i < path.length - 1; i++) {
    if (sameCell(path[i], cell)) return i;
  }
  return -1;
}

/** Has the path reached a GOAL-role cell at its head? */
export function reachedGoal(path, level, nodeTypes) {
  if (path.length === 0) return false;
  const head = path[path.length - 1];
  return nodeDefAt(level, nodeTypes, head.x, head.y).role === 'goal';
}

/**
 * The legal orthogonal neighbors the head could extend into right now.
 * Used by "can I still reach the goal?" checks and the keyboard controller.
 */
export function legalNeighbors(path, level, nodeTypes) {
  const head = path[path.length - 1];
  return neighbors4(head.x, head.y).filter((c) => canExtend(path, c, level, nodeTypes));
}
