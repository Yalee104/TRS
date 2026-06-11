// =============================================================================
//  core/loop.js  —  fixed-timestep game loop with slow-motion (timeScale)
// =============================================================================
//
//  The sim always advances in FIXED steps of `1000/normalFps` ms, so physics is
//  deterministic. `state.timeScale` scales how much sim-time each real
//  millisecond contributes:
//     1.0           → normal speed
//     slowFps/fps   → slow motion (battle crawls while a puzzle is open)
//     0             → hard pause
//  Rendering happens every animation frame regardless. Cooldowns tick at REAL
//  (wall-clock) time so they feel consistent even during slow motion.
// =============================================================================

export function createLoop({ getState, stepSim, render }) {
  let raf = null;
  let last = 0;
  let acc = 0;
  let running = false;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const state = getState();
    let wall = now - last;
    last = now;
    if (wall > 250) wall = 250; // clamp tab-switch spikes (spiral-of-death guard)

    // cooldowns count down in real time, independent of slow-mo
    for (const k of ['offensive', 'defensive']) {
      if (state.cooldowns[k] > 0) state.cooldowns[k] = Math.max(0, state.cooldowns[k] - wall);
    }

    const STEP = 1000 / state.config.normalFps;
    acc += wall * state.timeScale;
    let guard = 0;
    while (acc >= STEP && guard++ < 8) {
      stepSim(state, STEP);
      acc -= STEP;
    }
    if (acc > STEP) acc = 0; // if we hit the guard, drop the backlog

    render(state);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    },
  };
}
