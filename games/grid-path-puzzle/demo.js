// =============================================================================
//  demo.js  —  a host that USES the grid-path-puzzle module + ComboEngine
// =============================================================================
//
//  This is the "embedding game" side. It:
//   1. Loads an Offensive OR Defensive config (pure JSON data).
//   2. Builds the module's nodeTypes catalog FROM that config, and asks the
//      module to generate a board with the config's route-first generation plan.
//   3. Reads the module's ordered path on every change, runs the generic
//      ComboEngine over the skill sequence, and renders a live combo readout.
//
//  Nothing in module/ knows about combos — it just emits the path; the engine
//  (combo/) is generic and driven entirely by the chosen config.
// =============================================================================

import { GridPathPuzzle } from './module/GridPathPuzzle.js';
import { evaluate } from './combo/ComboEngine.js';
import { effectBadges } from './combo/effects.js';
import OFFENSIVE from './combo/configs/offensive.json';
import DEFENSIVE from './combo/configs/defensive.json';

const CONFIGS = { offensive: OFFENSIVE, defensive: DEFENSIVE };
const $ = (id) => document.getElementById(id);
const round = (n) => Math.round(n * 100) / 100;

let mode = 'offensive';
let config = CONFIGS[mode];
let game = null;

// Build the module's nodeTypes from a config: the base cells + the skills +
// any power-ups. Extra config fields (class, value, tiers…) are ignored by the
// module and consumed by the engine.
function catalogFromConfig(cfg) {
  const nt = { ...cfg.base };
  for (const [k, d] of Object.entries(cfg.skills)) nt[k] = { role: 'normal', passable: true, ...d };
  if (cfg.powerups) for (const [k, d] of Object.entries(cfg.powerups)) nt[k] = { role: 'normal', passable: true, ...d };
  return nt;
}

// The engine's input: the skill-node keys the path crossed, in order.
const skillSeqFromPath = (pathDesc) => pathDesc.map((c) => c.typeKey).filter((k) => config.skills[k]);

function currentSize() { return Number($('size').value); }
function currentSeed() { return Number($('seed').value); }

function buildGame() {
  if (game) game.destroy();
  config = CONFIGS[mode];
  const nodeTypes = catalogFromConfig(config);
  game = new GridPathPuzzle({
    mount: $('board'),
    nodeTypes,
    generate: { size: currentSize(), seed: currentSeed(), routePlan: config.generation },
    trapEntryMode: 'commitFail',
    onPathChange: onPathChange,
    onComplete: onComplete,
    onFail: onFail,
    onTick: onTick,
  });
  window.__puzzle = game;
  renderLegend();
  resetReadout();
}

function regenerate() {
  config = CONFIGS[mode];
  game.loadLevel({ size: currentSize(), seed: currentSeed(), routePlan: config.generation });
  resetReadout();
}

// ---- combo readout ----------------------------------------------------------
function renderCombo(result, isFinal) {
  const panel = $('combo');
  if (!result || (result.items.length === 0 && !result.special)) {
    panel.innerHTML = '<div class="combo-empty">Draw through skill nodes to build a combo…</div>';
    return;
  }
  let html = '';
  if (result.special) {
    html += `<div class="banner beam">⚡ ${result.special.name}</div>`;
    const applied = (result.special.applies || []).map((k) => config.skills[k]?.icon || k).join(' ');
    html += `<div class="combo-sub">applies ${applied} to <b>all</b> for ${result.special.durationSec}s</div>`;
  } else if (result.label && mode === 'defensive') {
    html += `<div class="banner fortress">🏰 ${result.label}</div>`;
  }
  for (const it of result.items) {
    const sk = config.skills[it.skill] || {};
    const badges = effectBadges(it.effects).map((b) => `<span class="badge ${b.fxClass}">${b.label}</span>`).join('');
    const gv = it.gameValue != null ? `${round(it.gameValue)} ${it.unit || ''}` : '';
    const dur = it.durationSec != null ? ` · ${round(it.durationSec)}s` : '';
    const tgt = it.targets === 'all' ? ' · 🎯 all' : '';
    html += `<div class="combo-item"><span class="ci-icon">${sk.icon || ''}</span>`
      + `<span class="ci-tier">${it.tier}</span>`
      + `<span class="ci-val">${gv}${dur}${tgt}</span> ${badges}</div>`;
  }
  panel.innerHTML = html;
  if (isFinal) { panel.classList.remove('fx'); void panel.offsetWidth; panel.classList.add('fx'); }
}

function onPathChange(info) {
  renderCombo(evaluate(skillSeqFromPath(info.path), config), false);
  window.__combo = evaluate(skillSeqFromPath(info.path), config);
  $('steps').textContent = `${info.steps} / ${info.budget.max ?? '∞'}`;
  const reach = $('reach');
  reach.textContent = info.canReachGoal ? 'yes' : 'no';
  reach.className = info.canReachGoal ? '' : 'warn';
  $('status').textContent = '';
  $('status').className = '';
}

function onComplete(result) {
  const combo = evaluate(skillSeqFromPath(result.path), config);
  renderCombo(combo, true); // isFinal → FX flourish
  const el = $('status');
  el.className = 'win';
  el.textContent = combo.special ? `✅ ${combo.special.name} unleashed!`
    : combo.label && mode === 'defensive' ? `✅ ${combo.label} raised!`
    : `✅ Combo executed: ${combo.items[0]?.tier ?? '—'}`;
}

function onFail(info) {
  const el = $('status');
  el.className = 'lose';
  el.textContent = info.reason === 'timeout' ? '⏱ Time up — failed!'
    : info.reason === 'trap' ? '💥 Hit a hazard — failed!' : '❌ Failed.';
}

function onTick(info) {
  $('time').textContent = info.limitMs == null
    ? `${(info.elapsedMs / 1000).toFixed(1)}s`
    : `${(info.remainingMs / 1000).toFixed(1)}s left`;
}

function resetReadout() {
  renderCombo(null, false);
  $('status').textContent = '';
  $('status').className = '';
  $('time').textContent = '—';
  $('reach').textContent = 'yes';
  $('reach').className = '';
  const st = game.getState();
  $('steps').textContent = `0 / ${st.level.moveBudget ?? '∞'}`;
  $('combo-title').textContent = `Combo — ${config.title}`;
}

function renderLegend() {
  const cfg = config;
  const entries = [
    ...Object.entries(cfg.base).filter(([k]) => k !== 'normal'),
    ...Object.entries(cfg.skills),
    ...Object.entries(cfg.powerups || {}),
  ];
  $('legend').innerHTML = entries
    .map(([k, d]) => `<span><i class="sw" style="background:${d.color || '#333'}"></i>${d.icon ? d.icon + ' ' : ''}${d.label || k}</span>`)
    .join('');
}

// ---- controls ---------------------------------------------------------------
function setMode(next) {
  mode = next;
  $('mode-offensive').classList.toggle('active', mode === 'offensive');
  $('mode-defensive').classList.toggle('active', mode === 'defensive');
  buildGame();
}
$('mode-offensive').addEventListener('click', () => setMode('offensive'));
$('mode-defensive').addEventListener('click', () => setMode('defensive'));
$('size').addEventListener('input', (e) => { $('sizeVal').textContent = e.target.value; $('sizeVal2').textContent = e.target.value; });
$('generate').addEventListener('click', regenerate);
$('random').addEventListener('click', () => { $('seed').value = Math.floor(Math.random() * 100000); regenerate(); });
$('reset').addEventListener('click', () => { game.reset(); resetReadout(); });
$('execute').addEventListener('click', () => game.execute());

buildGame();
