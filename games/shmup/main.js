// =============================================================================
//  main.js — BOOT: wire config → state → loop → systems → render → HUD → puzzle.
// =============================================================================
import config from './config/game.json';
import { createState } from './core/state.js';
import { stepSim } from './core/sim.js';
import { createLoop } from './core/loop.js';
import { createRenderer } from './render/renderer.js';
import { createBridge } from './puzzle/bridge.js';
import { createHud } from './ui/hud.js';
import OFFENSIVE from '../grid-path-puzzle/combo/configs/offensive.json';
import DEFENSIVE from '../grid-path-puzzle/combo/configs/defensive.json';

const canvas = document.getElementById('game');
canvas.width = config.canvas.w;
canvas.height = config.canvas.h;
const ctx = canvas.getContext('2d');

// `app.state` is a holder so Restart can swap the whole state while the loop runs.
const app = { state: createState(config) };
const getState = () => app.state;

const bridge = createBridge({
  getState,
  overlayEl: document.getElementById('puzzle-overlay'),
  configs: { offensive: OFFENSIVE, defensive: DEFENSIVE },
});
const drawScene = createRenderer(ctx);
const hud = createHud({
  bridge,
  onRestart: () => { bridge.abort(); app.state = createState(config); },
});

function render(state) {
  // if the encounter ended while a puzzle was open, close it (no cooldown)
  if ((state.phase === 'won' || state.phase === 'lost') && state.activePuzzle) bridge.abort();
  drawScene(state);
  hud(state);
}

const loop = createLoop({ getState, stepSim, render });

// --- input: L/R move (arrows or A/D); J/K also open the puzzles ---
const MOVE = { ArrowLeft: 'left', ArrowRight: 'right', KeyA: 'left', KeyD: 'right' };
window.addEventListener('keydown', (e) => {
  const k = MOVE[e.code];
  if (k) { app.state.player.input[k] = true; e.preventDefault(); }
  else if (e.code === 'KeyJ') bridge.openOffensive();
  else if (e.code === 'KeyK') bridge.openDefensive();
});
window.addEventListener('keyup', (e) => {
  const k = MOVE[e.code];
  if (k) app.state.player.input[k] = false;
});

// --- debug + test hook (mirrors the fighting game's window.__game) ---
window.__shmup = {
  get state() { return app.state; },
  bridge,
  restart() { bridge.abort(); app.state = createState(config); },
  // drive the open puzzle to completion along its intended route (used by tests)
  solveActivePuzzle() {
    const ap = app.state.activePuzzle;
    if (!ap) return false;
    const g = ap.instance;
    const route = g.level.primaryRoute || [g.level.start, g.level.goal];
    g.reset();
    g.tryBegin(route[0]);
    for (let i = 1; i < route.length; i++) g.tryMoveTo(route[i]);
    g.endDrag();
    return true;
  },
};

loop.start();
