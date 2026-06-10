# Grid Path Puzzle — Combo System Design (DEFENSIVE)

> **Status: design only (not implemented).** Companion to
> `COMBO_DESIGN_OFFENSIVE.md`. Same engine, same combo *grammar*, but applied to
> the **player's own systems** instead of the enemy. Runs on a **separate board**
> from the offensive one, sharing the engine and the status library.

**Offense vs defense in one line:** offense = *commit to one thing and unleash*
(focused, breadth across many enemies); defense = *layer many safety nets*
(broad, depth on the one actor — you).

---

## 1. Skill / class / role

| Skill | Class | Owns | Role |
|---|---|---|---|
| 🛡️ Shield | Payload | **Magnitude** | Mitigation — absorb incoming damage |
| 🧹 Cleanse | Payload | **Removal** | strip enemy-inflicted statuses from you |
| ⚡ Overclock | Payload | **Duration** | firepower / fire-rate boost |
| ⏳ Prolong | Amplifier | Duration | make the effect last longer (×1.5) |
| 💪 Amplify | Amplifier | Magnitude | make the effect stronger (×1.5) |
| 🔧 Repair | *power-up (non-combo)* | — | instant HP / shield recovery |

Both amplifiers push **depth** (one on time, one on strength). Defense has **no
breadth amplifier** — there's only one of you, so "more targets" is meaningless;
forcing it just collides with Cleanse. The dimensions are **Magnitude** and
**Duration**.

### Payload character

| Payload | Signature | Identity | Natural amplifier |
|---|---|---|---|
| 🛡️ Shield | Magnitude | the wall — soak a big hit | 💪 Amplify |
| 🧹 Cleanse | Removal | the reset button (instant) | ⏳ Prolong (longer immunity) |
| ⚡ Overclock | Duration | the comeback — firepower window | ⏳ Prolong |

---

## 2. Shared status library (how it connects to offense)

Enemies inflict the **same status conditions** the player inflicts offensively —
**Frozen ❄️, Confused 🌀, Drained 🩸** — there is **one shared library** that applies
to any actor. So the player only ever learns one set of statuses.

- **Offensive board:** player *inflicts* those statuses on enemies.
- **Enemy AI:** *inflicts* the same statuses on the player.
- **Defensive board:** 🧹 **Cleanse removes them** from the player; 🛡️ Shield / ⚡
  Overclock / 🔧 Repair keep you alive and hitting back.

This is what keeps two boards from becoming "a mess": shared *statuses*, but the
*verbs* you path through are side-specific (inflict vs. counter), so nothing is
redundant.

---

## 3. Combo rules (defensive variant)

The combo **grammar** is shared with offense, with **three deliberate divergences**
(no lock-to-first, run-based stacking, no special/near-miss):

| Rule | Offense | **Defense** |
|---|---|---|
| Lock-to-first payload | yes | **No — every distinct skill applies** |
| Stacking | leading run of the *locked* type | **Longest run of *adjacent* identical copies, per skill** |
| Mixing different skills | wasted (except the Beam) | **All apply** (layered buffs) |
| Special ultimate + near-miss punish | Beam special-cased, near-miss punished | **Dropped** — Fortress just *emerges* (every partial mix is still useful) |
| Amplifier order matters | yes | **yes** — an amplifier boosts only the buffs collected *before* it |
| Multiplicative amplifiers | yes | yes |
| Cap | 5 slots | 5 slots |
| Board has exactly one of each amplifier | yes | yes (one ⏳, one 💪) |

### Stacking examples (longest adjacent run, per skill)

| Path | Result | Why |
|---|---|---|
| 🛡️ · 🧹 | Shield×1, Cleanse×1 | both apply |
| 🛡️ · 🧹 · 🛡️ | Shield×1, Cleanse×1 | the two 🛡️ are separated → no stack |
| 🛡️ · 🧹 · 🧹 | Shield×1, Cleanse×2 | the 🧹 are adjacent |
| 🛡️ · 🧹 · 🛡️ · 🛡️ | Shield×2, Cleanse×1 | longest adjacent 🛡️ run is the trailing pair |

> A run is broken by **any** other node (a different payload, an amplifier, or a
> power-up). Stacks must be truly adjacent.

### Amplifier order (confirmed)

An amplifier only boosts buffs collected **before** it. So `🛡️🛡️ → 💪` amplifies the
Shield, but `💪 → 🛡️🛡️` does nothing for it. Ideal shape: `payloads… → ⏳ → 💪`.

---

## 4. Stack value & the two tracks

