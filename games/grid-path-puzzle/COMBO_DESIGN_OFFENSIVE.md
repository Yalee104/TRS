# Grid Path Puzzle — Combo System Design

> **Status: design only (not implemented).** This captures the agreed skill/combo
> rules for the puzzle's skill nodes. Combo evaluation is intended to be
> **host-side**: the module already emits the collected skills **in path order**
> (`result.runState.skills`), so a game embedding the module computes combos from
> that list. The module itself stays generic.

The five skills come from the Pragmata "hacking node" reference: the board is
*risk/reward path construction* — **how you route = how the enemy dies.**

---

## 1. Skill / class / role

| Skill | Class | Owns | Role |
|---|---|---|---|
| ❄️ Freeze | Payload | — | **Control**: lock the target (can't act) |
| 🌀 Confuse | Payload | — | **Redirect**: enemies attack each other |
| 🩸 Drain | Payload | — | **Sustain**: steal HP/energy back to you |
| 🔗 Chain | Amplifier | Potency + Duration | **Depth**: ×1.5 stronger & longer on current targets — adds no enemies |
| 💥 Multihack | Amplifier | Targets | **Breadth**: apply the accumulated status to **all** enemies |

**Payloads decide *what* the status is; Chain deepens it; Multihack widens it.**
The two amplifiers never compete because they push different dimensions.

### Payload character (tunable starting feel)

| Payload | Potency | Duration | Identity |
|---|---|---|---|
| ❄️ Freeze | ★★ | ★★★ | long lockdown, defensive tempo |
| 🌀 Confuse | ★★★ | ★★ | turn enemies into your weapon |
| 🩸 Drain | ★★ | ★★ | convert the fight into sustain |

---

## 2. Combo rules

| # | Rule |
|---|---|
| 1 | The board always contains **exactly one 🔗 and one 💥** (amplifiers never stack). |
| 2 | The combo **locks to the first payload type** collected; only its **leading consecutive run** counts. |
| 3 | A **different payload breaks the run** — it and everything after it are **wasted** (no forgiving). |
| 4 | **Amplifier order matters**: they only boost payloads taken *before* them → ideal shape `payloads → 🔗 → 💥`. |
| 5 | 🔗 Chain is **multiplicative (×1.5)**, never additive. |
| 6 | **Exception — the Beam:** `{❄️ + 🌀 + 🩸, each once, any order} → 🔗 → 💥` overrides rule 2. |
| 7 | **Near-miss is punished:** anything short of the full Beam pattern falls back to lock-to-first. |
| 8 | **Cap: 5 slots** contribute to a combo. |

Examples of rules 2–3:
- `❄️ 🩸 …` → locked to Freeze ×1; the 🩸 (and all after) wasted.
- `❄️ ❄️ 🩸 …` → Freeze ×2; the 🩸 (and all after) wasted.
- `❄️ 🩸 ❄️` → Freeze ×1 (the 🩸 broke the run; the later ❄️ is wasted).

---

## 3. Stack value (accelerating — rewards going deep)

Stacking the **same** payload builds a **Value** (see §4 for what Value *is*). The
curve accelerates, so each extra copy is worth *more* than the last — committing to
one skill pays off:

| Stack | Value | Increment |
|---|---|---|
| ×1 | 1.0 | — |
| ×2 | 2.5 | +1.5 |
| ×3 | 4.5 | +2.0 |
| ×4 | 7.0 | +2.5 |
| ×5 | 10.0 | +3.0 |

---

## 4. What "Value" actually is  ← read this

**Value is an abstract, unit-less magnitude** the combo system produces. It means
nothing on its own — **the game (host) decides what each status's Value maps to.**
The puzzle module just hands you the number; you convert it into your game's units.

The same Value of, say, `6.75` becomes different things depending on the payload:

| Status | Value scales… | Example host mapping |
|---|---|---|
| ❄️ Freeze | **freeze duration** | `seconds = 0.4 × Value` → 6.75 ≈ **2.7 s frozen** |
| 🩸 Drain | **amount drained** | `hpStolen = 20 × Value` → 6.75 ≈ **135 HP** (+ overflow shield at tier 3) |
| 🌀 Confuse | **redirect strength / time** | `seconds = 0.5 × Value`, or “# of enemies turned” |
| *(any)* | **a damage multiplier** | feed Value into the attack multiplier, or the enemy "OPEN" window |

Two more dimensions ride alongside Value:
- **Targets** — `1` by default; becomes **all enemies** when 💥 Multihack is in the combo.
- **Tier** (§6) — a *qualitative* unlock (shatter, shield, civil war…) layered on top of the raw magnitude; the host implements what each named tier adds.

So a full combo result the host receives looks conceptually like:
```
{ status: 'Freeze', tier: 'Deep Freeze', value: 6.75, targets: 'all' }
```
…and the host turns that into "freeze every enemy for 2.7s and apply shatter."

### Worked examples (Freeze base = 0.4 s × Value)

| Path | Value | Targets | Host result (example) |
|---|---|---|---|
| ❄️❄️ | 2.5 | 1 | freeze 1 enemy **1.0 s** |
| ❄️❄️❄️ | 4.5 | 1 | freeze 1 enemy **1.8 s** + Deep-Freeze shatter |
| ❄️❄️❄️ → 🔗 | 4.5 × 1.5 = 6.75 | 1 | freeze 1 enemy **2.7 s** + shatter |
| ❄️❄️❄️ → 🔗 → 💥 | 6.75 | **all** | freeze **every** enemy **2.7 s** + shatter |
| 🩸🩸🩸 → 🔗 → 💥 | 6.75 | **all** | drain **135 HP from every enemy** (Drain mapping) |

> Because Chain is **multiplicative**, a 3rd stack is worth *more* with Chain than
> without (`+2.0` becomes `+3.0` of effective Value), so there's always a reason to
> stack deeper before amplifying.

---

## 5. Breakpoint tiers (named effect per stack count)

Each stack count unlocks a **named tier** on the payload's signature dimension —
qualitative flavor on top of the raw Value:

| Stack | ❄️ Freeze | 🌀 Confuse | 🩸 Drain |
|---|---|---|---|
| ×1 | Chill — brief slow | Glitch — occasional misfire | Leech — small steal |
| ×2 | Freeze — full lock, short | Confuse — attacks allies | Drain — solid lifesteal |
| ×3 | Deep Freeze — long lock + **shatter** dmg | Mass Hysteria — pulls others in | Siphon — overflow → **shield** |
| ×4–5 | Absolute Zero — very long + shatter blast | Civil War — enemies use **your** damage | Vampiric Surge — big heal + regen |

## 6. How amplifiers transform the stack

| Amplifier | Targets | Potency | Duration |
|---|---|---|---|
| 🔗 Chain | — | ×1.5 | ×1.5 |
| 💥 Multihack | → **all enemies** | — | — |

Pipeline: **stack → deepen (🔗) → widen (💥).**

---

## 7. Chain table (small → big)

| Path | Tier / target | Value |
|---|---|---|
| ❄️ | Chill, 1 target | 1.0 |
| ❄️❄️ | Freeze, 1 target | 2.5 |
| ❄️❄️❄️ | Deep Freeze, 1 target | 4.5 |
| ❄️❄️ → 🔗 | Freeze (stronger/longer), 1 target | 3.75 |
| ❄️❄️❄️ → 🔗 | Deep Freeze (stronger/longer), 1 target | 6.75 |
| ❄️❄️❄️ → 💥 | Deep Freeze, **all enemies** | 4.5 (wide) |
| ❄️❄️❄️ → 🔗 → 💥 | Deep Freeze, all enemies | 6.75 (wide) |
| ❄️🩸… | locked Freeze ×1; 🩸 wasted | 1.0 |
| ❄️🌀🩸 → 🔗 → 💥 | **THE BEAM** (see §9) | special |

## 8. The three apex builds (spending 5 slots)

| Build | Identity | Strength | Weakness |
|---|---|---|---|
| `❄️×5` | **Mono-max** | deepest single dimension (Value 10.0) | one effect, narrow targets |
| `❄️×3 → 🔗 → 💥` | **Stack + amplify** | strong (6.75) *and* hits everyone | one status type |
| `❄️🌀🩸 → 🔗 → 💥` | **The Beam** | all 3 statuses on all enemies, sustained | hardest route, scarce distinct nodes |

The cap of 5 forces the trade between **depth**, **breadth**, and **variety**.

## 9. The Beam (cross-payload ultimate)

The only rewarding *mix*. Pattern: **all three distinct payloads (any order) → 🔗 → 💥.**
Produces a host-defined "super" effect — e.g. a **big sweeping beam (~5 s)** that
applies Freeze + Confuse + Drain to every enemy at once while the player aims it
across the field. Beam duration/width/values are tuning knobs for the host game.

Near-misses (rule 7): `❄️🌀🩸 → 🔗` (no 💥) is **not** the Beam → it falls back to
lock-to-first = Freeze ×1, then 🔗 amplifies just that. A 4-node investment yields a
weak result — the Beam must be *completed* to pay off.

---

## 10. Implementation: data-driven, not hard-coded

Goal: **everything tunable lives in a config file (YAML or JSON)**; only genuinely
mechanical logic is code. Three layers:

| Layer | Lives in | Examples |
|---|---|---|
| **Config (data)** | YAML / JSON | skill catalog, `stackCurve`, Chain multiplier, tier names + thresholds, Value→unit mappings, the Beam pattern, rule toggles |
| **Engine (generic, code)** | a small `ComboEngine` | the evaluation *algorithm* (lock-to-first, count leading run, apply amplifier ops, match special combos) + a fixed menu of formula `kind`s |
| **Host glue (game code)** | the embedding game | named effect handlers (`shatter`, `shield`, `beam`…) and applying magnitudes to enemies / rendering |

**Safety rule: config contains no code.** Instead it references **named formula
`kind`s** (`linear`, `multiply`, `curve`, `table`) the engine implements, and
**named `effects`** the host implements as handlers. So you tune/retheme/add skills
in data; you only write code to add a brand-new *mechanic*.

### Example config (YAML)

```yaml
rules: { maxSlots: 5, lockToFirstPayload: true, leadingRunOnly: true,
         amplifierOrderMatters: true, punishNearMiss: true }

stackCurve: [1.0, 2.5, 4.5, 7.0, 10.0]      # indexed by stack count 1..5

skills:
  freeze:
    class: payload
    icon: "❄️"
    signature: duration
    value: { kind: linear, base: 0.4, unit: seconds }   # gameValue = base * Value
    tiers:
      - { atStack: 1, name: Chill }
      - { atStack: 2, name: Freeze }
      - { atStack: 3, name: Deep Freeze, effects: [shatter] }
      - { atStack: 4, name: Absolute Zero, effects: [shatter, blast] }
  confuse:
    class: payload
    icon: "🌀"
    signature: potency
    value: { kind: linear, base: 0.5, unit: seconds }
    tiers:
      - { atStack: 2, name: Confuse }
      - { atStack: 3, name: Mass Hysteria, effects: [pullIn] }
      - { atStack: 4, name: Civil War, effects: [ownDamage] }
  drain:
    class: payload
    icon: "🩸"
    signature: amount
    value: { kind: linear, base: 20, unit: hp }
    tiers:
      - { atStack: 2, name: Drain }
      - { atStack: 3, name: Siphon, effects: [shield] }
      - { atStack: 4, name: Vampiric Surge, effects: [regen] }
  chain:     { class: amplifier, icon: "🔗", op: multiply, potency: 1.5, duration: 1.5 }
  multihack: { class: amplifier, icon: "💥", op: scope, targets: all }

specialCombos:
  - id: beam
    name: System Beam
    requires: { payloads: [freeze, confuse, drain], eachCount: 1, anyOrder: true }
    finisher: [chain, multihack]            # must follow the payloads, in this order
    result:  { type: beam, durationSec: 5, targets: all, applies: [freeze, confuse, drain] }
```

> `value.kind` options the engine ships with: `linear` (`base*Value`),
> `multiply` (`base*Value^exp`), `curve`/`table` (explicit breakpoints). Adding a
> new kind = a few lines of engine code, available to all configs afterward.

**Optional fields & resolution (no undefined behavior):**
- `effects` is **optional**. When omitted, the engine returns `effects: []` — the
  tier is just the **base status at that tier's magnitude** (the base status, e.g.
  "freeze for `gameValue` seconds", *always* applies; it comes from `skill` +
  `value` + `targets`, not from `effects`). `effects` only adds *extra* bolt-on
  modifiers (shatter, shield…), each a host handler keyed by name.
