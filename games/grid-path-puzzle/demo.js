// =============================================================================
//  demo.js  —  the TRS Puzzle Playground (a host that USES the puzzle module)
// =============================================================================
//
//  Reproduces the exact puzzle the TRS strategy game would build for a given
//  {phase, component, Launch-Pad health} plus live generation knobs, so puzzles
//  can be verified before they ship to the strategy game. It uses the shared
//  preset `presets/trs.js` (the same palette/genPlan strategy will adopt) and
//  exercises the module's new GO-pause / START-flash options.
//
//  Nothing in module/ knows about TRS — it just emits the path; the generic
//  ComboEngine (combo/) scores it from the chosen palette.
// =============================================================================

import { GridPathPuzzle } from './module/GridPathPuzzle.js';
import { evaluate } from './combo/ComboEngine.js';
import { effectBadges } from './combo/effects.js';
import {
  buildPalette, catalogFromConfig, LAUNCHPAD_MODS, DEFAULT_GRID_SIZE,
  ATTACK_EFFECT, DEFENSE_VERB, OFFENSE_META, DEFENSE_META, MIN_CHAIN,
} from './presets/trs.js';

const $ = (id) => document.getElementById(id);
const round = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Effective "min chain" for the objective gate: the knob, clamped to the
// payload-count min so it can never exceed it (and is always achievable).
function minChainValue() {
  const cmin = Number($('cmin').value) || 1;
  return clamp(Number($('minchain').value) || 1, 1, cmin);
}

// Keep the Min-chain field itself within [1, payload-count min] — the rule is it
// cannot exceed the payload min — and cap the spinner's max accordingly.
function clampMinChainInput() {
  const cmin = Number($('cmin').value) || 1;
  const el = $('minchain');
  el.max = cmin;
  el.value = clamp(Number(el.value) || 1, 1, cmin);
}

const COMPONENTS = ['weapon', 'generator', 'tower', 'engine', 'launchpad'];
const COMP_LABEL = { weapon: 'Weapon', generator: 'Generator', tower: 'Tower', engine: 'Engine', launchpad: 'Launch Pad' };

let phase = 'attack';
let component = 'weapon';
let palette = null;  // current palette config (from presets/trs.js)
let game = null;
let lastSeed = null; // seed used by the last build (so Regenerate can tell it changed)

// ---- palette / build --------------------------------------------------------
const skillOf = () => (phase === 'attack' ? ATTACK_EFFECT[component] : DEFENSE_VERB[component]);
const metaOf = (skill) => (phase === 'attack' ? OFFENSE_META[skill] : DEFENSE_META[skill]);

function readKnobs() {
  return {
    cluster: $('cluster').checked,
    count: { min: Number($('cmin').value), max: Number($('cmax').value) },
    placement: $('placement').value,
    trapDensity: Number($('trap').value),
    blockerDensity: Number($('block').value),
    alternateRoutes: Number($('alt').value),
    channeling: $('channel').value,
    primaryLengthTarget: $('plt').value,
    chainChance: Math.max(0, Math.min(100, Number($('chainpct').value))) / 100,
    chainPlacement: $('chainplace').value,
  };
}

function goOpts() {
  const on = $('go').checked;
  return { countdownMs: on ? Number($('goms').value) : 0, flashStart: $('flash').checked, countdownText: $('gotext').value || 'GO' };
}

// The engine's input: the skill-node keys the path crossed, in order.
const skillSeqFromPath = (pathDesc) => pathDesc.map((c) => c.typeKey).filter((k) => palette.skills[k]);