Stacking the same payload (adjacent) builds **Magnitude** via the accelerating
curve (same as offense — rewards going deep):

| Stack | Magnitude (Value) | Increment |
|---|---|---|
| ×1 | 1.0 | — |
| ×2 | 2.5 | +1.5 |
| ×3 | 4.5 | +2.0 |
| ×4 | 7.0 | +2.5 |
| ×5 | 10.0 | +3.0 |

Each buff carries **two tracks**:
- **Magnitude** = stack Value × (💪 Amplify if collected before it).
- **Duration** = the payload's `baseDurationSec` × (⏳ Prolong if collected before it).

---

## 5. What "Value" is (same principle as offense)

**Value is an abstract magnitude**; the **host game maps it to its own units.** The
same Magnitude `6.75` means different things per buff:

| Buff | Magnitude scales… | Duration | Example host mapping |
|---|---|---|---|
| 🛡️ Shield | **damage absorbed** | how long the shield lasts | `absorb = 25 × Magnitude` → 6.75 ≈ **169 HP**, for `4 s × Prolong` |
| ⚡ Overclock | **boost amount** | how long the boost lasts | `fireRate% = 15 × Magnitude`, for `5 s × Prolong` |
| 🧹 Cleanse | **(removal is tier-driven)** | post-cleanse immunity window | tier ×3 = remove all; ⏳ extends immunity, 💪 lets it purge tougher debuffs |

So the engine hands the host a bundle per active buff, e.g.:
```
{ skill:'shield', tier:'Bulwark', magnitude:6.75, durationSec:6.0,
  effects:['reflect'] }
```
…and the host turns it into "a 169 HP shield for 6 s that reflects."

> Note 🧹 Cleanse is mostly **tier-driven** (its stack count decides how many
> debuffs are purged), so Magnitude/Amplify matter less for it — they map to
> "purge tougher debuffs" / "longer immunity" instead of raw size.

---

## 6. Breakpoint tiers (named effect per adjacent-stack count)

| Stack | 🛡️ Shield *(magnitude)* | 🧹 Cleanse *(removal)* | ⚡ Overclock *(duration)* |
|---|---|---|---|
| ×1 | Plating — small absorb | Purge — remove worst 1 debuff | Boost — minor fire-rate up |
| ×2 | Shield — solid absorb | Cleanse — remove 2 debuffs | Overclock — solid firepower up |
| ×3 | Bulwark — big absorb + **reflect** | Decontaminate — remove **all** + short immunity | Surge — firepower + **armor-pierce** |
| ×4–5 | Aegis — huge absorb + brief **invuln** | Purity — remove all + **ward** (blocks next debuff) | Overdrive — max fire rate, sustained |

## 7. How amplifiers transform a stack

| Amplifier | Magnitude | Duration |
|---|---|---|
| 💪 Amplify | ×1.5 | — |
| ⏳ Prolong | — | ×1.5 |

Pipeline: **stack → strengthen (💪) / prolong (⏳)**, each boosting only the buffs
collected before it.

---

## 8. Chain table (small → big)

| Path | Tier / result | Magnitude |
|---|---|---|
| 🛡️ | Plating | 1.0 |
| 🛡️🛡️ | Shield | 2.5 |
| 🛡️🛡️🛡️ | Bulwark (+reflect) | 4.5 |
| 🛡️🛡️🛡️ → 💪 | Bulwark, stronger | 6.75 |
| 🛡️🛡️🛡️ → ⏳ | Bulwark, longer-lasting | 4.5 (×1.5 time) |
| 🛡️🛡️🛡️ → ⏳ → 💪 | Bulwark, strong **and** long | 6.75 (×1.5 time) |
| 🛡️ 🧹 | Shield×1 **and** Cleanse×1 (both apply) | 1.0 / 1.0 |
| 🛡️🧹⚡ → ⏳ → 💪 | **FORTRESS** (all three, prolonged + amplified) | emergent |

## 9. The three apex builds (5 slots)

| Build | Identity | Strength | Weakness |
|---|---|---|---|
| `🛡️×5` | **Mono-max** | deepest single buff (Aegis: brief invuln) | one buff only |
| `🛡️×3 → ⏳ → 💪` | **Stack + amplify** | strong *and* long Bulwark | one buff type |
| `🛡️🧹⚡ → ⏳ → 💪` | **Fortress** | shield + cleanse + firepower, prolonged & amplified | hardest route, each buff only ×1 |

