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
    if ((tally(lvl).firehazard || 0) > 0) withBurn++;
    // routes carry no hazards
    for (const c of lvl.primaryRoute || []) assert(lvl.cells[c.y][c.x] !== 'firehazard', 'no burning on primary route');
    for (const c of lvl.safeRoute || []) assert(lvl.cells[c.y][c.x] !== 'firehazard', 'no burning on safe route');
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
    if ((t.firehazard || 0) > 0) sawBurn = true;
  }
  assert(sawTrap && sawBurn, `both trap and burning appear (trap=${sawTrap} burn=${sawBurn})`);
});

test('burning: density 0 (off) places none', () => {
  for (let seed = 0; seed < 8; seed++) {
    const { pal, nt } = build({ burningDensity: 0 });
    const lvl = generate({ size: 8, nodeTypes: nt, seed, routePlan: pal.generation });
    assert((tally(lvl).firehazard || 0) === 0, `no burning when density 0 (seed ${seed})`);
  }
});

// ---- runtime modifiers (facade + DOM stub) ---------------------------------
const mkEl = () => {
  const cls = new Set();
  return {
    className: '', dataset: {}, style: { setProperty() {} }, hidden: false, textContent: '', title: '',
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => { on ? cls.add(c) : cls.delete(c); }, contains: (c) => cls.has(c) },
    appendChild() { return this; }, remove() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, get offsetWidth() { return 0; },
  };
};
globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} };
globalThis.document = globalThis.document || { createElement: mkEl, createElementNS: mkEl, head: mkEl(), elementFromPoint() { return null; } };
const { GridPathPuzzle } = await import('../module/GridPathPuzzle.js');

const NT2 = {
  start: { role: 'start', passable: true, color: '#fff' },
  goal: { role: 'goal', passable: true, color: '#3a0' },
  normal: { role: 'normal', passable: true, color: '#345' },
  p: { role: 'normal', passable: true, color: '#5cf', icon: '🩸' },
};
const GRID2 = [
  ['start', 'p', 'p', 'p', 'goal'],
  ['normal', 'normal', 'normal', 'normal', 'normal'],
  ['normal', 'normal', 'normal', 'normal', 'normal'],
  ['normal', 'normal', 'normal', 'normal', 'normal'],
  ['normal', 'normal', 'normal', 'normal', 'normal'],
];
const makeD = (opts) => new GridPathPuzzle({ mount: mkEl(), nodeTypes: NT2, level: { grid: GRID2.map((r) => r.slice()) }, countdownMs: 0, ...opts });

test('drain: timers rank closest-to-start first with base + step', () => {
  const g = makeD({ modifiers: { decay: { type: 'p', baseMs: 3000, stepMs: 250 } } });
  g.start();
  const exp = [...g._decayTimers.values()].map((t) => t.expiry).sort((a, b) => a - b);
  assert(exp.length === 3, `3 payload timers (got ${exp.length})`);
  assert(exp[0] === 3000 && exp[1] === 3250 && exp[2] === 3500, `expiries 3000/3250/3500 (got ${exp})`);
});

test('drain: crossing a payload secures it (timer stops)', () => {
  const g = makeD({ modifiers: { decay: { type: 'p', baseMs: 3000, stepMs: 250 } } });
  g.start();
  g.tryBegin({ x: 0, y: 0 });
  g.tryMoveTo({ x: 1, y: 0 }); // cross the closest payload
  assert(g._decayTimers.get('1,0').done === true, 'crossed payload is secured');
});

test('drain: an un-crossed payload vanishes after its timer', () => {
  let decayed = 0;
  const g = makeD({ modifiers: { decay: { type: 'p', baseMs: 3000, stepMs: 250 } }, onDecay: () => { decayed++; } });
  g.start();
  g.state.elapsedMs = 3001; // past the closest payload's expiry only
  g._tickDecay();
  assert(g.level.cells[0][1] !== 'p', 'closest payload drained to filler');
  assert(g.level.cells[0][2] === 'p' && g.level.cells[0][3] === 'p', 'farther payloads still present');
  assert(decayed === 1, 'onDecay fired once');
});

