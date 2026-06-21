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
  core: 'The heart of the aircraft. If it reaches 0 HP the battle ends. Protected by an indestructible shield (below) until enough shield-linked parts are destroyed.',
  generator: 'Powers every system. Drives the largest share of your firepower (Combat Condition) and is the biggest shield-linked part.',
  weapon: 'Your base / automatic firepower — a big slice of Combat Condition.',
  tower: 'Sensors — two roles. VISION: YOUR Tower lets you SEE the enemy’s telegraphed strike before you defend; lose it (destroyed, Frozen, or CONFUSED) and you defend blind. AIM: the owner’s Tower governs its targeting — destroy the ENEMY’s Tower (or Freeze it) and its strikes SCATTER to random parts and deal only ×0.6 damage (Confuse does NOT scatter aim).',
  engine: 'Evasion — dodges part of every hit (×0.15 at full HP, scaling with HP). YOUR Engine reduces ALL incoming damage in defense; the ENEMY’s Engine dodges part of your focus-fire in attack. Destroyed/Frozen → 0% (hits land in full). (Initiative/resolve-order is parked.)',
  launchpad: 'Governs its OWNER’s TRS quality: healthy = easier grids (fewer blockers/traps), damaged = grids drift to baseline, destroyed = congested. Also carries a small share of attack strength.',
};

const EFFECT_DESC = {
  freeze: 'Freeze — suspends the part for its duration: ×0 firepower contribution AND its system goes offline. Frozen Tower → suspends both roles: an enemy Tower’s aim scatters, YOUR Tower goes blind (no telegraph). Frozen Engine → no evasion. Alone: a Frozen focus is brittle (+40% dmg). ⚠ Cancels with Burning.',
  confuse: 'Confuse — scrambles the part’s fire: −50% of its firepower contribution to the enemy’s next attack. On a TOWER it also jams the sensors → that owner loses telegraph vision (a confused YOUR Tower = you defend blind). (Meaningful on Weapon / Tower.)',
  drain: 'Drain — siphons the part: damage feeds your firepower pool AND heals your Core; also chokes the part’s output (×0.6).',
  burning: 'Burning — damage-over-time each round that BYPASSES the Core shield (the anti-shield tool). ⚠ Cancels with Freeze.',
  shatter: 'Shatter — alone, the part takes +50% from all your fire; valid on ANY part, so it’s the universal combo enabler (Glass, Meltdown, Backfire, Collapse).',
};

// Defence verb description (v2), pulling the actual numbers from config.
function verbDesc(verb, config) {
  const d = config.defense || {};
  switch (verb) {
    case 'shield': return `Shield — absorbs incoming damage; +${d.shield?.absorbPerPotency} per potency, stacks additively.`;
    case 'repair': return `Repair — restores HP to the target part; +${d.repair?.hpPerPotency} per potency (applied after the strike).`;
    case 'cleanse': return 'Cleanse — strips the OLDEST 1 status off the target (FCFS). It runs before the strike, so it can’t stop an incoming status (those land after your defenses). Reboot (Cleanse+Overclock) strips ALL.';
    case 'harden':
      return `Harden — % off the FIRST incoming hit only: +${Math.round((d.harden?.reductionPerPotency || 0) * 100)}% per potency, capped at ${Math.round((d.harden?.maxReduction || 0) * 100)}%; combines with Engine evasion (90% total cap). Bastion (Shield+Harden) caps ALL hits instead.`;
    case 'overclock':
      return `Overclock — banks +${((d.overclock?.creditBonusMs || 0) / 1000).toFixed(1)}s of build-credit for your NEXT attack phase (stacks; grants nothing if it forms a combo).`;
    default: return '';
  }
}

const CASCADE = {
  generator: { damaged: 'Core shield link + 40% firepower weight.', dead: 'Reactor shield contribution lost + brownout: all output ×0.5.' },
  weapon: { damaged: '35% firepower weight; base damage scales with HP.', dead: 'Base firepower collapses (only weakened TRS add-ons remain).' },
  tower: { damaged: 'No change until destroyed (binary in v1).', dead: 'YOUR Tower → you defend blind (no telegraph preview). ENEMY Tower → its aim scatters to random parts and lands ~40% softer.' },
  engine: { damaged: 'Evasion fades with HP (less dodge, both in defense and vs your focus-fire).', dead: 'No evasion — incoming hits and your focus-fire on it land in full.' },
  launchpad: { damaged: 'TRS easing fades toward baseline; small attack-strength dip.', dead: 'Owner’s TRS congests (bigger grid, more blockers); loses its attack-strength share.' },
  core: { damaged: '', dead: 'Match over.' },
};

// component display names are identical across aircraft, so read them off the player
const compName = (state, id) => state.player.components[id].name;

