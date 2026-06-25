// =============================================================================
//  core/map.js — the StS-style act map (pure, seeded, no DOM)
// =============================================================================
//
//  A run is a branching DAG of node rows the player walks from a `start` node to a
//  single `boss`. Row 0 is the start; the last row is the boss; the content rows in
//  between hold enemy/elite/shop/heal/upgrade nodes. Edges branch and re-converge
//  (each node links to 1–3 nearest-column nodes in the next row; a coverage pass
//  guarantees every node is reachable). Types are drawn from per-band weights, then
//  a guarantee pass enforces the design rules (first content row all-enemy, a fight
//  right before the boss, ≥1 shop, ≥1 heal, ≥minElites). Everything is seeded so a
//  given (config, seed) always yields the same map — no Date/Math.random.
// =============================================================================

import { makeRng } from './state.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isBattleType = (t) => t === 'enemy' || t === 'elite' || t === 'boss';
export const isBossNode = (n) => !!n && n.type === 'boss';

function tierOf(type) {
  if (type === 'boss') return 'boss';
  if (type === 'elite') return 'elite';
  if (type === 'enemy') return 'normal';
  return null;
}

function mkNode(row, col, type) {
  return { id: `r${row}c${col}`, row, col, type, tier: tierOf(type), encounter: null, next: [], visited: false };
}

/** Which band ('early'|'mid'|'late') a row falls in, per config.run.map.bands. */
export function bandForRow(row, config) {
  const bands = config.run.map.bands || {};
  for (const [name, [lo, hi]] of Object.entries(bands)) if (row >= lo && row <= hi) return name;
  return 'late';
}

function weightedPick(weights, rng) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) return 'enemy';
  let roll = rng() * total;
  for (const [k, w] of entries) { roll -= w; if (roll <= 0) return k; }
  return entries[entries.length - 1][0];
}

/** Connect every node in rowA forward to 1–3 nearest-column nodes in rowB; then a
 *  coverage pass so every rowB node has ≥1 inbound edge (no orphans). */
function linkRows(rowA, rowB, rng) {
  const bMax = rowB.length - 1;
  for (const node of rowA) {
    const posCol = rowA.length > 1 ? node.col / (rowA.length - 1) : 0.5;
    const center = clamp(Math.round(posCol * bMax), 0, bMax);
    const count = 1 + Math.floor(rng() * Math.min(3, rowB.length));
    const targets = new Set([center]);
    let guard = 0;
    while (targets.size < count && guard++ < 12) {
      const off = (rng() < 0.5 ? -1 : 1) * (1 + Math.floor(rng() * 2));
      targets.add(clamp(center + off, 0, bMax));
    }
    node.next = [...targets].sort((x, y) => x - y).map((i) => rowB[i].id);
  }
  const inbound = new Set(rowA.flatMap((n) => n.next));
  for (const b of rowB) {
    if (inbound.has(b.id)) continue;
    const posB = rowB.length > 1 ? b.col / (rowB.length - 1) : 0.5;
    let best = rowA[0]; let bestD = Infinity;
    for (const an of rowA) {
      const posA = rowA.length > 1 ? an.col / (rowA.length - 1) : 0.5;
      const d = Math.abs(posA - posB);
      if (d < bestD) { bestD = d; best = an; }
    }
    if (!best.next.includes(b.id)) { best.next.push(b.id); best.next.sort(); }
  }
}

function assignTypes(rows, config, rng) {
  const a = config.run.map.act1;
  const firstContent = 1;
  const lastContent = rows.length - 2;
  for (let r = firstContent; r <= lastContent; r++) {
    const band = bandForRow(r, config);
    const weights = a.typeWeights[band] || { enemy: 1 };
    for (const node of rows[r]) {
      if (r === firstContent && a.guarantees?.firstRowAllEnemy) node.type = 'enemy';
      else node.type = weightedPick(weights, rng);
      node.tier = tierOf(node.type);
    }
  }
}

/** Deterministically convert one content node matching `pred` to `type` (lowest id first
 *  among candidates, offset by an rng draw) — used by the guarantee pass. */
function convertOne(rows, pred, type, rng) {
  const cands = [];
  for (let r = 1; r <= rows.length - 2; r++) for (const n of rows[r]) if (pred(n, r)) cands.push(n);
  if (!cands.length) return false;
  const n = cands[Math.floor(rng() * cands.length)];
  n.type = type; n.tier = tierOf(type);
  return true;
}

function countType(rows, type) {
  let c = 0;
  for (let r = 1; r <= rows.length - 2; r++) for (const n of rows[r]) if (n.type === type) c += 1;
  return c;
}