test('shatter: a step relocates an un-crossed payload to an empty neighbor', () => {
  let moved = 0;
  const g = new GridPathPuzzle({ mount: mkEl(), nodeTypes: NT2, level: { grid: GRID2.map((r) => r.slice()) }, countdownMs: 0, rng: () => 0, modifiers: { wander: { type: 'p', chance: 1 } }, onShatter: () => { moved++; } });
  g.tryBegin({ x: 0, y: 0 });
  g.tryMoveTo({ x: 0, y: 1 }); // one step down → triggers wander (rng()=0 < chance 1)
  assert(g.level.cells[0][1] === 'normal', 'payload (1,0) vacated');
  assert(g.level.cells[1][1] === 'p', 'payload moved to the empty neighbor (1,1)');
  assert(moved === 1, 'onShatter fired');
});

test('shatter: chance 0 (off) never moves a payload', () => {
  const g = new GridPathPuzzle({ mount: mkEl(), nodeTypes: NT2, level: { grid: GRID2.map((r) => r.slice()) }, countdownMs: 0, rng: () => 0, modifiers: { wander: { type: 'p', chance: 0 } } });
  g.tryBegin({ x: 0, y: 0 });
  g.tryMoveTo({ x: 0, y: 1 });
  assert(g.level.cells[0][1] === 'p' && g.level.cells[0][2] === 'p' && g.level.cells[0][3] === 'p', 'all payloads intact when off');
});

test('shatter: never lands a payload on the path or a non-empty cell', () => {
  // chance 1, deterministic: drive several steps and assert payload count is conserved
  const g = new GridPathPuzzle({ mount: mkEl(), nodeTypes: NT2, level: { grid: GRID2.map((r) => r.slice()) }, countdownMs: 0, rng: () => 0.0001, modifiers: { wander: { type: 'p', chance: 1 } } });
  g.tryBegin({ x: 0, y: 0 });
  g.tryMoveTo({ x: 0, y: 4 }); // walk down the left column (several steps)
  let count = 0;
  for (const row of g.level.cells) for (const k of row) if (k === 'p') count++;
  assert(count === 3, `payload count conserved (got ${count})`);
  for (const c of g.state.path) assert(g.level.cells[c.y][c.x] !== 'p', 'no payload sitting on the path');
});

test('confused: a confused step veers to a different safe neighbor', () => {
  const g = new GridPathPuzzle({ mount: mkEl(), nodeTypes: NT2, level: { grid: GRID2.map((r) => r.slice()) }, countdownMs: 0, rng: () => 0, modifiers: { confusion: 1 } });
  g.state.path = [{ x: 0, y: 0 }]; g.state.status = 'drawing';
  const step = g._stepToward({ x: 0, y: 0 }, { x: 4, y: 0 }); // intend to go right toward (1,0)
  assert(step && !(step.x === 1 && step.y === 0), `veered off the intended (1,0) (got ${JSON.stringify(step)})`);
  assert(step.x === 0 && step.y === 1, 'took the other safe neighbor (0,1)');
});

test('confused: never veers onto a hazard', () => {
  const NTH = { ...NT2, t: { role: 'normal', passable: true, icon: '☠️', failsOnPass: true } };
  const GH = [
    ['normal', 'normal', 'normal', 'normal', 'normal'],
    ['normal', 'normal', 't', 'normal', 'normal'],
    ['normal', 'normal', 'start', 'goal', 'normal'],
    ['normal', 'normal', 'normal', 'normal', 'normal'],
    ['normal', 'normal', 'normal', 'normal', 'normal'],
  ];
  const g = new GridPathPuzzle({ mount: mkEl(), nodeTypes: NTH, level: { grid: GH.map((r) => r.slice()) }, countdownMs: 0, rng: () => 0, modifiers: { confusion: 1 } });
  g.state.path = [{ x: 2, y: 2 }]; g.state.status = 'drawing';
  for (let i = 0; i < 10; i++) {
    const s = g._stepToward({ x: 2, y: 2 }, { x: 4, y: 2 });
    assert(!(s && s.x === 2 && s.y === 1), 'never steps onto the trap at (2,1)');
  }
});

test('freeze: dragging extends the icy preview, not the solid path', () => {
  const g = makeD({ modifiers: { slow: 0.5 } });
  g.start();
  g.tryBegin({ x: 0, y: 0 });
  g.tryMoveTo({ x: 3, y: 0 });
  assert(g._previewPath.length === 4, `preview reached 4 cells (got ${g._previewPath.length})`);
  assert(g.state.path.length === 1, `solid still at START (got ${g.state.path.length})`);
});

