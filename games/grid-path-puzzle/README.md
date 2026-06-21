# Grid Path Puzzle — a reusable, dependency-free mini-game module

Drag a path from a **START** node to a **GOAL** node across a configurable grid.
Nodes you pass through grant benefits or apply penalties; reaching the goal
"executes" and emits a result. Risk/reward path construction — short = safe/weak,
long detour = strong but risky. Rendered with **DOM/CSS + SVG**, **zero
dependencies**, framework-agnostic.

## Use it in any project

The whole module is the self-contained `module/` folder — copy it anywhere and
import the one facade:

```js
import { GridPathPuzzle } from './module/GridPathPuzzle.js';

const game = new GridPathPuzzle({
  mount: document.getElementById('board'),   // REQUIRED: a DOM element to build into
  nodeTypes,                                  // REQUIRED: your node catalog (below)
  generate: { size: 8, difficulty: 0.5, seed: 1, weights },  // OR: level: { grid, start, goal }
  moveBudget: null,                           // optional: max cells in the path
  timeLimitMs: null,                          // optional: countdown; expiry => fail
  trapEntryMode: 'commitFail',                // 'commitFail' | 'block'
  countdownMs: 0,                             // optional: pre-start "GO" pause (ms); 0 = off
  flashStart: false,                          // optional: flash the START cell during that pause
  countdownText: 'GO',                        // optional: the overlay label
  objective: null,                            // optional: { type, min, icon?, label? } — win gate; null = off
  failText: null,                             // optional: big centred banner shown on any fail; null = off
});

game.on('complete', (r) => console.log(r.runState));   // reached goal (+ objective met, if any)
game.on('fail',     (f) => console.log(f.reason));     // 'trap' | 'timeout'
game.on('pathChange', (i) => updateHud(i.previewRunState));
game.on('countdownStart', () => {});                   // "GO" pause began (if countdownMs > 0)
game.on('ready',          () => {});                   // pause ended → grid interactive + timer running
game.on('objectiveProgress', (i) => {});               // { type, have, need, met } on every path change
game.on('objectiveBlocked',  (i) => {});               // hit the goal while short: { type, have, need, missing }
game.start();                                          // kick the timer (or the GO pause if countdownMs > 0)
```

### Pre-start "GO" pause (opt-in)

With `countdownMs > 0`, calling `start()` first shows a centred **"GO"** overlay for that
duration with the grid **non-interactive** and the **timer not running**; when it elapses the grid
becomes interactive, the timer begins, and a `ready` event (option `onCountdownEnd`) fires. `flashStart`
pulses the START cell during the pause. The pause time is excluded from `elapsedMs`. All three options
default OFF, so existing hosts (which call `start()` immediately) are unaffected — `status` adds a
transient `'ready'` step only when `countdownMs > 0`.

### Objective gate — "chain N before the goal opens" (opt-in)

Pass `objective: { type, min, icon?, label? }` to require the path to cross at least `min` cells of
node-type `type` (counted as a **total**, adjacency-independent) before reaching GOAL counts as a win:

- Reaching the goal while **short does NOT commit and does NOT fail** — it's *blocked*: the path stays
  drawn, an `objectiveBlocked` event fires, and a brief "Need X more" prompt shows. The player reroutes
  to collect more, then finishes. `objectiveProgress` (`{ type, have, need, met }`) fires on every path
  change (including backtracks, which can re-lock).
- The renderer shows a **badge** (the `icon` + `min` pips that fill and turn green when met) and a
  **locked GOAL** (🔒 + the number) until met. `icon` defaults to `nodeTypes[type].icon`.
- `getState().objective` exposes `{ type, min, have, met }` (or `null` when off).
- Default OFF (`null`/omitted, or `min <= 0`), so existing hosts are byte-identical. The module stays
  generic — it only counts crossings of a node-type key; it has no notion of "payloads" or combos.

### Timeout + fail banner

`timeLimitMs` (already supported) fails the run with `reason: 'timeout'` when the timer (which runs from
`start()`, excluding the GO pause) exceeds it. `failText` (default off) additionally shows a big centred
banner with that text on **any** fail (timeout or trap), reusing the GO overlay in a red "fail" style.
Both default off, so existing hosts are unaffected.

## Defining node types (your power-ups & obstacles)

You decide what each node MEANS. The module only cares about `passable` and the
`onPass` effect:

```js
const nodeTypes = {
  start: { role: 'start', passable: true,  color: '#fff', label: 'START' },
  goal:  { role: 'goal',  passable: true,  color: '#3ad07a', label: 'EXE' },
  normal:{ role: 'normal', passable: true, color: '#39404e' },

  blue:  { role: 'normal', passable: true, color: '#3a7bd0',
           onPass: (s) => { s.multiplier += 0.5; } },          // a power-up
  trap:  { role: 'normal', passable: true, color: '#d04a4a',
           failsOnPass: true, onPass: (s) => { s.fail = true; } }, // instant-fail obstacle
  penalty:{ role: 'normal', passable: true, color: '#a85',
           onPass: (s) => { s.multiplier -= 0.5; } },          // traversable-but-bad obstacle
  blocker:{ role: 'normal', passable: false, color: '#2a2e39' }, // hard wall
};
```

