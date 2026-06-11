// core/sim.js — one fixed simulation tick: runs every system in order.
// Pure data in/out, so the whole tick is unit-testable under Node.
import { stepInput } from '../systems/input.js';
import { stepPlayerFire } from '../systems/playerFire.js';
import { stepEnemyAI } from '../systems/enemyAI.js';
import { stepBullets } from '../systems/bullets.js';
import { stepCollision } from '../systems/collision.js';
import { stepStatus } from '../systems/status.js';
import { stepWinLose } from '../systems/winLose.js';

export function stepSim(state, dt) {
  state.time += dt;

  // transient visual effects decay regardless of phase
  for (const f of state.fx) f.remainingMs -= dt;
  state.fx = state.fx.filter((f) => f.remainingMs > 0);

  if (state.phase === 'won' || state.phase === 'lost') return; // freeze the battle

  stepInput(state, dt);
  stepPlayerFire(state, dt);
  stepEnemyAI(state, dt);
  stepBullets(state, dt);
  stepCollision(state);
  stepStatus(state, dt);
  stepWinLose(state);
}
