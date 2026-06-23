// =============================================================================
//  view/infoBar.js — the BOTTOM phase-aware help + state bar (DESIGN B.7)
// =============================================================================

import { PHASES } from '../core/state.js';
import { combatCondition, firepowerMult, totalFirepower } from '../core/firepower.js';
import { validAttackTargets } from '../combat/attack.js';
import { currentBudget } from '../combat/enemyAI.js';
import { isAlive } from '../core/components.js';
import { t, componentLabel, effectLabel, verbLabel, enemyLabel } from '../i18n/index.js';

const eName = (state, eid, id) => `${enemyLabel(state.enemies[eid])}·${componentLabel(id)}`;

export function createInfoBar(root) {
  return (state) => { root.innerHTML = barHtml(state); };
}

function barHtml(state) {
  if (state.phase === PHASES.CONFIG) return t('infobar.config');
  if (state.phase === PHASES.ATTACK_BUILD) return attackHelp(state);
  if (state.phase === PHASES.DEFENSE_BUILD) return defenseHelp(state);
  if (state.phase === PHASES.WON) return t('infobar.won');
  if (state.phase === PHASES.LOST) return t('infobar.lost');
  return '';
}

function attackPool(state) {
  let addon = 0;
  for (const a of state.queue) addon += a.potency * (state.config.effects[a.effect]?.dmgPerPotency || 1);
  const cond = combatCondition(state.player, state.config);
  return { fire: totalFirepower(state.player, addon, state.config), cond, mult: firepowerMult(cond, state.config) };
}

function queuedList(state) {
  if (!state.queue.length) return t('infobar.queuedNone');
  return state.queue.map((a) => `${effectLabel(a.effect)}→${eName(state, a.target.eid, a.target.component)}`).join(', ');
}

function attackHelp(state) {
  if (state.pendingAction) {
    const p = state.pendingAction;
    const parts = [...new Set(validAttackTargets(state).map((tg) => componentLabel(tg.component)))].join(', ') || t('infobar.threatNone');
    return t('infobar.attack2', { effect: effectLabel(p.effect), potency: p.potency.toFixed(1), parts });
  }
  const pool = attackPool(state);
  if (state.pickFocus) {
    return t('infobar.focus', { fire: Math.round(pool.fire), queued: queuedList(state) });
  }
  return t('infobar.attack1', { queued: queuedList(state), cond: (pool.cond * 100).toFixed(0), fire: Math.round(pool.fire) });
}

function defenseHelp(state) {
  const living = state.enemies.filter((e) => isAlive(e.components.core));
  const threats = [];
  for (const e of living) {
    if (!(e.telegraph && e.telegraph.visible)) { threats.push(t('infobar.threatHidden', { label: enemyLabel(e) })); continue; }
    if (e.telegraph.confused) {
      const list = (e.telegraph.display || []).map((tg) => `${componentLabel(tg.component)}${tg.status ? '+' + effectLabel(tg.status) : ''}?`).join(', ');
      threats.push(t('infobar.threatUnreliable', { label: enemyLabel(e), list: list || '—' }));
    } else {
      const budget = currentBudget(state, e);
      const hits = e.telegraph.entries.map((tg) => `${componentLabel(tg.component)} ~${Math.round(tg.share * budget)}${tg.status ? '+' + effectLabel(tg.status) : ''}`).join(', ');
      threats.push(t('infobar.threatHits', { label: enemyLabel(e), hits }));
    }
  }
  const threat = t('infobar.threatPrefix') + (threats.join(' <span class="sep">|</span> ') || t('infobar.threatNone'));
  if (state.pendingDefense) {
    const p = state.pendingDefense;
    return t('infobar.defense2', { verb: verbLabel(p.verb), potency: p.potency.toFixed(1), threat });
  }
  return t('infobar.defense1', { threat });
}
