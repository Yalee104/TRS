// systems/status.js — tick status effects and recompute derived values.
export function stepStatus(state, dt) {
  for (const ent of [state.player, ...state.enemies]) {
    for (const s of ent.statuses) s.remainingMs -= dt;
    ent.statuses = ent.statuses.filter((s) => s.remainingMs > 0);
  }

  // player shield duration
  const sh = state.player.shield;
  if (sh.remainingMs > 0) {
    sh.remainingMs -= dt;
    if (sh.remainingMs <= 0) { sh.amount = 0; sh.remainingMs = 0; }
  }

  // derived: fire-rate multiplier from Overclock statuses (magnitude = fraction)
  let mult = 1;
  for (const s of state.player.statuses) if (s.type === 'overclock') mult *= 1 + s.magnitude;
  state.player.fireRateMult = mult;

  // Drain regen (heal-over-time) tick
  const regen = state.config.tuning.drainRegenPerTick || 0;
  if (regen && state.player.statuses.some((s) => s.type === 'drainTick')) {
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + regen * (dt / 1000));
  }
}
