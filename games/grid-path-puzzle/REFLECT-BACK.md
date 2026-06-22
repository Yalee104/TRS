# Reflect-back guide — applying the puzzle upgrades to the TRS strategy game

This documents everything added to the **grid-path-puzzle package** on branch
`TRS-Puzzle-Playground` (which now includes the merged `TRS-Puzzle-Status-Effects`), so it can be
wired into **`games/strategy/`** in a later session. `games/strategy/` is currently **untouched** —
all of this is new capability in the puzzle module + the playground that exercises it.

## 0. IMPORTANT prerequisite — which module the strategy game uses
The strategy game imports the puzzle package, so it gets whatever module code is on its branch.
All the new module behaviour lives on **`TRS-Puzzle-Playground`**, NOT on `main`. So before/at the
start of the strategy reflect-back, do ONE of:
- **(recommended)** merge `TRS-Puzzle-Playground` → `main`, then branch the strategy work off `main`; or
- branch the strategy work off `TRS-Puzzle-Playground` directly.
Otherwise strategy would still be using the old module.

Note: simply picking up the new module already changes strategy's generated boards even before any
strategy edits, because the **generator itself changed** (see §4) — primaryLengthTarget is now a real
lever, the non-clustered payload-count bug is fixed, etc. Re-baseline the 133 strategy tests after the
module update and update snapshots/expectations as needed.

---

## 1. The new generic MODULE API (what strategy consumes)
`games/grid-path-puzzle/module/GridPathPuzzle.js` — all options default OFF / null (backward-compatible).
The module stays generic (no TRS/combo knowledge): it only knows node-type keys, counts, and timers.

### 1a. Pre-start "GO" pause
- Options: `countdownMs` (ms; 0=off), `flashStart` (flash START until first drag), `countdownText` ('GO').
- Adds a transient `'ready'` status while counting; timer + input are blocked during it; the pause time
  is excluded from `elapsedMs`.
- Events: `countdownStart` / `ready` (option callbacks `onCountdownStart` / `onCountdownEnd`).

### 1b. Objective gate — "chain ≥ N payloads to solve"
- Option: `objective: { type, min, icon?, label? }` (null=off). `type` = a node-type key; `min` = how many
  of that type the path must CROSS (total count, adjacency-independent) before GOAL commits.
- Reaching the goal while short is **BLOCKED, not failed** (path stays drawn, a "Need X more" prompt
  shows); the player reroutes and finishes.
- Visual (in the module): a badge (icon + N pips that fill + turn green when met) and a **locked GOAL**
  showing the REMAINING count (🔒3 → 🔒2 → … → 🏁).
- Events: `objectiveProgress { type, have, need, met }` (every path change; backtrack can re-lock),
  `objectiveBlocked { type, have, need, missing }`. `getState().objective = { type, min, have, met }`.
- Constraint: keep `min ≤ payload-count min` so it's always achievable.

### 1c. Fail banner
- Option: `failText` (null=off) — a big centred red banner (reuses the GO overlay) on **any** fail.

### 1d. Immediate hazard fail
- Option: `trapEntryMode: 'commitFail' | 'block' | 'failFast'`.
  - `commitFail` (default, legacy): stepping a hazard flags pendingFail; the fail happens on release.
  - `failFast`: crossing a hazard fails the run **immediately** (used by the playground).

### 1e. Runtime status modifiers
- Option: `modifiers: { slow, confusion, decay, wander }` (null/{}=off). Randomness uses a **seeded RNG**
  (`level.seed`, or inject `options.rng` for tests/determinism).
  - `slow: 0..1` — **freeze**: the cursor drags an instant *icy preview*; the SOLID path (which ALL
    gameplay reads) catches up at `FREEZE_BASE_CPS(=6) * slow` cells/sec. `endDrag` defers until the
    solid reaches the preview end, then resolves. So freeze genuinely costs clock time.
  - `confusion: 0..1` — per-step chance to veer to a random **safe** (non-hazard) legal neighbour.
  - `decay: { type, baseMs, stepMs }` — **drain**: each node of `type` vanishes on a timer — closest to
    START first (`baseMs`), each further one `+stepMs`. Crossing a payload first **secures** it. A timer
    travels with its payload if shatter moves it. Fires `decay { x, y, type }`.
  - `wander: { type, chance }` — **shatter**: per-step chance to move one un-crossed `type` node to a
    random empty neighbour. Fires `shatter { from, to, type }`.

