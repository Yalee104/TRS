// =============================================================================
//  core/effects.js  —  apply node effects over a path; assemble the result
// =============================================================================
//
//  The host defines what each node type DOES via `onPass(state, ctx)`. This file
//  runs those callbacks over a path, in order, so outcomes are deterministic
//  (e.g. skills collected in the exact order you walked through them).
//
//  Used in two ways:
//   - PREVIEW: run against a CLONE of the run-state on every path change so the
//     host can render a live HUD without committing anything.
//   - COMMIT:  run on reaching the goal to produce the final result.
// =============================================================================

import { typeKeyAt, nodeDefAt } from './gridModel.js';
import { createRunState } from './state.js';

/**
 * Apply every cell's onPass() to a fresh run-state, in path order.
 * Returns the resulting run-state (a new object; never mutates baseRunState).
 */
export function runEffects(path, level, nodeTypes, baseRunState) {
  const state = createRunState(baseRunState); // clone, so this is side-effect free
  path.forEach((cell, index) => {
    const def = nodeDefAt(level, nodeTypes, cell.x, cell.y);
    if (typeof def.onPass === 'function') {
      def.onPass(state, { cell, index, path, level });
    }
  });
  return state;
}

/** Map the path to a serializable form including the type key per cell. */
export function describePath(path, level) {
  return path.map((c) => ({ x: c.x, y: c.y, typeKey: typeKeyAt(level, c.x, c.y) }));
}

/** Assemble the public Result object emitted by onComplete / onFail. */
export function buildResult({ path, level, nodeTypes, baseRunState, reason, success, elapsedMs }) {
  const runState = runEffects(path, level, nodeTypes, baseRunState);
  return {
    success,
    reason, // 'goal' | 'trap' | 'budget' | 'timeout' | 'aborted'
    path: describePath(path, level),
    steps: path.length,
    runState,
    budget: { used: path.length, max: level.moveBudget ?? null },
    time: { elapsedMs, limitMs: level.timeLimitMs ?? null },
  };
}