function buildGame() {
  if (game) game.destroy();
  clampMinChainInput(); // keep Min chain <= payload-count min
  const preset = $('lpmod').value;
  palette = buildPalette({ phase, component, preset, knobs: readKnobs() });
  const size = Math.max(4, Number($('size').value) + (LAUNCHPAD_MODS[preset]?.sizeDelta || 0));
  const { countdownMs, flashStart, countdownText } = goOpts();
  const skill = skillOf();
  const objective = $('objon').checked
    ? { type: skill, min: minChainValue(), icon: metaOf(skill).icon, label: metaOf(skill).name }
    : null; // null/omitted = gate off (reaching goal solves)
  const timeLimitMs = $('touon').checked ? clamp(Number($('tousec').value) || 10, 2, 30) * 1000 : null;
  game = new GridPathPuzzle({
    mount: $('board'),
    nodeTypes: catalogFromConfig(palette),
    generate: { size, seed: Number($('seed').value), routePlan: palette.generation },
    trapEntryMode: 'commitFail',
    countdownMs, flashStart, countdownText,
    objective, timeLimitMs, failText: 'FAIL',
    onPathChange, onComplete, onFail, onTick, onObjectiveBlocked,
    onCountdownEnd: () => { $('status').textContent = ''; },
  });
  game.start(); // kick the GO pause (or start immediately if countdownMs is 0)
  window.__puzzle = game;
  lastSeed = Number($('seed').value);
  const pr = game.level.primaryRoute, sr = game.level.safeRoute;
  $('routelen').textContent = pr ? `${pr.length}${sr ? ` · safe ${sr.length}` : ''}` : '—';
  renderLegend();
  resetReadout();
  updateSolveWarn();
  renderRouteOverlay();
}

// Debug overlay: outline the generator's intended primary (reward) + safe routes
// on the board so the effect of Primary length / Placement is actually visible.
// (The routes are level metadata the module exposes; it never draws them itself.)
function renderRouteOverlay() {
  const board = $('board');
  board.querySelectorAll('.pg-primary, .pg-safe').forEach((c) => c.classList.remove('pg-primary', 'pg-safe'));
  if (!$('showroute').checked || !game?.level) return;
  const mark = (route, cls) => (route || []).forEach((p) => {
    board.querySelector(`.gpp-cell[data-x="${p.x}"][data-y="${p.y}"]`)?.classList.add(cls);
  });
  mark(game.level.safeRoute, 'pg-safe');
  mark(game.level.primaryRoute, 'pg-primary');
}

// Regenerate: rebuild from the current knobs. If the seed is unchanged since the
// last build, roll a fresh one first so you actually get a NEW board (otherwise
// it would just replay the same layout, like Reset).
function regenerate() {
  if (Number($('seed').value) === lastSeed) {
    $('seed').value = Math.floor(Math.random() * 100000);
  }
  buildGame();
}

// Warn when the requirement can't be guaranteed: the active min-chain (the gate,
// or the skill's inherent MIN_CHAIN) must be <= the payload-count MIN, since min
// is the worst-case number of payloads the generator places.
function updateSolveWarn() {
  const el = $('solvewarn');
  const skill = skillOf();
  const gate = $('objon').checked ? (Number($('minchain').value) || 1) : 0;
  const need = Math.max(MIN_CHAIN[skill] || 1, gate);
  const min = Number($('cmin').value);
  if (need > min) {
    el.style.display = '';
    el.textContent = `⚠ ${metaOf(skill).name} needs ${need} chained to solve, but payload min is ${min} — raise the payload min or lower Min chain.`;
  } else {
    el.style.display = 'none';
  }
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
  } else if (result.label && phase === 'defense') {
    html += `<div class="banner fortress">🏰 ${result.label}</div>`;
  }
  for (const it of result.items) {
    const sk = palette.skills[it.skill] || {};
    const badges = effectBadges(it.effects).map((b) => `<span class="badge ${b.fxClass}">${b.label}</span>`).join('');
    const gv = it.gameValue != null ? `${round(it.gameValue)} ${it.unit || ''}` : '';
    const dur = it.durationSec != null ? ` · ${round(it.durationSec)}s` : '';
    html += `<div class="combo-item"><span class="ci-icon">${sk.icon || ''}</span>`
      + `<span class="ci-tier">${it.tier}</span>`
      + `<span class="ci-val">${gv}${dur}</span> ${badges}</div>`;
  }
  panel.innerHTML = html;
  if (isFinal) { panel.classList.remove('fx'); void panel.offsetWidth; panel.classList.add('fx'); }
}

// "potency" the route would yield, the resolved skill, and the min-chain check.
function renderTrsInfo(info) {
  const skill = skillOf();
  const need = $('objon').checked ? minChainValue() : (MIN_CHAIN[skill] || 1);
  const seq = info ? skillSeqFromPath(info.path) : [];
  const chained = seq.filter((k) => k === skill).length;
  const value = info ? (evaluate(seq, palette).items?.[0]?.value ?? 0) : 0;
  $('trsinfo').innerHTML = `<span>Skill <b>${metaOf(skill).icon} ${skill}</b></span>`
    + `<span>Chained <b>${chained}/${need}</b> ${chained >= need ? '✅ solve' : '⛔ short'}</span>`
    + `<span>Potency <b>${round(value)}</b></span>`;
}

