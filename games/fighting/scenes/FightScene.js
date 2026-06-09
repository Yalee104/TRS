// =============================================================================
//  FightScene.js  —  THE GAME LOOP lives here
// =============================================================================
//
//  A Phaser Scene has three lifecycle hooks. THIS is the whole framework:
//    preload()  runs once  → load assets (our atlas)
//    create()   runs once  → build the world (fighters, input, UI)
//    update(t,dt) every frame (~60fps) → read input, run AI, detect hits, draw
//
//  Phaser runs the requestAnimationFrame loop, sprite batching, and physics
//  for us. `dt` (delta time, ms since last frame) is what keeps movement speed
//  consistent regardless of frame rate.
// =============================================================================

import Phaser from 'phaser';
import { Fighter, overlaps } from '../fighter/Fighter.js';
import { EnemyBrain } from '../ai/EnemyBrain.js';

// How many frames each animation has (must match the generated atlas).
const ANIM_FRAMES = { idle: 2, walk: 4, punch: 5, kick: 5, block: 1, hitstun: 2, ko: 1 };
const ANIM_FPS    = { idle: 3, walk: 10, punch: 14, kick: 12, block: 1, hitstun: 8, ko: 1 };

const GROUND_Y = 348;

export class FightScene extends Phaser.Scene {
  constructor() {
    super('FightScene');
  }

  // ---- 1. LOAD --------------------------------------------------------------
  preload() {
    // Load the from-scratch atlas: ONE image + the JSON that maps frame names
    // to rectangles inside it. This is the payoff of build-spritesheet.mjs.
    this.load.atlas('fighter', 'assets/sprites/fighter.png', 'assets/sprites/fighter.json');
  }

