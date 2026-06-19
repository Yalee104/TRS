// =============================================================================
//  view/render.js — draw the enemy boards (top) + the player board (bottom)
// =============================================================================
//
//  Plain DOM, re-rendered on demand; one delegated click listener on the root
//  survives re-renders, so main.js supplies onComponentClick(side, id, eid).
//  Up to four enemy aircraft sit in a row; each enemy card carries its data-eid.
//  Cards show HP, statuses (+turns), stacked defenses (+amounts), per-enemy
//  pending statuses, the firepower-cooldown badge, aggregated incoming telegraph,
//  and step-aware highlights (valid status target / Focus candidate / protect).
// =============================================================================

import { COMPONENT_IDS, ATTACK_EFFECT, DEFENSE_VERB, isAlive, isEffectValidOn } from '../core/components.js';
import { PHASES } from '../core/state.js';
import { coreShieldUp } from '../core/cascade.js';

const STATUS_ICON = { freeze: '❄️', confuse: '🌀', drain: '🩸', burning: '🔥', shatter: '💥' };
const DEF_ICON = { shield: '🛡️', repair: '🔧', cleanse: '🧹', harden: '🪨', overclock: '⚡' };

/**
 * @param clickRoot  element to attach the delegated click listener to (covers all boards)
 * @param els        { enemy, player } the wrap elements the boards render into
 */
export function createRenderer(clickRoot, els, onComponentClick) {
  clickRoot.addEventListener('click', (e) => {
    const card = e.target.closest('[data-comp]');
    if (!card || card.classList.contains('noclick')) return;
    const eid = card.dataset.eid != null && card.dataset.eid !== '' ? Number(card.dataset.eid) : null;
    onComponentClick(card.dataset.side, card.dataset.id, eid);
  });
  return (state) => {
    els.enemy.innerHTML = enemyHtml(state);
    els.player.innerHTML = playerHtml(state);
  };
}

function enemyHtml(state) {
  const boards = state.enemies.map((e) => enemyBoard(state, e)).join('');
  return `<div class="enemy-row" data-n="${state.enemies.length}">${boards}</div>
    <div class="phase-banner">${phaseBanner(state)}</div>`;
}

function enemyBoard(state, enemy) {
  const dead = !isAlive(enemy.components.core);
  return `
    <div class="board enemy-board${dead ? ' defeated' : ''}" data-eid="${enemy.eid}">
      <div class="board-label">${enemy.label}${dead ? ' · DEFEATED' : ''}</div>
      <div class="cards">${COMPONENT_IDS.map((id) => cardHtml(state, 'enemy', id, enemy.eid)).join('')}</div>
    </div>`;
}

function playerHtml(state) {
  return `
    <div class="board player-board">
      <div class="board-label">YOU</div>
      <div class="cards">${COMPONENT_IDS.map((id) => cardHtml(state, 'player', id, null)).join('')}</div>
    </div>`;
}

function phaseBanner(state) {
  const round = `Round ${state.round}`;
  switch (state.phase) {
    case PHASES.CONFIG: return 'Configure on the left, then ▶ Start Battle';
    case PHASES.ATTACK_BUILD: return `${round} — ATTACK ⚔️`;
    case PHASES.DEFENSE_BUILD: return `${round} — DEFENSE 🛡️`;
    case PHASES.WON: return '🏆 VICTORY';
    case PHASES.LOST: return '💀 DEFEAT';
    default: return round;
  }
}

