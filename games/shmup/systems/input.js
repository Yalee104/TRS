// systems/input.js — apply the player's L/R movement intent.
// The actual key/pointer listeners live in main.js and write into
// state.player.input; this system just integrates movement (so it's pure and
// testable). Firing intent is read by playerFire.js.

export function stepInput(state, dt) {
  const p = state.player;
  if (state.config.freezePlayerDuringPuzzle && state.phase === 'puzzle') return;
  const dir = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
  p.pos.x += dir * p.speed * (dt / 1000);
  const margin = p.radius;
  p.pos.x = Math.max(margin, Math.min(state.canvas.w - margin, p.pos.x));
}
