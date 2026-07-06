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
import { generateMap, nodeById, reachableNext, isBossNode } from './map.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The node the player is currently resolving (or null off-map / legacy). */
const currentNode = (run) => (run.map ? nodeById(run.map, run.currentNodeId) : null);
/** Map depth driving escalation: the current node's row (fallback to battleIndex). */
const depthOf = (run) => { const n = currentNode(run); return n ? n.row : (run.battleIndex || 0); };
/** Deterministic per-node seed salt for offers/shops. */
const nodeSeed = (run) => { const n = currentNode(run); return n ? (n.row * 131 + n.col * 17) : (run.battleIndex || 0); };

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

  const hasMap = !!(rc.map && rc.map.act1);
  const run = {
    config,
    seed: seed || 0,
    loadout: components ? 'custom' : loadout,
    battleIndex: 0,
    // 'map' | 'inBattle' | 'reward' | 'shop' | 'won' | 'lost'. With a map, a run OPENS on the map.
    status: hasMap ? 'map' : 'inBattle',
    owned,
    comboMods: {},                // comboId -> merged patch
    componentMods: {},            // componentId -> merged patch ({ hpBonus, armor, effect, verb })
    persistentHp: {},             // componentId -> carried HP
    offer: null,                  // current reward/upgrade offer awaiting a pick
    offerPicks: 0,                // picks remaining from the current offer (elites grant 2)
    offerFree: false,             // true for upgrade-node offers (no scrap cost; titled differently)
    lastBattleReport: null,       // { rounds, par, fastWin, scrapGained } for the reward screen
    rewardsTaken: [],             // [{ type, modId?, id? }]
    // --- map + economy ---
    map: hasMap ? generateMap(config, (seed || 0) * 7919 + 101) : null,
    mapPos: null,                 // id of the node the player stands on (start, then resolved nodes)
    currentNodeId: null,          // id of the node being resolved right now
    scrap: (rc.economy && rc.economy.startScrap) || 0,
    shop: null,                   // built when a shop node is entered
    act: 1,
  };
  if (run.map) run.mapPos = run.map.startId;
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

  // Escalation: deeper rows hit harder, and elite/boss nodes get a tier multiplier on
  // top. With rosterBudgetSplit the budget is divided across the roster, so TOTAL
  // incoming pressure is set by the tier — and killing one enemy visibly relieves it.
  const eco = run.config.run?.economy || {};
  const rowMult = (eco.perRowBudgetMult ?? 1) ** depthOf(run);
  const tier = (currentNode(run) && currentNode(run).tier) || 'normal';
  const tierMult = (eco.tierBudgetMult && eco.tierBudgetMult[tier]) ?? 1;
  const split = eco.rosterBudgetSplit ? Math.max(1, (currentEncounter(run).enemies || []).length) : 1;
  const mult = rowMult * tierMult / split;
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

  // Component-mods: hp/armor onto components[id]; effect/verb/cascade onto the shared tables.
  for (const [id, patch] of Object.entries(run.componentMods)) {
    if (!cfg.components[id]) continue;
    if (patch.hpBonus) cfg.components[id].hp = (cfg.components[id].hp || 0) + patch.hpBonus;
    if (patch.armor) cfg.components[id].armor = (cfg.components[id].armor || 0) + patch.armor;
    if (patch.effect) deepMerge(cfg.effects, patch.effect);     // e.g. { freeze: { dmgPerPotency } }
    if (patch.verb) deepMerge(cfg.defense, patch.verb);         // e.g. { shield: { absorbPerPotency } }
    if (patch.cascade) deepMerge(cfg.cascade, patch.cascade);   // e.g. { launchpadHealthy: { sizeDelta } }
  }

  // Breach (run-only): enemy Cores use a weaker shield threshold so fights close out.
  const breach = run.config.run?.enemyShieldThreshold;
  if (breach != null && cfg.coreShield) cfg.coreShield.enemyThreshold = breach;
  return cfg;
}

