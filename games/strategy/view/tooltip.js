// =============================================================================
//  view/tooltip.js — hover dossier for any component (enemy or player)
// =============================================================================
//
//  A floating panel that appears while the cursor is inside a component box and
//  follows it. Content is organised into LABELED, SIDE-AWARE sections so each
//  idea is stated once and only what APPLIES to that part on that side shows:
//    ROLE     what the part does for its owner + the side-relevant kill payoff
//             (+ 🔗 shield-link); for the Core, the shield UP/DOWN state.
//    ATTACK   (your parts) the effect this part fires when you solve it.
//    DEFENCE  (your parts) the verb this part solves for.
//    STATE    live debuffs (+turns), incoming telegraph, cooldown, carried
//             defenses, queued chain, or DESTROYED.
//  Any status applies to any component now (Table B dropped — see core/components.js),
//  so there's no "valid on" / "apply here" list.
//  Lives in <body> so board re-renders never wipe it; driven purely off state.
// =============================================================================

import { ATTACK_EFFECT, DEFENSE_VERB, hpFrac } from '../core/components.js';
import { coreShieldStatus } from '../core/cascade.js';
import { PHASES } from '../core/state.js';

// ROLE — owner role folded with the side-specific consequence (you: "if lost";
// enemy: the kill/Freeze payoff). One line per side; the cascade detail lives here
// instead of a separate row.
const ROLE = {
  core: {
    you: 'The heart — if it reaches 0 HP you lose.',
    foe: 'The heart — reduce it to 0 to defeat this enemy.',
  },
  generator: {
    you: 'Powers everything — your largest firepower share (40%). Destroyed → brownout: all output ×0.5.',
    foe: 'Powers the enemy (40% of its firepower). Destroy it → the Core is exposed + brownout (its output ×0.5).',
  },
  weapon: {
    you: 'Your base / automatic firepower (35% of Combat Condition). Destroyed → base damage collapses.',
    foe: 'The enemy’s base firepower (35%). Destroy it → its base damage collapses.',
  },
  tower: {
    you: 'Sensors — you SEE the enemy’s telegraphed strike before you defend. Destroyed/Frozen → blind (no preview); Confused → telegraph stays but UNRELIABLE (~50% false).',
    foe: 'Sensors (aim). Destroy it or Freeze it → its strikes SCATTER to random parts and hit ~40% softer.',
  },
  engine: {
    you: 'Evasion — dodges part of every incoming hit (×0.15 at full HP, scaling with HP). Destroyed/Frozen → 0% (hits land in full).',
    foe: 'Evasion — dodges part of your focus-fire (scales with HP). Destroy it or Freeze it → your fire lands in full.',
  },
  launchpad: {
    you: 'Governs YOUR TRS quality: healthy = easier grids (fewer blockers/traps), damaged drifts to baseline, destroyed = congested. Also a small attack-strength share.',
    foe: 'Carries a small share of the enemy’s attack strength. (Its TRS-quality role only affects a side that solves puzzles — i.e. you.)',
  },
};

// ATTACK — the effect a PLAYER part fires when solved (the telegraph note for Confuse
// lives in the Tower ROLE, not here, since you apply Confuse to an enemy).
const ATTACK_DESC = {
  freeze: 'Freeze — suspends the target for its duration: ×0 firepower + its system goes offline. A frozen focus is brittle (+40% dmg). ⚠ Cancels with Burning.',
  confuse: 'Confuse — halves (−50%) the target’s firepower contribution to the enemy’s next attack.',
  drain: 'Drain — siphons the target’s HP into your firepower pool AND heals your Core; also chokes its output (×0.6).',
  burning: 'Burning — damage-over-time each round that BYPASSES the Core shield (the anti-shield tool). ⚠ Cancels with Freeze.',
  shatter: 'Shatter — the target takes +50% from all your fire; the universal combo enabler (Glass, Meltdown, Backfire, Collapse).',
};

// DEFENCE — the verb a PLAYER part solves for; numbers pulled from config.
function defenceDesc(verb, config) {
  const d = config.defense || {};
  switch (verb) {
    case 'shield': return `Shield — absorbs +${d.shield?.absorbPerPotency}/potency before HP (stacks).`;
    case 'repair': return `Repair — heals +${d.repair?.hpPerPotency}/potency, applied after the strike.`;
    case 'cleanse': return 'Cleanse — strips the OLDEST status (FCFS); Reboot (Cleanse+Overclock) strips all.';
    case 'harden': return `Harden — −${Math.round((d.harden?.reductionPerPotency || 0) * 100)}%/potency off the FIRST hit (cap ${Math.round((d.harden?.maxReduction || 0) * 100)}%; combines with evasion).`;
    case 'overclock': return `Overclock — banks +${((d.overclock?.creditBonusMs || 0) / 1000).toFixed(1)}s of build-credit for your next attack.`;
    default: return '';
  }
}

