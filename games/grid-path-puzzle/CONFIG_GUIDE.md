# Combo Config Guide (`combo/configs/*.json`)

How to read and **tune** `offensive.json` / `defensive.json`. These JSON files are
pure data — one file drives three things at once:

1. **the board's look** (which node types exist, their icons/colors),
2. **the combo math** (`ComboEngine` reads `rules` / `skills` / `stackCurve` / …),
3. **level generation** (the `generation` node — the route-first generator).

Edit a file, refresh the demo (`npm run dev`), and the change is live. Nothing in
`module/` needs touching. The bulk of this guide is the **`generation` node** (§3),
since that's where you'll do most tuning.

> Quick mental model: the **player drags a path**; the *ordered* skill nodes it
> crosses feed the combo engine. The generator's whole job is to lay out a board
> where that choice is interesting.

---

## 1. Top-level fields (quick reference)

| Field | Purpose |
|---|---|
| `mode` | `"offensive"` or `"defensive"` — selects the engine's rule branch. |
| `title` | Label shown in the demo's combo panel header. |
| `rules` | Toggles that change how the engine evaluates a path (see §2). |
| `stackCurve` | Array indexed by stack count (1-based): the "Value" for ×1..×5. |
| `base` | The non-skill cells: `start`, `goal`, `normal`, `blocker`, `trap`. |
| `skills` | The combo nodes: payloads + amplifiers (icon/color/value/tiers). |
| `specialCombos` | (offensive) named ultimate recipes, e.g. the **Beam**. |
| `named` | (defensive) emergent labels, e.g. **Fortress**. |
| `powerups` | (defensive) non-combo nodes the engine ignores, e.g. `repair`. |
| `generation` | **The route-first generator's plan** — the focus of this guide. |

### `rules` (engine behaviour)
| Key | Offensive | Defensive | Meaning |
|---|---|---|---|
| `maxSlots` | 5 | 5 | how many skill nodes count toward a combo |
| `lockToFirstPayload` | `true` | `false` | offense locks to the first payload; defense applies every distinct one |
| `leadingRunOnly` | `true` | — | only the leading consecutive run of the locked payload counts |
| `stacking` | — | `longestAdjacentRun` | defense stacks the longest *adjacent* run per skill |
| `amplifierOrderMatters` | `true` | `true` | an amplifier only boosts skills collected *before* it |
| `multiplicativeAmplifiers` | `true` | `true` | amplifiers multiply (×1.5), never add |
| `punishNearMiss` | `true` | `false` | offense: an incomplete Beam falls back to lock-to-first |

### `skills` (combo nodes)
Two classes:
- **payload** — `{ class:"payload", icon, color, signature, value:{kind,base,unit}, baseDurationSec?, tiers:[…] }`.
  `tiers` is `[{ atStack, name, effects? }]`; the engine picks the highest tier whose
  `atStack ≤ stackCount`. `value` maps the abstract Value to a game number
  (`kind`: `linear` = `base*Value`, `multiply` = `base*Value^exp`, `table`).
- **amplifier** — `{ class:"amplifier", op:"multiply"|"scope", potency?, duration?, magnitude?, targets? }`.
  `multiply` scales Value (Chain/Amplify/Prolong); `scope` widens targets (Multihack).

> The generator learns **blocker** = the first `base` type with `passable:false`, and
> **trap** = the first with `failsOnPass:true`. Keep one of each in `base`.

---

## 2. How a board is generated (so the knobs make sense)

When the demo calls `generate({ size, seed, routePlan: config.generation })`, the
**route-first generator** runs this pipeline (all seeded → reproducible):

1. **Pick endpoints** (`endpointMode`) — start & goal on different edges, far apart.
2. **Carve the PRIMARY route** — a long, winding intended path (length set by
   `primaryLengthTarget`). This is the *high-reward* route.
3. **Resolve & place valuables** along the primary interior, per `place[]`:
   clustered runs as a contiguous block (random position), others spread out,
   amplifiers reserved in the **tail** near the goal (so order = `payloads → 🔗 → 💥`).
4. **Carve a SAFE alternate route** (if `alternateRoutes ≥ 1`) — the shortest path
   that avoids the primary's cells. It carries **no** valuables → the low-risk,
   low-reward option.
5. **Paint hazards** (`blockerDensity` / `trapDensity` / `channeling`) onto cells
   that are on **neither** route — so both routes always stay valid.
6. **Validate** (BFS): solvable, two distinct routes, exact counts. If a constraint
   can't be met it **relaxes** one step (shorten route → fewer hazards → un-cluster →
   drop bait → drop the safe route) and retries; worst case it falls back to a simple
   random board. So an over-aggressive config never crashes — it just degrades (and
   may `console.warn`).