function enforceGuarantees(rows, config, rng) {
  const a = config.run.map.act1;
  const lastContent = rows.length - 2;
  // a battle right before the boss (last content row → all battles)
  for (const n of rows[lastContent]) if (!isBattleType(n.type)) { n.type = 'enemy'; n.tier = 'normal'; }
  // ≥1 shop and ≥1 heal somewhere in the middle (not first/last content row)
  const midOnly = (n, r) => r > 1 && r < lastContent;
  if (a.guarantees?.requireShop && countType(rows, 'shop') === 0) convertOne(rows, (n, r) => midOnly(n, r) && n.type !== 'heal', 'shop', rng);
  if (a.guarantees?.requireHeal && countType(rows, 'heal') === 0) convertOne(rows, (n, r) => midOnly(n, r) && n.type !== 'shop', 'heal', rng);
  // ≥ minElites elites (mid/late battle nodes)
  let guard = 0;
  while (countType(rows, 'elite') < (a.minElites || 0) && guard++ < 20) {
    const ok = convertOne(rows, (n, r) => r > 1 && bandForRow(r, config) !== 'early' && n.type === 'enemy', 'elite', rng);
    if (!ok) break;
  }
}

function pickRoster(pool, size, rng) {
  const out = [];
  for (let i = 0; i < size; i++) out.push(pool[Math.floor(rng() * pool.length)]);
  return out;
}

function assignEncounters(rows, config, seed) {
  const mc = config.run.map;
  for (const row of rows) {
    for (const n of row) {
      if (!isBattleType(n.type)) continue;
      const nodeRng = makeRng(seed + n.row * 131 + n.col * 17 + 3);
      let pool; let size; let credit;
      if (n.type === 'boss') { pool = mc.bossPool; size = mc.rosterSize.boss || 1; credit = mc.creditSeconds.boss; }
      else if (n.type === 'elite') { pool = mc.enemyPools.elite; size = mc.rosterSize.elite || 2; credit = mc.creditSeconds.elite; }
      else { const band = bandForRow(n.row, config); pool = mc.enemyPools[band] || mc.enemyPools.early; size = mc.rosterSize[band] || 1; credit = mc.creditSeconds.normal; }
      n.encounter = { enemies: pickRoster(pool, size, nodeRng), creditSeconds: credit };
    }
  }
}

/** Build the act map for a run. Deterministic in (config, seed). */
export function generateMap(config, seed) {
  const a = config.run.map.act1;
  const R = Math.max(3, a.rows);
  const [mn, mx] = a.nodesPerRow;
  const rng = makeRng(seed);

  const rows = [];
  rows.push([mkNode(0, 0, 'start')]);
  for (let r = 1; r <= R - 2; r++) {
    const w = mn + Math.floor(rng() * (mx - mn + 1));
    const row = [];
    for (let c = 0; c < w; c++) row.push(mkNode(r, c, 'enemy')); // type set in assignTypes
    rows.push(row);
  }
  rows.push([mkNode(R - 1, 0, 'boss')]);

  for (let r = 0; r < rows.length - 1; r++) linkRows(rows[r], rows[r + 1], rng);
  assignTypes(rows, config, rng);
  enforceGuarantees(rows, config, rng);
  assignEncounters(rows, config, seed);

  const byId = {};
  for (const row of rows) for (const n of row) byId[n.id] = n;
  return { act: 1, rows, byId, startId: rows[0][0].id, bossId: rows[rows.length - 1][0].id };
}

export const nodeById = (map, id) => (map && map.byId[id]) || null;

/** The clickable set from where the player stands: the current node's forward links. */
export function reachableNext(map, currentId) {
  const cur = nodeById(map, currentId);
  if (!cur) return [];
  return cur.next.map((id) => map.byId[id]).filter(Boolean);
}

/** Validate a generated map (used by tests and as a generation sanity net). */
export function validateMap(map, config) {
  const seen = new Set();
  const stack = [map.startId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const nx of (map.byId[id]?.next || [])) stack.push(nx);
  }
  const allIds = Object.keys(map.byId);
  const connected = allIds.every((id) => seen.has(id));
  const bossReachable = seen.has(map.bossId);
  const a = config.run.map.act1;
  const lastContent = map.rows.length - 2;
  const firstRowAllEnemy = map.rows[1].every((n) => n.type === 'enemy');
  const lastRowIsBoss = map.rows[map.rows.length - 1].length === 1 && isBossNode(map.rows[map.rows.length - 1][0]);
  const battleBeforeBoss = map.rows[lastContent].every((n) => isBattleType(n.type));
  const hasShop = allIds.some((id) => map.byId[id].type === 'shop');
  const hasHeal = allIds.some((id) => map.byId[id].type === 'heal');
  const elites = allIds.filter((id) => map.byId[id].type === 'elite').length;
  const guaranteesMet = firstRowAllEnemy && lastRowIsBoss && battleBeforeBoss
    && (!a.guarantees?.requireShop || hasShop)
    && (!a.guarantees?.requireHeal || hasHeal)
    && elites >= (a.minElites || 0);
  return { connected, bossReachable, guaranteesMet, firstRowAllEnemy, lastRowIsBoss, hasShop, hasHeal, elites };
}
