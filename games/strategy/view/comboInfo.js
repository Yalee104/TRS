// =============================================================================
//  view/comboInfo.js — in-game combo reference card (bottom-left of the boards)
// =============================================================================
//
//  Shows the OFFENSIVE combo table during attack and the DEFENSIVE one during
//  defense (hidden while the TRS puzzle is open). Each row = icon + name; hover a
//  row to pop a detail card (recipe + what it does + example + where it applies).
//  Pure presentation, driven off the current phase.
// =============================================================================

import { PHASES } from '../core/state.js';

const ING = {
  freeze: '❄️', confuse: '🌀', drain: '🩸', burning: '🔥', shatter: '💥',
  shield: '🛡️', repair: '🔧', cleanse: '🧹', harden: '🪨', overclock: '⚡',
};

const OFFENSE_INFO = [
  { name: 'Glass', icon: '🪟', recipe: ['freeze', 'shatter'], does: 'Focus-fire ×2 on this part (consumes both).', example: 'A 30 firepower pool → 60.', on: 'Focus only · any non-Core part.' },
  { name: 'Stasis Lock', icon: '🔒', recipe: ['freeze', 'confuse'], does: 'Disables the part (×0 firepower + system offline) for extra turns.', example: 'A frozen Tower stays blind/scattering ~2 turns longer.', on: 'Weapon, Tower.' },
  { name: 'Meltdown', icon: '🌋', recipe: ['shatter', 'burning'], does: 'Each Burn tick also funnels ~50% straight into the enemy Core — bypasses its shield.', example: 'Burns 6/rnd → 6 to the part + 3 to the Core.', on: 'Any part.' },
  { name: 'Backfire', icon: '💢', recipe: ['shatter', 'confuse'], does: 'The cracked, misfiring part takes a burst of self-damage (~20).', example: 'A Shattered+Confused Weapon recoils for 20.', on: 'Weapon, Tower.' },
  { name: 'Collapse', icon: '🏚️', recipe: ['shatter', 'drain'], does: 'If the part is below ~20% HP, the drain destroys it outright.', example: 'A Shattered Generator at 18% HP → destroyed.', on: 'Any part.' },
  { name: 'Wildfire', icon: '♨️', recipe: ['burning', 'confuse'], does: 'Burns the part and spreads Burning (½) to a neighbour.', example: 'A burning Weapon also lights the Engine.', on: 'Weapon, Tower.' },
  { name: 'Vaporize', icon: '💨', recipe: ['burning', 'drain'], does: 'Detonates the remaining Burn instantly + heals you ~50% of it.', example: '18 pending burn → 18 now + ~9 heal.', on: 'Any part.' },
  { name: 'Feedback Cascade', icon: '🔗', recipe: ['confuse', 'drain'], does: 'Chains ~50% of the drain to the same part on the next enemy.', example: 'Drain 15 → +7 to the next enemy’s same part.', on: 'Weapon, Tower · needs 2+ enemies.' },
];

const DEFENSE_INFO = [
  { name: 'Sustain', icon: '🔁', recipe: ['shield', 'repair'], does: 'Shield persists to your next defense resolve; repair tops it up.', example: 'Leftover 15 shield carries over.', on: 'Any part.' },
  { name: 'Purified Barrier', icon: '✨', recipe: ['shield', 'cleanse'], does: 'While the shield holds, the part is immune to incoming statuses this resolve.', example: 'An incoming freeze is warded off.', on: 'Any part.' },
  { name: 'Bastion', icon: '🏰', recipe: ['shield', 'harden'], does: 'Caps total damage to the part at ~25% of its max HP this resolve.', example: '3 enemies for 90 → capped to ~25.', on: 'Any part.' },
  { name: 'Reactive Plating', icon: '🪞', recipe: ['shield', 'overclock'], does: 'Reflects ~50% of absorbed damage at the attacker (lowest-HP part, Core-first if exposed).', example: 'Shield eats 40 → ~20 reflected.', on: 'Any part.' },
  { name: 'Field Repair', icon: '🩹', recipe: ['repair', 'harden'], does: 'Heals now and again at your next defense resolve.', example: 'Repair 18 now + 18 next.', on: 'Any part.' },
  { name: 'Deflect', icon: '🤺', recipe: ['cleanse', 'harden'], does: 'Dodges the first incoming hit entirely (no cleanse).', example: 'The first enemy strike whiffs.', on: 'Any part.' },
  { name: 'Reboot', icon: '🔄', recipe: ['cleanse', 'overclock'], does: 'Cleanses ALL statuses on the part (no credit).', example: 'freeze + drain + confuse all stripped.', on: 'Any part.' },
];

const OFF_FOOTER = '❄️+🔥 cancel each other · ❄️+🩸 no combo (open)';

function tableFor(state) {
  if (state.phase === PHASES.ATTACK_BUILD) return { side: 'off', title: '⚔️ Attack combos', rows: OFFENSE_INFO, footer: OFF_FOOTER };
  if (state.phase === PHASES.DEFENSE_BUILD) return { side: 'def', title: '🛡️ Defense combos', rows: DEFENSE_INFO, footer: '' };
  return null;
}
const lookup = (side, name) => (side === 'off' ? OFFENSE_INFO : DEFENSE_INFO).find((c) => c.name === name);

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
    const t = tableFor(state);
    if (!t || state.activePuzzle) { panelEl.style.display = 'none'; pop.style.display = 'none'; return; }
    panelEl.style.display = '';
    panelEl.innerHTML = `
      <div class="cp-title">${t.title} <span class="cp-hint">(hover for detail)</span></div>
      ${t.rows.map((c) => `<div class="cp-row" data-combo="${c.name}" data-side="${t.side}"><span class="cp-ic">${c.icon}</span> ${c.name} <span class="cp-recipe">${c.recipe.map((k) => ING[k] || '').join('')}</span></div>`).join('')}
      ${t.footer ? `<div class="cp-foot">${t.footer}</div>` : ''}`;
  };
}

function detailHtml(c) {
  return `
    <div class="tt-h"><b>${c.icon} ${c.name}</b></div>
    <div class="tt-sys">Recipe: ${c.recipe.map((k) => `${ING[k] || ''} ${k}`).join(' + ')}</div>
    <div class="tt-off"><b>Does:</b> ${c.does}</div>
    <div class="tt-def"><b>e.g.</b> ${c.example}</div>
    <div class="tt-dim">${c.on}</div>`;
}
