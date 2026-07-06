// =============================================================================
//  combat/enemyAI.js — the targeting brains (Saboteur + Brute), v1
// =============================================================================
//
//  The enemy commits its attack at the START of your attack phase (so it shows as
//  a telegraph if your Tower is alive). It picks TARGETS + shares now; the actual
//  damage is scaled at defense-resolve by the enemy's CURRENT condition — so
//  crippling its offence in your attack makes the telegraphed blow land softer.
// =============================================================================

import { isAlive, isOwned, hasStatus } from '../core/components.js';
import { combatCondition, firepowerMult } from '../core/firepower.js';
import { systemState, coreShieldUp, towerActive, effectiveAim } from '../core/cascade.js';

// the five base statuses a confused telegraph may falsely show (local to avoid an import cycle)
const FAKE_STATUS_POOL = ['freeze', 'confuse', 'drain', 'burning', 'shatter'];

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

/** Can the enemy meaningfully target this player part right now? Must EXIST (owned), be alive,
 *  and never the SHIELDED Core. Ownership matters in the roguelike: a part the player hasn't
 *  acquired isn't on the board, so the enemy must never aim at it. */
function canTarget(id, player, coreShielded) {
  const c = player.components[id];
  if (!c || !isOwned(c) || !isAlive(c)) return false;
  if (id === 'core' && coreShielded) return false; // wasted — shield blocks all direct damage
  return true;
}

/** Owned, alive, non-core player parts ordered by firepower weight (biggest contributor first).
 *  The graceful fallback so an enemy always strikes a part that actually EXISTS, whatever the
 *  player's loadout. */
function fallbackOrder(player, config) {
  const weights = (config && config.firepower && config.firepower.weights) || {};
  return Object.keys(player.components)
    .filter((id) => id !== 'core' && isOwned(player.components[id]) && isAlive(player.components[id]))
    .sort((a, b) => (weights[b] || 0) - (weights[a] || 0));
}

/**
 * Ordered list of player target ids for this archetype. Archetype `priority` lists are
 * PREFERENCES; when none of them are owned/alive we fall back to the player's biggest owned
 * part (fallbackOrder) so the strike always lands on something real. While the Core is shielded
 * it's excluded (the AI goes after shield-linked parts first); the Core re-enters only when exposed.
 */
function targetOrder(arch, player, coreShielded, config) {
  const comps = player.components;
  let ids;
  if (arch.priority === 'highestHp') {
    ids = Object.keys(comps)
      .filter((id) => id !== 'core' && isOwned(comps[id]) && isAlive(comps[id]))
      .sort((a, b) => comps[b].hp - comps[a].hp);
  } else {
    ids = (arch.priority || []).filter((id) => canTarget(id, player, coreShielded));
  }
  if (!ids.length) ids = fallbackOrder(player, config);            // adaptive: hit a part that exists
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
    const order = targetOrder(arch, state.player, coreShielded, state.config);
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

  // You SEE the telegraph unless YOUR Tower is destroyed/frozen/locked (towerActive). A CONFUSED
  // Tower keeps the telegraph visible but jams it: the displayed prediction is unreliable.
  const visible = state.config.telegraph.gated ? towerActive(state.player) : true;
  const confused = visible && hasStatus(state.player.components.tower, 'confuse');
  const display = !visible ? [] : (confused ? fuzzedDisplay(state, entries) : entries.map((e) => ({ component: e.component, status: e.status, uncertain: false })));
  return { eid: enemy.eid, archetype: enemy.archetype, label: enemy.label, entries, display, visible, confused, scattered: !enemyTowerOk };
}

/**
 * Build the DISPLAYED prediction when the player's Tower is Confused: each entry independently has
 * a `confuseFalseChance` to become a DECOY (target swapped to a random other part, status maybe
 * faked). Every shown marker is flagged `uncertain`. The TRUE `entries` (used at resolve) are
 * never changed — only the player's view is. Seeded by state.rng so it's stable across re-renders.
 */
function fuzzedDisplay(state, entries) {
  const rng = () => (state.rng ? state.rng() : Math.random());
  const falseChance = state.config.telegraph.confuseFalseChance ?? 0.5;
  const parts = Object.keys(state.player.components).filter((id) => isOwned(state.player.components[id]) && isAlive(state.player.components[id]));
  return entries.map((e) => {
    if (rng() >= falseChance) return { component: e.component, status: e.status, uncertain: true }; // truthful but flagged
    const others = parts.filter((id) => id !== e.component);
    const component = others.length ? others[Math.floor(rng() * others.length)] : e.component;
    let status = e.status;
    if (rng() < 0.5) status = rng() < 0.5 ? FAKE_STATUS_POOL[Math.floor(rng() * FAKE_STATUS_POOL.length)] : undefined; // 50% fake/drop the status
    return { component, status, uncertain: true };
  });
}

/**
 * Overheat (run mode): past the fight's par round, every enemy's budget compounds
 * per extra round — the anti-stall clock. 1 when at/under par or when the battle
 * has no overheat configured (single battle).
 */
export function overheatMult(state) {
  const oh = state.overheat;
  if (!oh || !oh.rampPerRound || state.round <= oh.par) return 1;
  return oh.rampPerRound ** (state.round - oh.par);
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
  return arch.damageBudget * scale * overheatMult(state);
}
