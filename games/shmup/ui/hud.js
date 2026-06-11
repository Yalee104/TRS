// =============================================================================
//  ui/hud.js — DOM HUD over the canvas: Hack/Protect buttons (with cooldown
//  overlays), HP bars, status chips, and the win/lose banner.
// =============================================================================
//  DOM (not canvas) because the buttons must be clickable and the puzzle mounts
//  DOM anyway. `update(state)` is called every frame from the render step.

const STATUS_ICONS = {
  overclock: '⚡', weaponJam: '🔧', slow: '🐢', invuln: '✨',
  immunity: '🛡️', shieldReflect: '🪞', drainTick: '🩸',
};

export function createHud({ bridge, onRestart }) {
  const $ = (id) => document.getElementById(id);
  $('hack').addEventListener('click', () => bridge.openOffensive());
  $('protect').addEventListener('click', () => bridge.openDefensive());
  $('restart').addEventListener('click', () => onRestart());

  const pct = (v, max) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;

  function button(id, mode, state) {
    const btn = $(id);
    const fill = $(`${id}-cd`);
    const cd = state.cooldowns[mode];
    const busy = !!state.activePuzzle || state.phase !== 'playing';
    const cooling = cd > 0;
    btn.classList.toggle('disabled', busy || cooling);
    fill.style.height = cooling ? pct(cd, state.cooldownMax[mode]) : '0%';
    btn.querySelector('.cd-label').textContent = cooling ? `${(cd / 1000).toFixed(1)}s` : '';
  }

  return function update(state) {
    button('hack', 'offensive', state);
    button('protect', 'defensive', state);

    // player HP + shield
    $('hp-player-fill').style.width = pct(state.player.hp, state.player.maxHp);
    $('hp-shield-fill').style.width = pct(state.player.shield.amount, state.player.maxHp);

    // boss HP
    const boss = state.enemies.find((e) => e.kind === 'boss');
    $('hp-boss-wrap').style.visibility = boss ? 'visible' : 'hidden';
    if (boss) $('hp-boss-fill').style.width = pct(boss.hp, boss.maxHp);

    // status chips (player)
    $('status-row').innerHTML = state.player.statuses
      .map((s) => `<span class="chip">${STATUS_ICONS[s.type] || '•'} ${(s.remainingMs / 1000).toFixed(1)}s</span>`)
      .join('');

    // banner
    const over = state.phase === 'won' || state.phase === 'lost';
    $('banner-wrap').style.display = over ? 'flex' : 'none';
    if (over) {
      $('banner').textContent = state.banner?.text || '';
      $('banner').className = state.banner?.kind === 'win' ? 'win' : 'lose';
    }
  };
}
