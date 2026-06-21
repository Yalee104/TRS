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
  buildPalette, catalogFromConfig, LAUNCHPAD_MODS,
  ATTACK_EFFECT, DEFENSE_VERB, OFFENSE_META, DEFENSE_META, MIN_CHAIN,
} from './presets/trs.js';

const $ = (id) => document.getElementById(id);
const round = (n) => Math.round(n * 100) / 100;

const COMPONENTS = ['weapon', 'generator', 'tower', 'engine', 'launchpad'];
const COMP_LABEL = { weapon: 'Weapon', generator: 'Generator', tower: 'Tower', engine: 'Engine', launchpad: 'Launch Pad' };

let phase = 'attack';
let component = 'weapon';
let palette = null;  // current palette config (from presets/trs.js)
let game = null;

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
  const preset = $('lpmod').value;
  palette = buildPalette({ phase, component, preset, knobs: readKnobs() });
  const size = Math.max(4, Number($('size').value) + (LAUNCHPAD_MODS[preset]?.sizeDelta || 0));
  const { countdownMs, flashStart, countdownText } = goOpts();
  game = new GridPathPuzzle({
    mount: $('board'),
    nodeTypes: catalogFromConfig(palette),
    generate: { size, seed: Number($('seed').value), routePlan: palette.generation },
    trapEntryMode: 'commitFail',
    countdownMs, flashStart, countdownText,
    onPathChange, onComplete, onFail, onTick,
    onCountdownEnd: () => { $('status').textContent = ''; },
  });
  game.start(); // kick the GO pause (or start immediately if countdownMs is 0)
  window.__puzzle = game;
  renderLegend();
  resetReadout();
  updateSolveWarn();
}

// Warn when the board can't satisfy the skill's MIN_CHAIN: e.g. Cleanse/Overclock
// need 3 chained, so a payload max below that makes the TRS unsolvable.
function updateSolveWarn() {
  const el = $('solvewarn');
  const skill = skillOf();
  const need = MIN_CHAIN[skill] || 1;
  const max = Number($('cmax').value);
  if (need > max) {
    el.style.display = '';
    el.textContent = `⚠ ${metaOf(skill).name} needs ${need} chained to solve, but payload max is ${max} — raise the payload count.`;
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
  const need = MIN_CHAIN[skill] || 1;
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
  renderTrsInfo(null);
  $('status').textContent = '';
  $('status').className = '';
  $('time').textContent = '—';
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
$('generate').addEventListener('click', buildGame);
$('random').addEventListener('click', () => { $('seed').value = Math.floor(Math.random() * 100000); buildGame(); });
$('reset').addEventListener('click', () => { game.reset(); game.start(); resetReadout(); }); // re-arm + replay GO

renderComponents();
buildGame();
