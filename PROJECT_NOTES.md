# TRS — Project Notes & Continuation Guide

> A self-contained log of what this project is, what's been built, how to run and verify
> it, and a roadmap for continuing in a future session. Read `README.md` for the quick
> start; read **this** file to understand the *why*, the *state*, and the *next steps*.

---

## 1. What this project is

A **learning vehicle**, not a product. The goal is to understand the end-to-end workflow
behind **rich HTML animation** (for a separate work project), using a small 2D arcade PvP
fighting game as a concrete teaching example. You (blue) fight a CPU opponent (red) driven
by the open-source **Yuka** AI library.

Every file is **heavily commented as a tutorial** — the comments explain the *why*, not just
the *what*. The intended way to learn is to read the code top-to-bottom and tweak values.

### Tech stack (and why)

| Concern | Choice | Why |
|---|---|---|
| Build / dev server | **Vite** | Instant `npm run dev`, hot reload, simple prod build |
| Game framework | **Phaser 3** | Sprite animation, arcade physics, input, asset loader built in |
| Enemy AI | **Yuka** | Open-source: state machine for decisions + steering for movement |
| Sprites | **Hand-built atlas** | Generated from scratch in code to make the asset pipeline tangible |
| Language | **Plain JS (ES modules)** | Keep the focus on concepts, not tooling |

---

## 2. Current state — DONE and VERIFIED

Everything below is implemented and was verified working in a real headless browser
(Chromium via Puppeteer) and a headless AI logic test. **No runtime errors.**

- [x] **Project scaffold** — Vite + Phaser + Yuka, directory layout modeling a real asset pipeline.
- [x] **Sprite atlas from scratch** — `tools/build-spritesheet.mjs` draws 20 poses, packs them
      into one 320×256 PNG, and emits a Phaser-format JSON atlas. Confirmed by rendering the sheet.
- [x] **Fighter state machine** — `idle / walk / jump / punch / kick / block / hitstun / ko`
      with attack **frame data** (startup → active → recovery) and **hitbox vs hurtbox** combat.
- [x] **Yuka enemy AI** — decision state machine (approach → attack → retreat → block) + seek/flee
      steering. Verified cycling through all states and landing hits.
- [x] **Game loop / scene** — Phaser `preload → create → update`; input, hit detection, health
      bars, KO/reset, camera shake on hit, debug hit/hurtbox view (press **H**).

### Verification evidence
- `npm run build` compiles cleanly (all imports/wiring valid).
- `npm run build:sprites` produces a sheet whose poses are individually visible.
- Headless browser run: tints apply (`0x66aaff` player / `0xff7766` enemy), states transition
  (`player: hitstun`, `enemy: kick`, `ai: attack`), health drops on hits, zero page errors.
- The only network 404 was `favicon.ico` (cosmetic, ignored).

---

## 3. How to run

```bash
npm install
npm run build:sprites   # (re)generate assets/sprites/fighter.{png,json}
npm run dev             # open the printed http://localhost:5173 URL
```

**Controls:** ← → move · ↑ jump · **A** punch · **S** kick · **D** block ·
**H** toggle hit/hurt boxes · **R** reset.

**Live tinkering:** open DevTools and the game is exposed on `window.__game`, e.g.
```js
__game.scene.getScene('FightScene').brain.opts.aggression = 1      // relentless AI
__game.scene.getScene('FightScene').brain.opts.preferredRange = 120
```

---

## 4. File map — read in this order

| File | Concept it teaches |
|---|---|
| `tools/build-spritesheet.mjs` | **Asset pipeline** — draw frames → pack into one sprite sheet (atlas) + JSON map. The core asset lesson. |
| `assets/src/README.md` | **Asset management** — source-vs-export, how Aseprite/TexturePacker make the same files, free CC0 art sources. |
| `src/main.js` | **Booting Phaser** — the game config object (renderer, physics, scenes). |
| `src/scenes/FightScene.js` | **The game loop** — `preload → create → update`; loading the atlas, defining animations, input, hit detection, UI. |
| `src/fighter/states.js` | **State machine as data** — states, legal transitions, attack frame data. |
| `src/fighter/Fighter.js` | **A character** — sprite + physics + FSM; hitbox vs hurtbox combat. |
| `src/ai/EnemyBrain.js` | **Enemy AI with Yuka** — decision FSM (approach/attack/retreat/block) + steering for movement. |

