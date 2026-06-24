// =============================================================================
//  core/run.js — the roguelike RUN meta-layer (pure logic, no DOM)
// =============================================================================
//
//  A RUN wraps the existing single-battle engine. It owns everything that
//  persists BETWEEN battles — which components the player owns, the mods they've
//  installed, and per-component HP — and per battle it produces three things the
//  battle engine consumes:
//
//    1. an EFFECTIVE CONFIG  — the base game.json deep-cloned with installed
//       combo-mods / component-mods merged in (+ per-battle escalation). Because
//       every combat module reads tuning from `state.config`, baking mods into a
//       cloned config makes them live with ZERO combat-code edits and NEVER
//       mutates the base config.
//    2. an OWNERSHIP tag on each player component  — only owned parts can open
//       their TRS, so only owned effects/verbs (and the combos they form) exist.
//    3. PERSISTENT HP  — owned components (incl. the Core) carry their HP between
//       battles; the Core is clamped to >=1 at battle start so a run is always
//       playable.
//
//  main.js drives the screen flow (loadout -> battle -> reward -> next/end); the
//  decisions and data live here so they're unit-testable headlessly.
// =============================================================================

import { COMPONENT_IDS, ATTACK_EFFECT, DEFENSE_VERB } from './components.js';
import { makeRng } from './state.js';
import { OFFENSE_COMBOS, DEFENSE_COMBOS } from '../combat/combos.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Deep clone a pure-JSON value (the config has no functions). */
export const deepClone = (o) => JSON.parse(JSON.stringify(o));