function cardHtml(state, side, id, eid) {
  const aircraft = side === 'player' ? state.player : state.enemies[eid];
  const c = aircraft.components[id];
  const dead = c.hp <= 0;
  const pct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
  const classes = ['comp', side, id];
  if (dead) classes.push('dead', 'noclick');
  if (id === 'core') {
    classes.push('core');
    if (!dead && coreShieldUp(aircraft, state.config)) classes.push('shielded');
  }

  // step-aware highlighting
  if (side === 'enemy') {
    const enemyAlive = isAlive(state.enemies[eid].components.core);
    if (!dead && enemyAlive) {
      if (state.pendingAction) {
        if (isEffectValidOn(state.pendingAction.effect, id)) classes.push('valid-target');
        else classes.push('invalid-target', 'noclick');
      } else if (state.pickFocus) classes.push('focus-candidate');
    } else if (!enemyAlive) {
      classes.push('noclick');
    }
    if (state.focus && state.focus.eid === eid && state.focus.component === id && state.phase !== PHASES.ATTACK_BUILD) classes.push('focus');
  }
  if (!dead && side === 'player' && state.pendingDefense) classes.push('valid-target');
  if (side === 'player' && state.cooldowns?.[id] > 0) classes.push('cooldown');
  // attack: a weapon that already launched its TRS this phase is spent — grey it out
  if (!dead && side === 'player' && state.phase === PHASES.ATTACK_BUILD && state.usedComponents?.[id]) classes.push('used', 'noclick');

  const statuses = Object.entries(c.statuses)
    .filter(([, s]) => s.turns > 0)
    .map(([k, s]) => `<span class="st" title="${k} (${s.turns} turn${s.turns > 1 ? 's' : ''})">${STATUS_ICON[k] || '•'}${s.turns}</span>`)
    .join('');

  const defenses = Object.entries(c.defenses || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `<span class="df" title="queued ${k}">${DEF_ICON[k] || '+'}${defAmount(k, v)}</span>`)
    .join('');

  // Pending offensive statuses queued onto THIS enemy part this phase — greyed, land at Resolve.
  let pending = '';
  if (side === 'enemy' && state.phase === PHASES.ATTACK_BUILD) {
    const counts = {};
    for (const a of state.queue) if (a.target && a.target.eid === eid && a.target.component === id) counts[a.effect] = (counts[a.effect] || 0) + 1;
    pending = Object.entries(counts)
      .map(([k, n]) => `<span class="st pending" title="${k} — applies at Resolve">${STATUS_ICON[k] || '•'}${n > 1 ? `×${n}` : ''}</span>`)
      .join('');
  }

  const cd = (side === 'player' && state.cooldowns?.[id] > 0)
    ? `<span class="cdbadge" title="recovering from a failed TRS — ${state.cooldowns[id]} round(s) left">⏳${state.cooldowns[id]}</span>` : '';

  // Telegraph: aggregate incoming strikes from EVERY living enemy onto this player part.
  let tel = '';
  if (side === 'player') {
    const incoming = [];
    for (const en of state.enemies) {
      if (!en.telegraph || !en.telegraph.visible) continue;
      const ent = en.telegraph.entries.find((x) => x.component === id);
      if (ent) incoming.push(ent);
    }
    if (incoming.length) {
      const carried = incoming.filter((e) => e.status)
        .map((e) => `<span class="st pending" title="incoming ${e.status} — lands AFTER your defenses">${STATUS_ICON[e.status] || ''}</span>`)
        .join('');
      const n = incoming.length;
      tel = `<span class="tel" title="incoming strike${n > 1 ? ` from ${n} enemies` : ''}">⚠️${n > 1 ? `×${n}` : ''}</span>${carried}`;
    }
  }

  const role = roleHint(side, id, state);
  return `
    <div class="${classes.join(' ')}" data-comp data-side="${side}" data-id="${id}"${side === 'enemy' ? ` data-eid="${eid}"` : ''}>
      <div class="cn">${c.name}</div>
      <div class="hpbar"><div class="hpfill" style="width:${pct}%"></div></div>
      <div class="hpnum">${Math.max(0, Math.round(c.hp))}/${c.maxHp}</div>
      <div class="badges">${statuses}${pending}${defenses}${cd}${tel}</div>
      ${role ? `<div class="role">${role}</div>` : ''}
    </div>`;
}

function defAmount(verb, v) {
  if (verb === 'shield' || verb === 'repair') return ` ${Math.round(v)}`;
  if (verb === 'harden' || verb === 'overclock') return ` ${Math.round(v * 100)}%`;
  return '';
}

function roleHint(side, id, state) {
  if (id === 'core') return '';
  if (side === 'player' && state.phase === PHASES.ATTACK_BUILD) return ATTACK_EFFECT[id] || '';
  if (side === 'player' && state.phase === PHASES.DEFENSE_BUILD) return DEFENSE_VERB[id] || '';
  return '';
}