---

## 3. The `generation` node (the important part)

```jsonc
"generation": {
  "place": [ /* what to put where — see §3.1 */ ],
  "alternateRoutes": 1,          // 0 = single route; ≥1 = add one safe alternate route
  "primaryLengthTarget": "long", // "long" | "medium" | "shortest" | <number>
  "safeLengthMode": "shortest",  // (currently informational; safe route = shortest distinct)
  "trapDensity": 0.2,            // 0..0.6 — fraction of OFF-ROUTE cells made traps
  "blockerDensity": 0.18,        // 0..0.6 — fraction of OFF-ROUTE cells made blockers
  "channeling": "strong",        // "soft" | "strong" — bias hazards next to the route
  "lateGap": { "min": 1, "max": 2 }, // plain cells between last payload and amplifiers
  "endpointMode": "edgeRandom"   // "edgeRandom" | "cornerRandom" | "anyRandom"
}
```

### 3.1 `place[]` — what goes on the board

Each entry says "put this many of this type, here":

```jsonc
{
  "type": "freeze",              // a key in `skills` (or `powerups`); OR an object (below)
  "count": { "exact": 3 },       // OR { "min": 2, "max": 4 } (picked per board)
  "placement": "onPrimaryRoute", // see table below
  "cluster": true,               // (onPrimaryRoute only) make the copies an ADJACENT run
  "order": 0                     // sequence hint (lower = earlier along the route)
}
```

**`placement` values:**

| Value | Where it goes | Use it for |
|---|---|---|
| `onPrimaryRoute` | on the long intended route's interior | payloads you want the player to collect |
| `lateOnRoute` | reserved near the goal, **after** all payloads, ordered by `order` | amplifiers (Chain/Multihack, Prolong/Amplify) |
| `offRoute` | a cell on neither route | "bait" valuables that tempt a risky detour |
| `anywhere` | (currently same as `offRoute`) | decoration |

**`type` can be dynamic** (this is how the featured skill *varies* per board):

```jsonc
"type": { "oneOf": ["freeze", "confuse", "drain"], "distinctGroup": "payload" }
```
- `oneOf` — the generator picks one (seeded).
- `distinctGroup` — entries sharing a group pick **different** types, so e.g. three
  payload slots resolve to three *distinct* skills (one featured, the others single).

**`cluster`** (only meaningful for `onPrimaryRoute`):
- `true` → the copies form a **contiguous adjacent run** (needed so offense can
  *stack* the same payload; the run is placed at a randomized position on the route).