/** Recursively merge `patch` into `target`: plain objects merge, everything else overwrites. */
export function deepMerge(target, patch) {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = (target && typeof target === 'object' && !Array.isArray(target)) ? target : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

/** Which config table a combo lives in ('offense' = effects.synergy.combos, 'defense' = defense.combos). */
function comboTable(config, comboId) {
  if (config.effects?.synergy?.combos?.[comboId] != null) return 'offense';
  if (config.defense?.combos?.[comboId] != null) return 'defense';
  return null;
}

/**
 * Start a run. `loadout` is a preset key from config.run.loadouts OR an explicit
 * { components:[...] }. Core is always owned. Returns the run object.
 */
export function createRun(config, { loadout = 'custom', components = null, seed = 0 } = {}) {
  const rc = config.run || {};
  let picked = components;
  if (!picked) {
    const preset = (rc.loadouts && rc.loadouts[loadout]) || null;
    picked = preset ? (preset.components || []) : [];
  }
  const owned = { core: true };
  for (const id of picked) if (COMPONENT_IDS.includes(id)) owned[id] = true;

  const run = {
    config,
    seed: seed || 0,
    loadout: components ? 'custom' : loadout,
    battleIndex: 0,
    status: 'inBattle',           // 'inBattle' | 'reward' | 'won' | 'lost'
    owned,
    comboMods: {},                // comboId -> merged patch
    componentMods: {},            // componentId -> merged patch ({ hpBonus, armor, effect, verb })
    persistentHp: {},             // componentId -> carried HP
    offer: null,                  // current reward offer awaiting a pick
    rewardsTaken: [],             // [{ type, modId?, id? }]
  };
  // Owned parts enter the first battle at full (modded) HP.
  for (const id of Object.keys(owned)) run.persistentHp[id] = moddedMaxHp(run, id);
  return run;
}

/** Modded max HP for a component (base + any component-mod hpBonus). */
export function moddedMaxHp(run, id) {
  const base = run.config.components[id]?.hp ?? 0;
  const bonus = run.componentMods[id]?.hpBonus || 0;
  return base + bonus;
}

/**
 * The base config deep-cloned with this run's mods + escalation merged in.
 * NEVER mutates run.config.
 */
export function effectiveConfig(run) {
  const cfg = deepClone(run.config);

  // Per-battle escalation: later battles hit harder (damageBudget scales).
  const mult = (run.config.run?.escalation?.perBattleBudgetMult ?? 1) ** run.battleIndex;
  if (mult !== 1) {
    for (const [k, a] of Object.entries(cfg.archetypes || {})) {
      if (k === '_comment' || !a || typeof a.damageBudget !== 'number') continue;
      a.damageBudget = Math.round(a.damageBudget * mult);
    }
  }

  // Combo-mods: merge each merged patch into the combo's home table.
  for (const [comboId, patch] of Object.entries(run.comboMods)) {
    const table = comboTable(cfg, comboId);
    if (table === 'offense') deepMerge(cfg.effects.synergy.combos[comboId], patch);
    else if (table === 'defense') deepMerge(cfg.defense.combos[comboId], patch);
  }

  // Component-mods: hp/armor onto components[id]; effect/verb onto the shared tables.
  for (const [id, patch] of Object.entries(run.componentMods)) {
    if (!cfg.components[id]) continue;
    if (patch.hpBonus) cfg.components[id].hp = (cfg.components[id].hp || 0) + patch.hpBonus;
    if (patch.armor) cfg.components[id].armor = (cfg.components[id].armor || 0) + patch.armor;
    if (patch.effect) deepMerge(cfg.effects, patch.effect);     // e.g. { freeze: { dmgPerPotency } }
    if (patch.verb) deepMerge(cfg.defense, patch.verb);         // e.g. { shield: { absorbPerPotency } }
  }
  return cfg;
}

/** UI overrides for createState() for the current battle (roster, credit, seed). */
export function buildBattleUi(run, baseUi = {}) {
  const battle = (run.config.run?.battles || [])[run.battleIndex] || {};
  return {
    ...baseUi,
    enemies: battle.enemies || baseUi.enemies,
    creditSeconds: battle.creditSeconds != null ? battle.creditSeconds : baseUi.creditSeconds,
    seed: (run.seed || 0) + run.battleIndex,
  };
}

/** Tag each player component with its ownership (Core always owned). Post-step on a fresh state. */
export function applyOwnership(state, run) {
  for (const id of COMPONENT_IDS) {
    const comp = state.player.components[id];
    if (comp) comp.owned = id === 'core' ? true : !!run.owned[id];
  }
  return state;
}

/** Carry persistent HP onto a fresh battle state. Core clamped >=1 so the run is playable. */
export function applyPersistentHp(state, run) {
  for (const id of COMPONENT_IDS) {
    const comp = state.player.components[id];
    if (!comp) continue;
    if (comp.owned !== false) {
      const stored = run.persistentHp[id];
      comp.hp = (stored != null) ? clamp(stored, 0, comp.maxHp) : comp.maxHp;
    }
    if (id === 'core') comp.hp = Math.max(1, comp.hp);
  }
  return state;
}

/** After a battle: snapshot surviving HP of owned components (incl. Core) into the run. */
export function captureBattleResult(run, state) {
  for (const id of COMPONENT_IDS) {
    if (run.owned[id]) run.persistentHp[id] = Math.max(0, state.player.components[id].hp);
  }
  return run;
}

export function isFinalBattle(run) {
  const battles = run.config.run?.battles || [];
  const b = battles[run.battleIndex];
  return !!(b && b.isFinal) || run.battleIndex >= battles.length - 1;
}

/** Step to the next battle (clears the spent offer). */
export function advanceBattle(run) {
  run.battleIndex += 1;
  run.offer = null;
  return run;
}

// --- rewards -----------------------------------------------------------------

const takenModIds = (run) => new Set(run.rewardsTaken.map((r) => r.modId).filter(Boolean));

/** Combo id -> its source effect/verb pair, derived from the combo tables. */
function comboPairKey(comboId) {
  for (const [pair, def] of Object.entries(OFFENSE_COMBOS)) if (def.id === comboId) return pair;
  for (const [pair, def] of Object.entries(DEFENSE_COMBOS)) if (def.id === comboId) return pair;
  return null;
}

/** Is `comboId` currently formable — does the player own both source components? */
export function comboFormable(run, comboId, needs) {
  if (Array.isArray(needs) && needs.length) return needs.every((id) => run.owned[id]);
  // Fallback: derive the two components from the effect/verb pair.
  const pair = comboPairKey(comboId);
  if (!pair) return false;
  const owners = { ...invert(ATTACK_EFFECT), ...invert(DEFENSE_VERB) };
  return pair.split('+').every((k) => run.owned[owners[k]]);
}
const invert = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [v, k]));

