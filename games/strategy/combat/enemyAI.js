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
import { systemState } from '../core/cascade.js';

/** Resolve 'random' to a concrete archetype key. */
export function resolveArchetype(key, rng) {
  if (key === 'random') return (rng ? rng() : Math.random()) < 0.5 ? 'saboteur' : 'brute';
  return key === 'brute' ? 'brute' : 'saboteur';
}

/** Ordered list of alive player target component ids for this archetype (core last-resort). */
function targetOrder(arch, player) {
  const comps = player.components;
  let ids;
  if (arch.priority === 'highestHp') {
    ids = Object.keys(comps)
      .filter((id) => id !== 'core' && isAlive(comps[id]))
      .sort((a, b) => comps[b].hp - comps[a].hp);
  } else {
    ids = (arch.priority || []).filter((id) => isAlive(comps[id]));
  }
  if (!ids.length && isAlive(comps.core)) ids = ['core']; // nothing left but the heart
  return ids;
}

/** Build the telegraph the player sees during their attack phase. */
export function planAttack(state) {
  const arch = state.config.archetypes[state.archetype];
  const order = targetOrder(arch, state.player);
  const spread = arch.spread || 0;

  // shares: primary gets (1-spread); the rest split `spread` across up to 2 others.
  const entries = [];
  if (order.length) {
    if (spread > 0 && order.length > 1) {
      entries.push({ component: order[0], share: 1 - spread });
      const rest = order.slice(1, 3);
      for (const id of rest) entries.push({ component: id, share: spread / rest.length });
    } else {
      entries.push({ component: order[0], share: 1 });
    }
    // status intent on the primary target (rng-gated)
    if ((state.rng ? state.rng() : Math.random()) < (arch.statusChance || 0)) {
      entries[0].status = state.archetype === 'saboteur' ? 'drain' : 'freeze';
    }
  }

  const sys = systemState(state.player, state.config);
  const visible = state.config.telegraph.gated ? sys.telegraphVisible : true;
  return { archetype: state.archetype, entries, visible };
}

/** Enemy attack budget scaled by its CURRENT condition (called at defense-resolve). */
export function currentBudget(state) {
  const arch = state.config.archetypes[state.archetype];
  const sys = systemState(state.enemy, state.config);
  const scale = firepowerMult(combatCondition(state.enemy, state.config), state.config) * sys.brownout;
  return arch.damageBudget * scale;
}
