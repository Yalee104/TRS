// =============================================================================
//  view/configPanel.js — the LEFT RAIL (DESIGN B.6)
// =============================================================================
//
//  Before Start: a ROSTER of up to maxEnemies enemies, phase length, seed.
//  After Start: a live status readout + Restart. A language
//  selector sits at the top (both modes). getUi() returns createState() overrides.
//  rebuild() re-renders the whole rail in the current locale, preserving inputs.
// =============================================================================

import { PHASES } from '../core/state.js';
import { t, archetypeLabel, enemyLabel, getLocale, setLocale, LOCALES } from '../i18n/index.js';

export function createConfigPanel(root, { onStart, onRestart, defaults, archetypes }) {
  const archList = Object.keys(archetypes || {}).filter((k) => k !== '_comment');
  const maxEnemies = defaults.maxEnemies || 4;
  let mode = 'config';
  // live values (seeded from config.ui defaults; preserved across locale rebuilds)
  let vals = {
    enemies: (Array.isArray(defaults.enemies) && defaults.enemies.length) ? defaults.enemies.slice(0, maxEnemies) : [defaults.archetype || archList[0]],
    creditSeconds: defaults.creditSeconds || 15,
    seed: defaults.seed || 0,
  };

  const $ = (id) => root.querySelector(id);
  let setupEl, statusEl, rosterEl;

  const optionsHtml = (sel) => [
    ...archList.map((k) => `<option value="${k}"${k === sel ? ' selected' : ''}>${archetypeLabel(k)}</option>`),
    `<option value="random"${sel === 'random' ? ' selected' : ''}>${t('archetype.random')}</option>`,
  ].join('');
  const rowSelects = () => [...rosterEl.querySelectorAll('.cfg-enemy')];
  const rowHtml = (sel) => `<div class="roster-row"><select class="cfg-enemy">${optionsHtml(sel)}</select><button class="rm" title="${t('config.remove')}" type="button">✖</button></div>`;

  function syncButtons() {
    const n = rowSelects().length;
    $('#cfg-add').disabled = n >= maxEnemies;
    rosterEl.querySelectorAll('.rm').forEach((b) => { b.disabled = n <= 1; });
  }
  function addRow(sel) {
    if (rowSelects().length >= maxEnemies) return;
    rosterEl.insertAdjacentHTML('beforeend', rowHtml(sel || archList[0]));
    syncButtons();
  }
  function captureVals() {
    if (!rosterEl) return vals;
    return {
      enemies: rowSelects().map((r) => r.value),
      creditSeconds: Number($('#cfg-credit').value),
      seed: Number($('#cfg-seed').value) || 0,
    };
  }
  function applyMode() {
    setupEl.style.display = mode === 'config' ? '' : 'none';
    statusEl.style.display = mode === 'status' ? '' : 'none';
  }

  function build() {
    root.innerHTML = `
      <h2>${t('ui.appTitle')}</h2>
      <label class="lang-row">${t('ui.language')}
        <select id="cfg-lang">${LOCALES.map((l) => `<option value="${l.code}"${l.code === getLocale() ? ' selected' : ''}>${l.label}</option>`).join('')}</select>
      </label>
      <div class="setup">
        <label>${t('config.enemies')} <span class="dim">${t('config.upTo', { max: maxEnemies })}</span></label>
        <div id="cfg-roster" class="roster"></div>
        <button id="cfg-add" class="addbtn">${t('ui.addEnemy')}</button>
        <label>${t('config.phaseLength')} <span id="cfg-credit-val"></span>
          <input id="cfg-credit" type="range" min="10" max="150" step="5" />
        </label>
        <label>${t('config.seed')} <input id="cfg-seed" type="number" min="0" step="1" /></label>
        <button id="cfg-start">${t('ui.startBattle')}</button>
      </div>
      <div class="status" style="display:none">
        <button id="cfg-restart">${t('ui.restart')}</button>
        <div id="cfg-readout"></div>
        <div class="log-title">${t('config.eventLog')}</div>
        <div id="cfg-log" class="log"></div>
      </div>`;

    setupEl = root.querySelector('.setup');
    statusEl = root.querySelector('.status');
    rosterEl = $('#cfg-roster');

    $('#cfg-lang').addEventListener('change', (e) => setLocale(e.target.value));
    rosterEl.addEventListener('click', (e) => {
      if (e.target.classList.contains('rm') && rowSelects().length > 1) { e.target.closest('.roster-row').remove(); syncButtons(); }
    });
    $('#cfg-add').addEventListener('click', () => addRow());
    vals.enemies.forEach((k) => addRow(k));

    $('#cfg-credit').value = vals.creditSeconds;
    $('#cfg-credit-val').textContent = `${$('#cfg-credit').value}s`;
    $('#cfg-seed').value = vals.seed;
    $('#cfg-credit').addEventListener('input', () => { $('#cfg-credit-val').textContent = `${$('#cfg-credit').value}s`; });

    $('#cfg-start').addEventListener('click', () => onStart(getUi()));
    $('#cfg-restart').addEventListener('click', () => onRestart());
    applyMode();
  }

  function getUi() { return captureVals(); }
  function showConfig() { mode = 'config'; applyMode(); }
  function showStatus() { mode = 'status'; applyMode(); }
  /** Re-render the whole rail in the current locale, preserving inputs + mode. */
  function rebuild() { vals = captureVals(); build(); }

  function update(state) {
    const credit = (state.creditLeftMs / 1000).toFixed(0);
    const phaseName = {
      [PHASES.ATTACK_BUILD]: t('config.phase.attackBuild'), [PHASES.DEFENSE_BUILD]: t('config.phase.defenseBuild'),
      [PHASES.WON]: t('config.phase.won'), [PHASES.LOST]: t('config.phase.lost'),
    }[state.phase] || state.phase;
    const enemyList = state.enemies.map((e) => `${enemyLabel(e)}${e.components.core.hp <= 0 ? ' ☠️' : ''}`).join(', ');
    $('#cfg-readout').innerHTML = `
      <div><b>${t('config.readout.round')}</b> ${state.round} · ${phaseName}</div>
      <div><b>${t('config.readout.credit')}</b> ${t('config.readout.creditLeft', { n: credit })}</div>
      <div><b>${t('config.readout.enemies')}</b> ${enemyList}</div>
      <div><b>${t('config.readout.queued')}</b> ${t('config.readout.queuedActions', { n: state.queue.length })}</div>`;
    renderLog($('#cfg-log'), state.log);
  }

  build();
  return { getUi, showConfig, showStatus, update, rebuild };
}

