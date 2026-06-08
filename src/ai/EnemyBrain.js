// =============================================================================
//  EnemyBrain.js  —  THE OPPONENT AI, built on YUKA
// =============================================================================
//
//  This is the answer to "how does the enemy decide where to move and what to
//  do?". We use TWO open-source-AI ideas, both provided by the Yuka library:
//
//    1. A STATE MACHINE for DECISIONS — the enemy is always in one of:
//         Approach → Attack → Retreat → (Block when threatened)
//       This is exactly how the vast majority of shipped game AI works.
//
//    2. STEERING BEHAVIORS for MOVEMENT — Yuka's SeekBehavior / FleeBehavior
//       compute a velocity vector toward (or away from) the player. We read the
//       horizontal sign of that vector and feed it to fighter.walk(). For a
//       roughly 1-D fight that's all the "pathing" we need; on a real 2-D
//       arena you'd swap in Yuka's pathfinding (or PathFinding.js / easystar).
//
//  HOW IT CONNECTS TO THE GAME each frame (see FightScene.update):
//       enemy world position  ──►  Yuka vehicle position   (we sync it)
//       player world position ──►  Yuka target position    (we sync it)
//       Yuka decides + steers ──►  fighter.walk()/punch()/kick()/block()
//
//  TUNING KNOBS (constructor opts) — change these and watch behavior change:
//       aggression     0..1  how eager to attack vs. keep distance
//       preferredRange px    spacing it tries to hold before committing
//       reactionDelay  ms    human-like delay before it reacts (no frame-perfect)
// =============================================================================

import * as YUKA from 'yuka';

// --- The four decision states ------------------------------------------------
// Each extends YUKA.State and implements enter()/execute()/exit(). The
// StateMachine calls execute() every tick with the `owner` we created below.

class ApproachState extends YUKA.State {
  enter(owner) { owner.seek.active = true; owner.flee.active = false; }
  execute(owner) {
    const dist = owner.distanceToPlayer();

    // If the player is winding up an attack and we're in range, raise guard.
    if (owner.playerIsAttacking() && dist < owner.opts.preferredRange + 30 &&
        owner.roll(0.04 + 0.04 * owner.opts.aggression)) {
      owner.fsm.changeTo('block');
      return;
    }

    // Close enough and our reaction timer is ready → commit to an attack.
    if (dist <= owner.attackRange() && owner.reactionReady()) {
      owner.fsm.changeTo('attack');
      return;
    }
    // Otherwise keep walking toward the player (direction comes from steering).
  }
  exit(owner) { owner.seek.active = false; }
}

class AttackState extends YUKA.State {
  enter(owner) {
    owner.self.sprite.setVelocityX(0);
    // Pick the move by range: kick reaches farther, punch is faster up close.
    const dist = owner.distanceToPlayer();
    if (dist > 58 && owner.roll(0.6)) owner.self.kick();
    else owner.self.punch();
    owner.startReactionCooldown();
  }
  execute(owner) {
    // Wait until the attack animation has fully resolved (canAct again),
    // then back off to reset spacing — or re-approach if very aggressive.
    if (owner.self.canAct) {
      owner.fsm.changeTo(owner.roll(owner.opts.aggression) ? 'approach' : 'retreat');
    }
  }
}

class RetreatState extends YUKA.State {
  enter(owner) {
    owner.seek.active = false; owner.flee.active = true;
    owner.retreatUntil = owner.clock + 350 + 400 * (1 - owner.opts.aggression);
  }
  execute(owner) {
    if (owner.clock >= owner.retreatUntil ||
        owner.distanceToPlayer() > owner.opts.preferredRange + 120) {
      owner.fsm.changeTo('approach');
    }
  }
  exit(owner) { owner.flee.active = false; }
}

class BlockState extends YUKA.State {
  enter(owner) { owner.self.block(true); owner.blockUntil = owner.clock + 320; }
  execute(owner) {
    // Drop the guard once the threat passes (player no longer attacking) or
    // after a short hold, then re-engage.
    if (owner.clock >= owner.blockUntil || !owner.playerIsAttacking()) {
      owner.fsm.changeTo('approach');
    }
  }
  exit(owner) { owner.self.block(false); }
}

// --- The brain ---------------------------------------------------------------
export class EnemyBrain {
  constructor(self, player, opts = {}) {
    this.self = self;       // the AI's Fighter
    this.player = player;   // the human's Fighter
    this.opts = {
      aggression: 0.55,
      preferredRange: 70,
      reactionDelay: 220,
      ...opts,
    };

    this.clock = 0;             // ms since brain start (our own time base)
    this.reactionCooldownUntil = 0;
    this.retreatUntil = 0;
    this.blockUntil = 0;

    // --- Yuka steering setup ----------------------------------------------
    this.entityManager = new YUKA.EntityManager();
    this.time = new YUKA.Time();

    this.vehicle = new YUKA.Vehicle();   // represents the AI for steering math
    this.vehicle.maxSpeed = 200;
    this.target = new YUKA.GameEntity();  // represents the player's position

    this.seek = new YUKA.SeekBehavior(this.target.position);
    this.flee = new YUKA.FleeBehavior(this.target.position);
    this.flee.panicDistance = 400;        // flee works within this radius
    this.seek.active = false;
    this.flee.active = false;
    this.vehicle.steering.add(this.seek);
    this.vehicle.steering.add(this.flee);
    this.entityManager.add(this.vehicle);

    // --- Yuka decision state machine --------------------------------------
    // NOTE: Yuka's StateMachine owner is normally a GameEntity, but it just
    // forwards `this` to the state callbacks — so we pass this brain itself,
    // giving the states easy access to all the helpers below.
    this.fsm = new YUKA.StateMachine(this);
    this.fsm.add('approach', new ApproachState());
    this.fsm.add('attack', new AttackState());
    this.fsm.add('retreat', new RetreatState());
    this.fsm.add('block', new BlockState());
    this.fsm.changeTo('approach');
  }

  // ---- helpers used by the states ---------------------------------------
  distanceToPlayer() { return Math.abs(this.player.sprite.x - this.self.sprite.x); }
  attackRange() { return 64 + 24 * this.opts.aggression; }
  playerIsAttacking() {
    return this.player.state === 'punch' || this.player.state === 'kick';
  }
  reactionReady() { return this.clock >= this.reactionCooldownUntil; }
  startReactionCooldown() {
    this.reactionCooldownUntil = this.clock + this.opts.reactionDelay + 260;
  }
  roll(p) { return Math.random() < p; }

  // ---- per-frame update (called from FightScene.update) ------------------
  update(dtMs) {
    this.clock += dtMs;
    if (this.self.isKO || this.player.isKO) {
      this.self.stopWalking();
      return;
    }

    // 1) Sync the real game positions into the Yuka world (x-axis fight).
    this.vehicle.position.set(this.self.sprite.x, 0, 0);
    this.target.position.set(this.player.sprite.x, 0, 0);

    // 2) Decide (state machine) — may call punch()/kick()/block() etc.
    this.fsm.update();

    // 3) Steer (Yuka computes a velocity), then translate to a walk command.
    const delta = dtMs / 1000;
    this.entityManager.update(delta);

    const vx = this.vehicle.velocity.x;
    if (this.self.canAct) {
      if (Math.abs(vx) > 8) this.self.walk(vx > 0 ? 1 : -1);
      else this.self.stopWalking();
    }
  }
}
