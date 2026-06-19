// =============================================================================
//  combat/enemyAI.js — the targeting brains (Saboteur + Brute), v1
// =============================================================================
//
//  The enemy commits its attack at the START of your attack phase (so it shows as
//  a telegraph if your Tower is alive). It picks TARGETS + shares now; the actual
//  damage is scaled at defense-resolve by the enemy's CURRENT condition — so
//  crippling its offence in your attack makes the telegraphed blow land softer.
// =============================================================================

import { isAlive } from '../core/components.js';
import { combatCondition, firepowerMult } from '../core/firepower.js';
import { systemState, coreShieldUp, towerActive, effectiveAim } from '../core/cascade.js';

/** The archetype keys defined in config (skips the `_comment` doc field). The roster
 *  is 100% config-driven: add an entry under game.json#archetypes and it's selectable. */
export function archetypeKeys(config) {
  return Object.keys((config && config.archetypes) || {}).filter((k) => k !== '_comment');
}

/**
 * Resolve 'random' (or an unknown key) against the config's archetype keys.
 * @param keys  the list from archetypeKeys(config); falls back to ['saboteur'] if absent.
 */
export function resolveArchetype(key, rng, keys) {
  const list = (keys && keys.length) ? keys : ['saboteur'];
  if (key === 'random') return list[Math.floor((rng ? rng() : Math.random()) * list.length)];
  return list.includes(key) ? key : list[0];
}

/** The status a strike may inflict for this archetype (single `status` or a random `statusPool`). */
function pickStatus(arch, rng) {
  if (arch.statusPool && arch.statusPool.length) return arch.statusPool[Math.floor((rng ? rng() : Math.random()) * arch.statusPool.length)];
  return arch.status || 'drain';
}

/** Fisher–Yates shuffle (seeded) — used when the enemy Tower is down and aim scatters. */
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Can the enemy meaningfully target this player part right now? (never the SHIELDED Core). */
function canTarget(id, player, coreShielded) {
  if (!isAlive(player.components[id])) return false;
  if (id === 'core' && coreShielded) return false; // wasted — shield blocks all direct damage
  return true;
}

/**
 * Ordered list of player target ids for this archetype. While the Core is shielded it
 * is excluded entirely (the AI goes after the shield-linked parts instead, e.g. the
 * Saboteur's Generator); the Core re-enters targeting only once its shield is down.
 */
function targetOrder(arch, player, coreShielded) {
  const comps = player.components;
  let ids;
  if (arch.priority === 'highestHp') {
    ids = Object.keys(comps)
      .filter((id) => id !== 'core' && isAlive(comps[id]))
      .sort((a, b) => comps[b].hp - comps[a].hp);
  } else {
    ids = (arch.priority || []).filter((id) => canTarget(id, player, coreShielded));
  }
  if (!ids.length && canTarget('core', player, coreShielded)) ids = ['core']; // only when exposed
  return ids;
}

/** Build the telegraph ONE enemy declares during the player's attack phase. */
export function planAttack(state, enemy) {
  const arch = state.config.archetypes[enemy.archetype];
  const coreShielded = coreShieldUp(state.player, state.config);
  const enemyTowerOk = towerActive(enemy);   // this enemy's Tower destroyed OR frozen → aim breaks
  const spread = arch.spread || 0;
  const entries = [];

  if (!enemyTowerOk) {
    // Enemy Tower down/frozen → blind aim: targets SCATTER randomly (no archetype focus),
    // spread evenly across up to 3 parts. (It also hits softer — see currentBudget.)
    const pool = Object.keys(state.player.components).filter((id) => canTarget(id, state.player, coreShielded));
    const picks = shuffle(pool, state.rng).slice(0, 3);
    const share = picks.length ? 1 / picks.length : 0;
    for (const id of picks) entries.push({ component: id, share });
  } else {
    const order = targetOrder(arch, state.player, coreShielded);
    if (order.length) {
      if (spread > 0 && order.length > 1) {
        entries.push({ component: order[0], share: 1 - spread });
        const rest = order.slice(1, 3);
        for (const id of rest) entries.push({ component: id, share: spread / rest.length });
      } else {
        entries.push({ component: order[0], share: 1 });
      }
      // status intent on the primary target (rng-gated, archetype-flavoured)
      if ((state.rng ? state.rng() : Math.random()) < (arch.statusChance || 0)) {
        entries[0].status = pickStatus(arch, state.rng);
      }
    }
  }

  // You SEE the telegraph only if YOUR Tower is active (alive and not frozen).
  const visible = state.config.telegraph.gated ? towerActive(state.player) : true;
  return { eid: enemy.eid, archetype: enemy.archetype, label: enemy.label, entries, visible, scattered: !enemyTowerOk };
}

/**
 * ONE enemy's attack budget scaled by its CURRENT condition (called at defense-resolve).
 * A destroyed/frozen enemy Tower also costs it accuracy (aimMult), so its blow lands softer.
 */
export function currentBudget(state, enemy) {
  const arch = state.config.archetypes[enemy.archetype];
  const sys = systemState(enemy, state.config);
  const aim = effectiveAim(enemy, state.config); // tower dead OR frozen → softer
  const scale = firepowerMult(combatCondition(enemy, state.config), state.config) * sys.brownout * aim;
  return arch.damageBudget * scale;
}