function validTargetsText(state, effect) {
  const v = EFFECT_VALID_TARGETS[effect];
  if (v === '*') return 'any part';
  return (v || []).map((id) => compName(state, id)).join(', ');
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
  const sideLabel = side === 'player' ? 'YOU' : aircraft.label;
  const pct = Math.round(hpFrac(c) * 100);
  const dead = c.hp <= 0;

  const rows = [];
  rows.push(`<div class="tt-h"><b>${c.name}</b> <span class="tt-side ${side}">${sideLabel}</span></div>`);
  rows.push(`<div class="tt-hp">HP ${Math.max(0, Math.round(c.hp))}/${c.maxHp} (${pct}%)${dead ? ' — DESTROYED' : ''}</div>`);
  rows.push(`<div class="tt-sys">${SYSTEM[id] || ''}</div>`);

  if (id === 'core') {
    const sh = coreShieldStatus(aircraft, state.config);
    if (sh.up) {
      const rem = sh.remaining.map((r) => `${compName(state, r.id)} ${r.pct}%`).join(', ');
      rows.push(`<div class="tt-shield up">🛡️ Shield UP — Core takes 0 damage. Destroy shield-linked parts (${sh.downSum}/${sh.threshold}% down). Still standing: ${rem || 'none'}.</div>`);
    } else {
      rows.push(`<div class="tt-shield down">⚠️ Shield DOWN (${sh.downSum}/${sh.threshold}%) — the Core is exposed.</div>`);
    }
  }

  // shield-linked parts: destroying them counts toward dropping the Core shield
  const contrib = state.config.coreShield?.contributors?.[id];
  if (contrib && id !== 'core') {
    rows.push(`<div class="tt-shield">🔗 Shield-linked: destroying it adds ${contrib}% toward dropping the Core shield (needs ${state.config.coreShield.threshold}%).</div>`);
  }

  const eff = ATTACK_EFFECT[id];
  if (eff) rows.push(`<div class="tt-off"><b>Offence:</b> ${EFFECT_DESC[eff]}<br><span class="tt-dim">valid on: ${validTargetsText(state, eff)}</span></div>`);
  const verb = DEFENSE_VERB[id];
  if (verb) rows.push(`<div class="tt-def"><b>Defence:</b> ${verbDesc(verb, state.config)}</div>`);

  // Why a player part may be greyed out with no statuses: a failed TRS cools it down.
  if (side === 'player' && state.cooldowns?.[id] > 0) {
    rows.push(`<div class="tt-cd">⏳ Recovering from a failed TRS — unusable for ${state.cooldowns[id]} more round(s).</div>`);
  }

  const casc = CASCADE[id];
  if (casc && (casc.damaged || casc.dead)) {
    rows.push(`<div class="tt-casc">${casc.damaged ? `<div>· damaged: ${casc.damaged}</div>` : ''}<div>· destroyed: ${casc.dead}</div></div>`);
  }

  const statuses = Object.entries(c.statuses).filter(([, s]) => s.turns > 0);
  if (statuses.length) rows.push(`<div class="tt-st">Statuses: ${statuses.map(([k, s]) => `${k} (${s.turns}t)`).join(', ')}</div>`);

  // this-phase queued chain (statuses on an enemy part / verbs on your part), in order with breaks
  const build = (side === 'enemy' && state.phase === PHASES.ATTACK_BUILD) || (side === 'player' && state.phase === PHASES.DEFENSE_BUILD);
  if (build) {
    const q = state.queue
      .filter((x) => (side === 'enemy' ? (x.target && x.target.eid === eid && x.target.component === id) : (x.target === id)))
      .map((x) => (x.brk ? '⊘' : (x.effect || x.verb)));
    if (q.length) rows.push(`<div class="tt-pending">Queued chain: ${q.join(' → ')} <span class="tt-dim">(combos form on adjacent pairs; ⊘ = break)</span></div>`);
  }

  // carried defensive states (Sustain shield / Field Repair HoT)
  if (side === 'player') {
    const carry = [];
    if (c.carry && c.carry.shield > 0) carry.push(`shield ${Math.round(c.carry.shield)}`);
    if (c.carryHeal > 0) carry.push(`field-repair ${Math.round(c.carryHeal)}/next`);
    if (carry.length) rows.push(`<div class="tt-defs">Carried: ${carry.join(', ')}</div>`);
  }

  if (side === 'player') {
    const incoming = state.enemies
      .filter((en) => en.telegraph && en.telegraph.visible)
      .map((en) => ({ en, t: en.telegraph.entries.find((x) => x.component === id) }))
      .filter((x) => x.t);
    if (incoming.length) {
      const detail = incoming.map((x) => `${x.en.label}${x.t.status ? ` (+${x.t.status})` : ''}`).join(', ');
      rows.push(`<div class="tt-tel">⚠️ Incoming strike from: ${detail}.</div>`);
    }
  }

  return rows.join('');
}