### 1f. Live board mutation + reset
- Drain/shatter mutate `level.cells` in place; the module keeps a **pristine copy** and `reset()` now
  restores it + fully repaints (so drained payloads reappear and animations re-trigger). Hosts that call
  `reset()` get a clean board for free.

### 1g. Renderer additions (internal, but available)
`updateCell`, `startDecay/clearDecay`, `setConfused`, `setPreview` (2nd "icy" polyline), `showFail`,
`setObjective/updateObjective/showObjectiveNeed`, plus a generic `anim` node-def field → `gpp-anim-<x>`
class (used by the burning flame + shatter shake). CSS for all of it is appended in `view/styles.js`.

---

## 2. Burning is a GENERATION feature, not a runtime modifier
Burning = a **second `failsOnPass` hazard node type** placed off-route at its own density:
- Add the node to the catalog (see preset `firehazard`): `{ role:'normal', passable:true,
  failsOnPass:true, icon:'🔥', anim:'flame', color:'#7a2d18' }`.
- In the routePlan set `burningType: '<that key>'` and `burningDensity: 0..1` (0=off).
- The generator's `paintHazards` places blocker → trap → burning as cumulative density bands, off both
  routes; the existing ☠️ trap and 🔥 burning coexist as distinct hazards.
- **Key gotcha (already solved in the preset):** the hazard key MUST differ from any PAYLOAD key. The
  launch-pad attack payload is literally named `burning`; the hazard is therefore keyed **`firehazard`**
  so they never merge. Keep this separation in strategy.

---

## 3. The shared preset `games/grid-path-puzzle/presets/trs.js` — and how it DIVERGES from strategy
This preset mirrors `games/strategy/puzzle/palettes.js` + the maps in `games/strategy/core/components.js`,
but has intentionally diverged. When reflecting back, RECONCILE — do not copy verbatim. The end goal is
for strategy's `palettes.js`/`bridge.js` to **import this preset** (one source of truth), but mind these:

- `ATTACK_EFFECT` {weapon:freeze, tower:confuse, generator:drain, launchpad:burning, engine:shatter},
  `DEFENSE_VERB` {weapon:shield, generator:repair, tower:cleanse, engine:harden, launchpad:overclock},
  `OFFENSE_META`/`DEFENSE_META`, `MIN_CHAIN` (most=1, cleanse/overclock=3), `STACK_CURVE`, `CHAIN_MULT`.
- `LAUNCHPAD_MODS` **REDEFINED** (no more "Healthy", no trap modifier):
  - baseline = full HP, no modifier
  - damaged (≤50% HP) = grid +1, blockerBonus +0.10
  - destroyed = grid +2, blockerBonus +0.20
- `BASE_CELLS` adds the `firehazard` hazard node (see §2).
- `DEFAULT_GRID_SIZE = 6`.
- `genPlan(skill, withChain, trsMods, knobs)` DEFAULTS changed vs strategy's current `genPlan`:
  | field | strategy/main genPlan | preset genPlan default |
  |---|---|---|
  | cluster | true | **false** |
  | payload count | {2,4} **plus a guaranteed +1 singleton** | **{3,5}, no +1 singleton** |
  | trapDensity base | 0.2 | **0** |
  | blockerDensity base | 0.18 | **0.4** |
  | chain | always | `chainChance`/`chainPlacement` knobs (default still always/near-goal) |
  | burning | — | `burningType:'firehazard'`, `burningDensity:0` |
  - **Solvability gotcha:** dropping the +1 singleton means **Cleanse/Overclock (MIN_CHAIN 3)** need
    `count.min ≥ 3` or they're unsolvable. The playground clamps the min-chain knob to `count.min` and
    warns; strategy must keep count.min ≥ the verb's minChain.
- `buildPalette({phase, component, preset, knobs})`, `offensivePalette/defensivePalette`,
  `catalogFromConfig`. `knobs = {}` ⇒ original strategy generation EXCEPT the default changes above.

---

## 4. Generator changes (already in the module strategy uses)
`module/core/generator.js`:
- **Primary length is now a real difficulty lever** (`primarySpineParams`): drives BOTH a target length
  AND a meander difficulty (short=0.12/min, medium=0.5/~1.3×, long=0.92/~1.7×) and the accept gate
  enforces the target (keeps the longest near-miss as fallback). Strategy uses `'long'` → routes are now
  meaningfully longer than before. **Re-baseline strategy board expectations.**