- **Tier resolution:** pick the highest tier whose `atStack ≤ stackCount`. If the
  count is below the lowest defined tier, fall back to an implicit base tier
  (`name` = skill name, `effects: []`). So a skill needn't define every stack level.
- If a named `effect` has no registered host handler, the engine ignores it (and
  may `console.warn`) — a missing handler never crashes the run.

### What the engine returns (the host applies it)

```js
const result = comboEngine.evaluate(skills);   // generic; reads the loaded config

// normal combo:
// { kind:'status', skill:'freeze', tier:'Deep Freeze',
//   value:6.75, gameValue:2.7, unit:'seconds', targets:'all', effects:['shatter'] }
// special:
// { kind:'beam', id:'beam', durationSec:5, targets:'all', applies:[...] }

applyComboToGame(result);   // host: use gameValue + dispatch the named effects/handlers
```

### What stays hard-coded (on purpose)
- The `evaluate()` algorithm shape (parsing order, lock-to-first, run counting, amplifier ops, special-combo matching).
- The fixed menu of `value.kind` formulas and amplifier `op`s (`multiply`, `scope`).
- Named `effects` and the beam render — implemented as host handlers keyed by the name in config.
- Grid/path mechanics (no-revisit, adjacency) — already in the module.

### How it plugs into the puzzle module
- The module already emits `skills[]` **in path order** via the `pathChange`
  (live preview) and `complete` (final) events — that ordered list is the engine's input.
- A thin adapter can also build the module's `nodeTypes` (icon/color/class) **from
  the same config**, so one file drives both the board's look and the combo math.
- Because the rules are data, a different game reuses the engine by shipping its
  **own YAML** — no engine changes.