The defensive trade is **depth vs duration vs magnitude vs variety** (instead of
offense's depth vs breadth vs variety).

## 10. Fortress (emergent, not special-cased)

`🛡️ 🧹 ⚡ → ⏳ → 💪` — full layered defense: a shield + a cleanse + a firepower boost,
all prolonged and amplified. Because mixing is now natural, this isn't a special
recipe — it's just the max-variety build. We keep the **name "Fortress / Overdrive"**
purely as a HUD label when all three payloads + both amplifiers are present. Partial
mixes (e.g. `🛡️🧹 → 💪`) are **not punished** — they're simply a smaller layered buff.

---

## 11. Implementation: data-driven, not hard-coded

Same approach as the offensive spec — a declarative **config (YAML/JSON)** + a
generic **engine** + **host handlers**. Defense reuses the *same* `ComboEngine`;
only the config and a couple of rule toggles differ.

| Layer | Lives in | Examples |
|---|---|---|
| **Config (data)** | YAML / JSON | skills, `stackCurve`, amplifier multipliers, tiers, Value/duration mappings, rule toggles |
| **Engine (generic, code)** | shared `ComboEngine` | evaluation algorithm + formula `kind`s |
| **Host glue (game code)** | the game | named effect handlers (`reflect`, `invuln`, `ward`, `pierce`…) + applying magnitude/duration |

### Example config (YAML)

```yaml
rules:
  maxSlots: 5
  lockToFirstPayload: false        # DEFENSE: every distinct skill applies
  stacking: longestAdjacentRun     # per-skill, consecutive copies only
  amplifierOrderMatters: true      # amplifiers boost buffs collected BEFORE them
  multiplicativeAmplifiers: true
  # no specialCombos, no near-miss punishment on defense

stackCurve: [1.0, 2.5, 4.5, 7.0, 10.0]

skills:
  shield:
    class: payload
    icon: "🛡️"
    signature: magnitude
    baseDurationSec: 4
    value: { kind: linear, base: 25, unit: hp }      # absorb = base * Magnitude
    tiers:
      - { atStack: 2, name: Shield }
      - { atStack: 3, name: Bulwark, effects: [reflect] }
      - { atStack: 4, name: Aegis, effects: [reflect, invuln] }
  cleanse:
    class: payload
    icon: "🧹"
    signature: removal
    tiers:
      - { atStack: 1, name: Purge }                  # remove worst 1
      - { atStack: 2, name: Cleanse }                # remove 2
      - { atStack: 3, name: Decontaminate, effects: [immunityShort] }   # remove all
      - { atStack: 4, name: Purity, effects: [ward] }
  overclock:
    class: payload
    icon: "⚡"
    signature: duration
    baseDurationSec: 5
    value: { kind: linear, base: 0.15, unit: fireRatePct }
    tiers:
      - { atStack: 2, name: Overclock }
      - { atStack: 3, name: Surge, effects: [pierce] }
      - { atStack: 4, name: Overdrive, effects: [maxRate] }
  prolong: { class: amplifier, icon: "⏳", op: multiply, duration: 1.5 }
  amplify: { class: amplifier, icon: "💪", op: multiply, magnitude: 1.5 }

powerups:
  repair: { icon: "🔧", effect: instantHeal, base: 30, unit: hp }   # non-combo node

named:                              # cosmetic label only — Fortress is emergent
  fortress:
    when: { payloads: [shield, cleanse, overclock], amplifiers: [prolong, amplify] }
    label: "Fortress / Overdrive"
```

### Optional fields & resolution (no undefined behavior)
- `effects` is **optional** → engine returns `effects: []`; the base buff still
  applies (from `skill` + value/duration), `effects` only adds bolt-ons.
- **Tier resolution:** highest tier with `atStack ≤ stackCount`; below the lowest
  defined tier, fall back to an implicit base tier (`name` = skill, `effects: []`).
- A named `effect` with no registered host handler is ignored (with a `console.warn`).

### What stays hard-coded
- The `evaluate()` algorithm (now branching on `lockToFirstPayload`/`stacking`),
  the formula `kind`s, and amplifier `op`s.
- Named `effects` + the apply-to-player rendering — host handlers keyed by name.
- Grid/path mechanics — already in the module.

### How it plugs into the module
- The module emits `skills[]` in path order via `pathChange` / `complete`.
- `comboEngine.evaluate(skills, defensiveConfig)` returns the **set** of active
  buffs (defense produces multiple, unlike offense's single locked status).
- The host applies each buff's magnitude/duration and dispatches named effects.
- A different game reuses the same engine with its own config — offense and
  defense are just **two configs** of one engine.