### How the pieces connect each frame
```
input (keyboard) ─┐
                  ├─► Fighter state machine ─► animation + physics ─► render
Yuka AI brain  ───┘            │
                               └─► hitbox vs hurtbox ─► damage / hitstun / KO
```

### Key tunable values (where to poke first)
- **Frame data / damage / range:** `src/fighter/states.js` (the `STATES` table).
- **Movement / jump speed:** `MOVE_SPEED`, `JUMP_SPEED` in `src/fighter/Fighter.js`.
- **AI behavior:** `opts` in `EnemyBrain` constructor (`aggression`, `preferredRange`, `reactionDelay`).
- **Animations / frame rates:** `ANIM_FRAMES`, `ANIM_FPS` in `src/scenes/FightScene.js`.
- **Sprite poses:** the `ANIMATIONS` table in `tools/build-spritesheet.mjs` (re-run `build:sprites`).
- **Gravity / canvas size:** `config` in `src/main.js`.

---

## 5. Roadmap — what to build next

Roughly ordered easiest → most involved. Each is a self-contained learning step.

### A. Game-feel & content (good warm-ups)
- **Sound effects** — Phaser audio (`this.load.audio`), trigger on hit/block/KO. Generate retro
  blips with **jsfxr**; free SFX at **freesound.org**. Teaches: audio in the asset pipeline.
- **Hit "juice"** — flash the sprite white on hit, hit-spark particles, a brief hit-stop (freeze
  a few ms on contact). Teaches: tweens, particles, the feel layer that transfers to UI work.
- **Combos / second attacks** — allow `punch → punch → kick` chains by adding cancel windows in
  the state machine. Teaches: extending an FSM with conditional transitions.
- **Rounds & score** — best-of-3, round timer, "Round 1 / FIGHT!" intro. Teaches: scene state
  beyond a single match (consider a `MenuScene` + `FightScene`).

### B. AI depth (your original interest)
- **Difficulty tiers** — presets for `aggression` / `reactionDelay` (easy/normal/hard).
- **Utility AI** — replace/augment the FSM: score each option (punch/kick/block/approach/retreat)
  each frame and pick the best. Teaches: a more nuanced decision model than a plain FSM.
- **Anti-air / spacing reads** — make the AI block more when the player is in `punch`/`kick`
  startup, and whiff-punish recovery frames. Teaches: reading frame data defensively.
- **(Stretch) Learned AI** — self-play reinforcement learning with TensorFlow.js. Honest note:
  big effort, hard to control; only worth it as an experiment, not for shipping.

### C. Asset pipeline maturity
- **Swap in real art** — drop a CC0 character from **kenney.nl** / **itch.io** and replace
  `assets/sprites/fighter.{png,json}` (keep the frame-name convention). ~5-minute change.
- **Author in Aseprite** — recreate the sheet in Aseprite, export JSON Hash, confirm it loads
  unchanged. Teaches: the real authoring tool behind the generator.
- **Tilemap background** — use **Tiled** + Phaser's tilemap loader for a real stage.

### D. Bridge to the actual work project
The transferable core is: **(1)** pick a renderer, **(2)** the asset pipeline (author → pack →
load → manage), **(3)** state-machine-driven animation. For UI-style rich animation specifically,
look at **GSAP** (scripted timelines) and **Rive** (designer-authored animations with a built-in
state machine — the same mental model as `states.js`). Next session, describe what the work
project's animation must actually *do* and we'll pick the right subset (you likely won't need
physics or AI, but the asset + state-machine patterns carry straight over).

---

## 6. Notes for a future session

- **Where I left off:** all five milestones complete and verified; no known bugs.
- **Verification approach:** there's no automated test suite (this is a learning artifact —
  verification is manual/visual in the browser, which is itself part of the lesson). Puppeteer
  was used only transiently for verification and **removed** from dependencies; re-add it
  (`npm i -D puppeteer && npx puppeteer browsers install chrome`) if you want headless checks.
- **Known cosmetic item:** `favicon.ico` 404 in the console — harmless; add a favicon to silence it.
- **Architecture intent:** keep code teaching-oriented — favor clarity over cleverness, and keep
  explaining the *why* in comments when extending.
- **Generated files:** `assets/sprites/fighter.{png,json}` are build outputs of
  `npm run build:sprites` — always regenerable from `tools/build-spritesheet.mjs`.

---

## 7. Suggested commit

```bash
git add -A
git commit -m "Add 2D fighting-game learning demo (Phaser 3 + Yuka + from-scratch sprite atlas)"
```
Consider `git lfs track "*.png"` before committing if the art grows large.
