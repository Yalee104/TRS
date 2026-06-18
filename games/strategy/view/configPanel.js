// =============================================================================
//  view/configPanel.js — the LEFT RAIL (DESIGN B.6)
// =============================================================================
//
//  Before Start: knobs to set up the battle (archetype, phase length, time model,
//  telegraph mode, seed) without editing game.json. After Start: a live status
//  readout (round/phase/credit/log) + Restart. getUi() returns the chosen
//  overrides to feed createState().
// =============================================================================

import { PHASES } from '../core/state.js';

export function createConfigPanel(root, { onStart, onRestart, defaults }) {
  root.innerHTML = `
    <h2>TRS Command</h2>
    <div class="setup">
      <label>Enemy archetype
        <select id="cfg-arch">
          <option value="saboteur">Saboteur (hits your offence)</option>
          <option value="brute">Brute (focus-fires biggest part)</option>
          <option value="random">Random</option>
        </select>
      </label>
      <label>Phase length: <span id="cfg-credit-val"></span>
        <input id="cfg-credit" type="range" min="10" max="150" step="5" />
      </label>
      <label>Attack time model
        <select id="cfg-time">
          <option value="cost">Cost (fixed per action)</option>
          <option value="realtime">Real-time (seconds solving)</option>
        </select>
      </label>
      <label>Telegraph
        <select id="cfg-tel">
          <option value="deterministic">Deterministic</option>
          <option value="variance">With variance</option>
        </select>
      </label>
      <label>Seed <input id="cfg-seed" type="number" min="0" step="1" /></label>
      <button id="cfg-start">▶ Start Battle</button>
    </div>
    <div class="status" style="display:none">
      <button id="cfg-restart">⟲ Restart / Reconfigure</button>
      <div id="cfg-readout"></div>
      <div class="log-title">Event log</div>
      <div id="cfg-log" class="log"></div>
    </div>`;

  const $ = (id) => root.querySelector(id);
  const setupEl = root.querySelector('.setup');
  const statusEl = root.querySelector('.status');

  // seed defaults
  $('#cfg-arch').value = defaults.archetype || 'saboteur';
  $('#cfg-credit').value = defaults.creditSeconds || 120;
  $('#cfg-credit-val').textContent = `${$('#cfg-credit').value}s`;
  $('#cfg-time').value = defaults.attackTimeModel || 'cost';
  $('#cfg-tel').value = defaults.telegraphMode || 'deterministic';
  $('#cfg-seed').value = defaults.seed || 0;

  $('#cfg-credit').addEventListener('input', () => { $('#cfg-credit-val').textContent = `${$('#cfg-credit').value}s`; });

  function getUi() {
    return {
      archetype: $('#cfg-arch').value,
      creditSeconds: Number($('#cfg-credit').value),
      attackTimeModel: $('#cfg-time').value,
      telegraphMode: $('#cfg-tel').value,
      seed: Number($('#cfg-seed').value) || 0,
    };
  }

  $('#cfg-start').addEventListener('click', () => onStart(getUi()));
  $('#cfg-restart').addEventListener('click', () => onRestart());

  function showConfig() { setupEl.style.display = ''; statusEl.style.display = 'none'; }
  function showStatus() { setupEl.style.display = 'none'; statusEl.style.display = ''; }

  function update(state) {
    const credit = (state.creditLeftMs / 1000).toFixed(0);
    const phaseName = {
      [PHASES.ATTACK_BUILD]: 'Attack build', [PHASES.DEFENSE_BUILD]: 'Defense build',
      [PHASES.WON]: 'Won', [PHASES.LOST]: 'Lost',
    }[state.phase] || state.phase;
    $('#cfg-readout').innerHTML = `
      <div><b>Round</b> ${state.round} · ${phaseName}</div>
      <div><b>Credit</b> ${credit}s left</div>
      <div><b>Enemy</b> ${state.config.archetypes[state.archetype]?.label || state.archetype}</div>
      <div><b>Queued</b> ${state.queue.length} action(s)</div>
      <div><b>Time model</b> ${state.attackTimeModel}</div>`;
    renderLog($('#cfg-log'), state.log);
  }

  return { getUi, showConfig, showStatus, update };
}

function groupOf(phase) {
  if (phase === PHASES.ATTACK_BUILD || phase === PHASES.ATTACK_RESOLVE) return { tag: 'ATTACK', icon: '⚔️' };
  if (phase === PHASES.DEFENSE_BUILD || phase === PHASES.DEFENSE_RESOLVE) return { tag: 'DEFENSE', icon: '🛡️' };
  if (phase === PHASES.WON || phase === PHASES.LOST) return { tag: 'RESULT', icon: '🏁' };
  return { tag: 'SETUP', icon: '⚙️' };
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Grouped, indented event log: a header per (round + Attack/Defense phase), the
 * phase's events indented under it, and per-hit detail (· lines) indented deeper.
 * Newest at the bottom; auto-scrolls so the latest is always in view.
 */
function renderLog(el, log) {
  let html = '';
  let curKey = null;
  for (const l of log.slice(-40)) {
    if (l.msg.startsWith('===')) continue; // header line is redundant with the group banner
    const g = groupOf(l.phase);
    const key = `${l.round}|${g.tag}`;
    if (key !== curKey) { html += `<div class="log-grp">${g.icon} Round ${l.round} · ${g.tag}</div>`; curKey = key; }
    const detail = /^[·•]/.test(l.msg);
    const text = detail ? l.msg.replace(/^[·•]\s*/, '') : l.msg;
    html += `<div class="log-line ${detail ? 'l2' : 'l1'}">${esc(text)}</div>`;
  }
  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}