function onPathChange(info) {
  renderCombo(evaluate(skillSeqFromPath(info.path), palette), false);
  renderTrsInfo(info);
  $('steps').textContent = `${info.steps} / ${info.budget.max ?? '∞'}`;
  const reach = $('reach');
  reach.textContent = info.canReachGoal ? 'yes' : 'no';
  reach.className = info.canReachGoal ? '' : 'warn';
  $('status').textContent = '';
  $('status').className = '';
}

function onComplete(result) {
  const combo = evaluate(skillSeqFromPath(result.path), palette);
  renderCombo(combo, true);
  const el = $('status');
  el.className = 'win';
  el.textContent = `✅ Solved: ${combo.items[0]?.tier ?? '—'} (potency ${round(combo.items[0]?.value ?? 0)})`;
  $('solved').textContent = `${(result.time.elapsedMs / 1000).toFixed(1)}s`;
}

function onFail(info) {
  const el = $('status');
  el.className = 'lose';
  el.textContent = info.reason === 'timeout' ? '⏱ Time up — failed!'
    : info.reason === 'trap' ? '💥 Hit a hazard — failed!' : '❌ Failed.';
}

function onObjectiveBlocked(info) {
  const el = $('status');
  el.className = 'warn';
  el.textContent = `🔒 Locked — chain ${info.missing} more ${metaOf(skillOf()).icon} to solve`;
}

function onTick(info) {
  $('time').textContent = info.limitMs == null
    ? `${(info.elapsedMs / 1000).toFixed(1)}s`
    : `${(info.remainingMs / 1000).toFixed(1)}s left`;
}

function resetReadout() {
  renderCombo(null, false);
  renderTrsInfo(null);
  $('status').textContent = '';
  $('status').className = '';
  $('time').textContent = '—';
  $('solved').textContent = '—';
  $('reach').textContent = 'yes';
  $('reach').className = '';
  const st = game.getState();
  $('steps').textContent = `0 / ${st.level.moveBudget ?? '∞'}`;
  $('combo-title').textContent = `Combo — ${phase === 'attack' ? 'Attack' : 'Defense'}: ${COMP_LABEL[component]} (${metaOf(skillOf()).name})`;
}

function renderLegend() {
  const entries = [
    ...Object.entries(palette.base).filter(([k]) => k !== 'normal'),
    ...Object.entries(palette.skills),
  ];
  $('legend').innerHTML = entries
    .map(([k, d]) => `<span><i class="sw" style="background:${d.color || '#333'}"></i>${d.icon ? d.icon + ' ' : ''}${d.label || k}</span>`)
    .join('');
}

// ---- component selector -----------------------------------------------------
function renderComponents() {
  $('components').innerHTML = COMPONENTS.map((c) => {
    const skill = phase === 'attack' ? ATTACK_EFFECT[c] : DEFENSE_VERB[c];
    const meta = phase === 'attack' ? OFFENSE_META[skill] : DEFENSE_META[skill];
    return `<button data-comp="${c}" class="${c === component ? 'active' : ''}">${COMP_LABEL[c]}`
      + `<br><span style="font-size:11px;color:#9aa0aa">${meta.icon} ${meta.name}</span></button>`;
  }).join('');
}

// ---- controls ---------------------------------------------------------------
function setPhase(next) {
  phase = next;
  $('phase-attack').classList.toggle('active', phase === 'attack');
  $('phase-defense').classList.toggle('active', phase === 'defense');
  $('chainrows').style.display = phase === 'attack' ? '' : 'none'; // chain is attack-only
  renderComponents();
  buildGame();
}
$('phase-attack').addEventListener('click', () => setPhase('attack'));
$('phase-defense').addEventListener('click', () => setPhase('defense'));
$('components').addEventListener('click', (e) => {
  const b = e.target.closest('[data-comp]');
  if (!b) return;
  component = b.dataset.comp;
  renderComponents();
  buildGame();
});

