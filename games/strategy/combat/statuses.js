// =============================================================================
//  combat/statuses.js — offensive statuses + the v2 chain combo resolver
// =============================================================================
//
//  Base statuses on a component: { key: {turns, potency, dot} }. v2 ongoing combos
//  collapse two base statuses into a single COMBO-STATUS (stasisLock / meltdown /
//  wildfire) that persists and ticks; burst combos fire once and consume. The
//  greedy chain algorithm lives in combos.js; this file applies the effects.
// =============================================================================

import { hasStatus, isAlive, statusTurns } from '../core/components.js';
import { logEvent } from '../core/state.js';
import { OFFENSE_COMBOS, resolveChain } from './combos.js';

/** The five base offensive statuses (combo-statuses are separate and don't re-combo). */
export const BASE_OFFENSE = ['freeze', 'confuse', 'drain', 'burning', 'shatter'];

// Fire ⊗ Freeze can't co-exist — applying one to a part that has the other wipes both (steam).
const OPPOSITE = { freeze: 'burning', burning: 'freeze' };

// Stacking policy (DESIGN §3.7 tuning): only Burning ADDS magnitude+duration (capped); every other
// status REFRESHES (keeps the stronger). The firepower pool always adds — handled in resolveAttack.
const STACK_ADD = { burning: true };

/**
 * Add or stack a status. Burning adds DoT (cap `dotCap`) + extends turns (cap `turns.stackMax`);
 * all others refresh to the stronger turns/dot/potency. Returns { canceled } if it annulled the
 * opposite status instead of applying. `config` enables Burning's caps (defaults to uncapped add).
 */
export function applyStatus(component, key, { turns = 1, potency = 0, dot = 0 } = {}, config = null) {
  const opp = OPPOSITE[key];
  if (opp && component.statuses[opp]) { delete component.statuses[opp]; return { canceled: opp }; }
  const cur = component.statuses[key];
  if (cur) {
    if (STACK_ADD[key]) {
      const e = config?.effects?.[key] || {};
      cur.dot = Math.min(e.dotCap ?? Infinity, (cur.dot || 0) + dot);
      cur.turns = Math.min(e.turns?.stackMax ?? e.turns?.max ?? Infinity, cur.turns + turns);
      cur.potency = Math.max(cur.potency || 0, potency);
    } else {
      cur.turns = Math.max(cur.turns, turns);
      cur.potency = Math.max(cur.potency || 0, potency);
      cur.dot = Math.max(cur.dot || 0, dot);
    }
  } else {
    component.statuses[key] = { turns, potency, dot };
  }
  return { applied: key };
}

/** Remove all (offensive) debuffs from a component — what Reboot / full Cleanse does. */
export function cleanseComponent(component) {
  for (const key of [...BASE_OFFENSE, 'stasisLock', 'meltdown', 'wildfire']) delete component.statuses[key];
}

/** Remove only the OLDEST base status (FCFS) — what a lone Cleanse does in v2. */
export function cleanseOldest(component) {
  for (const key of Object.keys(component.statuses)) {
    if (BASE_OFFENSE.includes(key)) { delete component.statuses[key]; return key; }
  }
  return null;
}

/**
 * End-of-round tick on one aircraft. Applies DoT from Burning, plus the ongoing
 * combo-statuses Meltdown (DoT + core-funnel, bypasses shield) and Wildfire (DoT).
 * Returns { dot, meltdown }.
 */
export function tickAircraftStatuses(aircraft, config) {
  let dot = 0;
  let meltdown = 0;
  const K = config?.effects?.synergy?.combos || {};
  const core = aircraft.components.core;
  for (const comp of Object.values(aircraft.components)) {
    const burn = comp.statuses.burning;
    if (burn && burn.turns > 0 && burn.dot > 0) { comp.hp -= burn.dot; dot += burn.dot; }

    const wf = comp.statuses.wildfire;            // Wildfire: ticks DoT (spread happened at formation)
    if (wf && wf.turns > 0 && wf.dot > 0) { comp.hp -= wf.dot; dot += wf.dot; }

    const md = comp.statuses.meltdown;            // Meltdown: DoT to part + funnel into the Core
    if (md && md.turns > 0 && md.dot > 0) {
      comp.hp -= md.dot; dot += md.dot;
      if (comp.id !== 'core' && core && core.hp > 0) { const f = md.dot * (K.meltdown?.coreFrac || 0); core.hp -= f; meltdown += f; }
    }

    for (const [key, s] of Object.entries(comp.statuses)) { s.turns -= 1; if (s.turns <= 0) delete comp.statuses[key]; }
  }
  return { dot, meltdown };
}

