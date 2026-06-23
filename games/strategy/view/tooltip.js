// =============================================================================
//  view/tooltip.js — hover dossier for any component (enemy or player)
// =============================================================================
//
//  Labeled, side-aware sections (ROLE / ATTACK / DEFENCE / STATE). All prose comes
//  from the i18n catalog; this file holds the structure + which keys to look up.
//  Lives in <body> so board re-renders never wipe it; driven purely off state.
// =============================================================================

import { ATTACK_EFFECT, DEFENSE_VERB, hpFrac } from '../core/components.js';
import { coreShieldStatus } from '../core/cascade.js';
import { PHASES } from '../core/state.js';
import { t, componentLabel, effectLabel, skillLabel, enemyLabel } from '../i18n/index.js';

// DEFENCE — verb description with config numbers slotted into the localized string.
function defenceDesc(verb, config) {
  const d = config.defense || {};
  switch (verb) {
    case 'shield': return t('tooltip.defence.shield', { n: d.shield?.absorbPerPotency });
    case 'repair': return t('tooltip.defence.repair', { n: d.repair?.hpPerPotency });
    case 'cleanse': return t('tooltip.defence.cleanse');
    case 'harden': return t('tooltip.defence.harden', { per: Math.round((d.harden?.reductionPerPotency || 0) * 100), cap: Math.round((d.harden?.maxReduction || 0) * 100) });
    case 'overclock': return t('tooltip.defence.overclock', { s: ((d.overclock?.creditBonusMs || 0) / 1000).toFixed(1) });
    default: return '';
  }
}

const row = (k, v) => `<div class="tt-row"><span class="tt-k">${k}</span><span class="tt-v">${v}</span></div>`;

export function createTooltip(rootEl, getState) {
  const el = document.createElement('div');
  el.className = 'trs-tooltip';
  el.style.display = 'none';
  document.body.appendChild(el);

  function place(e) {
    const pad = 14;
    const r = el.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight) y = window.innerHeight - r.height - pad;
    el.style.left = `${Math.max(4, x)}px`;
    el.style.top = `${Math.max(4, y)}px`;
  }

  rootEl.addEventListener('mousemove', (e) => {
    if (getState().activePuzzle) { el.style.display = 'none'; return; } // don't cover the open puzzle
    const card = e.target.closest('[data-comp]');
    if (!card) { el.style.display = 'none'; return; }
    const eid = card.dataset.eid != null && card.dataset.eid !== '' ? Number(card.dataset.eid) : null;
    el.innerHTML = dossier(getState(), card.dataset.side, card.dataset.id, eid);
    el.style.display = '';
    place(e);
  });
  rootEl.addEventListener('mouseleave', () => { el.style.display = 'none'; });

  return { hide: () => { el.style.display = 'none'; } };
}