$('size').addEventListener('input', (e) => { $('sizeVal').textContent = e.target.value; });
$('trap').addEventListener('input', (e) => { $('trapVal').textContent = Number(e.target.value).toFixed(2); });
$('block').addEventListener('input', (e) => { $('blockVal').textContent = Number(e.target.value).toFixed(2); });
$('placement').addEventListener('change', () => {
  const off = $('placement').value === 'offRoute' || $('placement').value === 'anywhere';
  $('placehint').style.display = off ? '' : 'none';
});

$('showroute').addEventListener('change', renderRouteOverlay);

// Enable/grey the Min-chain knob with its toggle. Enabling defaults the value to
// the payload-count min (and the field is capped there).
function syncObjUI() {
  const on = $('objon').checked;
  if (on) $('minchain').value = Number($('cmin').value) || 1;
  $('minchain').disabled = !on;
  $('minchainrow').classList.toggle('is-off', !on);
}
$('objon').addEventListener('change', syncObjUI);

// Enable/grey the Timeout (seconds) field with its toggle.
function syncTouUI() {
  const on = $('touon').checked;
  $('tousec').disabled = !on;
  $('tourow').classList.toggle('is-off', !on);
}
$('touon').addEventListener('change', syncTouUI);

// Re-apply generation knobs on the SAME seed when any change, so you can A/B a
// single knob (e.g. Primary length) without the seed shifting underneath you.
// (Regenerate is still the way to roll a fresh board.)
['lpmod', 'cluster', 'size', 'cmin', 'cmax', 'placement', 'trap', 'block', 'alt', 'channel', 'plt', 'chainpct', 'chainplace', 'objon', 'minchain', 'touon', 'tousec']
  .forEach((id) => $(id).addEventListener('change', buildGame));

// Print the current settings as a paste-ready snippet for presets/trs.js (the
// playground never writes files — this is the bridge to "baking" tuned defaults).
function exportConfig() {
  const k = readKnobs();
  const preset = $('lpmod').value;
  const go = goOpts();
  const q = (v) => (typeof v === 'string' ? `'${v}'` : v);
  const text = [
    '// TRS Puzzle Playground — current config',
    `// phase: ${phase} · component: ${component} (${skillOf()}) · Launch Pad: ${preset} · size ${$('size').value} · seed ${$('seed').value}`,
    "// To ship as the DEFAULT difficulty, set these in genPlan()'s defaults in",
    '//   games/grid-path-puzzle/presets/trs.js',
    'const knobs = {',
    `  cluster: ${k.cluster},`,
    `  count: { min: ${k.count.min}, max: ${k.count.max} },`,
    `  placement: ${q(k.placement)},`,
    `  trapDensity: ${k.trapDensity},`,
    `  blockerDensity: ${k.blockerDensity},`,
    `  alternateRoutes: ${k.alternateRoutes},`,
    `  channeling: ${q(k.channeling)},`,
    `  primaryLengthTarget: ${q(k.primaryLengthTarget)},`,
    `  chainChance: ${k.chainChance}, // attack only`,
    `  chainPlacement: ${q(k.chainPlacement)},`,
    '};',
    '// presentation (module options — set where the puzzle is constructed, e.g. strategy bridge.js):',
    `//   countdownMs: ${go.countdownMs}, flashStart: ${go.flashStart}, countdownText: ${q(go.countdownText)}`,
  ].join('\n');

  const ta = $('exportout');
  ta.style.display = '';
  ta.value = text;
  ta.focus();
  ta.select();
  const msg = $('exportmsg');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => { msg.textContent = '✅ copied to clipboard'; },
      () => { msg.textContent = 'select the text above and copy (Ctrl/Cmd+C)'; },
    );
  } else {
    msg.textContent = 'select the text above and copy (Ctrl/Cmd+C)';
  }
}

$('export').addEventListener('click', exportConfig);
$('generate').addEventListener('click', regenerate);
$('random').addEventListener('click', () => { $('seed').value = Math.floor(Math.random() * 100000); buildGame(); });
$('reset').addEventListener('click', () => { game.reset(); game.start(); resetReadout(); }); // re-arm + replay GO

// Initialise the grid-size control from the preset's recommended default.
$('size').value = DEFAULT_GRID_SIZE;
$('sizeVal').textContent = String(DEFAULT_GRID_SIZE);

renderComponents();
syncObjUI();
syncTouUI();
buildGame();
