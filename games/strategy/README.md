# 🛰️ TRS Command — turn-based strategy on the routing puzzle (v1)

Two component-built aircraft duel in alternating **Build → Resolve** phases. TRS (the
grid-path puzzle) is the *only* verb: solve a component's routing puzzle to **queue** an
attack or defense; everything fires at **Resolve**. Destroy the enemy **Reactor Core** to win.

> Full design rationale: **[DESIGN.md](./DESIGN.md)** (Part A = design, Part B = this v1 build plan).

## Run
```bash
npm install
npm run dev            # → http://localhost:5173  → "TRS Command"
npm run test:strategy  # headless logic tests (50)
npm run build
```

## How a battle plays
- **Left rail** — pre-game config (enemy archetype, phase length, time-model, telegraph, seed),
  then a live status/log once you press **Start Battle**.
- **Center** — the two boards (enemy top, you bottom) of 6 components each. **Bottom info bar**
  tells you the current step, what's useful, and projected damage.
- **Right** — the TRS puzzle panel (opens when you solve a component).

**Attack phase:** click an **enemy** part to set your **Focus**, then click your weapons to fire
TRS at it (Freeze/Confuse/Drain/Burning/Shatter), then **▶ Resolve**. Each weapon is one-use per
phase. **Defense phase:** click a part (defense type) then the part to protect (Shield/Repair/
Cleanse/Harden/Overclock); reusable; **▶ Resolve** lets the enemy strike your pre-loaded guard.

The link that binds them: damaged/debuffed offence components lower your **Combat Condition**,
which lowers your firepower — so repairing offence (not just the Core) keeps you lethal.

## Layout
```
config/game.json   all tuning (HP, firepower curve, cascade, archetypes, telegraph)
core/   state · components · phases · firepower · cascade
combat/ statuses (5 statuses + 3 synergies) · attack · defense · enemyAI (Saboteur+Brute)
puzzle/ palettes (per-component combo configs) · bridge (mount TRS, queue on solve)
view/   render (boards) · configPanel (left rail) · infoBar (bottom)
tests/  run.mjs · strategy.test.mjs
```
The `grid-path-puzzle/module` + `combo/ComboEngine` are **imported, never modified** — all
strategy logic (statuses, firepower, cascade, AI) is host-side, mirroring `games/shmup/`.

## v1 scope
In: one battle, the full build→resolve loop, single-Focus attacks, two archetypes, condition↔
firepower, cascade, win/lose on Core. Deferred (see DESIGN §10 / v2): roguelike map, trophies,
multi-target focus, the full status matrix, Detonate/Multihack/Beam, Spike. Debug: `window.__strategy`.
