// systems/playerFire.js — the player's constant auto-fire upward.
// Fire rate = baseFireRate × fireRateMult (Overclock raises the mult).
// A 'weaponJam' debuff (inflicted by the boss) suppresses firing until cleansed.

import { spawnBullet, hasStatus } from '../core/state.js';

export function stepPlayerFire(state, dt) {
  const p = state.player;
  p.fireCooldown -= dt;
  const jammed = hasStatus(p, 'weaponJam');
  const rate = p.baseFireRate * p.fireRateMult; // shots/sec
  if (p.input.firing && !jammed && rate > 0 && p.fireCooldown <= 0) {
    spawnBullet(state, {
      owner: 'player', srcId: 'player',
      pos: { x: p.pos.x, y: p.pos.y - p.radius },
      vel: { x: 0, y: -p.bulletSpeed },
      dmg: p.bulletDmg, radius: p.bulletRadius, color: p.color,
    });
    p.fireCooldown += 1000 / rate;
  }
}