/**
 * Focus-fire multiplier from LEFTOVER single statuses on the focus (Shatter alone
 * +shatterAmp, Freeze alone +frozenBrittle). Glass (both) is handled in the chain
 * resolver, which returns its own multiplier.
 */
export function attackSynergyMult(focus, config) {
  const syn = config.effects.synergy;
  let m = 1;
  if (hasStatus(focus, 'shatter')) m *= 1 + (syn.shatterAmp || 0);
  if (hasStatus(focus, 'freeze')) m *= 1 + (syn.frozenBrittle || 0);
  return m;
}

/** Build a chain entry from a queued attack action. */
function queuedEntry(a, config) {
  const ec = config.effects[a.effect] || {};
  return {
    key: a.effect, fresh: true, potency: a.potency,
    turns: statusTurns(a.potency, ec.turns),
    dot: a.effect === 'burning' ? a.potency * (ec.dotPerPotency || 0) : 0,
  };
}

/**
 * Resolve every enemy component's status chain (active base statuses + this phase's
 * queued statuses/breaks) per DESIGN §3.7: greedy combos, replace-base, ongoing →
 * combo-status, burst → consume. Returns { healed, focusMult } for the Focus.
 */
export function resolveOffenseChains(state, focusEid, focusId) {
  const { config } = state;
  let healed = 0;
  let focusMult = null;

  const byTarget = new Map();                     // queued entries (statuses + breaks) per target
  for (const x of state.queue) {
    const k = `${x.target.eid}:${x.target.component}`;
    if (!byTarget.has(k)) byTarget.set(k, []);
    byTarget.get(k).push(x);
  }

  for (const enemy of state.enemies) {
    for (const comp of Object.values(enemy.components)) {
      const isFocus = enemy.eid === focusEid && comp.id === focusId;
      const active = [];
      for (const key of BASE_OFFENSE) {
        const s = comp.statuses[key];
        if (s && s.turns > 0) active.push({ key, fresh: false, active: true, potency: s.potency || 0, turns: s.turns, dot: s.dot || 0 });
      }
      const queued = (byTarget.get(`${enemy.eid}:${comp.id}`) || []).map((x) => (x.brk ? { brk: true } : queuedEntry(x, config)));
      const chain = [...active, ...queued];
      if (!chain.length) continue;

      const { combos, leftovers } = resolveChain(chain, OFFENSE_COMBOS, (def) => isFocus || !def.focusOnly);

      // consume active ingredients that combo'd
      for (const c of combos) { if (c.a.active) delete comp.statuses[c.a.key]; if (c.b.active) delete comp.statuses[c.b.key]; }

      for (const c of combos) {
        const r = applyOffenseCombo(state, enemy, comp, c, isFocus);
        healed += r.healed || 0;
        if (r.focusMult != null) focusMult = r.focusMult;
      }

      // leftover QUEUED statuses become active (active leftovers are already on the part);
      // a non-combo'd drain applies its base heal.
      for (const e of leftovers) {
        if (e.brk || e.active) continue;
        applyStatus(comp, e.key, { turns: e.turns, potency: e.potency, dot: e.dot }, config);
        if (e.key === 'drain') healed += e.potency * (config.effects.drain?.healPerPotency || 0);
      }
    }
  }
  return { healed, focusMult };
}