- `false`/omitted → copies are **spread out** (good for defense's "one of each, layered").

**`order`** — for `lateOnRoute` it sets the amplifier sequence (e.g. `chain` order 10
before `multihack` order 11 → you cross Chain then Multihack). For `onPrimaryRoute`
it's a soft sequence hint.

---

## 4. The two shipped configs, annotated

### Offensive — "commit to one payload, then amplify"
```jsonc
"generation": {
  "place": [
    // a CLUSTER of one random payload, 2–4 copies → the stack you commit to
    { "type": { "oneOf": ["freeze","confuse","drain"], "distinctGroup": "payload" },
      "count": { "min": 2, "max": 4 }, "placement": "onPrimaryRoute", "cluster": true, "order": 0 },
    // a SECOND distinct payload on the route (×1) — a tempting but run-breaking pickup
    { "type": { "oneOf": ["freeze","confuse","drain"], "distinctGroup": "payload" },
      "count": { "exact": 1 }, "placement": "onPrimaryRoute", "order": 1 },
    // the THIRD distinct payload off-route — bait for the Beam (1 of each + 🔗 + 💥)
    { "type": { "oneOf": ["freeze","confuse","drain"], "distinctGroup": "payload" },
      "count": { "exact": 1 }, "placement": "offRoute", "order": 0 },
    { "type": "chain",     "count": { "exact": 1 }, "placement": "lateOnRoute", "order": 10 },
    { "type": "multihack", "count": { "exact": 1 }, "placement": "lateOnRoute", "order": 11 }
  ],
  "alternateRoutes": 1, "primaryLengthTarget": "long", "trapDensity": 0.2,
  "blockerDensity": 0.18, "channeling": "strong", "lateGap": { "min": 1, "max": 2 },
  "endpointMode": "edgeRandom"
}
```

### Defensive — "one of each safety net, then amplify"
```jsonc
"generation": {
  "place": [
    { "type": "shield",    "count": { "exact": 1 }, "placement": "onPrimaryRoute", "order": 0 },
    { "type": "cleanse",   "count": { "exact": 1 }, "placement": "onPrimaryRoute", "order": 1 },
    { "type": "overclock", "count": { "exact": 1 }, "placement": "onPrimaryRoute", "order": 2 },
    { "type": "prolong",   "count": { "exact": 1 }, "placement": "lateOnRoute",    "order": 10 },
    { "type": "amplify",   "count": { "exact": 1 }, "placement": "lateOnRoute",    "order": 11 },
    { "type": "repair",    "count": { "min": 1, "max": 2 }, "placement": "offRoute", "order": 0 }
  ],
  "alternateRoutes": 1, "primaryLengthTarget": "medium", "trapDensity": 0.12,
  "blockerDensity": 0.2, "channeling": "soft", "lateGap": { "min": 1, "max": 3 },
  "endpointMode": "edgeRandom"
}
```

---

## 5. Tuning recipes (especially for defensive)

> Edit `defensive.json` → `generation`, save, refresh, click **Generate**.

**"Make boards bigger / longer (more skills per run)"**
`"primaryLengthTarget": "long"` (it's `"medium"` by default on defense). Or a fixed
number: `"primaryLengthTarget": 22` (clamped to fit the grid).

**"Less dragging / smaller boards"**
`"primaryLengthTarget": "shortest"` or a small number like `12`. Also drop the grid
size slider.

**"Harder — more hazards, riskier detours"**
Raise `"trapDensity"` / `"blockerDensity"` (toward `0.4`) and set
`"channeling": "strong"` (hazards hug the route, punishing shortcuts).

**"Easier — fewer hazards"**
Lower the densities (e.g. `0.06`) and `"channeling": "soft"`.

**"Let a defensive buff STACK (e.g. Shield ×2 for Bulwark)"**
Replace the single shield entry with a clustered, ranged one. Because defense stacks
the *longest adjacent run*, the copies must be `cluster:true`:
```jsonc
{ "type": "shield", "count": { "min": 1, "max": 2 }, "placement": "onPrimaryRoute", "cluster": true, "order": 0 }
```
Or make the *featured* buff random like offense does:
```jsonc
{ "type": { "oneOf": ["shield","cleanse","overclock"], "distinctGroup": "d" },
  "count": { "min": 1, "max": 3 }, "placement": "onPrimaryRoute", "cluster": true, "order": 0 },
{ "type": { "oneOf": ["shield","cleanse","overclock"], "distinctGroup": "d" },
  "count": { "exact": 1 }, "placement": "onPrimaryRoute", "order": 1 },
{ "type": { "oneOf": ["shield","cleanse","overclock"], "distinctGroup": "d" },
  "count": { "exact": 1 }, "placement": "onPrimaryRoute", "order": 2 }
```
Now each board features a different stacked buff while still layering the other two.

**"Always feature a specific skill"**
Use a plain string instead of `oneOf`: `"type": "overclock"`.

**"Force the long route (no easy safe option)"**
`"alternateRoutes": 0`. (Riskier: the only way to the goal runs past the hazards.)

**"More repair power-ups"**
Bump the repair entry: `"count": { "min": 2, "max": 3 }`.

**"Move amplifiers further from the payloads"**
Increase `"lateGap": { "min": 3, "max": 5 }` — more plain cells before 🔗/💥.

**"Vary where start/goal sit"**
`"endpointMode": "anyRandom"` (interior endpoints too) or `"cornerRandom"`.

---

## 6. Gotchas

- **`type` must exist** in `skills` (or `powerups`, like `repair`). A typo'd key is
  ignored by placement.
- **Counts vs. grid size**: asking for many `onPrimaryRoute`/`lateOnRoute` nodes on a
  tiny grid (e.g. 4×4) may exceed the route's capacity. The generator **relaxes**
  (shortens the route, un-clusters, drops bait, then the safe route) and `console.warn`s;
  it never produces an unsolvable board. If you see warnings, raise the grid size or
  lower counts.
- **Densities are clamped** to `0..0.6`; very high values are reduced during relaxation.
- **`alternateRoutes`** is effectively 0 or 1 today (one safe route is carved when ≥1);
  `safeLengthMode` is accepted but the safe route is currently always the shortest
  distinct path.
- **The combo cap is `rules.maxSlots` (5)** — placing more than 5 collectible skills on a
  route is fine, but only the first 5 the player crosses count toward the combo.
- **Reproducibility**: the same `seed` + same `generation` always rebuilds the same
  board. Change the seed (or hit 🎲 Random) for a new one.

---

See also: `README.md` (module API), `COMBO_DESIGN_OFFENSIVE.md` /
`COMBO_DESIGN_DEFENSIVE.md` (the combo design rationale).