/** The encounter to fight: the current node's, or a row-1 fallback (no node selected). */
function currentEncounter(run) {
  const node = currentNode(run);
  if (node && node.encounter) return node.encounter;
  if (run.map && run.map.rows[1]) {
    const firstBattle = run.map.rows[1].find((n) => n.encounter);
    if (firstBattle) return firstBattle.encounter;
  }
  return {};
}

/** UI overrides for createState() for the current battle (node-driven roster, credit,
 *  seed + run pacing: tier HP scaling and the Overheat par clock). */
export function buildBattleUi(run, baseUi = {}) {
  const enc = currentEncounter(run);
  const node = currentNode(run);
  const tier = (node && node.tier) || 'normal';
  const eco = run.config.run?.economy || {};
  const oh = run.config.run?.overheat || null;
  return {
    ...baseUi,
    enemies: enc.enemies || baseUi.enemies,
    creditSeconds: enc.creditSeconds != null ? enc.creditSeconds : baseUi.creditSeconds,
    seed: (run.seed || 0) + ((node?.row ?? 0) * 101) + ((node?.col ?? 0) * 7),
    enemyHpMult: (eco.tierHpMult && eco.tierHpMult[tier]) ?? 1,
    overheat: (oh && oh.parRounds && oh.parRounds[tier])
      ? { par: oh.parRounds[tier], rampPerRound: oh.rampPerRound || 1 }
      : null,
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
  return !!run.map && isBossNode(currentNode(run));
}

// --- node map navigation + economy -------------------------------------------

/** Enter a reachable node from the current map position; dispatch by node type. */
export function enterNode(run, id) {
  if (!run.map) return run;
  const reachable = reachableNext(run.map, run.mapPos).map((n) => n.id);
  if (!reachable.includes(id)) return run;            // ignore an unreachable pick
  const node = nodeById(run.map, id);
  node.visited = true;
  run.currentNodeId = id;
  // Final staging: entering the boss fully restores the owned kit (config-gated).
  if (node.type === 'boss' && run.config.run?.map?.bossStaging?.fullRepair) {
    for (const cid of COMPONENT_IDS) if (run.owned[cid]) run.persistentHp[cid] = moddedMaxHp(run, cid);
  }
  if (node.type === 'enemy' || node.type === 'elite' || node.type === 'boss') run.status = 'inBattle';
  else if (node.type === 'shop') { buildShop(run); run.status = 'shop'; }
  else if (node.type === 'heal') { applyHeal(run); advanceFromNode(run); }   // auto-resolve → back to map
  else if (node.type === 'upgrade') { rollUpgradeOffer(run); run.status = 'reward'; }
  else advanceFromNode(run);
  return run;
}

/** Finish the current node: stand on it, clear transient state, return to the map (or win). */
export function advanceFromNode(run) {
  const node = currentNode(run);
  run.battleIndex += 1;                               // kept only for reward-seed variety
  run.mapPos = run.currentNodeId || run.mapPos;
  run.currentNodeId = null;
  run.offer = null;
  run.offerPicks = 0;
  run.offerFree = false;
  run.shop = null;
  run.status = isBossNode(node) ? 'won' : 'map';
  return run;
}

/** Award Scrap for clearing a battle node: tier reward + per-row bonus + a fast-win
 *  bonus when the fight ended at or under its Overheat par (`rounds` from the battle
 *  state). Boss wins end the run immediately, so they pay nothing. Also records
 *  run.lastBattleReport for the reward screen. */
export function awardScrap(run, node, rounds = null) {
  const eco = run.config.run?.economy || {};
  const tier = (node && node.tier) || 'normal';
  if (tier === 'boss') return run.scrap || 0;
  const base = (eco.scrapReward && eco.scrapReward[tier]) || 0;
  const perRow = (eco.scrapPerRow || 0) * ((node && node.row) || 0);
  const par = run.config.run?.overheat?.parRounds?.[tier] ?? null;
  const fastWin = rounds != null && par != null && rounds <= par;
  const bonus = fastWin ? ((eco.fastWinScrap && eco.fastWinScrap[tier]) || 0) : 0;
  run.scrap = (run.scrap || 0) + base + perRow + bonus;
  run.lastBattleReport = { rounds, par, fastWin, scrapGained: base + perRow + bonus };
  return run.scrap;
}

/** Post-battle field repair: every SURVIVING owned part patches up a % of max HP
 *  between sorties. Destroyed parts stay destroyed — reviving one takes a real
 *  repair (reward, shop or heal bay), so attrition stays a threat without being
 *  a death spiral. */
export function applyPostBattleRepair(run) {
  const pct = run.config.run?.postBattleRepair?.percent ?? 0;
  if (!pct) return run;
  for (const id of COMPONENT_IDS) {
    if (!run.owned[id]) continue;
    const cur = run.persistentHp[id];
    if (cur == null || cur <= 0) continue;
    run.persistentHp[id] = Math.min(moddedMaxHp(run, id), cur + Math.round(moddedMaxHp(run, id) * pct));
  }
  return run;
}

/** Repair-bay node: restore a % of (modded) max HP to every owned component, incl. Core. */
export function applyHeal(run) {
  const h = (run.config.run?.map && run.config.run.map.heal) || {};
  const pct = h.percent ?? 0.4;
  for (const id of COMPONENT_IDS) {
    if (!run.owned[id]) continue;
    const max = moddedMaxHp(run, id);
    const cur = run.persistentHp[id] ?? max;
    run.persistentHp[id] = Math.min(max, cur + Math.round(max * pct));
  }
  if (h.fullCore) run.persistentHp.core = moddedMaxHp(run, 'core');
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
 * Shared weighted offer draw — distinct entries from the given pools, optionally leading
 * with a guaranteed component. Used by both the reward and upgrade offers.
 */
function drawOffer(rng, { pools, weights, size, guaranteeComponent }) {
  const offer = [];
  const used = new Set();
  const keyOf = (x) => `${x.type}:${x.id || x.modId || ''}`;
  const drawFrom = (poolName) => {
    const pool = (pools[poolName] || []).filter((x) => !used.has(keyOf(x)));
    if (!pool.length) return null;
    const pick = pool[Math.floor(rng() * pool.length)];
    used.add(keyOf(pick));
    offer.push(pick);
    return pick;
  };
  if (guaranteeComponent && pools.component && pools.component.length) drawFrom('component');
  while (offer.length < size) {
    const available = Object.keys(weights).filter((p) => pools[p] && pools[p].some((x) => !used.has(keyOf(x))));
    if (!available.length) break;
    const total = available.reduce((s, p) => s + (weights[p] || 0), 0);
    if (total <= 0) break;
    let roll = rng() * total;
    let chosen = available[available.length - 1];
    for (const p of available) { roll -= (weights[p] || 0); if (roll <= 0) { chosen = p; break; } }
    if (!drawFrom(chosen)) break;
  }
  return offer;
}

/**
 * Roll a post-battle reward offer. Deterministic for a given (seed, node) so it's
 * reproducible. Guarantees a component while unowned parts remain; never empty.
 * Elite wins (economy.eliteRewardBonus) present a bigger spread and grant 2 picks.
 */
export function rollRewardOffer(run, rng) {
  const reward = (run.config.run && run.config.run.reward) || {};
  const eco = run.config.run?.economy || {};
  const elite = !!eco.eliteRewardBonus && (currentNode(run)?.tier === 'elite');
  const eliteOffer = reward.eliteOffer || {};
  const r = rng || makeRng((run.seed || 0) * 100003 + nodeSeed(run) * 31 + 17);
  const offer = drawOffer(r, {
    pools: rewardPools(run),
    weights: reward.weights || {},
    size: elite ? (eliteOffer.size || 4) : (reward.offerSize || 3),
    guaranteeComponent: reward.guaranteeComponentUntilOwned,
  });
  if (!offer.length) offer.push({ type: 'repair', id: 'core', amount: 'full' });  // floor
  run.offer = offer;
  run.offerPicks = elite ? Math.min(eliteOffer.picks || 2, offer.length) : 1;
  run.offerFree = false;
  return offer;
}

/** Roll a FREE upgrade-node offer: mods only (and optionally a component). */
export function rollUpgradeOffer(run, rng) {
  const uc = (run.config.run?.map && run.config.run.map.upgrade) || {};
  const r = rng || makeRng((run.seed || 0) * 777 + nodeSeed(run) + 5);
  const all = rewardPools(run);
  const pools = { comboMod: all.comboMod, componentMod: all.componentMod };
  const weights = { comboMod: 2, componentMod: 2 };
  if (uc.allowComponent) { pools.component = all.component; weights.component = 2; }
  let offer = drawOffer(r, { pools, weights, size: uc.size || 3, guaranteeComponent: false });
  if (!offer.length) offer = [{ type: 'repair', id: 'core', amount: 'full' }];  // free heal fallback
  run.offer = offer;
  run.offerPicks = 1;
  run.offerFree = true;
  return offer;
}

/** Build a priced shop inventory from the reward pools (+ a full-repair option). */
export function buildShop(run) {
  const eco = run.config.run?.economy || {};
  const prices = eco.prices || {};
  const node = currentNode(run);
  const rowMult = 1 + (eco.priceRowMult || 0) * ((node && node.row) || 0);
  const r = makeRng((run.seed || 0) * 331 + nodeSeed(run) + 13);
  const px = (key, fallback) => Math.round(((prices[key] != null ? prices[key] : fallback)) * rowMult);
  const pools = rewardPools(run);
  const cands = [
    ...pools.component.map((x) => ({ ...x, price: px('component', 110) })),
    ...pools.comboMod.map((x) => ({ ...x, price: px('comboMod', 70) })),
    ...pools.componentMod.map((x) => ({ ...x, price: px('componentMod', 70) })),
    ...pools.repair.map((x) => ({ ...x, price: px('repair', 30) })),
  ];
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  const size = (eco.shop && eco.shop.size) || 5;
  const items = cands.slice(0, Math.max(0, size - 1));
  items.push({ type: 'repairAll', price: px('repairAll', 80) });   // always offer a full repair
  run.shop = { items, sold: [] };
  return run.shop;
}

const shopKey = (item) => `${item.type}:${item.id || item.modId || ''}`;

/** Spend Scrap on a shop item. Routes mutation through applyRewardChoice; rejects if unaffordable/sold. */
export function applyShopPurchase(run, item) {
  if (!item) return { ok: false, reason: 'none' };
  const price = item.price || 0;
  if ((run.scrap || 0) < price) return { ok: false, reason: 'afford' };
  const key = shopKey(item);
  if (run.shop && run.shop.sold.includes(key)) return { ok: false, reason: 'sold' };
  run.scrap -= price;
  if (item.type === 'repairAll') {
    for (const id of COMPONENT_IDS) if (run.owned[id]) run.persistentHp[id] = moddedMaxHp(run, id);
  } else {
    applyRewardChoice(run, item);   // component / comboMod / componentMod / repair
  }
  if (run.shop) run.shop.sold.push(key);
  return { ok: true };
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
        // the mod is already merged, so the pre-mod fallback is modded max MINUS this bonus
        const cur = run.persistentHp[choice.id] ?? (moddedMaxHp(run, choice.id) - choice.patch.hpBonus);
        run.persistentHp[choice.id] = Math.min(moddedMaxHp(run, choice.id), cur + choice.patch.hpBonus);
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
  // Multi-pick offers (elite bonus): remove the taken card and keep the offer open
  // until every pick is spent.
  if (run.offer && run.offerPicks > 1) {
    const keyOf = (x) => `${x.type}:${x.id || x.modId || ''}`;
    run.offer = run.offer.filter((x) => keyOf(x) !== keyOf(choice));
    run.offerPicks -= 1;
    if (!run.offer.length) { run.offer = null; run.offerPicks = 0; }
  } else {
    run.offer = null;
    run.offerPicks = 0;
  }
  return run;
}
