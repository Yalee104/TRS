// =============================================================================
//  Fighter.js  —  ONE CHARACTER: sprite + physics + state machine + hitboxes
// =============================================================================
//
//  This class wraps a Phaser physics sprite and drives it through the states
//  defined in states.js. The SAME class is used for the human player AND the
//  AI opponent — the only difference is who calls punch()/walk()/etc.:
//    - the player: keyboard input in FightScene
//    - the enemy:  the Yuka brain in ai/EnemyBrain.js
//
//  KEY CONCEPTS demonstrated here:
//    - enterState(): the single choke-point that changes state + plays animation
//    - frame data:   attacks progress startup → active → recovery over time
//    - hitbox vs hurtbox:
//        hurtBox = where you can be HURT (your body, always present)
//        hitBox  = where you can HURT others (only live during an attack's
//                  "active" window)
//    - takeHit():    blocking reduces damage; otherwise you go to hitstun
// =============================================================================

import { STATES, isAttack, attackDuration } from './states.js';

const MOVE_SPEED = 200;   // px/sec horizontal walk speed
const JUMP_SPEED = 520;   // px/sec initial jump velocity

export class Fighter {
  constructor(scene, x, y, { facing = 1, tint = 0xffffff, name = 'P1' } = {}) {
    this.scene = scene;
    this.name = name;
    this.facing = facing;       // 1 = facing right, -1 = facing left
    this.health = 100;
    this.maxHealth = 100;

    // --- the Phaser physics sprite (this is the visible, moving object) ----
    this.sprite = scene.physics.add.sprite(x, y, 'fighter', 'idle_0');
    this.sprite.setTint(tint);
    this.sprite.setCollideWorldBounds(true);
    // The art is 64x64 but the actual collision body is a slimmer torso box.
    this.sprite.body.setSize(24, 46).setOffset(20, 16);

    // --- state-machine bookkeeping ----------------------------------------
    this.state = 'idle';
    this.stateElapsed = 0;      // ms spent in the current state
    this.attackHasLanded = false; // so one swing can only hit once

    this.enterState('idle');
  }

  // The ONE place state changes. Everything funnels through here so the
  // animation and bookkeeping can never drift out of sync with the state.
  enterState(name) {
    this.state = name;
    this.stateElapsed = 0;
    const def = STATES[name];
    if (isAttack(name)) this.attackHasLanded = false;
    // play(key, ignoreIfPlaying). loop is controlled per state.
    this.sprite.anims.play({ key: def.anim, repeat: def.loop ? -1 : 0 }, true);
  }

  get canAct() {
    return STATES[this.state].canAct;
  }

  // ---- ACTIONS (called by player input OR the AI brain) -------------------
  // Each is a no-op unless the current state allows acting, which is what makes
  // attacks "commit" you — you can't cancel a kick's recovery into a punch.

  // Face the opponent. In fighting games you always face your opponent, so
  // facing is decided by relative position — not by which way you're walking
  // (walking away from the opponent = "backing up", still facing them).
  faceToward(other) {
    if (!this.canAct) return;              // don't spin around mid-attack
    this.facing = other.sprite.x >= this.sprite.x ? 1 : -1;
  }

  walk(dir) {
    if (!this.canAct) return;
    this.sprite.setVelocityX(MOVE_SPEED * dir);
    if (this.onGround && this.state !== 'walk') this.enterState('walk');
  }

  stopWalking() {
    if (!this.canAct) return;
    this.sprite.setVelocityX(0);
    if (this.onGround && this.state === 'walk') this.enterState('idle');
  }

  jump() {
    if (!this.canAct || !this.onGround) return;
    this.sprite.setVelocityY(-JUMP_SPEED);
    this.enterState('jump');
  }

  punch() {
    if (!this.canAct) return;
    this.sprite.setVelocityX(0);
    this.enterState('punch');
  }

  kick() {
    if (!this.canAct) return;
    this.sprite.setVelocityX(0);
    this.enterState('kick');
  }

  block(on) {
    // Holding block enters the block state; releasing returns to idle.
    if (on) {
      if (this.canAct && this.onGround) {
        this.sprite.setVelocityX(0);
        this.enterState('block');
      }
    } else if (this.state === 'block') {
      this.enterState('idle');
    }
  }

  get isBlocking() {
    return this.state === 'block';
  }

  get onGround() {
    return this.sprite.body.blocked.down || this.sprite.body.touching.down;
  }

  // ---- HITBOX / HURTBOX --------------------------------------------------
  // Returned as world-space rectangles {x, y, w, h}. The scene checks overlap.

  hurtBox() {
    const b = this.sprite.body;
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }

  // Only returns a box during the ACTIVE window of an attack; otherwise null.
  hitBox() {
    if (!isAttack(this.state)) return null;
    const def = STATES[this.state];
    const t = this.stateElapsed;
    const inActive = t >= def.startup && t < def.startup + def.active;
    if (!inActive) return null;

    // The hitbox sticks out in front of the fighter (direction = facing).
    const b = this.sprite.body;
    const w = def.range, h = 22;
    const x = this.facing === 1 ? b.x + b.width : b.x - w;
    const y = b.y + 8;
    return { x, y, w, h };
  }

  // Called by the scene when THIS fighter's hitbox overlaps the opponent.
  applyHitTo(target) {
    if (this.attackHasLanded) return;     // one hit per swing
    this.attackHasLanded = true;
    const def = STATES[this.state];
    target.takeHit(def.damage, def.knockback, this.facing);
  }

  // Receive a hit. Blocking cuts damage and knockback hard and keeps you
  // standing; otherwise you're knocked into hitstun.
  takeHit(damage, knockback, fromDir) {
    if (this.state === 'ko') return;
    if (this.isBlocking && this.facing === -fromDir) {
      // blocking only works when facing the attacker
      this.health = Math.max(0, this.health - damage * 0.15);
      this.sprite.setVelocityX(knockback * 0.3 * fromDir);
      this.scene.onHit?.(this, true);     // notify scene (block spark)
      return;
    }
    this.health = Math.max(0, this.health - damage);
    this.sprite.setVelocityX(knockback * fromDir);
    this.sprite.setVelocityY(-120);
    this.scene.onHit?.(this, false);
    this.enterState(this.health <= 0 ? 'ko' : 'hitstun');
  }

  // ---- PER-FRAME UPDATE --------------------------------------------------
  update(dtMs) {
    this.stateElapsed += dtMs;

    // Mirror the sprite to match facing (art is drawn facing right).
    this.sprite.setFlipX(this.facing === -1);

    // Advance time-based states to their natural end.
    if (isAttack(this.state)) {
      if (this.stateElapsed >= attackDuration(this.state)) this.enterState('idle');
    } else if (this.state === 'hitstun') {
      if (this.stateElapsed >= 350) this.enterState('idle');
    } else if (this.state === 'jump') {
      if (this.onGround && this.stateElapsed > 50) this.enterState('idle');
    }
  }

  get isKO() {
    return this.state === 'ko';
  }
}

// Simple AABB overlap test for hit/hurt boxes (used by the scene).
export function overlaps(a, b) {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}
