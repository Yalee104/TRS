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
// Each type can carry an `icon` (its sprite glyph) and an `effectKind`
// ('buff' | 'debuff' | 'skill' | 'danger') that tints the pass animation.
// `skills` is just an array the host defines — add as many skill nodes as you
// like (here: Freeze / Confuse / Drain / Chain / Multihack).
const nodeTypes = {
  start:   { role: 'start',  passable: true,  color: '#eef2f7', icon: '🚀', label: 'Start' },
  goal:    { role: 'goal',   passable: true,  color: '#2fae62', icon: '🏁', label: 'Goal' },
  normal:  { role: 'normal', passable: true,  color: '#39404e' },

  dmg:     { role: 'normal', passable: true,  color: '#3a7bd0', icon: '⚔️', label: '+DMG', effectKind: 'buff',  onPass: (s) => { s.multiplier += 0.5; } },
  upgrade: { role: 'normal', passable: true,  color: '#9b59b6', icon: '⭐', label: '×1.25', effectKind: 'buff', onPass: (s) => { s.multiplier *= 1.25; } },

  freeze:    { role: 'normal', passable: true, color: '#56c5e6', icon: '❄️', label: 'Freeze',    effectKind: 'skill', onPass: (s) => { s.skills.push('Freeze'); } },
  confuse:   { role: 'normal', passable: true, color: '#c58cff', icon: '🌀', label: 'Confuse',   effectKind: 'skill', onPass: (s) => { s.skills.push('Confuse'); } },
  drain:     { role: 'normal', passable: true, color: '#7fd66b', icon: '🩸', label: 'Drain',     effectKind: 'skill', onPass: (s) => { s.skills.push('Drain'); } },
  chain:     { role: 'normal', passable: true, color: '#e6a24a', icon: '🔗', label: 'Chain',     effectKind: 'skill', onPass: (s) => { s.skills.push('Chain'); } },
  multihack: { role: 'normal', passable: true, color: '#ff9f43', icon: '💥', label: 'Multihack', effectKind: 'skill', onPass: (s) => { s.skills.push('Multihack'); } },

  penalty: { role: 'normal', passable: true,  color: '#aa8855', icon: '➖', label: '-MULT', effectKind: 'debuff', onPass: (s) => { s.multiplier = Math.max(0, s.multiplier - 0.5); } },
  trap:    { role: 'normal', passable: true,  color: '#d04a4a', icon: '☠️', label: 'Trap',  effectKind: 'danger', failsOnPass: true, onPass: (s) => { s.fail = true; } },
  blocker: { role: 'normal', passable: false, color: '#2a2e39', icon: '⛔' },
};
const weights = { normal: 5, dmg: 3, upgrade: 1, freeze: 1.4, confuse: 1.4, drain: 1.4, chain: 1.4, multihack: 1, penalty: 2, trap: 1.2, blocker: 3 };

// A hand-authored level (the safe route runs along the top row, then down the
// right column — so it's solvable; the generator-blocked detours add the risk).
const authoredLevel = {
  grid: [
    ['start',   'dmg',     'normal', 'normal', 'normal',  'upgrade'],
    ['normal',  'trap',    'blocker', 'trap',  'blocker', 'normal'],
    ['dmg',     'normal',  'freeze', 'normal', 'confuse', 'normal'],
    ['normal',  'blocker', 'normal', 'trap',   'normal',  'dmg'],
    ['chain',   'normal',  'dmg',    'normal', 'penalty', 'normal'],
    ['normal',  'drain',   'normal', 'normal', 'multihack', 'goal'],
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
  .map(([k, d]) => `<span><i class="sw" style="background:${d.color}"></i>${d.icon ? d.icon + ' ' : ''}${d.label || k}</span>`)
  .join('');

resetHud();
