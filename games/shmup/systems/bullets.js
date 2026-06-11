// systems/bullets.js — integrate bullet positions and cull off-screen ones.
export function stepBullets(state, dt) {
  const m = 28;
  const { w, h } = state.canvas;
  state.bullets = state.bullets.filter((b) => {
    b.pos.x += b.vel.x * (dt / 1000);
    b.pos.y += b.vel.y * (dt / 1000);
    return b.pos.x > -m && b.pos.x < w + m && b.pos.y > -m && b.pos.y < h + m;
  });
}
