// =============================================================================
//  main.js  —  BOOT: create the Phaser game and start the scene
// =============================================================================
//
//  This is the entry point index.html loads. A Phaser game is just a config
//  object handed to `new Phaser.Game()`. The config wires together:
//    - the renderer (AUTO = WebGL if available, else Canvas 2D),
//    - where the canvas mounts in the page,
//    - the physics engine (Arcade = fast AABB physics, perfect for 2D),
//    - and the list of scenes.
// =============================================================================

import Phaser from 'phaser';
import { FightScene } from './scenes/FightScene.js';

const config = {
  type: Phaser.AUTO,            // WebGL with Canvas2D fallback
  parent: 'game',              // the <div id="game"> in index.html
  width: 800,
  height: 400,
  backgroundColor: '#0e0f13',
  pixelArt: true,              // crisp scaling — don't blur our pixel sprites
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 1400 },    // pulls fighters back to the ground after jumps
      debug: false,            // (we draw our OWN combat boxes; press H)
    },
  },
  scene: [FightScene],
};

const game = new Phaser.Game(config);

// Expose the game on window so you can poke at it live in the browser DevTools
// console, e.g.:  __game.scene.getScene('FightScene').brain.opts.aggression = 1
window.__game = game;
