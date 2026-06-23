// =============================================================================
//  view/comboInfo.js — in-game combo reference card (bottom-left of the boards)
// =============================================================================
//
//  Shows the OFFENSIVE combo table during attack and the DEFENSIVE one during
//  defense (hidden while the TRS puzzle is open). Each row = icon + name; hover a
//  row to pop a detail card (recipe + what it does + example + where it applies).
//  All prose comes from the i18n catalog (keyed by combo id); this file holds only
//  the structure (icon + recipe-by-key).
// =============================================================================

import { PHASES } from '../core/state.js';
import { t, comboLabel, skillLabel } from '../i18n/index.js';

const ING = {
  freeze: '❄️', confuse: '🌀', drain: '🩸', burning: '🔥', shatter: '💥',
  shield: '🛡️', repair: '🔧', cleanse: '🧹', harden: '🪨', overclock: '⚡',
};

const OFFENSE_INFO = [
  { id: 'glass', icon: '🪟', recipe: ['freeze', 'shatter'] },
  { id: 'stasisLock', icon: '🔒', recipe: ['freeze', 'confuse'] },
  { id: 'meltdown', icon: '🌋', recipe: ['shatter', 'burning'] },
  { id: 'backfire', icon: '💢', recipe: ['shatter', 'confuse'] },
  { id: 'collapse', icon: '🏚️', recipe: ['shatter', 'drain'] },
  { id: 'wildfire', icon: '♨️', recipe: ['burning', 'confuse'] },
  { id: 'vaporize', icon: '💨', recipe: ['burning', 'drain'] },
  { id: 'feedback', icon: '🔗', recipe: ['confuse', 'drain'] },
];

const DEFENSE_INFO = [
  { id: 'sustain', icon: '🔁', recipe: ['shield', 'repair'] },
  { id: 'purifiedBarrier', icon: '✨', recipe: ['shield', 'cleanse'] },
  { id: 'bastion', icon: '🏰', recipe: ['shield', 'harden'] },
  { id: 'reactivePlating', icon: '🪞', recipe: ['shield', 'overclock'] },
  { id: 'fieldRepair', icon: '🩹', recipe: ['repair', 'harden'] },
  { id: 'deflect', icon: '🤺', recipe: ['cleanse', 'harden'] },
  { id: 'reboot', icon: '🔄', recipe: ['cleanse', 'overclock'] },
];

function tableFor(state) {
  if (state.phase === PHASES.ATTACK_BUILD) return { side: 'off', title: t('ui.combos.attackTitle'), rows: OFFENSE_INFO, footer: t('ui.combos.footer') };
  if (state.phase === PHASES.DEFENSE_BUILD) return { side: 'def', title: t('ui.combos.defenseTitle'), rows: DEFENSE_INFO, footer: '' };
  return null;
}
const lookup = (side, id) => (side === 'off' ? OFFENSE_INFO : DEFENSE_INFO).find((c) => c.id === id);

/**
 * @param panelEl  the docked #combo-panel element
 * @param getState
 * Returns a render(state) function; also toggles the panel hidden when the puzzle is open.
 */
export function createComboPanel(panelEl, getState) {
  const pop = document.createElement('div');
  pop.className = 'trs-tooltip';
  pop.style.display = 'none';
  document.body.appendChild(pop);

  function place(e) {
    const r = pop.getBoundingClientRect();
    let x = e.clientX + 14; let y = e.clientY + 14;
    if (x + r.width > window.innerWidth) x = e.clientX - r.width - 14;
    if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - 8;
    pop.style.left = `${Math.max(4, x)}px`;
    pop.style.top = `${Math.max(4, y)}px`;
  }

  panelEl.addEventListener('mousemove', (e) => {
    const row = e.target.closest('[data-combo]');
    if (!row) { pop.style.display = 'none'; return; }
    const info = lookup(row.dataset.side, row.dataset.combo);
    if (!info) { pop.style.display = 'none'; return; }
    pop.innerHTML = detailHtml(info);
    pop.style.display = '';
    place(e);
  });
  panelEl.addEventListener('mouseleave', () => { pop.style.display = 'none'; });

  return (state) => {
    const tbl = tableFor(state);
    if (!tbl || state.activePuzzle) { panelEl.style.display = 'none'; pop.style.display = 'none'; return; }
    panelEl.style.display = '';
    panelEl.innerHTML = `
      <div class="cp-title">${tbl.title} <span class="cp-hint">${t('ui.combos.hoverHint')}</span></div>
      ${tbl.rows.map((c) => `<div class="cp-row" data-combo="${c.id}" data-side="${tbl.side}"><span class="cp-ic">${c.icon}</span> ${comboLabel(c.id)} <span class="cp-recipe">${c.recipe.map((k) => ING[k] || '').join('')}</span></div>`).join('')}
      ${tbl.footer ? `<div class="cp-foot">${tbl.footer}</div>` : ''}`;
  };
}

function detailHtml(c) {
  const recipe = c.recipe.map((k) => `${ING[k] || ''} ${skillLabel(k)}`).join(' + ');
  return `
    <div class="tt-h"><b>${c.icon} ${comboLabel(c.id)}</b></div>
    <div class="tt-sys">${t('ui.combos.recipe', { recipe })}</div>
    <div class="tt-off"><b>${t('ui.combos.doesLabel')}</b> ${t(`combo.${c.id}.does`)}</div>
    <div class="tt-def"><b>${t('ui.combos.egLabel')}</b> ${t(`combo.${c.id}.example`)}</div>
    <div class="tt-dim">${t(`combo.${c.id}.on`)}</div>`;
}
