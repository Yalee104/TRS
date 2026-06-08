# TRS — 2D Arcade Fighting Demo (a learning project)

A tiny, **heavily-commented** 1-v-1 fighting game built to teach the end-to-end
workflow behind rich HTML animation: the **asset pipeline**, **sprite
animation**, an **animation state machine**, the **game loop**, and **enemy AI**.
You (blue) fight a CPU opponent (red) driven by the open-source **Yuka** AI library.

## Run it

```bash
npm install
npm run build:sprites   # generate the sprite atlas from scratch (PNG + JSON)
npm run dev             # open the printed http://localhost:5173 URL
```

Controls: **← →** move · **↑** jump · **A** punch · **S** kick · **D** block ·
**H** toggle hit/hurt boxes · **R** reset.

> Tip: open DevTools and tweak the AI live, e.g.
> `__game.scene.getScene('FightScene').brain.opts.aggression = 1`

## Read it in this order (each file teaches one concept)

| File | The concept it teaches |
|---|---|
| `tools/build-spritesheet.mjs` | **The asset pipeline** — drawing frames, packing them into one sprite sheet (texture atlas) + a JSON map. Run with `npm run build:sprites`. |
| `assets/src/README.md` | **Asset management** — source-vs-export, how Aseprite/TexturePacker produce the same files, where to get free CC0 art. |
| `src/main.js` | **Booting Phaser** — the game config (renderer, physics, scenes). |
| `src/scenes/FightScene.js` | **The game loop** — Phaser's `preload → create → update`; loading the atlas, defining animations, input, hit detection, UI. |
| `src/fighter/states.js` | **The state machine as data** — states, legal transitions, and attack **frame data** (startup/active/recovery). |
| `src/fighter/Fighter.js` | **A character** — sprite + physics + the FSM, plus **hitbox vs hurtbox** combat. |
| `src/ai/EnemyBrain.js` | **Enemy AI with Yuka** — a decision **state machine** (approach/attack/retreat/block) + **steering** for movement. |

## How the pieces connect each frame

```
input (keyboard) ─┐
                  ├─► Fighter state machine ─► animation + physics ─► render
Yuka AI brain  ───┘            │
                               └─► hitbox vs hurtbox ─► damage / hitstun / KO
```

Built with [Phaser 3](https://phaser.io) (framework), [Yuka](https://mugen87.github.io/yuka/) (AI), and [Vite](https://vitejs.dev) (dev server). Sprites are generated from scratch — swap in real art any time by replacing `assets/sprites/fighter.{png,json}`.
