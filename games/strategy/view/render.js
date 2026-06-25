// =============================================================================
//  view/render.js — draw the enemy boards (top) + the player board (bottom)
// =============================================================================
//
//  Plain DOM, re-rendered on demand; one delegated click listener on the root
//  survives re-renders, so main.js supplies onComponentClick(side, id, eid).
//  All visible text comes from the i18n catalog (view/../i18n).
// =============================================================================

import { COMPONENT_IDS, ATTACK_EFFECT, DEFENSE_VERB, isAlive, isOwned, isEffectValidOn } from '../core/components.js';
import { PHASES } from '../core/state.js';
import { coreShieldUp } from '../core/cascade.js';
import { OFFENSE_COMBOS, DEFENSE_COMBOS, lookupCombo } from '../combat/combos.js';
import { t, componentLabel, effectLabel, verbLabel, comboLabel, skillLabel, enemyLabel } from '../i18n/index.js';

const STATUS_ICON = { freeze: '❄️', confuse: '🌀', drain: '🩸', burning: '🔥', shatter: '💥' };
const COMBO_ICON = { meltdown: '🌋', stasisLock: '🔒', wildfire: '♨️' };
const DEF_ICON = { shield: '🛡️', repair: '🔧', cleanse: '🧹', harden: '🪨', overclock: '⚡' };
const BASE_OFFENSE_ORDER = ['freeze', 'confuse', 'drain', 'burning', 'shatter'];
// Combo icons keyed by combo id (combat/combos.js carries def.id).
const OFFENSE_COMBO_ICON = { glass: '🪟', stasisLock: '🔒', meltdown: '🌋', backfire: '💢', collapse: '🏚️', wildfire: '♨️', vaporize: '💨', feedback: '🔗' };
const DEFENSE_COMBO_ICON = { sustain: '🔁', purifiedBarrier: '✨', bastion: '🏰', reactivePlating: '🪞', fieldRepair: '🩹', deflect: '🤺', reboot: '🔄' };
const parseEid = (ds) => (ds.eid != null && ds.eid !== '' ? Number(ds.eid) : null);

// Localized name for an ACTIVE status key (base effect or ongoing combo-status).
const statusName = (k) => (STATUS_ICON[k] ? effectLabel(k) : (COMBO_ICON[k] ? comboLabel(k) : k));

export function createRenderer(clickRoot, els, onComponentClick, onBreak = () => {}) {
  clickRoot.addEventListener('click', (e) => {
    const brk = e.target.closest('.breakbtn');
    if (brk) { onBreak(brk.dataset.side, brk.dataset.id, parseEid(brk.dataset)); return; }
    const card = e.target.closest('[data-comp]');
    if (!card || card.classList.contains('noclick')) return;
    onComponentClick(card.dataset.side, card.dataset.id, parseEid(card.dataset));
  });
  return (state) => {
    els.enemy.innerHTML = enemyHtml(state);
    els.player.innerHTML = playerHtml(state);
  };
}

/** This phase's queued entries (statuses/verbs + breaks) for one component, in order. */
function queuedFor(state, side, id, eid) {
  return state.queue.filter((x) => (side === 'enemy'
    ? (x.target && x.target.eid === eid && x.target.component === id)
    : (x.target === id)));
}

/**
 * Queued-chain row with a LIVE combo preview: mirror the resolve chain (live entries
 * + this phase's queued additions/breaks), walk it greedily like resolveChain, and
 * COLLAPSE each comboing pair into a single combo icon. enemy → OFFENSE_COMBOS,
 * player → DEFENSE_COMBOS (carried shield is the live entry).
 */
