// =============================================================================
//  main.js — BOOT: wire config → state → bridge → render → panels → input
// =============================================================================
//  Three-pane UI: left rail (config/status), center (boards + Resolve button),
//  right (TRS puzzle overlay), bottom (phase-aware info bar).
//
//  Render ON DEMAND (after a click / puzzle solve / resolve), never every frame —
//  rebuilding the board innerHTML continuously would destroy the element under the
//  cursor mid-click and swallow clicks.
//
//  Flows:
//   ATTACK build  — click your weapon → solve TRS → click an enemy part to apply the
//                   status (valid only) → repeat → Resolve → click the enemy Focus.
//   DEFENSE build — click your part → solve TRS → click the part to protect → repeat
//                   → Resolve (enemy strikes your pre-loaded defenses).
// =============================================================================

import config from './config/game.json';
import { createState, PHASES } from './core/state.js';
import { startAttackBuild, commitAttack, commitDefense } from './core/phases.js';
import { finalizeAttackTarget } from './combat/attack.js';
import { finalizeDefenseTarget } from './combat/defense.js';
import { createBridge } from './puzzle/bridge.js';
import { createRenderer } from './view/render.js';
import { createConfigPanel } from './view/configPanel.js';
import { createInfoBar } from './view/infoBar.js';
import { createTooltip } from './view/tooltip.js';
import { createComboPanel } from './view/comboInfo.js';
import { ATTACK_EFFECT, DEFENSE_VERB, isAlive, isEffectValidOn } from './core/components.js';
import { t, onLocaleChange } from './i18n/index.js';

const app = { state: createState(config), started: false };
app.state.phase = PHASES.CONFIG;
const getState = () => app.state;

const centerEl = document.getElementById('center');
const enemyEl = document.getElementById('enemy-wrap');
const playerEl = document.getElementById('player-wrap');
const overlayEl = document.getElementById('puzzle-overlay');
const leftEl = document.getElementById('left');
const infoEl = document.getElementById('infobar');
const controlsEl = document.getElementById('controls');

const bridge = createBridge({ getState, overlayEl, onChange: () => draw() });
const renderer = createRenderer(centerEl, { enemy: enemyEl, player: playerEl }, onComponentClick, onBreak);
const tooltip = createTooltip(centerEl, getState);
const comboPanel = createComboPanel(document.getElementById('combo-panel'), getState);
const infobar = createInfoBar(infoEl);
const panel = createConfigPanel(leftEl, { onStart, onRestart, defaults: config.ui, archetypes: config.archetypes });
panel.showConfig();

// Language change → re-render the whole UI (every view reads text at render time).
document.title = t('ui.pageTitle');
onLocaleChange(() => { document.title = t('ui.pageTitle'); panel.rebuild(); draw(); });

function onComponentClick(side, id, eid) {
  const s = app.state;
  if (!app.started || s.activePuzzle) return;
  const enemy = (side === 'enemy' && eid != null) ? s.enemies[eid] : null;
  const enemyLives = enemy && isAlive(enemy.components.core);

  if (s.phase === PHASES.ATTACK_BUILD) {
    if (s.pendingAction) {                                   // step ②: apply status to an enemy part
      if (enemyLives && isAlive(enemy.components[id]) && isEffectValidOn(s.pendingAction.effect, id)) finalizeAttackTarget(s, eid, id);
    } else if (s.pickFocus) {                                // resolve: pick the firepower Focus
      if (enemyLives && isAlive(enemy.components[id])) commitAttack(s, eid, id);
    } else if (side === 'player' && ATTACK_EFFECT[id]) {     // step ①: play a weapon's TRS
      bridge.open(id);
    }
  } else if (s.phase === PHASES.DEFENSE_BUILD && side === 'player') {
    if (s.pendingDefense) {                                  // step ②: choose the part to protect
      if (isAlive(s.player.components[id])) finalizeDefenseTarget(s, id);
    } else if (DEFENSE_VERB[id]) {                           // step ①: play a part's TRS
      bridge.open(id);
    }
  }
  draw();
}

// Insert a chain break on a component (can't be first / can't double — enforced here).
function onBreak(side, id, eid) {
  const s = app.state;
  if (!app.started || s.activePuzzle) return;
  const mine = s.queue.filter((x) => (side === 'enemy'
    ? (x.target && x.target.eid === Number(eid) && x.target.component === id)
    : (x.target === id)));
  if (!mine.length || mine[mine.length - 1].brk) return; // not first, not two in a row
  s.queue.push({ brk: true, target: side === 'enemy' ? { eid: Number(eid), component: id } : id });
  draw();
}

function onStart(ui) {
  app.state = createState(config, ui);
  startAttackBuild(app.state);
  app.started = true;
  panel.showStatus();
  draw();
}

function onRestart() {
  bridge.abort();
  app.state = createState(config);
  app.state.phase = PHASES.CONFIG;
  app.started = false;
  panel.showConfig();
  draw();
}

function renderControls() {
  const s = app.state;
  let html = '';
  if (app.started && !s.activePuzzle) {
    if (s.phase === PHASES.ATTACK_BUILD) {
      if (s.pendingAction) html = `<span class="hint">${t('ui.hintApply')}</span>`;
      else if (s.pickFocus) html = `<button id="cancel">${t('ui.cancel')}</button> <span class="hint">${t('ui.hintFocus')}</span>`;
      else html = `<button id="resolve">${t('ui.resolveAttack')}</button>`;
    } else if (s.phase === PHASES.DEFENSE_BUILD) {
      if (s.pendingDefense) html = `<span class="hint">${t('ui.hintProtect')}</span>`;
      else html = `<button id="resolve">${t('ui.resolveDefense')}</button>`;
    }
  }
  controlsEl.innerHTML = html;
  const resolve = document.getElementById('resolve');
  if (resolve) resolve.onclick = () => {
    const st = app.state;
    if (st.phase === PHASES.ATTACK_BUILD) st.pickFocus = true;       // enter Focus-pick; enemy click commits
    else if (st.phase === PHASES.DEFENSE_BUILD) commitDefense(st);
    draw();
  };
  const cancel = document.getElementById('cancel');
  if (cancel) cancel.onclick = () => { app.state.pickFocus = false; draw(); };
}

function draw() {
  renderer(app.state);
  if (app.started) panel.update(app.state);
  infobar(app.state);
  comboPanel(app.state);
  renderControls();
  // While a puzzle is open: hide the boards (full-column puzzle) and dismiss the hover
  // dossier (on touch it lingers after the tap and would block the puzzle).
  const puzzleOpen = !!app.state.activePuzzle;
  centerEl.classList.toggle('puzzle-open', puzzleOpen);
  if (puzzleOpen) tooltip.hide();
}

draw(); // initial paint (config screen)

window.__strategy = {
  get state() { return app.state; },
  bridge,
  start: (ui) => onStart(ui || config.ui),
  restart: onRestart,
  redraw: draw,
  commitAttack: (eid, focusId) => { commitAttack(app.state, eid, focusId); draw(); },
  commitDefense: () => { commitDefense(app.state); draw(); },
  solveActivePuzzle() {
    const ap = app.state.activePuzzle;
    if (!ap) return false;
    const g = ap.instance;
    const route = g.level.primaryRoute || [g.level.start, g.level.goal];
    g.reset(); g.tryBegin(route[0]);
    for (let i = 1; i < route.length; i++) g.tryMoveTo(route[i]);
    g.endDrag();
    return true;
  },
};