  // ---- 2. BUILD THE WORLD ---------------------------------------------------
  create() {
    const { width } = this.scale;

    // --- backdrop + ground -------------------------------------------------
    this.add.rectangle(width / 2, 175, width, 350, 0x1b2a3a);       // sky
    // A static rectangle that doubles as the visible floor AND its physics body.
    // physics.add.existing(obj, true) → the `true` makes the body STATIC
    // (immovable), so fighters land on top of it.
    this.ground = this.add.rectangle(width / 2, GROUND_Y + 30, width, 60, 0x2c3a2c);
    this.physics.add.existing(this.ground, true);

    // --- register every animation from the atlas frame names ---------------
    // Frames are named `<anim>_<index>` (e.g. punch_0..punch_4) — exactly the
    // convention our generator used and generateFrameNames() expects.
    for (const [key, count] of Object.entries(ANIM_FRAMES)) {
      this.anims.create({
        key,
        frames: this.anims.generateFrameNames('fighter', {
          prefix: `${key}_`, start: 0, end: count - 1,
        }),
        frameRate: ANIM_FPS[key],
        repeat: key === 'idle' || key === 'walk' ? -1 : 0,
      });
    }

    // --- the two fighters (same class; tint distinguishes them) ------------
    this.player = new Fighter(this, 240, 300, { facing: 1, tint: 0x66aaff, name: 'YOU' });
    this.enemy  = new Fighter(this, 560, 300, { facing: -1, tint: 0xff7766, name: 'CPU' });

    // Land on the floor, and push apart so bodies don't overlap.
    this.physics.add.collider(this.player.sprite, this.ground);
    this.physics.add.collider(this.enemy.sprite, this.ground);
    this.physics.add.collider(this.player.sprite, this.enemy.sprite);

    // --- the AI brain (Yuka) drives the enemy fighter ---------------------
    this.brain = new EnemyBrain(this.enemy, this.player, {
      aggression: 0.55, preferredRange: 70, reactionDelay: 220,
    });

    // --- input -------------------------------------------------------------
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
      punch: Phaser.Input.Keyboard.KeyCodes.A,
      kick:  Phaser.Input.Keyboard.KeyCodes.S,
      block: Phaser.Input.Keyboard.KeyCodes.D,
      debug: Phaser.Input.Keyboard.KeyCodes.H,
      reset: Phaser.Input.Keyboard.KeyCodes.R,
    });

    // --- UI / debug graphics ----------------------------------------------
    this.ui = this.add.graphics();           // health bars
    this.debugGfx = this.add.graphics();     // hit/hurt boxes
    this.showDebug = false;
    this.koText = this.add.text(width / 2, 150, '', {
      fontFamily: 'system-ui', fontSize: '40px', color: '#ffe27a', fontStyle: 'bold',
    }).setOrigin(0.5).setVisible(false);
  }

  // Called by Fighter.takeHit() — a little "juice" so hits feel impactful.
  onHit(_target, blocked) {
    this.cameras.main.shake(blocked ? 60 : 120, blocked ? 0.004 : 0.01);
  }

  // ---- 3. THE GAME LOOP (runs every frame) ---------------------------------
  update(_time, delta) {
    const over = this.player.isKO || this.enemy.isKO;

    if (Phaser.Input.Keyboard.JustDown(this.keys.debug)) this.showDebug = !this.showDebug;
    if (Phaser.Input.Keyboard.JustDown(this.keys.reset)) { this.scene.restart(); return; }

    if (!over) {
      // Fighters always face each other (fighting-game convention).
      this.player.faceToward(this.enemy);
      this.enemy.faceToward(this.player);

      this.handlePlayerInput();   // human controls the player
      this.brain.update(delta);   // Yuka controls the enemy
    }

    // Advance both state machines / animations / timers.
    this.player.update(delta);
    this.enemy.update(delta);

    // --- hit detection: an ACTIVE hitbox overlapping a hurtbox = a hit -----
    this.resolveHit(this.player, this.enemy);
    this.resolveHit(this.enemy, this.player);

    this.drawHealthBars();
    this.drawDebug();

    if (over && !this.koText.visible) {
      const winner = this.player.isKO ? 'CPU' : 'YOU';
      this.koText.setText(`K.O.  —  ${winner} WIN!\nPress R`).setVisible(true);
    }
  }

  handlePlayerInput() {
    const p = this.player;
    if (this.keys.block.isDown) {
      p.block(true);
      return;                       // blocking overrides movement/attacks
    }
    p.block(false);

    if (Phaser.Input.Keyboard.JustDown(this.keys.punch)) p.punch();
    else if (Phaser.Input.Keyboard.JustDown(this.keys.kick)) p.kick();

    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) p.jump();

    if (this.cursors.left.isDown) p.walk(-1);
    else if (this.cursors.right.isDown) p.walk(1);
    else p.stopWalking();
  }

  // attacker's live hitbox vs defender's hurtbox.
  resolveHit(attacker, defender) {
    if (overlaps(attacker.hitBox(), defender.hurtBox())) {
      attacker.applyHitTo(defender);
    }
  }

  drawHealthBars() {
    const g = this.ui;
    g.clear();
    const draw = (f, x, flip) => {
      const w = 280, h = 18, pct = f.health / f.maxHealth;
      g.fillStyle(0x000000, 0.5).fillRect(x, 16, w, h);
      g.fillStyle(0x3ad36a, 1);
      if (flip) g.fillRect(x + w * (1 - pct), 16, w * pct, h);
      else g.fillRect(x, 16, w * pct, h);
      g.lineStyle(2, 0xffffff, 0.8).strokeRect(x, 16, w, h);
    };
    draw(this.player, 20, false);
    draw(this.enemy, this.scale.width - 300, true);
  }

  // Visualize the combat boxes so you can SEE how hits work. Toggle with H.
  drawDebug() {
    const g = this.debugGfx;
    g.clear();
    if (!this.showDebug) return;
    for (const f of [this.player, this.enemy]) {
      const hurt = f.hurtBox();
      g.lineStyle(1, 0x00ff66, 1).strokeRect(hurt.x, hurt.y, hurt.w, hurt.h); // green = can be hit
      const hit = f.hitBox();
      if (hit) {
        g.fillStyle(0xff2222, 0.35).fillRect(hit.x, hit.y, hit.w, hit.h);
        g.lineStyle(1, 0xff2222, 1).strokeRect(hit.x, hit.y, hit.w, hit.h);   // red = hurts others
      }
    }
  }
}