function queuedChainHtml(state, side, id, eid, q) {
  const comp = (side === 'enemy' ? state.enemies[eid] : state.player).components[id];
  const table = side === 'enemy' ? OFFENSE_COMBOS : DEFENSE_COMBOS;
  const comboIcon = side === 'enemy' ? OFFENSE_COMBO_ICON : DEFENSE_COMBO_ICON;
  const icon = side === 'enemy' ? STATUS_ICON : DEF_ICON;

  const live = side === 'enemy'
    ? BASE_OFFENSE_ORDER.filter((k) => comp.statuses[k] && comp.statuses[k].turns > 0).map((k) => ({ key: k, fresh: false }))
    : (comp.carry && comp.carry.shield > 0 ? [{ key: 'shield', fresh: false }] : []);
  const queued = q.map((x) => (x.brk ? { brk: true } : { key: x.effect || x.verb, fresh: true }));
  const chain = [...live, ...queued];

  const out = [];
  let i = 0;
  while (i < chain.length) {
    const e = chain[i];
    if (e.brk) { out.push(`<span class="brk" title="${t('ui.title.break')}">⊘</span>`); i += 1; continue; }
    const n = chain[i + 1];
    if (n && !n.brk) {
      const def = lookupCombo(table, e.key, n.key);
      if (def && (e.fresh || n.fresh)) {
        const fo = def.focusOnly ? t('ui.title.focusOnly') : '';
        const recipe = `${skillLabel(e.key)}+${skillLabel(n.key)}`;
        out.push(`<span class="combo-prev" title="${t('ui.title.comboForms', { name: comboLabel(def.id), recipe, fo })}">${comboIcon[def.id] || '✦'}</span>`);
        i += 2; continue;
      }
    }
    if (e.fresh) out.push(`<span class="st pending" title="${t('ui.title.queued', { name: skillLabel(e.key) })}">${icon[e.key] || '•'}</span>`);
    i += 1;
  }
  return out.join('');
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
      <div class="board-label">${enemyLabel(enemy)}${dead ? ` · ${t('ui.defeated')}` : ''}</div>
      <div class="cards">${COMPONENT_IDS.map((id) => cardHtml(state, 'enemy', id, enemy.eid)).join('')}</div>
    </div>`;
}

function playerHtml(state) {
  // Render only the components the player actually owns (unowned parts don't exist yet — they're
  // not on the board). Size the grid to the owned count so the row isn't sparse.
  const owned = COMPONENT_IDS.filter((id) => isOwned(state.player.components[id]));
  return `
    <div class="board player-board">
      <div class="board-label">${t('ui.you')}</div>
      <div class="cards" style="grid-template-columns:repeat(${Math.max(1, owned.length)},1fr)">${owned.map((id) => cardHtml(state, 'player', id, null)).join('')}</div>
    </div>`;
}

function phaseBanner(state) {
  switch (state.phase) {
    case PHASES.CONFIG: return t('ui.banner.config');
    case PHASES.ATTACK_BUILD: return t('ui.banner.attack', { n: state.round });
    case PHASES.DEFENSE_BUILD: return t('ui.banner.defense', { n: state.round });
    case PHASES.WON: return t('ui.banner.won');
    case PHASES.LOST: return t('ui.banner.lost');
    default: return t('ui.banner.round', { n: state.round });
  }
}

function cardHtml(state, side, id, eid) {
  const aircraft = side === 'player' ? state.player : state.enemies[eid];
  const c = aircraft.components[id];
  const dead = c.hp <= 0;
  const unowned = side === 'player' && !isOwned(c);   // run meta-layer: not acquired yet
  const pct = Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100));
  const classes = ['comp', side, id];
  if (unowned) classes.push('unowned', 'noclick');
  else if (dead) classes.push('dead', 'noclick');
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
  if (!dead && !unowned && side === 'player' && state.pendingDefense) classes.push('valid-target');
  if (side === 'player' && state.cooldowns?.[id] > 0) classes.push('cooldown');
  if (!dead && side === 'player' && state.phase === PHASES.ATTACK_BUILD && state.usedComponents?.[id]) classes.push('used', 'noclick');

  // ACTIVE statuses (base + ongoing combo-statuses), with turns
  const statuses = Object.entries(c.statuses)
    .filter(([, s]) => s.turns > 0)
    .map(([k, s]) => `<span class="st" title="${t('ui.title.statusActive', { name: statusName(k), n: s.turns })}">${STATUS_ICON[k] || COMBO_ICON[k] || '•'}${s.turns}</span>`)
    .join('');

  // locked badge for an unacquired component (run meta-layer)
  const lock = unowned ? `<span class="st" title="${t('ui.locked')}">🔒</span>` : '';

  // carried defensive states (Sustain shield / Field Repair HoT)
  let carried = '';
  if (side === 'player') {
    if (c.carry && c.carry.shield > 0) carried += `<span class="df" title="${t('ui.title.carriedSustain')}">🛡️${Math.round(c.carry.shield)}</span>`;
    if (c.carryHeal > 0) carried += `<span class="df" title="${t('ui.title.carriedField')}">🔧${Math.round(c.carryHeal)}</span>`;
  }

  // QUEUED chain this phase, comboing pairs collapsed to a live combo icon
  let queued = '';
  let breakBtn = '';
  const buildSide = (side === 'enemy' && state.phase === PHASES.ATTACK_BUILD)
    || (side === 'player' && state.phase === PHASES.DEFENSE_BUILD);
  if (buildSide && !dead && !unowned) {
    const q = queuedFor(state, side, id, eid);
    queued = queuedChainHtml(state, side, id, eid, q);
    if (q.length && !q[q.length - 1].brk) {
      breakBtn = `<span class="breakbtn" data-side="${side}" data-id="${id}"${side === 'enemy' ? ` data-eid="${eid}"` : ''} title="${t('ui.title.insertBreak')}">⊘</span>`;
    }
  }

  const cd = (side === 'player' && state.cooldowns?.[id] > 0)
    ? `<span class="cdbadge" title="${t('ui.title.cooldown', { n: state.cooldowns[id] })}">⏳${state.cooldowns[id]}</span>` : '';

  // Telegraph: aggregate incoming strikes (the DISPLAYED prediction) from EVERY living enemy.
  let tel = '';
  if (side === 'player') {
    const incoming = [];
    for (const en of state.enemies) {
      if (!en.telegraph || !en.telegraph.visible) continue;
      const ent = (en.telegraph.display || en.telegraph.entries).find((x) => x.component === id);
      if (ent) incoming.push(ent);
    }
    if (incoming.length) {
      const uncertain = incoming.some((e) => e.uncertain);
      const badges = incoming.filter((e) => e.status)
        .map((e) => `<span class="st pending${e.uncertain ? ' uncertain' : ''}" title="${t('ui.title.incoming', { name: effectLabel(e.status), uncertain: e.uncertain })}">${STATUS_ICON[e.status] || ''}${e.uncertain ? '?' : ''}</span>`)
        .join('');
      const n = incoming.length;
      const title = uncertain ? t('ui.title.telUnreliable') : t('ui.title.telReliable', { n });
      tel = `<span class="tel${uncertain ? ' uncertain' : ''}" title="${title}">⚠️${uncertain ? '?' : ''}${n > 1 ? `×${n}` : ''}</span>${badges}`;
    }
  }

  const role = roleHint(side, id, state);
  const queuedRow = (queued || breakBtn) ? `<div class="queued">${queued}${breakBtn}</div>` : '';
  return `
    <div class="${classes.join(' ')}" data-comp data-side="${side}" data-id="${id}"${side === 'enemy' ? ` data-eid="${eid}"` : ''}>
      <div class="cn">${componentLabel(id)}</div>
      <div class="hpbar"><div class="hpfill" style="width:${pct}%"></div></div>
      <div class="hpnum">${Math.max(0, Math.round(c.hp))}/${c.maxHp}</div>
      <div class="badges">${lock}${statuses}${carried}${cd}${tel}</div>
      ${queuedRow}
      ${role ? `<div class="role">${role}</div>` : ''}
    </div>`;
}

function roleHint(side, id, state) {
  if (id === 'core') return '';
  if (side === 'player' && !isOwned(state.player.components[id])) return '';   // locked → no role hint
  if (side === 'player' && state.phase === PHASES.ATTACK_BUILD) return ATTACK_EFFECT[id] ? effectLabel(ATTACK_EFFECT[id]) : '';
  if (side === 'player' && state.phase === PHASES.DEFENSE_BUILD) return DEFENSE_VERB[id] ? verbLabel(DEFENSE_VERB[id]) : '';
  return '';
}