/** Build the candidate reward pools given the run's current state. */
export function rewardPools(run) {
  const rc = run.config.run || {};
  const taken = takenModIds(run);

  const component = COMPONENT_IDS
    .filter((id) => id !== 'core' && !run.owned[id])
    .map((id) => ({ type: 'component', id }));

  const comboMod = Object.entries(rc.comboModCatalog || {})
    .filter(([modId]) => modId !== '_comment' && !taken.has(modId))
    .filter(([, e]) => comboFormable(run, e.combo, e.needs))
    .map(([modId, e]) => ({ type: 'comboMod', modId, combo: e.combo, table: e.table, patch: e.patch }));

  const componentMod = Object.entries(rc.componentModCatalog || {})
    .filter(([modId]) => modId !== '_comment' && !taken.has(modId))
    .filter(([, e]) => run.owned[e.component])
    .map(([modId, e]) => ({ type: 'componentMod', modId, id: e.component, patch: e.patch }));

  const repair = COMPONENT_IDS
    .filter((id) => run.owned[id] && (run.persistentHp[id] ?? moddedMaxHp(run, id)) < moddedMaxHp(run, id))
    .map((id) => ({ type: 'repair', id, amount: 'full' }));

  return { component, comboMod, componentMod, repair };
}

/**
 * Roll a reward offer. Deterministic for a given (seed, battleIndex) so an offer is
 * reproducible. Guarantees at least one component while unowned parts remain, and is
 * never empty (repair fallback).
 */
export function rollRewardOffer(run, rng) {
  const rc = run.config.run || {};
  const reward = rc.reward || {};
  const size = reward.offerSize || 3;
  const weights = reward.weights || {};
  const r = rng || makeRng((run.seed || 0) * 100003 + run.battleIndex * 31 + 17);

  const pools = rewardPools(run);
  const offer = [];
  const used = new Set();
  const keyOf = (x) => `${x.type}:${x.id || x.modId || ''}`;

  const drawFrom = (poolName) => {
    const pool = pools[poolName].filter((x) => !used.has(keyOf(x)));
    if (!pool.length) return null;
    const pick = pool[Math.floor(r() * pool.length)];
    used.add(keyOf(pick));
    offer.push(pick);
    return pick;
  };

  // Pity: always lead with a component while any remain (so a run can finish its kit).
  if (reward.guaranteeComponentUntilOwned && pools.component.length) drawFrom('component');

  while (offer.length < size) {
    const available = Object.keys(weights).filter((p) => pools[p] && pools[p].some((x) => !used.has(keyOf(x))));
    if (!available.length) break;
    const total = available.reduce((s, p) => s + (weights[p] || 0), 0);
    let roll = r() * total;
    let chosen = available[available.length - 1];
    for (const p of available) { roll -= (weights[p] || 0); if (roll <= 0) { chosen = p; break; } }
    if (!drawFrom(chosen)) break;
  }

  // Never empty: offer a Core repair (a no-op if already full) as the floor.
  if (!offer.length) offer.push({ type: 'repair', id: 'core', amount: 'full' });

  run.offer = offer;
  return offer;
}

/** Apply a chosen reward to the run. */
export function applyRewardChoice(run, choice) {
  if (!choice) return run;
  switch (choice.type) {
    case 'component':
      run.owned[choice.id] = true;
      run.persistentHp[choice.id] = moddedMaxHp(run, choice.id);
      run.rewardsTaken.push({ type: 'component', id: choice.id });
      break;
    case 'comboMod':
      run.comboMods[choice.combo] = deepMerge(run.comboMods[choice.combo] || {}, deepClone(choice.patch));
      run.rewardsTaken.push({ type: 'comboMod', modId: choice.modId });
      break;
    case 'componentMod': {
      run.componentMods[choice.id] = deepMerge(run.componentMods[choice.id] || {}, deepClone(choice.patch));
      // Installing extra hull also heals into the new max (feels rewarding).
      if (choice.patch.hpBonus) {
        const cur = run.persistentHp[choice.id] ?? run.config.components[choice.id].hp;
        run.persistentHp[choice.id] = cur + choice.patch.hpBonus;
      }
      run.rewardsTaken.push({ type: 'componentMod', modId: choice.modId, id: choice.id });
      break;
    }
    case 'repair': {
      const max = moddedMaxHp(run, choice.id);
      run.persistentHp[choice.id] = choice.amount === 'full'
        ? max
        : Math.min(max, (run.persistentHp[choice.id] ?? 0) + (choice.amount || 0));
      run.rewardsTaken.push({ type: 'repair', id: choice.id });
      break;
    }
    default: break;
  }
  run.offer = null;
  return run;
}
