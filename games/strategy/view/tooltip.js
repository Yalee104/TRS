// =============================================================================
//  view/tooltip.js — hover dossier for any component (enemy or player)
// =============================================================================
//
//  A floating panel that appears while the cursor is inside a component box and
//  follows it, explaining EVERYTHING about that part so the player can decide
//  which status to apply and which part to focus-fire / protect:
//    • what it powers + its offensive effect (Table A) and valid targets (Table B)
//    • its defensive verb (B.0) • current HP, live statuses + turns, pre-loaded
//      defenses • cascade consequences (while damaged / when destroyed) • the
//      Reactor-Core shield state • any incoming telegraphed strike.
//  Lives in <body> so board re-renders never wipe it; driven purely off state.
// =============================================================================

import { ATTACK_EFFECT, DEFENSE_VERB, EFFECT_VALID_TARGETS, hpFrac } from '../core/components.js';
import { coreShieldStatus } from '../core/cascade.js';
import { PHASES } from '../core/state.js';

const SYSTEM = {
  core: 'The heart of the aircraft. If it reaches 0 HP the battle ends. Protected by an indestructible shield (below) until its shield-linked parts fall.',
  generator: 'Powers every system. Drives the largest share of your firepower (Combat Condition) and holds up the Reactor-Core shield.',
  weapon: 'Your base / automatic firepower. A big slice of Combat Condition.',
  tower: 'Sensors. YOUR Tower lets you SEE the enemy’s telegraphed strike (defend blind without it). An owner’s Tower also governs ITS aim — destroyed, its strikes scatter to random parts and land ~40% softer.',
  engine: 'Initiative (who resolves first) and evasion.',
  launchpad: 'Governs its OWNER’s TRS quality: healthy = easier grids (fewer blockers/traps), damaged = grids drift back to baseline, destroyed = congested. Also carries a share of attack strength.',
};

const EFFECT_DESC = {
  freeze: 'Freeze — suspends the part for its duration (a frozen offence part ≈ ×0 firepower). Synergy: a Frozen focus is brittle (+dmg).',
  confuse: 'Confuse — the part misfires / mis-aims.',
  drain: 'Drain — siphons HP and heals your Core.',
  burning: 'Burning — damage-over-time each round. Burning + Confused → Wildfire spreads to a neighbour.',
  shatter: 'Shatter — synergy: while Shattered the focus takes +50% from all your fire.',
};

const VERB_DESC = {
  shield: 'Shield — absorbs incoming damage (stacks additively).',
  repair: 'Repair — restores HP (applied to whichever part you target).',
  cleanse: 'Cleanse — strips all offensive statuses off the target.',
  harden: 'Harden — flat damage reduction (capped).',
  overclock: 'Overclock — boosts the target system (Tower vision / Engine evasion / etc.).',
};

const CASCADE = {
  generator: { damaged: 'Core shield link + 40% firepower weight.', dead: 'Reactor shield contribution lost + brownout: all output ×0.5.' },
  weapon: { damaged: '35% firepower weight; base damage scales with HP.', dead: 'Base firepower collapses (only weakened TRS add-ons remain).' },
  tower: { damaged: 'No change until destroyed (binary in v1).', dead: 'YOUR Tower → you defend blind (no telegraph preview). ENEMY Tower → its aim scatters to random parts and lands ~40% softer.' },
  engine: { damaged: 'Evasion + initiative scale with HP.', dead: 'No evasion; lose initiative (other side resolves first).' },
  launchpad: { damaged: 'TRS easing fades toward baseline; small attack-strength dip.', dead: 'Owner’s TRS congests (bigger grid, more blockers); loses its attack-strength share.' },
  core: { damaged: '', dead: 'Match over.' },
};

const pName = (state, side, id) => (side === 'player' ? state.player : state.enemy).components[id].name;

