# 🛰️ TRS Command — turn-based strategy on the routing puzzle (v1)

Your component-built aircraft duels **up to 4 enemy aircraft** in alternating **Build → Resolve**
phases. TRS (the grid-path puzzle) is the *only* verb: solve a component's routing puzzle to
**queue** an attack or defense; everything fires at **Resolve**. Destroy **every** enemy **Reactor
Core** to win.

> Full design rationale: **[DESIGN.md](./DESIGN.md)** (Part A = design, Part B = this v1 build plan).

## Run
```bash
npm install
npm run dev            # → http://localhost:5173  → "TRS Command"
npm run test:strategy  # headless logic tests (84)
npm run build
```

## How a battle plays
- **Left rail** — pre-game config: an **enemy roster** (＋ Add enemy, up to 4: Saboteur/Brute/
  Hunter/Swarm/Disruptor/Random), phase length, time-model, telegraph, seed; then a live status/log
  once you press **Start Battle**.
- **Center** — the enemy aircraft in a row up top, your board at the bottom, the **TRS puzzle**
  sliding in between. **Bottom info bar** tells you the current step and projected damage.

**Attack phase:** click your weapons to fire TRS, then pick **which enemy + part** each status hits;
**▶ Resolve** then pick the single **Focus** (one enemy part) the firepower pool detonates on. Each
weapon is one-use per phase. **Defense phase:** click a part (defense type) then the part to protect
(Shield/Repair/Cleanse/Harden/Overclock); reusable; **▶ Resolve** lets **every** living enemy strike
your pre-loaded guard.

The link that binds them: damaged/debuffed offence components lower your **Combat Condition**,
which lowers your firepower — so repairing offence (not just the Core) keeps you lethal.

## Layout
```
config/game.json   all tuning (HP, firepower curve, cascade, archetypes, telegraph)
core/   state · components · phases · firepower · cascade
combat/ statuses · combos (v2 chain engine: 8 offensive + 7 defensive, breaks) · attack · defense · enemyAI (5 archetypes)
puzzle/ palettes (per-component combo configs) · bridge (mount TRS, queue on solve)
view/   render (boards) · configPanel (left rail) · infoBar (bottom)
tests/  run.mjs · strategy.test.mjs
```
The `grid-path-puzzle/module` + `combo/ComboEngine` are **imported, never modified** — all
strategy logic (statuses, firepower, cascade, AI) is host-side. (The same host-side reuse
pattern is used by the Hack & Blast shmup, preserved on the `hack-and-blast` branch.)

## scope
In: one battle vs **up to 4 enemies**, the full build→resolve loop, single-Focus attacks, the five
non-Boss archetypes, condition↔firepower, cascade, the **v2 combo engine** (offensive + defensive
chains with breaks; §3.6/§3.7/§4 Table E), win/lose on Cores. Deferred (DESIGN §10 / v3): roguelike
map, trophies, multi-target focus, status self-stacking, the open Frozen+Drained pair,
Detonate/Multihack/Beam, Boss, potency rebalance. Debug: `window.__strategy`.
