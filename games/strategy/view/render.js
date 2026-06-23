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
import { OFFENSE_COMBOS, DEFENSE_COMBOS, lookupCombo } from '../combat/combos.js';

const STATUS_ICON = { freeze: '❄️', confuse: '🌀', drain: '🩸', burning: '🔥', shatter: '💥' };
const COMBO_ICON = { meltdown: '🌋', stasisLock: '🔒', wildfire: '♨️' };
const DEF_ICON = { shield: '🛡️', repair: '🔧', cleanse: '🧹', harden: '🪨', overclock: '⚡' };
// Base-status order the resolve uses to build the chain (mirror of BASE_OFFENSE).
const BASE_OFFENSE_ORDER = ['freeze', 'confuse', 'drain', 'burning', 'shatter'];
// Combo icons (kept in sync with view/comboInfo.js).
const OFFENSE_COMBO_ICON = {
  Glass: '🪟', 'Stasis Lock': '🔒', Meltdown: '🌋', Backfire: '💢',
  Collapse: '🏚️', Wildfire: '♨️', Vaporize: '💨', 'Feedback Cascade': '🔗',
};
const DEFENSE_COMBO_ICON = {
  Sustain: '🔁', 'Purified Barrier': '✨', Bastion: '🏰', 'Reactive Plating': '🪞',
  'Field Repair': '🩹', Deflect: '🤺', Reboot: '🔄',
};
const parseEid = (ds) => (ds.eid != null && ds.eid !== '' ? Number(ds.eid) : null);

/**
 * @param clickRoot  element to attach the delegated click listener to (covers all boards)
 * @param els        { enemy, player } the wrap elements the boards render into
 * @param onComponentClick (side, id, eid)
 * @param onBreak    (side, id, eid) — insert a chain break on that component
 */
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
 * Render the queued-chain row with a LIVE combo preview: mirror the resolve chain
 * (live entries + this phase's queued additions/breaks) and walk it greedily exactly
 * like `resolveChain`, but COLLAPSE each comboing pair into a single combo icon —
 * `[status1][status2]` becomes `[combo]` as soon as the pair forms, no wait for resolve.
 *   - enemy/attack: live = base statuses; pairs use OFFENSE_COMBOS.
 *   - player/defense: live = a carried (Sustain/Bastion/…) shield; pairs use DEFENSE_COMBOS.
 * Live (non-fresh) leftovers aren't re-drawn here — they already show in the badges row;
 * only this-phase queued leftovers + breaks render alongside the collapsed combos.
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
    if (e.brk) { out.push('<span class="brk" title="break — a combo can\'t form across this">⊘</span>'); i += 1; continue; }
    const n = chain[i + 1];
    if (n && !n.brk) {
      const def = lookupCombo(table, e.key, n.key);          // ≥1 fresh entry, mirrors resolveChain
      if (def && (e.fresh || n.fresh)) {
        const fo = def.focusOnly ? ' · focus only' : '';
        out.push(`<span class="combo-prev" title="${def.name} — ${e.key}+${n.key}${fo} (forms at resolve)">${comboIcon[def.name] || '✦'}</span>`);
        i += 2; continue;
      }
    }
    // single entry: only this-phase queued additions render here (live ones are in the badges row)
    if (e.fresh) out.push(`<span class="st pending" title="queued ${e.key} — resolves this phase">${icon[e.key] || '•'}</span>`);
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

  // ACTIVE statuses (base + ongoing combo-statuses), with turns
  const statuses = Object.entries(c.statuses)
    .filter(([, s]) => s.turns > 0)
    .map(([k, s]) => `<span class="st" title="${k} (${s.turns} turn${s.turns > 1 ? 's' : ''})">${STATUS_ICON[k] || COMBO_ICON[k] || '•'}${s.turns}</span>`)
    .join('');

  // carried defensive states (Sustain shield / Field Repair HoT)
  let carried = '';
  if (side === 'player') {
    if (c.carry && c.carry.shield > 0) carried += `<span class="df" title="Sustain shield (carried to next defense)">🛡️${Math.round(c.carry.shield)}</span>`;
    if (c.carryHeal > 0) carried += `<span class="df" title="Field Repair (heals next defense)">🔧${Math.round(c.carryHeal)}</span>`;
  }

  // QUEUED chain this phase, with comboing pairs collapsed to a live combo icon
  // (enemy → offensive combos, player → defensive combos). See queuedChainHtml.
  let queued = '';
  let breakBtn = '';
  const buildSide = (side === 'enemy' && state.phase === PHASES.ATTACK_BUILD)
    || (side === 'player' && state.phase === PHASES.DEFENSE_BUILD);
  if (buildSide && !dead) {
    const q = queuedFor(state, side, id, eid);
    queued = queuedChainHtml(state, side, id, eid, q);
    if (q.length && !q[q.length - 1].brk) {
      breakBtn = `<span class="breakbtn" data-side="${side}" data-id="${id}"${side === 'enemy' ? ` data-eid="${eid}"` : ''} title="insert a break so the next pair won't combo">⊘</span>`;
    }
  }

  const cd = (side === 'player' && state.cooldowns?.[id] > 0)
    ? `<span class="cdbadge" title="recovering from a failed TRS — ${state.cooldowns[id]} round(s) left">⏳${state.cooldowns[id]}</span>` : '';

  // Telegraph: aggregate incoming strikes (the DISPLAYED prediction) from EVERY living enemy.
  // A confused Tower marks predictions `uncertain` → rendered faded with a "?" (could be a false alarm).
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
      const carried = incoming.filter((e) => e.status)
        .map((e) => `<span class="st pending${e.uncertain ? ' uncertain' : ''}" title="incoming ${e.status}${e.uncertain ? ' — UNRELIABLE (Tower confused)' : ' — lands AFTER your defenses'}">${STATUS_ICON[e.status] || ''}${e.uncertain ? '?' : ''}</span>`)
        .join('');
      const n = incoming.length;
      const title = uncertain ? 'incoming? — UNRELIABLE (Tower confused, ~50% false alarms)' : `incoming strike${n > 1 ? ` from ${n} enemies` : ''}`;
      tel = `<span class="tel${uncertain ? ' uncertain' : ''}" title="${title}">⚠️${uncertain ? '?' : ''}${n > 1 ? `×${n}` : ''}</span>${carried}`;
    }
  }

  const role = roleHint(side, id, state);
  const queuedRow = (queued || breakBtn) ? `<div class="queued">${queued}${breakBtn}</div>` : '';
  return `
    <div class="${classes.join(' ')}" data-comp data-side="${side}" data-id="${id}"${side === 'enemy' ? ` data-eid="${eid}"` : ''}>
      <div class="cn">${c.name}</div>
      <div class="hpbar"><div class="hpfill" style="width:${pct}%"></div></div>
      <div class="hpnum">${Math.max(0, Math.round(c.hp))}/${c.maxHp}</div>
      <div class="badges">${statuses}${carried}${cd}${tel}</div>
      ${queuedRow}
      ${role ? `<div class="role">${role}</div>` : ''}
    </div>`;
}

function roleHint(side, id, state) {
  if (id === 'core') return '';
  if (side === 'player' && state.phase === PHASES.ATTACK_BUILD) return ATTACK_EFFECT[id] || '';
  if (side === 'player' && state.phase === PHASES.DEFENSE_BUILD) return DEFENSE_VERB[id] || '';
  return '';
}
