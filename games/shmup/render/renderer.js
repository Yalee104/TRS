// render/renderer.js — draw the whole scene every animation frame (read-only).
import { drawBackground, drawPlayer, drawEnemy, drawBullet, drawFx } from './shapes.js';

export function createRenderer(ctx) {
  return function draw(state) {
    drawBackground(ctx, state);
    for (const b of state.bullets) drawBullet(ctx, b);
    for (const e of state.enemies) drawEnemy(ctx, e, state.time);
    if (state.phase !== 'lost') drawPlayer(ctx, state.player);
    for (const f of state.fx) drawFx(ctx, f);

    // slow-motion cue while a puzzle is open
    if (state.timeScale < 1 && state.phase === 'puzzle') {
      ctx.fillStyle = 'rgba(10,14,30,0.35)';
      ctx.fillRect(0, 0, state.canvas.w, state.canvas.h);
    }
  };
}