/** Apply one offensive combo's effect; mutates state, returns { healed, focusMult }. */
function applyOffenseCombo(state, enemy, comp, c, isFocus) {
  const eff = state.config.effects;
  const K = eff.synergy.combos || {};
  const at = `${enemy.label}·${comp.name}`;
  const out = { healed: 0, focusMult: null };
  const get = (key) => (c.a.key === key ? c.a : (c.b.key === key ? c.b : null));

  switch (c.def.name) {
    case 'Glass':
      out.focusMult = K.glass?.mult ?? 2;
      logEvent(state, `Glass: ${at} — focus ×${out.focusMult}.`);
      break;
    case 'Stasis Lock': {
      const fz = get('freeze');
      comp.statuses.stasisLock = { turns: (fz?.turns || 1) + (K.stasisLock?.extendTurns || 0) };
      logEvent(state, `Stasis Lock: ${at} disabled ${comp.statuses.stasisLock.turns} turn(s).`);
      break;
    }
    case 'Meltdown': {
      const bn = get('burning');
      comp.statuses.meltdown = { turns: bn?.turns || 1, dot: bn?.dot || 0 };
      logEvent(state, `Meltdown: ${at} — burns + funnels into the Core.`);
      break;
    }
    case 'Wildfire': {
      const bn = get('burning');
      comp.statuses.wildfire = { turns: bn?.turns || 1, dot: bn?.dot || 0 };
      const others = Object.values(enemy.components).filter((x) => x !== comp && isAlive(x));
      if (others.length) {
        const v = others[Math.floor((state.rng ? state.rng() : Math.random()) * others.length)];
        applyStatus(v, 'burning', { turns: bn?.turns || 1, dot: (bn?.dot || 0) * (K.wildfire?.spreadFrac || 0.5) }, state.config);
        logEvent(state, `Wildfire: ${at} burns + spreads to ${enemy.label}·${v.name}.`);
      } else {
        logEvent(state, `Wildfire: ${at} burns.`);
      }
      break;
    }
    case 'Backfire': {
      const dmg = K.backfire?.selfDamage || 0; comp.hp -= dmg;
      logEvent(state, `Backfire: ${at} misfires on its cracked armor → −${Math.round(dmg)} HP${isAlive(comp) ? '' : ' — DESTROYED'}.`);
      break;
    }
    case 'Collapse':
      if (comp.hp < (K.collapse?.hpThreshold || 0) * comp.maxHp) { comp.hp = 0; logEvent(state, `Collapse: ${at} ruptures — DESTROYED.`); }
      break;
    case 'Vaporize': {
      const bn = get('burning'); const burst = (bn?.dot || 0) * (bn?.turns || 0);
      comp.hp -= burst; out.healed = burst * (K.vaporize?.healFrac || 0);
      logEvent(state, `Vaporize: ${at} − ${Math.round(burst)} burst${out.healed ? `, heal +${Math.round(out.healed)}` : ''}${isAlive(comp) ? '' : ' — DESTROYED'}.`);
      break;
    }
    case 'Feedback Cascade': {
      // Drain the TARGET part for a direct chunk and cascade the SAME chunk to that part on
      // every other living enemy; heal healFrac of each hit. Also keep Drain's Core heal +
      // firepower choke on the target. Confuse is spent as the cascade enabler.
      const dr = get('drain');
      const p = dr?.potency || 0;
      const fk = K.feedback || {};
      out.healed += p * (eff.drain?.healPerPotency || 0);
      applyStatus(comp, 'drain', { turns: statusTurns(p, eff.drain?.turns), potency: p, dot: 0 }, state.config);
      const arc = p * (eff.drain?.dmgPerPotency || 0) * (fk.chainFrac || 0);
      if (arc > 0) {
        const parts = [{ owner: enemy, c: comp }]; // the target part is hit too — then every other enemy
        for (const other of state.enemies) {
          if (other === enemy || !isAlive(other.components.core)) continue;
          const oc = other.components[comp.id];
          if (oc && isAlive(oc)) parts.push({ owner: other, c: oc });
        }
        for (const { owner, c: tc } of parts) {
          tc.hp -= arc; out.healed += arc * (fk.healFrac || 0);
          logEvent(state, `Feedback Cascade: ${owner.label}·${tc.name} −${Math.round(arc)} HP${isAlive(tc) ? '' : ' — DESTROYED'}.`);
        }
      }
      break;
    }
    default:
      break;
  }
  return out;
}
