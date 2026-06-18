// =============================================================================
//  view/render.js — draw the two aircraft boards (center pane)
// =============================================================================
//
//  Plain DOM, re-rendered on demand; one delegated click listener on the root
//  survives re-renders, so main.js supplies onComponentClick(side, id). Cards show
//  HP, statuses (with turns), stacked defenses (with amounts), and highlights that
//  follow the current build step (valid status target / Focus candidate / protect).
// =============================================================================

import { COMPONENT_IDS, ATTACK_EFFECT, DEFENSE_VERB, isAlive, isEffectValidOn } from '../core/components.js';
import { PHASES } from '../core/state.js';
import { coreShieldUp } from '../core/cascade.js';

const STATUS_ICON = { freeze: '❄️', confuse: '🌀', drain: '🩸', burning: '🔥', shatter: '💥' };
const DEF_ICON = { shield: '🛡️', repair: '🔧', cleanse: '🧹', harden: '🪨', overclock: '⚡' };

/**
 * @param clickRoot  element to attach the delegated click listener to (covers both boards)
 * @param els        { enemy, player } the two wrap elements the boards render into
 */
export function createRenderer(clickRoot, els, onComponentClick) {
  clickRoot.addEventListener('click', (e) => {
    const card = e.target.closest('[data-comp]');
    if (!card || card.classList.contains('noclick')) return;
    onComponentClick(card.dataset.side, card.dataset.id);
  });
  return (state) => {
    els.enemy.innerHTML = enemyHtml(state);
    els.player.innerHTML = playerHtml(state);
  };
}

function enemyHtml(state) {
  return `
    <div class="board enemy-board">
      <div class="board-label">ENEMY${labelArchetype(state)}</div>
      <div class="cards">${COMPONENT_IDS.map((id) => cardHtml(state, 'enemy', id)).join('')}</div>
    </div>
    <div class="phase-banner">${phaseBanner(state)}</div>`;
}

function playerHtml(state) {
  return `
    <div class="board player-board">
      <div class="board-label">YOU</div>
      <div class="cards">${COMPONENT_IDS.map((id) => cardHtml(state, 'player', id)).join('')}</div>
    </div>`;
}

function labelArchetype(state) {
  const a = state.config.archetypes[state.archetype];
  return a ? ` · ${a.label}` : '';
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

function cardHtml(state, side, id) {
  const c = (side === 'player' ? state.player : state.enemy).components[id];
  const dead = c.hp <= 0;
  const pct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
  const aircraft = side === 'player' ? state.player : state.enemy;
  const classes = ['comp', side, id];
  if (dead) classes.push('dead', 'noclick');
  if (id === 'core') {
    classes.push('core');
    if (!dead && coreShieldUp(aircraft, state.config)) classes.push('shielded');
  }

  // step-aware highlighting
  if (!dead && side === 'enemy') {
    if (state.pendingAction) {
      if (isEffectValidOn(state.pendingAction.effect, id)) classes.push('valid-target');
      else classes.push('invalid-target', 'noclick');
    } else if (state.pickFocus) classes.push('focus-candidate');
  }
  if (!dead && side === 'player' && state.pendingDefense) classes.push('valid-target');
  if (side === 'enemy' && state.focus === id && state.phase !== PHASES.ATTACK_BUILD) classes.push('focus');
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

  // Pending offensive statuses queued onto this enemy part this phase — shown
  // greyed right away so the player sees what they applied; they land at Resolve.
  let pending = '';
  if (side === 'enemy' && (state.phase === PHASES.ATTACK_BUILD)) {
    const counts = {};
    for (const a of state.queue) if (a.target === id) counts[a.effect] = (counts[a.effect] || 0) + 1;
    pending = Object.entries(counts)
      .map(([k, n]) => `<span class="st pending" title="${k} — applies at Resolve">${STATUS_ICON[k] || '•'}${n > 1 ? `×${n}` : ''}</span>`)
      .join('');
  }

  let tel = '';
  if (side === 'player' && state.telegraph && state.telegraph.visible) {
    const e = state.telegraph.entries.find((x) => x.component === id);
    if (e) tel = `<span class="tel" title="incoming">⚠️${e.status ? STATUS_ICON[e.status] || '' : ''}</span>`;
  }

  const role = roleHint(side, id, state);
  return `
    <div class="${classes.join(' ')}" data-comp data-side="${side}" data-id="${id}">
      <div class="cn">${c.name}</div>
      <div class="hpbar"><div class="hpfill" style="width:${pct}%"></div></div>
      <div class="hpnum">${Math.max(0, Math.round(c.hp))}/${c.maxHp}</div>
      <div class="badges">${statuses}${pending}${defenses}${tel}</div>
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
