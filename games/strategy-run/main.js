// =============================================================================
//  strategy-run/main.js — BOOT for "TRS Run" (the roguelike meta-layer)
// =============================================================================
//  A thin orchestration shell over the SHARED strategy engine (../strategy/...).
//  It only adds the run flow on top of the per-battle engine:
//     loadout picker → battle → reward → next battle … → run won / run over.
//
//  The run object (../strategy/core/run.js) owns ownership + installed mods +
//  persistent HP; each battle is a normal createState() fed an effective config
//  plus an ownership/HP post-step. Battle rendering, the bridge, the info bar and
//  the combo panel are all reused unchanged from the strategy game.
// =============================================================================

import config from '../strategy/config/game.json';
import { createState, PHASES } from '../strategy/core/state.js';
import { startAttackBuild, commitAttack, commitDefense } from '../strategy/core/phases.js';
import { finalizeAttackTarget } from '../strategy/combat/attack.js';
import { finalizeDefenseTarget } from '../strategy/combat/defense.js';
import {
  createRun, effectiveConfig, buildBattleUi, applyOwnership, applyPersistentHp,
  captureBattleResult, advanceBattle, isFinalBattle, rollRewardOffer, applyRewardChoice,
} from '../strategy/core/run.js';
import { createBridge } from '../strategy/puzzle/bridge.js';
import { createRenderer } from '../strategy/view/render.js';
import { createConfigPanel } from '../strategy/view/configPanel.js';
import { createLoadoutPicker } from '../strategy/view/loadoutPicker.js';
import { createRewardScreen } from '../strategy/view/rewardScreen.js';
import { createInfoBar } from '../strategy/view/infoBar.js';
import { createTooltip } from '../strategy/view/tooltip.js';
import { createComboPanel } from '../strategy/view/comboInfo.js';
import { ATTACK_EFFECT, DEFENSE_VERB, isAlive, isOwned, isEffectValidOn } from '../strategy/core/components.js';
import { t, onLocaleChange } from '../strategy/i18n/index.js';

const app = { state: createState(config), run: null, started: false };
app.state.phase = PHASES.CONFIG;
const getState = () => app.state;

const centerEl = document.getElementById('center');
const enemyEl = document.getElementById('enemy-wrap');
const playerEl = document.getElementById('player-wrap');
const overlayEl = document.getElementById('puzzle-overlay');
const leftEl = document.getElementById('left');
const infoEl = document.getElementById('infobar');
const controlsEl = document.getElementById('controls');
const runScreenEl = document.getElementById('run-screen');

const bridge = createBridge({ getState, overlayEl, onChange: () => draw() });
const renderer = createRenderer(centerEl, { enemy: enemyEl, player: playerEl }, onComponentClick, onBreak);
const tooltip = createTooltip(centerEl, getState);
const comboPanel = createComboPanel(document.getElementById('combo-panel'), getState);
const infobar = createInfoBar(infoEl);
const panel = createConfigPanel(leftEl, { onNewRun, defaults: config.ui, archetypes: config.archetypes, config });
const loadout = createLoadoutPicker(runScreenEl, { config, onBegin: onBeginRun });
const reward = createRewardScreen(runScreenEl, { onPick: onPickReward });
panel.showRunSetup();

// Language change → re-render the whole UI (every view reads text at render time).
document.title = t('run.title');
onLocaleChange(() => { document.title = t('run.title'); panel.rebuild(); draw(); });

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
    } else if (side === 'player' && ATTACK_EFFECT[id] && isOwned(s.player.components[id])) { // step ①: play a weapon's TRS
      bridge.open(id);
    }
  } else if (s.phase === PHASES.DEFENSE_BUILD && side === 'player') {
    if (s.pendingDefense) {                                  // step ②: choose the part to protect
      if (isAlive(s.player.components[id])) finalizeDefenseTarget(s, id);
    } else if (DEFENSE_VERB[id] && isOwned(s.player.components[id])) { // step ①: play a part's TRS
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

function onBeginRun({ components, loadout: loadoutKey, seed }) {
  app.run = createRun(config, { components, loadout: loadoutKey, seed });
  startBattle();
  draw();
}

function onPickReward(choice) {
  const r = app.run;
  if (!r) return;
  applyRewardChoice(r, choice);
  advanceBattle(r);
  startBattle();
  draw();
}

function onNewRun() {
  bridge.abort();
  app.run = null;
  app.started = false;
  app.state = createState(config);
  app.state.phase = PHASES.CONFIG;
  panel.showRunSetup();
  draw();
}

/** Start (or restart) the current battle of the run from the run's effective state. */
function startBattle() {
  const r = app.run;
  app.state = createState(effectiveConfig(r), buildBattleUi(r, config.ui));
  applyOwnership(app.state, r);
  applyPersistentHp(app.state, r);
  startAttackBuild(app.state);
  r.status = 'inBattle';
  app.started = true;
  panel.setRun(r);
  panel.showRunStatus();
}

/** A battle just ended → fold the result into the run (reward / next / run-won / run-over). */
function maybeAdvanceRun() {
  const r = app.run;
  if (!r || r.status !== 'inBattle') return;
  const s = app.state;
  if (s.phase === PHASES.LOST) {
    r.status = 'lost';
  } else if (s.phase === PHASES.WON) {
    captureBattleResult(r, s);
    if (isFinalBattle(r)) r.status = 'won';
    else { rollRewardOffer(r); r.status = 'reward'; }
  }
}

/** Which centre screen is active right now. */
function currentScreen() {
  const r = app.run;
  if (!r) return 'loadout';
  if (r.status === 'reward') return 'reward';
  if (r.status === 'won') return 'runWon';
  if (r.status === 'lost') return 'runLost';
  return 'battle';
}

function renderRunOver(won) {
  runScreenEl.innerHTML = `
    <div class="rs-wrap" style="text-align:center">
      <h2 class="rs-title">${won ? t('run.won') : t('run.lost')}</h2>
      <p class="rs-sub">${won ? t('run.wonDesc') : t('run.lostDesc')}</p>
      <div class="rs-foot"><button class="rs-btn" id="rs-newrun">${t('run.newRun')}</button></div>
    </div>`;
  const b = runScreenEl.querySelector('#rs-newrun');
  if (b) b.onclick = () => onNewRun();
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
  maybeAdvanceRun();
  const screen = currentScreen();

  if (screen === 'loadout') loadout.render();
  else if (screen === 'reward') reward.render(app.run);
  else if (screen === 'runWon') renderRunOver(true);
  else if (screen === 'runLost') renderRunOver(false);
  centerEl.classList.toggle('screen-open', screen !== 'battle');

  if (screen === 'battle') {
    renderer(app.state);
    if (app.started) panel.update(app.state);
    infobar(app.state);
    comboPanel(app.state);
    renderControls();
  }

  const puzzleOpen = !!app.state.activePuzzle;
  centerEl.classList.toggle('puzzle-open', puzzleOpen);
  if (puzzleOpen) tooltip.hide();
}

draw(); // initial paint (loadout picker)

window.__strategyRun = {
  get state() { return app.state; },
  get run() { return app.run; },
  bridge,
  beginRun: (opts) => onBeginRun(opts || { components: config.run.loadouts.burst.components, loadout: 'burst', seed: 0 }),
  pickReward: (choice) => onPickReward(choice),
  newRun: onNewRun,
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
