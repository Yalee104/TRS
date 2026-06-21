// Objective-gate tests — the optional "must chain >= N payloads to solve" rule.
// Same DOM-stub approach as lifecycle.test.mjs; drives an AUTHORED level with
// known payload positions so counts are deterministic.
import { test, assert } from './harness.mjs';

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

const NT = {
  start: { role: 'start', passable: true, color: '#fff' },
  goal: { role: 'goal', passable: true, color: '#3a0' },
  normal: { role: 'normal', passable: true, color: '#345' },
  p: { role: 'normal', passable: true, color: '#5cf', icon: '❄️' }, // the "payload"
};
// 5x5; payloads sit on the top row between START and GOAL, with open rows below
// so a bypass crossing zero payloads also reaches the goal.
const GRID = [
  ['start', 'p', 'p', 'p', 'goal'],
  ['normal', 'normal', 'normal', 'normal', 'normal'],
  ['normal', 'normal', 'normal', 'normal', 'normal'],
  ['normal', 'normal', 'normal', 'normal', 'normal'],
  ['normal', 'normal', 'normal', 'normal', 'normal'],
];
const make = (opts) => new GridPathPuzzle({ mount: mkEl(), nodeTypes: NT, level: { grid: GRID.map((r) => r.slice()) }, ...opts });
const C = (x, y) => ({ x, y });
function drive(g, cells) { g.tryBegin(cells[0]); for (let i = 1; i < cells.length; i++) g.tryMoveTo(cells[i]); }

const TOP = [C(0, 0), C(1, 0), C(2, 0), C(3, 0), C(4, 0)];                   // crosses 3 payloads, ends at GOAL
const ONE = [C(0, 0), C(1, 0), C(1, 1), C(2, 1), C(3, 1), C(4, 1), C(4, 0)]; // crosses 1 payload
const NONE = [C(0, 0), C(0, 1), C(1, 1), C(2, 1), C(3, 1), C(4, 1), C(4, 0)]; // crosses 0 payloads

test('objective off (default): reaching the goal commits, no objective in state', () => {
  let done = false;
  const g = make({ onComplete: () => { done = true; } });
  drive(g, NONE);
  g.endDrag();
  assert(done === true, 'completes on reaching goal with no objective');
  assert(g.getState().objective === null, 'no objective block in state');
});

test('objective: reaching the goal UNDER the minimum is BLOCKED (not fail, not commit)', () => {
  let done = false, failed = false, blocked = null;
  const g = make({ objective: { type: 'p', min: 2 }, onComplete: () => { done = true; }, onFail: () => { failed = true; }, onObjectiveBlocked: (i) => { blocked = i; } });
  drive(g, ONE); // crosses 1 payload
  g.endDrag();
  assert(!done && !failed, 'neither completed nor failed');
  assert(g.state.status === 'drawing', 'still drawing — the path is preserved');
  assert(blocked && blocked.have === 1 && blocked.need === 2 && blocked.missing === 1, `objectiveBlocked payload (got ${JSON.stringify(blocked)})`);
  g.destroy();
});

test('objective: reaching the goal AT/OVER the minimum commits', () => {
  let done = false;
  const g = make({ objective: { type: 'p', min: 2 }, onComplete: () => { done = true; } });
  drive(g, TOP); // crosses 3 >= 2
  g.endDrag();
  assert(done === true, 'commits when chained >= min');
});

test('objective: exactly the minimum commits (boundary)', () => {
  let done = false;
  const g = make({ objective: { type: 'p', min: 3 }, onComplete: () => { done = true; } });
  drive(g, TOP); // exactly 3
  g.endDrag();
  assert(done === true, 'have === min commits');
});

test('objective: execute() respects the gate', () => {
  let blockedDone = 0;
  const g = make({ objective: { type: 'p', min: 2 }, onComplete: () => { blockedDone++; } });
  drive(g, ONE);
  g.execute();
  assert(blockedDone === 0, 'execute() blocked under the minimum');
  g.destroy();

  let metDone = 0;
  const g2 = make({ objective: { type: 'p', min: 2 }, onComplete: () => { metDone++; } });
  drive(g2, TOP);
  g2.execute();
  assert(metDone === 1, 'execute() commits when the minimum is met');
});

test('objective: backtracking below the minimum re-locks', () => {
  let last = null;
  const g = make({ objective: { type: 'p', min: 2 }, onObjectiveProgress: (i) => { last = i; } });
  drive(g, [C(0, 0), C(1, 0), C(2, 0)]); // cross 2 -> met
  assert(g.getState().objective.met === true, 'met after crossing 2');
  g.tryMoveTo(C(1, 0)); // backtrack onto an earlier cell -> path [start,(1,0)] -> 1 payload
  const st = g.getState().objective;
  assert(st.have === 1 && st.met === false, `re-locked after backtrack (got ${JSON.stringify(st)})`);
  assert(last && last.met === false, 'objectiveProgress reported met:false');
});

test('objectiveProgress fires with the running count', () => {
  const haves = [];
  const g = make({ objective: { type: 'p', min: 3 }, onObjectiveProgress: (i) => { haves.push(i.have); } });
  drive(g, [C(0, 0), C(1, 0), C(2, 0), C(3, 0)]); // 1,2,3
  assert(haves[haves.length - 1] === 3, 'final progress have=3');
  assert(haves.includes(1) && haves.includes(2), 'reported intermediate counts');
});

test('reset() drives the objective count back to 0', () => {
  const g = make({ objective: { type: 'p', min: 3 } });
  drive(g, [C(0, 0), C(1, 0), C(2, 0)]);
  assert(g.getState().objective.have === 2, 'counted 2 before reset');
  g.reset();
  const st = g.getState().objective;
  assert(st.have === 0 && st.met === false, 'reset to 0 / not met');
});

test('objective min<=0 normalizes to off', () => {
  let done = false;
  const g = make({ objective: { type: 'p', min: 0 }, onComplete: () => { done = true; } });
  assert(g.getState().objective === null, 'min:0 -> off');
  drive(g, NONE);
  g.endDrag();
  assert(done === true, 'commits normally when off');
});
