// =============================================================================
//  systems/collision.js — circle-vs-circle hits
// =============================================================================
//  - player bullets (and CONFUSED enemy "friendly fire" bullets) damage enemies
//    (+ bonus damage if the enemy is frozen with the 'shatter' tier);
//  - enemy bullets damage the player, but the player's SHIELD absorbs first
//    ('reflect' tier bounces a bullet back), and bosses can INFLICT a debuff
//    (which Cleanse later removes), unless the player has 'immunity'.
// =============================================================================

import { hasStatus, getStatus, addStatus, spawnBullet } from '../core/state.js';

function hit(a, b) {
  const dx = a.pos.x - b.pos.x;
  const dy = a.pos.y - b.pos.y;
  const r = (a.radius || 0) + (b.radius || 0);
  return dx * dx + dy * dy <= r * r;
}

export function stepCollision(state) {
  const tuning = state.config.tuning;
  const p = state.player;

  // 1) bullets that damage enemies: player bullets + confused friendly-fire
  for (const b of state.bullets) {
    if (b._dead || !(b.owner === 'player' || b.friendlyFire)) continue;
    for (const e of state.enemies) {
      if (e.hp <= 0) continue;
      if (b.friendlyFire && e.id === b.srcId) continue; // a confused enemy can't shoot itself
      if (hit(b, e)) {
        let dmg = b.dmg;
        const fr = getStatus(e, 'freeze');
        if (fr && fr.meta && fr.meta.shatter) dmg += tuning.shatterBonus;
        e.hp -= dmg;
        b._dead = true;
        break;
      }
    }
  }

  // 2) enemy bullets that damage the player (shield first)
  for (const b of state.bullets) {
    if (b._dead || b.owner !== 'enemy' || b.friendlyFire) continue;
    if (!hit(b, p)) continue;
    b._dead = true;
    if (hasStatus(p, 'invuln')) continue;
    let dmg = b.dmg;
    if (p.shield.amount > 0) {
      const absorbed = Math.min(p.shield.amount, dmg);
      p.shield.amount -= absorbed;
      dmg -= absorbed;
      if (hasStatus(p, 'shieldReflect')) {
        spawnBullet(state, {
          owner: 'player', srcId: 'player', pos: { x: p.pos.x, y: p.pos.y - p.radius },
          vel: { x: 0, y: -Math.abs(b.vel.y || 400) - 200 }, dmg: b.dmg, radius: p.bulletRadius, color: '#fff',
        });
      }
    }
    if (dmg > 0) p.hp -= dmg;
    if (b.inflict && !hasStatus(p, 'immunity') && Math.random() < (b.inflict.chance ?? 1)) {
      addStatus(p, b.inflict.type, b.inflict.ms, 1);
    }
  }

  state.bullets = state.bullets.filter((b) => !b._dead);
}