- `passable: false` → **hard blocker** (never enterable).
- `passable: true, failsOnPass: true` → **trap** (enterable, but flags failure).
- `passable: true` + an `onPass` that subtracts → **traversable-with-penalty**.
- `onPass(state, ctx)` mutates a host-shaped run-state object, applied in path order.
- Exactly one `role:'start'` and one `role:'goal'` per level.

**Optional visual fields** (the module renders these but ignores their meaning):
- `icon`: a glyph/emoji shown as the node's sprite (e.g. `'❄️'`, `'⚔️'`).
- `label`: short text (used as a fallback sprite, the tooltip, and the float text).
- `effectKind`: `'buff' | 'debuff' | 'skill' | 'danger'` — tints the pass animation.
- `floatText`: overrides the text that floats up when the path passes the node.

When the path enters a node that has an `onPass`/`effectKind`, the renderer pops the
icon and floats its label — green for buff/skill, red for debuff/danger.

## Rules (fixed by design)

Orthogonal movement only, **no cell revisited**, reach the goal to win. Drag back
along the line to erase (backtrack). Keyboard: focus the grid, arrow keys to draw,
Enter to finish. Grid size is clamped to **4×4 .. 15×15**.

## API surface

- **Lifecycle:** `mount()` `loadLevel(levelOrGenerateOpts)` `reset()` `start()` `pause()` `resume()` `getState()` `destroy()`
- **Events** (also as `on*` options): `pathChange` `complete` `fail` `tick`
- **Result** (`complete`): `{ success, reason, path:[{x,y,typeKey}], steps, runState, budget, time }`

## Read the code in this order

| File | Teaches |
|---|---|
| `module/core/gridModel.js` | grid coordinates + neighbor math |
| `module/core/pathRules.js` | the path-validity rules (single source of truth) |
| `module/core/effects.js` | applying `onPass` effects in path order |
| `module/core/generator.js` | seeded procedural generation with a solvability guarantee |
| `module/core/levelLoader.js` | validating an authored level |
| `module/view/Renderer.js` | DOM grid + SVG path overlay |
| `module/input/PointerController.js` | drag-to-draw + backtrack |
| `module/GridPathPuzzle.js` | the facade that wires it all together |
| `demo.js` | a host that embeds the module (this page) |

Headless logic tests: `npm run test:puzzle`.

---

## Combo system (host layer, `combo/`) + Offensive/Defensive modes

The module stays generic — it only emits the ordered path. The **demo** layers a
data-driven **combo system** on top, with an Offensive/Defensive toggle:

- **`combo/ComboEngine.js`** — `evaluate(skillSeq, config)` over the ordered skill
  keys the path crossed. Behaviour is driven by `rules` toggles in the config:
  - **Offensive**: lock to the first payload, count its leading consecutive run
    (a different payload wastes the rest), amplifiers boost it in order
    (🔗 Chain ×1.5, 💥 Multihack → all targets), and the **Beam** special
    (Freeze+Confuse+Drain → 🔗 → 💥); near-misses fall back.
  - **Defensive**: every distinct payload applies (longest *adjacent* run per
    skill), with separate **Magnitude** (💪 Amplify) and **Duration** (⏳ Prolong)
    tracks; the **Fortress** label emerges from all 3 payloads + both amplifiers.
- **`combo/configs/offensive.json` / `defensive.json`** — pure data (skills,
  `stackCurve`, tiers, amplifier ops, rule toggles, specials) **plus** a
  `generation` block (the route-first plan, below). One file drives the board's
  look, the combo math, and level generation.
- **`combo/formulas.js`** (`linear`/`multiply`/`table`) and **`combo/effects.js`**
  (named effect → HUD badge). "Value" is abstract; the host maps it to game units.

**Tuning the JSON configs — including the `generation` (level-gen) node — is documented
in [`CONFIG_GUIDE.md`](./CONFIG_GUIDE.md)** (with recipes/examples). For the combo design
rationale see `COMBO_DESIGN_OFFENSIVE.md` / `COMBO_DESIGN_DEFENSIVE.md`.

## Route-first level generation

`generate({ ..., routePlan })` (in the module's generic generator) builds a
*designed* board instead of random noise: an intended **high-combo primary route**
(payloads placed in order, amplifiers reserved near the goal), a shorter
**reward-free safe route**, and hazards that channel a real risk/reward choice.
The `routePlan` is a generic placement vocabulary (`place[]` with
`count`/`placement`/`cluster`/`order`, plus `alternateRoutes`, density and
`endpointMode` knobs) — no combo semantics in the generator. Always solvable
(BFS-validated, with a relaxation ladder + fallback).
