// render/shapes.js — primitive drawing (sprite-ready seam).
// Everything is drawn from plain state; swapping these for ctx.drawImage() later
// touches only this file. The renderer never mutates state.

export function drawBackground(ctx, state) {
  const { w, h } = state.canvas;
  ctx.fillStyle = '#0a0c12';
  ctx.fillRect(0, 0, w, h);
  // cheap scrolling starfield (deterministic from time)
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 60; i++) {
    const x = (i * 97) % w;
    const y = (i * 53 + state.time * 0.03) % h;
    ctx.fillRect(x, y, 2, 2);
  }
}

export function drawPlayer(ctx, p) {
  // shield ring
  if (p.shield.amount > 0) {
    ctx.strokeStyle = 'rgba(120,170,255,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.pos.x, p.pos.y, p.radius + 8, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = p.color;
  ctx.beginPath();
  ctx.moveTo(p.pos.x, p.pos.y - p.radius);
  ctx.lineTo(p.pos.x - p.radius, p.pos.y + p.radius);
  ctx.lineTo(p.pos.x + p.radius, p.pos.y + p.radius);
  ctx.closePath();
  ctx.fill();
  drawStatusAura(ctx, p);
}

export function drawEnemy(ctx, e) {
  ctx.fillStyle = e.color || '#ff6680';
  if (e.kind === 'boss') {
    polygon(ctx, e.pos.x, e.pos.y, e.radius, 6);
  } else {
    ctx.beginPath();
    ctx.moveTo(e.pos.x, e.pos.y + e.radius);
    ctx.lineTo(e.pos.x - e.radius, e.pos.y - e.radius);
    ctx.lineTo(e.pos.x + e.radius, e.pos.y - e.radius);
    ctx.closePath();
    ctx.fill();
  }
  if (e.patternState && e.patternState.telegraphing) {
    ctx.strokeStyle = 'rgba(255,80,80,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.pos.x, e.pos.y, e.radius + 6, 0, Math.PI * 2); ctx.stroke();
  }
  drawStatusAura(ctx, e);
}

function drawStatusAura(ctx, ent) {
  const colors = { freeze: '#7fdfff', confuse: '#c58cff', weaponJam: '#ff8a3d', slow: '#ffd24a' };
  let ring = 0;
  for (const s of ent.statuses) {
    const c = colors[s.type];
    if (!c) continue;
    ctx.strokeStyle = c;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ent.pos.x, ent.pos.y, ent.radius + 4 + ring, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ring += 5;
  }
}

export function drawBullet(ctx, b) {
  ctx.fillStyle = b.color || '#ff5566';
  ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, b.radius || 4, 0, Math.PI * 2); ctx.fill();
}

export function drawFx(ctx, f) {
  const a = Math.max(0, f.remainingMs / 400);
  if (f.kind === 'flash') {
    ctx.globalAlpha = a; ctx.fillStyle = f.color || '#fff';
    ctx.beginPath(); ctx.arc(f.pos.x, f.pos.y, 22 * (1 - a) + 8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (f.kind === 'death') {
    ctx.globalAlpha = a; ctx.fillStyle = '#ffd06a';
    ctx.beginPath(); ctx.arc(f.pos.x, f.pos.y, (f.big ? 60 : 26) * (1 - a) + 6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (f.kind === 'beam') {
    ctx.globalAlpha = a * 0.8; ctx.fillStyle = '#ff8af0';
    ctx.fillRect(f.pos.x - 30, 0, 60, 9999);
    ctx.globalAlpha = 1;
  }
}

function polygon(ctx, cx, cy, r, sides) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}
