// Tests the route-first "designer" generator: two distinct routes, exact node
// counts, achievable ordering, reproducibility, solvability, graceful fallback.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test, assert } from './harness.mjs';
import { generate, findAnyPath } from '../module/core/generator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(readFileSync(resolve(__dirname, `../combo/configs/${n}.json`), 'utf8'));
const OFF = load('offensive');
const DEF = load('defensive');

// Build a nodeTypes catalog from a config (mirrors what the demo does).
function catalogFromConfig(cfg) {
  const nt = { ...cfg.base };
  for (const [k, d] of Object.entries(cfg.skills)) nt[k] = { role: 'normal', passable: true, ...d };
  if (cfg.powerups) for (const [k, d] of Object.entries(cfg.powerups)) nt[k] = { role: 'normal', passable: true, ...d };
  return nt;
}
function tally(level) {
  const t = {};
  for (const row of level.cells) for (const k of row) t[k] = (t[k] || 0) + 1;
  return t;
}
const OFF_NT = catalogFromConfig(OFF);
const DEF_NT = catalogFromConfig(DEF);

test('solvable across sizes 4..15 (offensive + defensive), never crashes', () => {
  for (let size = 4; size <= 15; size++) {
    for (let seed = 0; seed < 6; seed++) {
      const o = generate({ size, nodeTypes: OFF_NT, seed, routePlan: OFF.generation });
      assert(findAnyPath(o, OFF_NT, o.moveBudget) !== null, `offensive ${size}x${size} seed ${seed} solvable`);
      const d = generate({ size, nodeTypes: DEF_NT, seed, routePlan: DEF.generation });
      assert(findAnyPath(d, DEF_NT, d.moveBudget) !== null, `defensive ${size}x${size} seed ${seed} solvable`);
    }
  }
});

test('offensive: exactly one of each amplifier; a varied featured payload stack', () => {
  const featuredSeen = new Set();
  for (let seed = 0; seed < 10; seed++) {
    const lvl = generate({ size: 10, nodeTypes: OFF_NT, seed, routePlan: OFF.generation });
    if (!lvl.primaryRoute) continue; // fell back (shouldn't at 10x10) — skip
    const t = tally(lvl);
    assert(t.chain === 1, `exactly one chain (got ${t.chain})`);
    assert(t.multihack === 1, `exactly one multihack (got ${t.multihack})`);
    const payloads = ['freeze', 'confuse', 'drain'];
    const counts = payloads.map((k) => t[k] || 0);
    const present = counts.filter((c) => c > 0).length;
    const featuredCount = Math.max(...counts);
    assert(present === 3, `all three payloads considered (present ${present})`);
    assert(featuredCount >= 2 && featuredCount <= 4, `one featured stack of 2..4 (got ${featuredCount})`);
    featuredSeen.add(payloads[counts.indexOf(featuredCount)]);
  }
  assert(featuredSeen.size > 1, `featured payload varies across seeds (saw ${[...featuredSeen].join(',')})`);
});

test('offensive: amplifiers come AFTER all payloads along the primary route', () => {
  for (let seed = 0; seed < 8; seed++) {
    const lvl = generate({ size: 11, nodeTypes: OFF_NT, seed, routePlan: OFF.generation });
    if (!lvl.primaryRoute) continue;
    const seq = lvl.primaryRoute
      .map((c) => lvl.cells[c.y][c.x])
      .filter((k) => OFF.skills[k]); // skill nodes only, in route order
    const isPayload = (k) => OFF.skills[k].class === 'payload';
    const lastPayload = seq.map(isPayload).lastIndexOf(true);
    const chainAt = seq.indexOf('chain');
    const multiAt = seq.indexOf('multihack');
    assert(chainAt > lastPayload && multiAt > chainAt,
      `order payloads… → chain → multihack (got ${seq.join(',')})`);
  }
});

test('defensive: one of each amplifier; a varied featured buff stack; repair present', () => {
  const featuredSeen = new Set();
  for (let seed = 0; seed < 10; seed++) {
    const lvl = generate({ size: 10, nodeTypes: DEF_NT, seed, routePlan: DEF.generation });
    if (!lvl.primaryRoute) continue;
    const t = tally(lvl);
    assert(t.prolong === 1, `exactly one prolong (got ${t.prolong})`);
    assert(t.amplify === 1, `exactly one amplify (got ${t.amplify})`);
    assert((t.repair || 0) >= 1, 'at least one repair power-up');
    const buffs = ['shield', 'cleanse', 'overclock'];
    const counts = buffs.map((k) => t[k] || 0);
    const present = counts.filter((c) => c > 0).length;
    const featuredCount = Math.max(...counts);
    assert(present === 3, `all three buffs considered (present ${present})`);
    assert(featuredCount >= 2 && featuredCount <= 4, `one featured stack of 2..4 (got ${featuredCount})`);
    featuredSeen.add(buffs[counts.indexOf(featuredCount)]);
  }
  assert(featuredSeen.size > 1, `featured buff varies across seeds (saw ${[...featuredSeen].join(',')})`);
});

test('two genuinely distinct routes: safe route is shorter and reward-free', () => {
  for (let seed = 0; seed < 8; seed++) {
    const lvl = generate({ size: 10, nodeTypes: OFF_NT, seed, routePlan: OFF.generation });
    if (!lvl.primaryRoute || !lvl.safeRoute) continue;
    assert(lvl.safeRoute.length < lvl.primaryRoute.length, 'safe route shorter than primary');
    const safeHasValuable = lvl.safeRoute.some((c) => {
      const k = lvl.cells[c.y][c.x];
      return OFF.skills[k]; // a skill on the safe route would defeat the choice
    });
    assert(!safeHasValuable, 'safe route carries no skill nodes');
  }
});

test('reproducible: same seed + routePlan => identical board', () => {
  const a = generate({ size: 9, nodeTypes: OFF_NT, seed: 4242, routePlan: OFF.generation });
  const b = generate({ size: 9, nodeTypes: OFF_NT, seed: 4242, routePlan: OFF.generation });
  assert(JSON.stringify(a.cells) === JSON.stringify(b.cells), 'cells identical for same seed');
});

test('over-constrained 4x4 still returns a solvable board (graceful fallback)', () => {
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    for (let seed = 0; seed < 4; seed++) {
      const lvl = generate({ size: 4, nodeTypes: OFF_NT, seed, routePlan: OFF.generation });
      assert(findAnyPath(lvl, OFF_NT, lvl.moveBudget) !== null, `4x4 seed ${seed} still solvable`);
    }
  } finally {
    console.warn = orig;
  }
  // not asserting a warning fires every time, but it must never throw/hang.
  assert(true, 'no crash on tiny over-constrained grids');
});
