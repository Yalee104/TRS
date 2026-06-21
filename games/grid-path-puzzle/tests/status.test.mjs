// Status-effect tests. Phase 1: BURNING (a second off-route hazard at its own
// density, distinct from the existing trap). Later phases append here.
import { test, assert } from './harness.mjs';
import { buildPalette, catalogFromConfig } from '../presets/trs.js';
import { generate, findAnyPath } from '../module/core/generator.js';

function build(knobs) {
  const pal = buildPalette({ phase: 'attack', component: 'weapon', preset: 'baseline', knobs: {
    cluster: false, count: { min: 3, max: 5 }, blockerDensity: 0.2, trapDensity: 0,
    primaryLengthTarget: 'long', channeling: 'strong', alternateRoutes: 1, ...knobs } });
  return { pal, nt: catalogFromConfig(pal) };
}
function tally(level) { const t = {}; for (const row of level.cells) for (const k of row) t[k] = (t[k] || 0) + 1; return t; }

test('burning: placed off-route at its density, board still solvable', () => {
  let withBurn = 0;
  for (let seed = 0; seed < 10; seed++) {
    const { pal, nt } = build({ burningDensity: 0.7 });
    const lvl = generate({ size: 8, nodeTypes: nt, seed, routePlan: pal.generation });
    assert(findAnyPath(lvl, nt, lvl.moveBudget) !== null, `solvable seed ${seed}`);
    if ((tally(lvl).burning || 0) > 0) withBurn++;
    // routes carry no hazards
    for (const c of lvl.primaryRoute || []) assert(lvl.cells[c.y][c.x] !== 'burning', 'no burning on primary route');
    for (const c of lvl.safeRoute || []) assert(lvl.cells[c.y][c.x] !== 'burning', 'no burning on safe route');
  }
  assert(withBurn >= 8, `most boards carry burning at density 0.7 (got ${withBurn}/10)`);
});

test('burning: trap and burning coexist as distinct hazards', () => {
  const { pal, nt } = build({ burningDensity: 0.4, trapDensity: 0.4 });
  let sawTrap = false, sawBurn = false;
  for (let seed = 0; seed < 12; seed++) {
    const lvl = generate({ size: 9, nodeTypes: nt, seed, routePlan: pal.generation });
    const t = tally(lvl);
    if ((t.trap || 0) > 0) sawTrap = true;
    if ((t.burning || 0) > 0) sawBurn = true;
  }
  assert(sawTrap && sawBurn, `both trap and burning appear (trap=${sawTrap} burn=${sawBurn})`);
});

test('burning: density 0 (off) places none', () => {
  for (let seed = 0; seed < 8; seed++) {
    const { pal, nt } = build({ burningDensity: 0 });
    const lvl = generate({ size: 8, nodeTypes: nt, seed, routePlan: pal.generation });
    assert((tally(lvl).burning || 0) === 0, `no burning when density 0 (seed ${seed})`);
  }
});
