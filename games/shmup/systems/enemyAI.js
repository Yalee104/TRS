// =============================================================================
//  systems/enemyAI.js — enemy movement/fire, incl. the boss pattern dispatcher
// =============================================================================
//
//  Small enemies: one aimed shot on a fixed timer.
//  Boss: cycles a JSON-defined `patterns[]` array — `aimed`, `spread`, `radial`
//  — each with its own rate / bullet speed / count / telegraph. Adding a new
//  pattern type = one `case` here + data in game.json; nothing else changes.
//
//  Status interactions: a FROZEN enemy does nothing; a CONFUSED enemy aims at a
//  random other enemy instead of the player (and at the 'ownDamage' tier its
//  bullets actually damage enemies — see collision.js `friendlyFire`).
// =============================================================================

import { spawnBullet, hasStatus, getStatus } from '../core/state.js';

export function stepEnemyAI(state, dt) {
  for (const e of state.enemies) {
    if (hasStatus(e, 'freeze')) continue;
    if (e.kind === 'small') stepSmall(state, e, dt);
    else stepBoss(state, e, dt);
  }
}

function aimAngle(state, e) {
  let target = state.player.pos;
  if (hasStatus(e, 'confuse')) {
    const others = state.enemies.filter((o) => o.id !== e.id);
    if (others.length) target = others[Math.floor(Math.random() * others.length)].pos;
  }
  return Math.atan2(target.y - e.pos.y, target.x - e.pos.x);
}

function stepSmall(state, e, dt) {
  e.fireTimer -= dt;
  if (e.fireTimer <= 0) {
    e.fireTimer += e.def.fireMs;
    fireAngle(state, e, aimAngle(state, e), e.def.bulletSpeed, e.def.bulletDmg, null);
  }
}

function stepBoss(state, e, dt) {
  const ps = e.patternState;
  const p = e.def.patterns[ps.index];
  ps.phaseTimer += dt;
  // telegraph: flag a wind-up shortly before firing (renderer shows a warning)
  if (p.telegraphMs && !ps.telegraphing && ps.phaseTimer >= p.rateMs - p.telegraphMs) {
    ps.telegraphing = true;
    state.fx.push({ kind: 'telegraph', pos: { x: e.pos.x, y: e.pos.y }, remainingMs: p.telegraphMs });
  }
  if (ps.phaseTimer >= p.rateMs) {
    ps.phaseTimer = 0;
    ps.telegraphing = false;
    emitPattern(state, e, p);
    ps.index = (ps.index + 1) % e.def.patterns.length; // advance the cycle
  }
}

function emitPattern(state, e, p) {
  const { bulletSpeed: speed, bulletDmg: dmg } = p;
  if (p.type === 'aimed') {
    const a = aimAngle(state, e);
    for (let i = 0; i < (p.count || 1); i++) fireAngle(state, e, a, speed, dmg, p);
  } else if (p.type === 'spread') {
    const base = aimAngle(state, e);
    const spread = (p.spreadDeg || 60) * Math.PI / 180;
    const n = p.count || 5;
    for (let i = 0; i < n; i++) {
      const frac = n === 1 ? 0.5 : i / (n - 1);
      fireAngle(state, e, base - spread / 2 + spread * frac, speed, dmg, p);
    }
  } else if (p.type === 'radial') {
    const n = p.count || 16;
    for (let i = 0; i < n; i++) fireAngle(state, e, (i / n) * Math.PI * 2, speed, dmg, p);
  }
}

function fireAngle(state, e, ang, speed, dmg, p) {
  const cd = state.config.bulletDefaults;
  const confuse = getStatus(e, 'confuse');
  spawnBullet(state, {
    owner: 'enemy', srcId: e.id,
    pos: { x: e.pos.x, y: e.pos.y },
    vel: { x: Math.cos(ang) * speed, y: Math.sin(ang) * speed },
    dmg, radius: cd.enemyRadius, color: e.color || cd.enemyColor,
    inflict: p?.inflict || null,
    friendlyFire: !!(confuse && confuse.meta && confuse.meta.ownDamage),
  });
}