// --- Event log (PARKED: stays English in v1) ----------------------------------
function groupOf(phase) {
  if (phase === PHASES.ATTACK_BUILD || phase === PHASES.ATTACK_RESOLVE) return { tag: 'ATTACK', icon: '⚔️' };
  if (phase === PHASES.DEFENSE_BUILD || phase === PHASES.DEFENSE_RESOLVE) return { tag: 'DEFENSE', icon: '🛡️' };
  if (phase === PHASES.WON || phase === PHASES.LOST) return { tag: 'RESULT', icon: '🏁' };
  return { tag: 'SETUP', icon: '⚙️' };
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderLog(el, log) {
  let html = '';
  let curKey = null;
  for (const l of log.slice(-40)) {
    if (l.msg.startsWith('===')) continue;
    const g = groupOf(l.phase);
    const key = `${l.round}|${g.tag}`;
    if (key !== curKey) { html += `<div class="log-grp">${g.icon} Round ${l.round} · ${g.tag}</div>`; curKey = key; }
    const detail = /^[·•]/.test(l.msg);
    const text = detail ? l.msg.replace(/^[·•]\s*/, '') : l.msg;
    html += `<div class="log-line ${detail ? 'l2' : 'l1'}">• ${esc(text)}</div>`;
  }
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}