function validTargetsText(state, side, effect) {
  const v = EFFECT_VALID_TARGETS[effect];
  if (v === '*') return 'any part';
  return (v || []).map((id) => pName(state, side === 'player' ? 'enemy' : 'player', id)).join(', ');
}

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
    const card = e.target.closest('[data-comp]');
    if (!card) { el.style.display = 'none'; return; }
    el.innerHTML = dossier(getState(), card.dataset.side, card.dataset.id);
    el.style.display = '';
    place(e);
  });
  rootEl.addEventListener('mouseleave', () => { el.style.display = 'none'; });

  return { hide: () => { el.style.display = 'none'; } };
}

function dossier(state, side, id) {
  const c = (side === 'player' ? state.player : state.enemy).components[id];
  const sideLabel = side === 'player' ? 'YOU' : 'ENEMY';
  const pct = Math.round(hpFrac(c) * 100);
  const dead = c.hp <= 0;

  const rows = [];
  rows.push(`<div class="tt-h"><b>${c.name}</b> <span class="tt-side ${side}">${sideLabel}</span></div>`);
  rows.push(`<div class="tt-hp">HP ${Math.max(0, Math.round(c.hp))}/${c.maxHp} (${pct}%)${dead ? ' — DESTROYED' : ''}</div>`);
  rows.push(`<div class="tt-sys">${SYSTEM[id] || ''}</div>`);

  if (id === 'core') {
    const sh = coreShieldStatus(side === 'player' ? state.player : state.enemy, state.config);
    if (sh.up) {
      const rem = sh.remaining.map((r) => `${pName(state, side, r.id)} ${r.pct}%`).join(', ');
      rows.push(`<div class="tt-shield up">🛡️ Shield UP — Core takes 0 damage. Destroy shield-linked parts (${sh.downSum}/${sh.threshold}% down). Still standing: ${rem || 'none'}.</div>`);
    } else {
      rows.push(`<div class="tt-shield down">⚠️ Shield DOWN (${sh.downSum}/${sh.threshold}%) — the Core is exposed.</div>`);
    }
  }

  const eff = ATTACK_EFFECT[id];
  if (eff) rows.push(`<div class="tt-off"><b>Offence:</b> ${EFFECT_DESC[eff]}<br><span class="tt-dim">valid on: ${validTargetsText(state, side, eff)}</span></div>`);
  const verb = DEFENSE_VERB[id];
  if (verb) rows.push(`<div class="tt-def"><b>Defence:</b> ${VERB_DESC[verb]}</div>`);

  const casc = CASCADE[id];
  if (casc && (casc.damaged || casc.dead)) {
    rows.push(`<div class="tt-casc">${casc.damaged ? `<div>· damaged: ${casc.damaged}</div>` : ''}<div>· destroyed: ${casc.dead}</div></div>`);
  }

  const statuses = Object.entries(c.statuses).filter(([, s]) => s.turns > 0);
  if (statuses.length) rows.push(`<div class="tt-st">Statuses: ${statuses.map(([k, s]) => `${k} (${s.turns}t)`).join(', ')}</div>`);

  // pending queued statuses on this enemy part this attack phase
  if (side === 'enemy' && state.phase === PHASES.ATTACK_BUILD) {
    const q = state.queue.filter((a) => a.target === id).map((a) => a.effect);
    if (q.length) rows.push(`<div class="tt-pending">Queued (applies at Resolve): ${q.join(', ')}</div>`);
  }

  const defs = Object.entries(c.defenses || {}).filter(([, v]) => v);
  if (defs.length) rows.push(`<div class="tt-defs">Pre-loaded: ${defs.map(([k, v]) => `${k}${typeof v === 'number' ? ' ' + Math.round(v * (k === 'harden' || k === 'overclock' ? 100 : 1)) + (k === 'harden' || k === 'overclock' ? '%' : '') : ''}`).join(', ')}</div>`);

  if (side === 'player' && state.telegraph && state.telegraph.visible) {
    const t = state.telegraph.entries.find((x) => x.component === id);
    if (t) rows.push(`<div class="tt-tel">⚠️ Incoming strike${t.status ? ` (+${t.status})` : ''}.</div>`);
  }

  return rows.join('');
}
