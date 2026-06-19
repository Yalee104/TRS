// =============================================================================
//  view/infoBar.js — the BOTTOM phase-aware help + state bar (DESIGN B.7)
// =============================================================================

import { PHASES } from '../core/state.js';
import { combatCondition, firepowerMult, totalFirepower } from '../core/firepower.js';
import { validAttackTargets } from '../combat/attack.js';
import { currentBudget } from '../combat/enemyAI.js';
import { isAlive } from '../core/components.js';

const eName = (state, eid, id) => `${state.enemies[eid].label}·${state.enemies[eid].components[id].name}`;
const pName = (state, id) => state.player.components[id].name;

export function createInfoBar(root) {
  return (state) => { root.innerHTML = barHtml(state); };
}

function barHtml(state) {
  if (state.phase === PHASES.CONFIG) return `Set up the battle in the <b>left rail</b> (enemy roster, phase length, options), then press <b>▶ Start Battle</b>.`;
  if (state.phase === PHASES.ATTACK_BUILD) return attackHelp(state);
  if (state.phase === PHASES.DEFENSE_BUILD) return defenseHelp(state);
  if (state.phase === PHASES.WON) return `<b>🏆 Victory.</b> Press Restart in the left rail for another battle.`;
  if (state.phase === PHASES.LOST) return `<b>💀 Defeat.</b> Press Restart in the left rail to try again.`;
  return '';
}

function attackPool(state) {
  let addon = 0;
  for (const a of state.queue) addon += a.potency * (state.config.effects[a.effect]?.dmgPerPotency || 1);
  const cond = combatCondition(state.player, state.config);
  return { fire: totalFirepower(state.player, addon, state.config), cond, mult: firepowerMult(cond, state.config) };
}

function queuedList(state) {
  if (!state.queue.length) return 'none yet';
  return state.queue.map((a) => `${a.effect}→${eName(state, a.target.eid, a.target.component)}`).join(', ');
}

function attackHelp(state) {
  if (state.pendingAction) {
    const p = state.pendingAction;
    const parts = [...new Set(validAttackTargets(state).map((t) => state.enemies[t.eid].components[t.component].name))].join(', ') || 'none';
    return `<b>ATTACK ②</b> Solved <b>${p.effect}</b> (potency ${p.potency.toFixed(1)}). Click a <span class="en">valid enemy part</span> on any living enemy to apply it — valid: ${parts}. <span class="sep">|</span> greyed parts can't take this effect.`;
  }
  const pool = attackPool(state);
  if (state.pickFocus) {
    return `<b>▶ FOCUS</b> Click the <span class="en">enemy part</span> to concentrate firepower. Pool ≈ <b>${Math.round(pool.fire)}</b> (×synergy if it has Shatter/Frozen). Statuses placed: ${queuedList(state)}.`;
  }
  return `<b>ATTACK ①</b> Click one of <b>your</b> components to play TRS. <span class="sep">|</span> Placed: ${queuedList(state)} <span class="sep">|</span> Condition ${(pool.cond * 100).toFixed(0)}% → firepower ≈ ${Math.round(pool.fire)} <span class="sep">|</span> then <b>▶ Resolve</b> to pick the Focus.`;
}

function defenseHelp(state) {
  const living = state.enemies.filter((e) => isAlive(e.components.core));
  const threats = [];
  for (const e of living) {
    if (e.telegraph && e.telegraph.visible) {
      const budget = currentBudget(state, e);
      const hits = e.telegraph.entries.map((t) => `${pName(state, t.component)} ~${Math.round(t.share * budget)}${t.status ? '+' + t.status : ''}`).join(', ');
      threats.push(`${e.label}→ ${hits}`);
    } else {
      threats.push(`${e.label}→ hidden (Tower down)`);
    }
  }
  const threat = '⚠️ Incoming — ' + (threats.join(' <span class="sep">|</span> ') || 'none');
  if (state.pendingDefense) {
    const p = state.pendingDefense;
    return `<b>DEFENSE ②</b> Solved <b>${p.verb}</b> (potency ${p.potency.toFixed(1)}). Click one of <b>your</b> parts to protect it. <span class="sep">|</span> ${threat}`;
  }
  return `<b>DEFENSE ①</b> Click one of <b>your</b> components to play TRS. <span class="sep">|</span> ${threat} <span class="sep">|</span> then <b>▶ Resolve</b>.`;
}
