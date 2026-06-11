// systems/winLose.js — remove dead enemies and decide win/lose.
export function stepWinLose(state) {
  state.enemies = state.enemies.filter((e) => {
    if (e.hp <= 0) {
      state.fx.push({ kind: 'death', pos: { x: e.pos.x, y: e.pos.y }, remainingMs: 420, big: e.kind === 'boss' });
      return false;
    }
    return true;
  });

  if (state.phase !== 'playing' && state.phase !== 'puzzle') return;
  if (state.enemies.length === 0) {
    state.phase = 'won';
    state.banner = { text: 'VICTORY', kind: 'win' };
  } else if (state.player.hp <= 0) {
    state.player.hp = 0;
    state.phase = 'lost';
    state.banner = { text: 'DEFEATED', kind: 'lose' };
  }
}