test('freeze: the solid fills along the preview at the frozen rate', () => {
  const g = makeD({ modifiers: { slow: 0.5 } }); // 6*0.5 = 3 cps => ~333 ms/cell
  g.start();
  g.tryBegin({ x: 0, y: 0 });
  g.tryMoveTo({ x: 3, y: 0 });
  g.state.elapsedMs = 400; g._advanceFreeze();
  assert(g.state.path.length === 2, `filled ~1 cell (got ${g.state.path.length})`);
  g.state.elapsedMs = 1000; g._advanceFreeze();
  assert(g.state.path.length === 4, `filled to the preview end (got ${g.state.path.length})`);
});

test('freeze: payloads count off the solid fill, not the preview', () => {
  const g = makeD({ modifiers: { slow: 0.5 }, objective: { type: 'p', min: 2 } });
  g.start();
  g.tryBegin({ x: 0, y: 0 });
  g.tryMoveTo({ x: 3, y: 0 }); // preview crosses 3 payloads
  assert(g.getState().objective.have === 0, 'nothing collected until the solid fills');
  g.state.elapsedMs = 1000; g._advanceFreeze();
  assert(g.getState().objective.have === 3, 'solid fill collected the payloads');
});

test('freeze: endDrag defers; commit happens when the slow fill reaches the goal', () => {
  let done = false;
  const g = makeD({ modifiers: { slow: 0.5 }, onComplete: () => { done = true; } });
  g.start();
  g.tryBegin({ x: 0, y: 0 });
  g.tryMoveTo({ x: 4, y: 0 }); // preview to the goal
  g.endDrag();
  assert(!done && g.state.status === 'drawing', 'not committed yet — fill still catching up');
  g.state.elapsedMs = 2000; g._advanceFreeze();
  assert(done === true, 'committed once the solid head reached the goal');
});

test('freeze: backtracking the preview trims a solid that ran ahead', () => {
  const g = makeD({ modifiers: { slow: 0.5 } });
  g.start();
  g.tryBegin({ x: 0, y: 0 });
  g.tryMoveTo({ x: 3, y: 0 });
  g.state.elapsedMs = 1000; g._advanceFreeze();
  assert(g.state.path.length === 4, 'solid caught up to (3,0)');
  g.tryMoveTo({ x: 1, y: 0 }); // backtrack the preview
  assert(g._previewPath.length === 2, 'preview trimmed to START,(1,0)');
  assert(g.state.path.length === 2, 'solid trimmed to match the shorter preview');
});

test('failFast: crossing a hazard fails immediately (no release needed)', () => {
  const NTH = { ...NT2, fz: { role: 'normal', passable: true, icon: '🔥', failsOnPass: true } };
  const GF = [
    ['start', 'fz', 'goal', 'normal', 'normal'],
    ['normal', 'normal', 'normal', 'normal', 'normal'],
    ['normal', 'normal', 'normal', 'normal', 'normal'],
    ['normal', 'normal', 'normal', 'normal', 'normal'],
    ['normal', 'normal', 'normal', 'normal', 'normal'],
  ];
  let failed = null;
  const g = new GridPathPuzzle({ mount: mkEl(), nodeTypes: NTH, level: { grid: GF.map((r) => r.slice()) }, countdownMs: 0, trapEntryMode: 'failFast', onFail: (i) => { failed = i; } });
  g.tryBegin({ x: 0, y: 0 });
  g.tryMoveTo({ x: 1, y: 0 }); // step onto the hazard — no endDrag
  assert(g.state.status === 'failed', 'failed immediately on crossing the hazard');
  assert(failed && failed.reason === 'trap', 'onFail fired with reason "trap"');
});

test('reset restores drained payloads (pristine board)', () => {
  const g = makeD({ modifiers: { decay: { type: 'p', baseMs: 1000, stepMs: 0 } } });
  g.start();
  g.state.elapsedMs = 2000; g._tickDecay(); // all 3 expire at 1000 → all drain
  let after = 0; for (const row of g.level.cells) for (const k of row) if (k === 'p') after++;
  assert(after === 0, `payloads drained (got ${after})`);
  g.reset();
  let restored = 0; for (const row of g.level.cells) for (const k of row) if (k === 'p') restored++;
  assert(restored === 3, `reset restored all 3 payloads (got ${restored})`);
});
