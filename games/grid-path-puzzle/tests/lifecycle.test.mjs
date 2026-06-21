// Facade lifecycle tests — the pre-start "GO" pause (countdownMs / flashStart).
// The facade needs a DOM; we install a tiny stub (enough for construction + the
// timer/input gate) BEFORE importing GridPathPuzzle.
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
// no requestAnimationFrame in node → the rAF loop is simply skipped (start() guards on it).

const { GridPathPuzzle } = await import('../module/GridPathPuzzle.js');

const NT = {
  start: { role: 'start', passable: true, color: '#fff' },
  goal: { role: 'goal', passable: true, color: '#3a0' },
  normal: { role: 'normal', passable: true, color: '#345' },
  blocker: { role: 'normal', passable: false, color: '#222' },
};
const make = (opts) => new GridPathPuzzle({ mount: mkEl(), nodeTypes: NT, generate: { size: 6, seed: 1 }, ...opts });

test('countdownMs:0 (default) starts the timer immediately, no "ready" state', () => {
  const g = make({ countdownMs: 0 });
  g.start();
  assert(g.state.status !== 'ready', 'never enters ready');
  assert(g._timerRunning === true, 'timer running immediately (backward-compatible)');
});

test('countdownMs>0 holds in "ready": timer paused + input blocked', () => {
  const g = make({ countdownMs: 1000, flashStart: true });
  g.start();
  assert(g.state.status === 'ready', 'enters ready during the GO pause');
  assert(g._timerRunning === false, 'timer not running yet');
  assert(g.tryBegin({ x: g.level.start.x, y: g.level.start.y }) === false, 'drawing is blocked during the pause');
});

test('after the GO pause the timer runs and the grid is interactive', () => {
  const g = make({ countdownMs: 1000 });
  g.start();
  g._beginAfterCountdown(); // simulate the countdown elapsing
  assert(g.state.status === 'idle' && g._timerRunning === true, 'timer running, status idle');
  assert(g.tryBegin({ x: g.level.start.x, y: g.level.start.y }) === true, 'drawing now allowed');
});

test('reset() clears a pending countdown', () => {
  const g = make({ countdownMs: 1000 });
  g.start();
  assert(g._countdownTimer != null, 'countdown pending after start');
  g.reset();
  assert(g._countdownTimer == null && g.state.status === 'idle', 'reset cleared the countdown');
});
