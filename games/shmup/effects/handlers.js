// =============================================================================
//  effects/handlers.js — the "host handlers" the combo docs talk about
// =============================================================================
//
//  Each combo skill (and each tier `effect`) maps to a function that mutates the
//  game state. The combo engine already turned the abstract Value into a
//  game number (`gameValue`) and a `durationSec`; here we just spend them. This
//  is the layer you retune for game feel. Unknown keys are ignored (with a warn),
//  mirroring the puzzle's own effects.js, so a new tier name never crashes.
// =============================================================================

import { addStatus, removeStatusesOfType } from '../core/state.js';

const flash = (state, targets, color) => {
  for (const t of targets) state.fx.push({ kind: 'flash', pos: { x: t.pos.x, y: t.pos.y }, color, remainingMs: 360 });
};

// ctx = { state, mode, item, targets, gameValue, durationSec, effects }
export const HANDLERS = {
  // --- offensive (targets = enemies) ---
  freeze(state, ctx) {
    const shatter = ctx.effects.includes('shatter');
    for (const t of ctx.targets) addStatus(t, 'freeze', ctx.gameValue * 1000, 0, { shatter });
    flash(state, ctx.targets, '#7fdfff');
  },
  confuse(state, ctx) {
    const ownDamage = ctx.effects.includes('ownDamage');
    for (const t of ctx.targets) addStatus(t, 'confuse', ctx.gameValue * 1000, 0, { ownDamage });
    flash(state, ctx.targets, '#c58cff');
  },
  drain(state, ctx) {
    for (const t of ctx.targets) t.hp -= ctx.gameValue;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + ctx.gameValue);
    flash(state, ctx.targets, '#7fd66b');
  },

  // --- defensive (targets = [player]) ---
  shield(state, ctx) {
    state.player.shield = { amount: ctx.gameValue, remainingMs: (ctx.durationSec || 4) * 1000 };
    flash(state, [state.player], '#5b8def');
  },
  overclock(state, ctx) {
    addStatus(state.player, 'overclock', (ctx.durationSec || 5) * 1000, (ctx.gameValue || 0) / 100);
    flash(state, [state.player], '#e6c84a');
  },
  cleanse(state) {
    removeStatusesOfType(state.player, state.config.tuning.cleansableDebuffs || []);
    flash(state, [state.player], '#56c5e6');
  },
  repair(state, ctx) { // a power-up node, not a combo skill (see apply.js)
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + (ctx.gameValue || 0));
    flash(state, [state.player], '#7fd66b');
  },
};

// Tier `effects` — bolt-on modifiers. Most set a status read elsewhere.
export const EFFECT_HANDLERS = {
  reflect(state) { addStatus(state.player, 'shieldReflect', state.player.shield.remainingMs || 4000, 1); },
  invuln(state, ctx) { addStatus(state.player, 'invuln', (ctx.durationSec || 1.2) * 1000 * 0.3, 1); },
  immunityShort(state) { addStatus(state.player, 'immunity', 3000, 1); },
  ward(state) { addStatus(state.player, 'immunity', 6000, 1); },
  regen(state) { addStatus(state.player, 'drainTick', 4000, 1); },
  // folded-in or visual-only for v1 (kept as explicit no-ops so they don't warn):
  shatter() {}, blast() {}, pullIn() {}, ownDamage() {}, maxRate() {}, pierce() {}, beam() {},
};