function dossier(state, side, id, eid) {
  const aircraft = side === 'player' ? state.player : state.enemies[eid];
  if (!aircraft) return '';
  const c = aircraft.components[id];
  const isPlayer = side === 'player';
  const sideLabel = isPlayer ? t('ui.you') : enemyLabel(aircraft);
  const pct = Math.round(hpFrac(c) * 100);
  const dead = c.hp <= 0;

  const rows = [];

  // header: name + side badge + HP (right-aligned)
  const hp = dead ? t('ui.destroyed') : `${Math.max(0, Math.round(c.hp))}/${c.maxHp} (${pct}%)`;
  rows.push(`<div class="tt-h"><b>${componentLabel(id)}</b> <span class="tt-side ${side}">${sideLabel}</span><span class="tt-hp${dead ? ' dead' : ''}">${hp}</span></div>`);

  // ROLE (+ 🔗 shield-link)
  let role = t(`tooltip.role.${id}.${isPlayer ? 'you' : 'foe'}`);
  const contrib = state.config.coreShield?.contributors?.[id];
  if (contrib && id !== 'core') {
    role += ` <span class="tt-dim">${t('tooltip.shieldLink', { pct: contrib, threshold: state.config.coreShield.threshold })}</span>`;
  }
  if (role) rows.push(row(t('tooltip.rowRole'), role));

  // Core shield state
  if (id === 'core') {
    const sh = coreShieldStatus(aircraft, state.config);
    if (sh.up) {
      const standing = sh.remaining.map((r) => `${componentLabel(r.id)} ${r.pct}%`).join(', ') || t('tooltip.standingNone');
      rows.push(row(t('tooltip.rowShield'), `<span class="tt-shield up">${t('tooltip.shieldUp')}</span> — ${t('tooltip.shieldUpDesc', { down: sh.downSum, threshold: sh.threshold, standing })}`));
    } else {
      rows.push(row(t('tooltip.rowShield'), `<span class="tt-shield down">${t('tooltip.shieldDown', { down: sh.downSum, threshold: sh.threshold })}</span> — ${t('tooltip.shieldDownDesc')}`));
    }
  }

  // ATTACK / DEFENCE — your parts only, and only while they can act
  if (isPlayer && !dead) {
    const eff = ATTACK_EFFECT[id];
    if (eff) rows.push(row(t('tooltip.rowAttack'), t(`tooltip.attack.${eff}`)));
    const verb = DEFENSE_VERB[id];
    if (verb) rows.push(row(t('tooltip.rowDefence'), defenceDesc(verb, state.config)));
  }

  // STATE — live debuffs + (player) telegraph/cooldown/carried + queued chain
  const bits = [];
  if (dead) bits.push(`<span class="tt-cd">${t('tooltip.destroyedState')}</span>`);
  for (const [k, s] of Object.entries(c.statuses).filter(([, s]) => s.turns > 0)) {
    bits.push(t(`tooltip.status.${k}`, { turns: s.turns, dot: Math.round(s.dot || 0) }));
  }
  if (isPlayer) {
    if (state.cooldowns?.[id] > 0) bits.push(`<span class="tt-cd">${t('tooltip.cooldown', { n: state.cooldowns[id] })}</span>`);
    const carry = [];
    if (c.carry && c.carry.shield > 0) carry.push(t('tooltip.carriedShield', { n: Math.round(c.carry.shield) }));
    if (c.carryHeal > 0) carry.push(t('tooltip.carriedField', { n: Math.round(c.carryHeal) }));
    if (carry.length) bits.push(t('tooltip.carried', { list: carry.join(', ') }));
    const incoming = state.enemies
      .filter((en) => en.telegraph && en.telegraph.visible)
      .map((en) => ({ en, x: (en.telegraph.display || en.telegraph.entries).find((y) => y.component === id) }))
      .filter((o) => o.x);
    if (incoming.length) {
      const detail = incoming.map((o) => `${enemyLabel(o.en)}${o.x.status ? ` (+${effectLabel(o.x.status)})` : ''}${o.x.uncertain ? '?' : ''}`).join(', ');
      const unreliable = incoming.some((o) => o.x.uncertain);
      bits.push(`<span class="tt-tel">${t('tooltip.incoming', { detail, unreliable })}</span>`);
    }
  }
  // this-phase queued chain (statuses on an enemy part / verbs on your part)
  const build = (!isPlayer && state.phase === PHASES.ATTACK_BUILD) || (isPlayer && state.phase === PHASES.DEFENSE_BUILD);
  if (build) {
    const q = state.queue
      .filter((x) => (!isPlayer ? (x.target && x.target.eid === eid && x.target.component === id) : (x.target === id)))
      .map((x) => (x.brk ? '⊘' : skillLabel(x.effect || x.verb)));
    if (q.length) bits.push(`<span class="tt-pending">${t('tooltip.queued', { chain: q.join(' → ') })}</span>`);
  }
  if (!bits.length) bits.push(`<span class="tt-dim">${t('tooltip.healthy', { isPlayer })}</span>`);
  rows.push(row(t('tooltip.rowState'), bits.join('<br>')));

  return rows.join('');
}