// STATE — one chip per live debuff, with turns + what it does to the part.
const STATUS_CHIP = {
  freeze: (s) => `❄️ Frozen ${s.turns}t — ×0 firepower, system offline`,
  confuse: (s) => `🌀 Confused ${s.turns}t — −50% firepower`,
  drain: (s) => `🩸 Draining ${s.turns}t — −40% firepower`,
  burning: (s) => `🔥 Burning ${s.turns}t — ${Math.round(s.dot || 0)}/round, bypasses shield`,
  shatter: (s) => `💥 Shattered ${s.turns}t — +50% damage taken`,
};

// component display names are identical across aircraft, so read them off the player
const compName = (state, id) => state.player.components[id].name;
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
  const sideLabel = isPlayer ? 'YOU' : aircraft.label;
  const pct = Math.round(hpFrac(c) * 100);
  const dead = c.hp <= 0;

  const rows = [];

  // header: name + side badge + HP (right-aligned)
  const hp = dead ? 'DESTROYED' : `${Math.max(0, Math.round(c.hp))}/${c.maxHp} (${pct}%)`;
  rows.push(`<div class="tt-h"><b>${c.name}</b> <span class="tt-side ${side}">${sideLabel}</span><span class="tt-hp${dead ? ' dead' : ''}">${hp}</span></div>`);

  // ROLE (+ 🔗 shield-link)
  let role = (ROLE[id] && ROLE[id][isPlayer ? 'you' : 'foe']) || '';
  const contrib = state.config.coreShield?.contributors?.[id];
  if (contrib && id !== 'core') {
    role += ` <span class="tt-dim">🔗 Shield-link ${contrib}% (toward exposing the Core, needs ${state.config.coreShield.threshold}%).</span>`;
  }
  if (role) rows.push(row('Role', role));

  // Core shield state
  if (id === 'core') {
    const sh = coreShieldStatus(aircraft, state.config);
    if (sh.up) {
      const rem = sh.remaining.map((r) => `${compName(state, r.id)} ${r.pct}%`).join(', ');
      rows.push(row('Shield', `<span class="tt-shield up">🛡️ UP</span> — Core takes 0 damage. Destroy linked parts (${sh.downSum}/${sh.threshold}% down). Standing: ${rem || 'none'}.`));
    } else {
      rows.push(row('Shield', `<span class="tt-shield down">⚠️ DOWN (${sh.downSum}/${sh.threshold}%)</span> — the Core is exposed.`));
    }
  }

  // ATTACK / DEFENCE — your parts only, and only while they can act
  if (isPlayer && !dead) {
    const eff = ATTACK_EFFECT[id];
    if (eff) rows.push(row('Attack', ATTACK_DESC[eff]));
    const verb = DEFENSE_VERB[id];
    if (verb) rows.push(row('Defence', defenceDesc(verb, state.config)));
  }

  // STATE — live debuffs + (player) telegraph/cooldown/carried + queued chain
  const bits = [];
  if (dead) bits.push('<span class="tt-cd">Destroyed — out of the fight.</span>');
  for (const [k, s] of Object.entries(c.statuses).filter(([, s]) => s.turns > 0)) {
    bits.push(STATUS_CHIP[k] ? STATUS_CHIP[k](s) : `${k} ${s.turns}t`);
  }
  if (isPlayer) {
    if (state.cooldowns?.[id] > 0) bits.push(`<span class="tt-cd">⏳ Recovering from a failed TRS — ${state.cooldowns[id]} more round(s).</span>`);
    const carry = [];
    if (c.carry && c.carry.shield > 0) carry.push(`shield ${Math.round(c.carry.shield)}`);
    if (c.carryHeal > 0) carry.push(`field-repair ${Math.round(c.carryHeal)}/next`);
    if (carry.length) bits.push(`🛡️ Carried: ${carry.join(', ')}`);
    const incoming = state.enemies
      .filter((en) => en.telegraph && en.telegraph.visible)
      .map((en) => ({ en, t: (en.telegraph.display || en.telegraph.entries).find((x) => x.component === id) }))
      .filter((x) => x.t);
    if (incoming.length) {
      const detail = incoming.map((x) => `${x.en.label}${x.t.status ? ` (+${x.t.status})` : ''}${x.t.uncertain ? '?' : ''}`).join(', ');
      const unreliable = incoming.some((x) => x.t.uncertain);
      bits.push(`<span class="tt-tel">⚠️ Incoming${unreliable ? ' (UNRELIABLE — Tower confused)' : ''} from ${detail}.</span>`);
    }
  }
  // this-phase queued chain (statuses on an enemy part / verbs on your part)
  const build = (!isPlayer && state.phase === PHASES.ATTACK_BUILD) || (isPlayer && state.phase === PHASES.DEFENSE_BUILD);
  if (build) {
    const q = state.queue
      .filter((x) => (!isPlayer ? (x.target && x.target.eid === eid && x.target.component === id) : (x.target === id)))
      .map((x) => (x.brk ? '⊘' : (x.effect || x.verb)));
    if (q.length) bits.push(`<span class="tt-pending">Queued: ${q.join(' → ')} <span class="tt-dim">(⊘ = break)</span></span>`);
  }
  if (!bits.length) bits.push(`<span class="tt-dim">Healthy · no debuffs${isPlayer ? ' · no incoming strike' : ''}.</span>`);
  rows.push(row('State', bits.join('<br>')));

  return rows.join('');
}
