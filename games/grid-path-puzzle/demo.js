// =============================================================================
//  demo.js  —  a host that USES the grid-path-puzzle module
// =============================================================================
//
//  This file is the "developer who embeds the module" side. It does three jobs:
//   1. Defines a nodeTypes catalog — what each node MEANS in THIS game.
//   2. Mounts a GridPathPuzzle and wires the controls (size/difficulty/seed...).
//   3. Reacts to the module's events to draw a live HUD + result.
//
//  Note: nothing in module/ knows about any of this. The module just emits
//  events and runs the onPass callbacks we define below.
// =============================================================================

import { GridPathPuzzle } from './module/GridPathPuzzle.js';

// --- 1. The node catalog (host-owned meaning) --------------------------------
const nodeTypes = {
  start:       { role: 'start',  passable: true,  color: '#f2f2f2', label: 'START' },
  goal:        { role: 'goal',   passable: true,  color: '#3ad07a', label: 'EXE' },
  normal:      { role: 'normal', passable: true,  color: '#39404e' },
  blue:        { role: 'normal', passable: true,  color: '#3a7bd0', label: '+DMG',  onPass: (s) => { s.multiplier += 0.5; } },
  yellow:      { role: 'normal', passable: true,  color: '#e6c84a', label: 'Freeze', onPass: (s) => { s.skills.push('Freeze'); } },
  purple:      { role: 'normal', passable: true,  color: '#9b59b6', label: 'UP',     onPass: (s) => { s.multiplier *= 1.25; } },
  trapPenalty: { role: 'normal', passable: true,  color: '#aa8855', label: '-MULT', onPass: (s) => { s.multiplier = Math.max(0, s.multiplier - 0.5); } },
  trap:        { role: 'normal', passable: true,  color: '#d04a4a', label: 'TRAP', failsOnPass: true, onPass: (s) => { s.fail = true; } },
  blocker:     { role: 'normal', passable: false, color: '#2a2e39' },
};
const weights = { normal: 4, blue: 3, yellow: 2, purple: 1, trapPenalty: 2, trap: 1, blocker: 3 };

// A hand-authored level to show the "authored" path (vs. the generator).
const authoredLevel = {
  grid: [
    ['start', 'blue',  'normal', 'blocker', 'normal', 'purple'],
    ['normal', 'trap', 'blue',   'normal',  'trap',   'normal'],
    ['blue',  'normal', 'yellow', 'blocker', 'blue',  'normal'],
    ['normal', 'blocker', 'normal', 'normal', 'trapPenalty', 'blue'],
    ['yellow', 'normal', 'trap',  'blue',    'normal', 'normal'],
    ['normal', 'blue',  'normal', 'normal',  'yellow', 'goal'],
  ],
  start: { x: 0, y: 0 },
  goal: { x: 5, y: 5 },
  moveBudget: 16,
};

// --- 2. Mount the game -------------------------------------------------------
const $ = (id) => document.getElementById(id);
const board = $('board');

const game = new GridPathPuzzle({
  mount: board,
  nodeTypes,
  generate: { size: 8, difficulty: 0.5, seed: 1, weights },
  trapEntryMode: 'commitFail',
  onPathChange: updateHud,
  onComplete: onComplete,
  onFail: onFail,
  onTick: onTick,
});
window.__puzzle = game; // live tinkering in DevTools

// --- 3. HUD + event reactions ------------------------------------------------
function updateHud(info) {
  $('mult').textContent = `×${info.previewRunState.multiplier.toFixed(2)}`;
  $('skills').textContent = info.previewRunState.skills.length ? info.previewRunState.skills.join(' → ') : '—';
  $('steps').textContent = `${info.steps} / ${info.budget.max ?? '∞'}`;
  const reach = $('reach');
  reach.textContent = info.canReachGoal ? 'yes' : 'no';
  reach.className = info.canReachGoal ? 'stat' : 'stat warn';
  $('result').textContent = '';
  $('result').className = '';
}

function onComplete(result) {
  const el = $('result');
  el.className = 'win';
  el.innerHTML = `✅ Reached goal! Final <b>×${result.runState.multiplier.toFixed(2)}</b>`
    + (result.runState.skills.length ? ` · ${result.runState.skills.join(' → ')}` : '');
}

function onFail(info) {
  const el = $('result');
  el.className = 'lose';
  el.textContent = info.reason === 'timeout' ? '⏱ Time up — failed!'
    : info.reason === 'trap' ? '💥 Hit a trap — failed!' : '❌ Failed.';
}

function onTick(info) {
  $('time').textContent = info.limitMs == null
    ? `${(info.elapsedMs / 1000).toFixed(1)}s`
    : `${(info.remainingMs / 1000).toFixed(1)}s left`;
}

// --- the level/options controls ---------------------------------------------
function readGenerateOpts() {
  const budget = $('budget').value === '' ? null : Number($('budget').value);
  const timelimitS = $('timelimit').value === '' ? null : Number($('timelimit').value);
  return {
    size: Number($('size').value),
    difficulty: Number($('diff').value),
    seed: Number($('seed').value),
    moveBudget: budget,
    timeLimitMs: timelimitS == null ? null : timelimitS * 1000,
    weights,
  };
}

$('size').addEventListener('input', (e) => { $('sizeVal').textContent = e.target.value; $('sizeVal2').textContent = e.target.value; });
$('diff').addEventListener('input', (e) => { $('diffVal').textContent = e.target.value; });
$('trapmode').addEventListener('change', (e) => { game.options.trapEntryMode = e.target.value; });

$('generate').addEventListener('click', () => { game.loadLevel(readGenerateOpts()); resetHud(); });
$('authored').addEventListener('click', () => { game.loadLevel(authoredLevel); resetHud(); });
$('reset').addEventListener('click', () => { game.reset(); resetHud(); });
$('execute').addEventListener('click', () => game.execute());

function resetHud() {
  $('mult').textContent = '×1.00';
  $('skills').textContent = '—';
  $('time').textContent = '—';
  $('reach').textContent = 'yes';
  $('reach').className = 'stat';
  $('result').textContent = '';
  $('result').className = '';
  const st = game.getState();
  $('steps').textContent = `0 / ${st.level.moveBudget ?? '∞'}`;
}

// --- legend ------------------------------------------------------------------
$('legend').innerHTML = Object.entries(nodeTypes)
  .map(([k, d]) => `<span><i class="sw" style="background:${d.color}"></i>${d.label || k}</span>`)
  .join('');

resetHud();