- **Non-clustered payload count bug fixed**: with `cluster:false` it now places the requested count
  (was always 2). (Strategy uses cluster:true so its behaviour is unchanged here.)
- **Generic `chance` field** on a `place` entry → probabilistic inclusion (seeded). Used for the chain's
  appearance %.
- **Second hazard** support in `paintHazards` (`burningType`/`burningDensity`) + `normalizePlan`/
  `relaxPlan` carry the new fields.
- `module/util/rng.js` — shared seeded `makeRng` (mulberry32) used by the runtime modifiers.

---

## 5. How the playground wires it (the recipe to mirror in `bridge.js`)
`games/grid-path-puzzle/demo.js` builds the puzzle EXACTLY as strategy's `bridge.js` should. Construction:
```js
const palette = buildPalette({ phase, component, preset, knobs });   // from presets/trs.js
const nt = catalogFromConfig(palette);
if (shatterOn) nt[payloadType].anim = 'shake';                        // payloads shake when shatter is on
new GridPathPuzzle({
  mount, nodeTypes: nt,
  generate: { size, seed, routePlan: palette.generation, moveBudget: size*size /* ≈ unlimited */ },
  trapEntryMode: 'failFast',                                          // crossing a hazard fails now
  countdownMs, flashStart, countdownText,                            // GO pause
  objective: minChainOn ? { type: payloadType, min, icon, label } : null,
  timeLimitMs, failText: 'FAIL',
  modifiers: {                                                        // any subset; null when none
    slow:        freezeOn   ? slowFactor : undefined,                // freeze (mutually exclusive w/ burning)
    confusion:   confusedOn ? chance     : undefined,
    decay:       drainOn    ? { type: payloadType, baseMs, stepMs } : undefined,
    wander:      shatterOn  ? { type: payloadType, chance }         : undefined,
  },
  onComplete, onFail, onPathChange, onTick, onObjectiveBlocked, ...
});
game.start();
```
Where `payloadType` = `ATTACK_EFFECT[component]` (attack) or `DEFENSE_VERB[component]` (defense).
Burning status ⇒ set `knobs.burningDensity` (generation), NOT a modifier; freeze ⊻ burning.

### Mapping TRS statuses → these knobs (independent of attack/defense phase)
burning → `burningDensity` (generation hazard) · freeze → `modifiers.slow` · confused → `modifiers.confusion`
· drain → `modifiers.decay` · shatter → `modifiers.wander`.

### Existing strategy enforcement to reconcile
`games/strategy/puzzle/bridge.js` `finish()` ALREADY enforces minChain **post-commit** (it lets the
puzzle commit, then fails the solve if `chain < minChain`). The module's new `objective` gate instead
**blocks completion** until met. Decide per situation: keep bridge's post-commit check, OR move to the
module gate (a behaviour change). Don't run both.

---

## 6. Tuning values chosen in the playground (defaults)
- Grid size 6; payload count 3–5; cluster off; placement onPrimaryRoute; trap 0; blocker 0.4;
  alternate routes 1; channeling strong; primary length long; chain 100% near-goal.
- Launch Pad: baseline (none) / damaged (grid+1, blk+0.10) / destroyed (grid+2, blk+0.20).
- Status defaults: burning density 0.5; freeze fill speed 0.5; confused chance 0.35; shatter chance 0.35;
  drain base 3.0s + 0.25s/step. Freeze `FREEZE_BASE_CPS = 6`.
- Move budget effectively unlimited (grid area).

---

## 7. Tests & verification
- Puzzle: `npm run test:puzzle` (now ~9952). New suites: `tests/status.test.mjs` (burning/drain/shatter/
  confused/freeze/failFast/reset), `tests/objective.test.mjs`, `tests/lifecycle.test.mjs`; generator
  primary-length + chance + count regression tests in `tests/generatorRouteFirst.test.mjs`.
- Strategy: `npm run test:strategy` (133) — currently green because nothing here touches strategy; expect
  to re-baseline once strategy adopts the new module (generator difficulty change).
- `npm run build` clean. Playground to explore behaviour: `npm run dev` → TRS Puzzle Playground.

## 8. Branches
- `TRS-Puzzle-Playground` (off main) — ALL puzzle work (playground + GO/flash + objective + timeout +
  solve-time + the 5 status effects, merged). Not yet on `main`.
- `TRS-Puzzle-Status-Effects` (off playground) — the status-effects feature, already merged into
  `TRS-Puzzle-Playground` (merge b5ec8f4).
