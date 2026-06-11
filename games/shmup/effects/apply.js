// =============================================================================
//  effects/apply.js — turn a ComboEngine result into game-state changes
// =============================================================================
//  Handles target selection (offensive: boss, or ALL enemies on Multihack/Beam;
//  defensive: the player) and dispatches the skill + tier-effect handlers.
// =============================================================================

import { bossOf } from '../core/state.js';
import { HANDLERS, EFFECT_HANDLERS } from './handlers.js';

const warn = (kind, key) => console.warn(`[shmup] no ${kind} handler for "${key}" — ignored.`);

export function applyComboResult(state, combo, mode) {
  if (!combo) return;
  if (combo.special) return applySpecial(state, combo.special);

  for (const item of combo.items) {
    const targets = selectTargets(state, mode, item.targets);
    const ctx = {
      state, mode, item, targets,
      gameValue: item.gameValue ?? 0,
      durationSec: item.durationSec,
      effects: item.effects || [],
    };
    const h = HANDLERS[item.skill];
    if (h) h(state, ctx); else warn('skill', item.skill);
    for (const fx of ctx.effects) {
      const e = EFFECT_HANDLERS[fx];
      if (e) e(state, ctx); else warn('effect', fx);
    }
  }
}

// A power-up node (e.g. repair) collected on the path — applied directly,
// outside the combo `items` (powerups aren't in cfg.skills). See bridge.js.
export function applyPowerup(state, key, def) {
  const h = HANDLERS[key];
  if (h) h(state, { state, mode: 'defensive', targets: [state.player], gameValue: def.base ?? 0, effects: [] });
  else warn('powerup', key);
}

function selectTargets(state, mode, targets) {
  if (mode === 'defensive') return [state.player];
  if (targets === 'all') return state.enemies.slice();
  const b = bossOf(state);
  return b ? [b] : [];
}

// The Beam ultimate: apply all three statuses to every enemy.
function applySpecial(state, sp) {
  const targets = state.enemies.slice();
  const secs = sp.durationSec || 5;
  const beamDrain = state.config.tuning.beamDrain ?? 30;
  for (const skill of sp.applies || []) {
    const h = HANDLERS[skill];
    if (!h) { warn('skill', skill); continue; }
    h(state, {
      state, mode: 'offensive', targets,
      gameValue: skill === 'drain' ? beamDrain : secs,
      durationSec: secs, effects: [],
    });
  }
  state.fx.push({ kind: 'beam', pos: { x: state.canvas.w / 2, y: 0 }, remainingMs: 700 });
}
