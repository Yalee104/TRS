// =============================================================================
//  core/state.js  —  the data model (pure data + small helpers)
// =============================================================================
//
//  Two kinds of state, kept deliberately separate from rendering:
//
//   - RunState : the HOST-SHAPED accumulator that node effects mutate as the
//                path passes through cells (e.g. { multiplier, skills[], fail }).
//                The module never inspects its fields — it just carries it and
//                hands it to onPass() / onComplete(). The host decides meaning.
//
//   - GameState: the MODULE-OWNED runtime state for one puzzle instance
//                (the current level, the drawn path, timer fields, status).
// =============================================================================

/** A safe deep-ish clone for the run-state (used for live preview). */
export function cloneRunState(state) {
  // structuredClone is available in modern browsers and Node 17+. It correctly
  // copies nested arrays/objects so a "preview" can't mutate the committed one.
  return structuredClone(state);
}

/** Build the initial run-state from the host's seed (or a sensible default). */
export function createRunState(initial) {
  return cloneRunState(initial ?? { multiplier: 1, skills: [], fail: false });
}

/**
 * The per-instance game state. `status` walks:
 *   'idle' -> 'drawing' -> 'done' | 'failed'
 */
export function createGameState(level, baseRunState) {
  return {
    level,
    path: [],                 // ordered [{x,y}], path[0] = start once drawing begins
    status: 'idle',
    pendingFail: false,       // set when a drag enters a fail-on-pass trap
    baseRunState,             // the seed; runEffects clones from this
    // timer fields (filled in by the facade's timer):
    startedAt: null,          // ms timestamp when the timer started
    elapsedMs: 0,
  };
}

/** A read-only snapshot for game.getState() — no live references leak out. */
export function snapshot(gameState) {
  return {
    status: gameState.status,
    path: gameState.path.map((c) => ({ x: c.x, y: c.y })),
    steps: gameState.path.length,
    elapsedMs: gameState.elapsedMs,
    pendingFail: gameState.pendingFail,
  };
}
