# Design Doc — "TRS Command" (strategy game on the Tactical Routing System)

> **Deliverable of this plan:** a design document, no code. On approval this content is
> saved to the repo as **`games/strategy/DESIGN.md`**. Concept source images:
> `/home/user/GameDev/TRS-Straregy/` (Attack / Defense / Roguelike).
>
> **Status key:** ✅ agreed with user · 🔧 draft, will refine later · ❓ open / TBD.

---

## Context

> **Note on `games/shmup/` references below:** the Hack & Blast shmup that this design was
> modelled on now lives on the **`hack-and-blast`** branch (it was removed from `main`). The
> `games/shmup/...` paths in this doc describe that reference implementation on the branch; the
> strategy game's own files are the source of truth on `main`.

`Hack & Blast` (the shmup) proved the **grid-path puzzle** ("TRS — Tactical Routing System")
works as an embedded verb: mount a puzzle → draw a route → `ComboEngine.evaluate()` returns a
combo result → a host "bridge" maps it onto game state. This second game makes TRS the *only*
verb but wraps it in a **deliberate, turn-programmed strategy loop** instead of arcade action.

The combat model — status *interactions*, firepower, phases, cascade, AI — is **host-side logic**
(exactly the layer the shmup keeps in `games/shmup/effects/` and `puzzle/bridge.js`), built on the
base effects the engine emits (`freeze/confuse/drain` + `shatter/blast`;
`shield/cleanse/overclock/repair`). The strategy game also **consumes the grid-path module's optional
features** — runtime `modifiers`, the `objective` gate, a GO countdown, a fail banner, `failFast`
hazards, and the `firehazard` generation node — to turn those statuses into *routing friction*
(§3.8). It does this **without modifying the module**: strategy mounts it verbatim and shares one
generation preset (`grid-path-puzzle/presets/trs.js`).

---

## 1. The board ✅

Two aircraft face off (yours bottom, enemy top). Each is the **same 6 components**, each with
its own HP, condition, and live statuses. **TRS is the universal verb** — you never click
"attack," you select a component and *solve a route*.

| Component | System it powers | Base HP 🔧 |
|---|---|---|
| **Reactor Core** | match life — 0 = destroyed; **shielded** (indestructible) until its shield-linked parts fall | 200 |
| **Power Generator** | powers all parts; **holds up the Core shield** (see §6) | 80 |
| **Weapon Storage** | base/auto firepower | 70 |
| **Tower (Sensors)** | **telegraph visibility** (yours) / **aim** (enemy) | 60 |
| **Engine** | **evasion** — dodges damage on both sides (defense + vs your focus-fire); *initiative parked v2* | 60 |
| **Launch Pad** | powers **TRS quality** — healthy = easier grids, scaling with HP (§7); also a small firepower share | 70 |

---

## 2. The battle cycle — "program your turn, then watch it execute" ✅

The single most important frame. Each phase is **BUILD (120s credit) → RESOLVE**. HP only
changes during RESOLVE.

```
BATTLE = repeat until one aircraft is destroyed:

┌─ ATTACK PHASE (your offense) ───────────────────┐
│ BUILD (120s credit):                             │
│   • pick ONE of YOUR components (1 use / phase)  │
│   • solve its TRS                                │
│   • choose which ENEMY part the effect targets   │
│   • repeat → queue a combo chain                 │
│ RESOLVE:                                         │
│   • queued package fires; ENEMY loses HP (only   │
│     here). firepower = base + condition + add-ons│
└──────────────────────────────────────────────────┘
                     ↓
┌─ DEFENSE PHASE (your defense) ──────────────────┐
│ BUILD (120s credit):                             │
│   • pick ONE of YOUR components (1 use / phase)  │
│   • solve its TRS                                │
│   • queue defense on YOURSELF (repair/shield/    │
│     cleanse) — NO enemy target                   │
│ RESOLVE:                                         │
│   • ENEMY attacks; pre-loaded defenses mitigate; │
│     YOU lose HP (only here)                      │
└──────────────────────────────────────────────────┘
                     ↓ repeat
```

Single-player vs AI: the enemy has no visible build; its attack is **AI-generated at the
player's defense-resolve** (archetype targeting, §7). The player gets an offense turn and a
defense turn, alternating.

---

## 3. Attack phase — detail

### 3.1 The 120s credit — time model ✅ DECIDED: realtime
The phase credit drains by the **seconds you spend drawing the route** (`phase.attackTimeModel:
"realtime"`): fast routing → more actions; tenser, rewards mastery. *(The engine still contains a
`cost` mode — a fixed chunk per action — but it was cut from the config UI; the game ships realtime
only.)*

Both run on the same machinery; build both, choose the feel later.

### 3.2 The build action ✅ (revised — statuses spread per action; Focus is picked at Resolve)
Each action = play one weapon's TRS, then choose **which enemy part receives its status**:
1. **Pick one of YOUR components** = which weapon fires → its TRS palette (Table A).
   **One use per component per phase** (v1; revisit). 🔧
2. **Solve the route** (~12s solve timer is the only real-time pressure).
3. On success, **pick the ENEMY component to apply the status to** — only parts the effect is
   *valid* on are selectable (Table B); the rest are greyed out.
4. Credit spent; repeat. Every action ALSO adds its potency to a shared **firepower pool**.

So one action does double duty: its **status** lands on a chosen enemy part (and cripples that
part during the enemy's defense phase — e.g. **Freeze cancels that part's contribution** to the
enemy's next attack), while its **potency** feeds the firepower pool that detonates at Resolve.

#### Potency — what a solved TRS route is worth ✅ config-driven
**Potency is the raw worth of a solved route.** When you solve, the ComboEngine counts how many
payload cells you chained along the path (the *stack*, 1→5) and looks that up in a **`stackCurve`**;
a **Chain** amplifier on the route multiplies the result by **`chainMultiplier`**. Defaults:

| Stack (payload cells on the route) | 1 | 2 | 3 | 4 | 5 | +Chain |
|---|---|---|---|---|---|---|
| **Potency** | 1.0 | 2.5 | 4.5 | 7.0 | 10.0 | ×1.5 |

So "potency 6" ≈ a clean 3–4-stack route. Longer/cleaner routes are worth more. Potency is then
turned into game effect by the **per-potency multipliers**: attack damage `= potency ×
effects[effect].dmgPerPotency`, status duration `= clamp(round(potency/divisor), min, max)`,
Drain heal `= potency × healPerPotency`; defense `shield = potency × absorbPerPotency`, `repair =
potency × hpPerPotency`, Harden `= potency × reductionPerPotency` (capped), etc.

**Two tuning layers, both in `config/game.json`:**
- **`potency`** (`stackCurve`, `chainMultiplier`) — tunes how much *routing skill* is worth (the
  feel of stacking a longer combo).
- **`effects` / `defense`** (the `*PerPotency` numbers + status `turns` divisors) — tunes how much
  that worth *does* in combat.

### 3.3 Resolve ✅ (revised — pick the firepower Focus now)
On **▶ Resolve Attack**, pick **one enemy component as the Focus**. The whole firepower pool
concentrates there; **enemy loses HP only here**:

```
damage to Focus = ( base firepower + Σ action potency×effectWeight ) × firepowerMult(condition, §6)
                  × synergy(statuses on Focus)
```
Statuses you placed on the Focus **amplify** it (Shatter → +50% bonus, Frozen → brittle — Table C).
Statuses on *other* enemy parts still apply — they weaken the enemy's defense-phase attack
(Freeze/Confuse) and tick DoT (Burning). v1 = a **single Focus**; multi-target focus is a later
power-up. 🔧 base value TBD

**Reactor-Core shield (✅, config-driven).** The Core is **invulnerable while its shield is UP** —
focusing it deals **0 HP** (statuses still land, they just don't chip it). The shield is **not** a
gradient any more: it falls only once the configured **shield-linked parts** that are *destroyed*
contribute percentages summing to **≥ threshold** (`config.coreShield`). Default: **Power Generator
= 100%** (kill it to expose the Core). A multi-part list (e.g. Generator 60 / Weapon 30 / Tower 10 /
Engine 40) means several kills must add up to ≥100% before the Core can be damaged. The UI draws a
**thick blue border** around a shielded Core. Shatter/Drain do **not** pierce the shield in v1.
**Exception — Burning:** Burning DoT is the one effect that bypasses the shield: it ticks on the
Core even while shielded, making Burning the deliberate **anti-shield** tool (apply it to the Core,
then chip it down while you break the shield-linked parts). Direct focus-fire and enemy strikes are
still fully blocked.

### 3.4 Table A — what each component produces (offense) · v1 ✅
| Component | v1 effect | Thematic fit |
|---|---|---|
| **Weapon Storage** | **Freeze** — disable the part | cryo cannons |
| **Tower** | **Confuse** — the part misfires | jamming / EW |
| **Power Generator** | **Drain** — damage + heal you | energy siphon |
| **Launch Pad** | **Burning** — damage over the resolve | incendiary missiles |
| **Engine** | **Shatter** — synergy: +50% damage to a Shattered focus | kinetic ram |

v1 statuses: **Freeze · Confuse · Drain · Burning · Shatter** (5). The amplifier column and
high-tier branches are deferred to v2. **Detonate / Multihack / Beam** are Table-C mechanics, not
component effects.

### 3.5 Table B — effect validity · v1: **DROPPED** (any status on any part) ⏸️ parked
**v1 simplification:** any status can be applied to **any** component (incl. the Core) — the validity
gate is off (`core/components.js → EFFECT_VALID_TARGETS` all `'*'`). Nothing is greyed out when you
pick a target. Effects are still *situationally* stronger on some parts (the "What it does there"
column), but that's no longer a hard restriction. The richer matching rules may return later.
| Effect | Valid targets | What it does there |
|---|---|---|
| **Freeze** | Any | ×0 firepower contribution **and** suspends the part's system for the duration: frozen **Tower** → suspends *both* Tower roles — an **enemy** Tower's aim scatters (~40% softer), **your** Tower goes **blind** (no telegraph preview); frozen **Engine** → no evasion. (Generator shield/brownout + Launch Pad TRS stay tied to destruction.) **Cancels with Burning** — applying one wipes both. |
| **Confuse** | Any | ×0.5 firepower contribution; **on your own Tower it jams the sensors → the telegraph stays visible but UNRELIABLE**: each predicted strike has a ~50% chance (`telegraph.confuseFalseChance`) of being a **false alarm** (wrong part/status), shown faded with a "?". *(Distinct from Freeze, which blinds the telegraph entirely. No telegraph effect on an enemy Tower, which never telegraphs your attacks.)* |
| **Drain** | Any | siphon HP to you (heals your Core); kill the Generator to drop the Core shield (best on Generator & Core) |
| **Burning** | Any | flat DoT each round; **bypasses the Core shield**; best on high-HP (Core, Generator). **Cancels with Freeze.** |
| **Shatter** | Any | brittle → the focus takes **+50%** from all your fire (no effect on a *shielded* Core until its shield drops); universal combo-enabler |

#### Offensive status reference (full) — ✅ v2, all config-driven (`effects.<status>`)
Each solved status feeds **two channels**: ① the shared **firepower pool** (`dmgPerPotency × potency`,
detonated on the single Focus, always counts even if the status is consumed by a combo) and ② a
**lingering** debuff on the part. **Min Chain** = minimum payload icons that must be chained for the
solve to succeed (`minChain`), now enforced by the module's **objective gate** — reaching the goal
short is *blocked* with a "Need X more" prompt, not failed (§3.8). **Stacks** = re-applying the same
status to the same part.

| Status (source) | Valid on | Min Chain | Stacks? | Full effect ( [scaled] grows with potency · [flat] fixed ) |
|---|---|---|---|---|
| **Freeze** ❄️ (Weapon) | Any | **1** | **Refresh** (MAX), pool adds | ① pool +1.5×p [scaled] · ② part contributes **×0** firepower [flat]; frozen Tower → enemy aim scatters (−40%) / **your telegraph goes blind**; frozen Engine → no evasion [flat]; **on Focus +40%** [flat]; duration round(p/4), 1–3 [scaled]. **Cancels with Burning.** |
| **Confuse** 🌀 (Tower) | Any | **1** | Refresh (MAX), pool adds | ① pool +1.0×p [scaled] · ② part ×0.5 (−50%) firepower [flat]; **on your own Tower → telegraph turns UNRELIABLE (~50% false predictions)** [flat]; duration round(p/4), 1–3 [scaled] |
| **Drain** 🩸 (Generator) | Any | **1** | **Heal per apply**, choke MAX, pool adds | ① pool +3.0×p [scaled] · ② heal +2.0×p to your Core on apply [scaled] **+ an ongoing SIPHON: each turn it lasts the part loses `dotPerPotency`×p HP that flows back to your Core** [scaled]; part ×0.6 (−40%) firepower [flat]; duration round(p/5), 1–2 [scaled] |
| **Burning** 🔥 (Launch Pad) | Any | **1** | **STACKS** — DoT adds (cap 24), duration extends (cap 6); pool adds | ① pool +1.0×p [scaled] · ② DoT 1.2×p/round, **bypasses Core shield** [scaled]; part ×0.85 (−15%) firepower [flat]; duration round(p/3), 1–4 [scaled]. **Cancels with Freeze.** |
| **Shatter** 💥 (Engine) | Any | **1** | Refresh (MAX), pool adds | ① pool +2.0×p [scaled] · ② **on Focus +50%** [flat]; no firepower choke (×1.0); duration round(p/3), 1–3 [scaled]; enables Glass/Meltdown/Backfire/Collapse |

*Stacking policy:* only **Burning** truly stacks (DoT & duration accumulate, capped); the rest
**refresh** (keep the stronger) — but the **pool always adds**, so re-applying any status still helps.

### 3.6 Table C — status compounding · v2 ✅ (implemented, config-driven)
Statuses pair up. A combo fires **wherever both its statuses sit on the same component**, across
**all** enemies (not just the Focus) — except **Glass**, which is a focus-fire multiplier. **Shatter
is valid on any part** (universal enabler). **Fire ⊗ Freeze cancel** (applying one wipes both —
steam), so that pair has no combo. **Frozen + Drained is intentionally open** (no combo yet — parked
for later). Every combo's numbers live in `config/game.json → effects.synergy.combos`.

|  | **Shattered** | **Burning** | **Confused** | **Drained** |
|---|---|---|---|---|
| **Frozen** | **Glass** | ⊗ cancel | **Stasis Lock** | *(open — TBD)* |
| **Shattered** | — | **Meltdown** | **Backfire** | **Collapse** |
| **Burning** | | — | **Wildfire** | **Vaporize** |
| **Confused** | | | — | **Feedback Cascade** |

**Glass** (Frozen + Shattered)
- *Does:* your focus-fire on the part is **×`glass.mult`** (one clean doubling; replaces the separate Shatter/Freeze bonuses). Focus-only.
- *Example:* a 30 pool → **60**.
- *On:* any non-Core part (Freeze can't touch the Core).

**Stasis Lock** (Frozen + Confused)
- *Does:* extends the freeze by **`stasisLock.extendTurns`** each resolve it's present — deep lockdown (×0 firepower + system suspended longer).
- *Example:* Freeze (2 turns) + Confuse on their Tower → freeze +2 → stays blind/scattering far longer.
- *On:* Weapon, Tower.

**Meltdown** (Shattered + Burning)
- *Does:* each Burning tick on a Shattered **non-Core** part also funnels **`meltdown.coreFrac` × dot** straight into that enemy's Reactor Core — and burning ignores the shield, so it lands while the Core is shielded.
- *Example:* Shattered+Burning Generator burning 6/rnd → 6 to the Generator **+ 3 to the Core** every round.
- *On:* any part (best on a side part to chip the Core indirectly).

**Backfire** (Shattered + Confused)
- *Does:* the cracked, misfiring part takes **`backfire.selfDamage`** self-damage at resolve (free chip you didn't spend firepower on).
- *Example:* a Shattered+Confused Weapon recoils for **20**.
- *On:* Weapon, Tower.

**Collapse** (Shattered + Drained)
- *Does:* if the part is already **below `collapse.hpThreshold` × maxHP**, the drain ruptures it → **destroyed outright** (execute). Runs last.
- *Example:* a Shattered Generator at 18% HP gets Drained → **collapses**.
- *On:* any part.

**Wildfire** (Burning + Confused)
- *Does:* spreads Burning at **`wildfire.spreadFrac`** strength to a random living neighbour on the same enemy.
- *Example:* Burning 6/rnd + Confused on their Weapon → also lights their Engine for 3/rnd.
- *On:* Weapon, Tower.

**Vaporize** (Burning + Drained)
- *Does:* the part's **remaining** Burn DoT detonates **immediately** (one burst), and you heal **`vaporize.healFrac`** of it; the burn is consumed.
- *Example:* a part burning 6/rnd with 3 rounds left (18 pending) gets Drained → **18 now + ~9 heal**.
- *On:* any part.

**Feedback Cascade** (Confused + Drained) — *reworked: it hits the target AND cascades.*
- *Does:* deals **`feedback.chainFrac` of the drain damage as direct HP to the TARGET part itself AND to the same part on _every_ other living enemy**, healing you **`feedback.healFrac`** of each hit; it also keeps Drain's Core **heal** + firepower **choke** on the target. Confuse is spent as the cascade enabler. In 1v1 it still hits the one part — never a wasted pick.
- *Example:* a Drained+Confused part vs 3 enemies → **~7.5 to it + ~7.5 to each of the other two** + drain heal + a heal share of each hit.
- *On:* Any part (extra reach with ≥2 enemies; works solo).

> **Single-status bonuses still apply when alone:** Shatter alone **+`shatterAmp`** (50%), Freeze alone
> **+`frozenBrittle`** (40%) on the focus.
>
> **Parked for later (v3):** the open Frozen+Drained pair, status **self-stacking**, and the
> **specials** (Detonate / Multihack / Beam).

---

## 3.7 Status queue, combos & breaks — the v2 engine ✅ (implemented; governs §3.6 + §4 Table E)

> One engine drives **both** offensive combos (§3.6, statuses on enemy parts) and defensive combos
> (§4 Table E, verbs on your own parts). This section is the source of truth.

### How a combo forms — FCFS chain, greedy consume (model A)
Every component holds an **ordered chain** of the statuses/verbs on it, in the order they were
applied (**first-come-first-served**). Resolution scans the chain **left-to-right**: the **first**
adjacent, non-`break`-separated pair that forms a valid combo **consumes both entries** into a single
result, and the scan continues **after** them. A combo **result never combos again**. So each entry
joins **at most one** combo, earlier pairs win, and any leftover entry applies its base effect.
- `[A, B, C]` → A+B fires → chain becomes `[result, C]` → **C applies its base. Exactly one combo.**
- `[A, B, C, D]` → A+B and C+D — two non-overlapping combos.
- `[A, break, B, C]` → A keeps its base; B+C fires.
- If A+B don't form a valid pair, the scan tries B+C next.

### Break — opting out of a combo
Because a combo **replaces** its ingredients' base effects (below), the player sometimes wants the
two base effects *instead* of the combo. A **`break`** is a dummy chain entry (a per-component
button, lower-right of the card) that **cuts adjacency**: `[A, break, B]` → A and B no longer
combo, both keep their base effects. Rules: a break **can't be first** and **can't follow another
break** (it must sit between two real entries).

### A combo REPLACES its two base effects (strict)
When two entries combo, **their individual base effects do not apply** — only the combo's effect
does. Each combo is therefore **self-contained** (it re-specifies any damage/DoT/etc. it needs).
- *Glass (Freeze+Shatter):* you get **×2 focus damage** but **lose** Freeze's firepower-choke /
  system-suspend **and** Shatter's +50% — pure burst, no lockdown.
- *Meltdown (Shatter+Burning):* you get the **core-funnel DoT** but **lose** Shatter's +50% amp.
- Want the bases instead? Put a `break` between them.

A status/verb consumed by a combo also **grants no side-benefit** — e.g. **Overclock in a combo
grants no build-credit**.

### Active + queued
The chain is **active (prior-round) entries at the front + this phase's queued additions appended**;
combos read the whole chain, and `break`s you place this phase opt out.
- **Attack:** statuses persist by their turn count, so active+queued mixing enables multi-round
  setups.
- **Defense:** plain verbs are one-shot (consumed at their resolve). The **only** carryovers are the
  two persistence combos — **Sustain** (a shield) and **Field Repair** (a heal) — which become
  **active defensive states** and resolve again at the **next DEFENSE resolve** (never the attack
  phase, where you're not hit).

### Resolution & guard rails
- **Evaluate each resolve from the current chain.** Combos that **consume** their inputs (Glass,
  Vaporize, Collapse, Deflect, Reboot, Backfire) fire once and clear; **ongoing** combos (Meltdown,
  Wildfire, Bastion, Reactive Plating, Sustain, Field Repair) re-apply while present. *(C6)*
- **A combo needs ≥1 *new* this-phase entry** — two *carried* entries never silently re-combo every
  round. *(C2, loop-guard)*
- **Carryovers last to the next defense resolve, then expire unless their combo is re-formed**
  (refresh). One Sustain ≠ a permanently shielded part. *(C3)*
- **Re-comboing a carryover is the intended depth** — carried **Shielded** + a new **Harden** =
  **Bastion** next round. *(C4)*
- **Self-stack *combos* stay parked** — same-status pairs (Shield², Freeze²) don't form a new combo;
  re-applying instead follows the **stacking policy** (§3.5 / §4 reference tables): only **Burning**
  accumulates (DoT + duration, capped); other statuses **refresh** (MAX) but the **firepower pool
  always adds**; defensive verbs are **additive**. **Min Chain** gates each solve via the module
  **objective gate** (1 scaled / 3 non-scaled — block-not-fail, §3.8). *(C5 stacking policy resolved
  2026-06-20; the per-potency **numbers** are still a deferred playtest pass.)*
- Tuning knobs: **persistence lifespan** and **Bastion cap %** stay in config in case a part gets
  too hard to kill. *(C7)*

### UI
Cards **separate two rows**: **Active** statuses (already on the part) and the **Queued** chain for
this phase (with `break` markers and an "＋ break" button). Combos are surfaced in the event log as
they fire.

---

## 3.8 Statuses as route friction — the puzzle-module reflect-back ✅ implemented

> Statuses don't just change the damage math (§3.5/§6) — they are now **felt while you solve a
> route**. When you open the TRS for one of YOUR components, any **enemy status sitting on that
> component** is translated into the grid-path module's runtime modifiers, so a debuff makes the
> *routing itself* harder. This is the headline reflect-back of the puzzle-module upgrades; it
> applies in **both** attack and defense build (you solve your own component in either). All of it is
> config-gated in `config/game.json#puzzle.modifiers` so the feel is tunable.

| Status on your component | Felt as (module mechanic) | What you experience while solving |
|---|---|---|
| **Freeze** ❄️ | `modifiers.slow` | the cursor drags an icy *preview*; the solid path catches up slowly (`6 × freezeSlow` cells/sec) — freeze genuinely costs clock time |
| **Confuse** 🌀 | `modifiers.confusion` | per-step chance to veer to a random **safe** neighbour — the route wobbles |
| **Drain** 🩸 | `modifiers.decay` | your **payload icons vanish on a timer** (closest to START first); cross one to secure it before it drains |
| **Shatter** 💥 | `modifiers.wander` | un-crossed payload icons **shake and jump** to random empty neighbours |
| **Burning** 🔥 | `burningDensity` (generation) | the board is seeded with off-route **🔥 firehazard** cells (a second hazard); with `failFast`, crossing one **fails the run immediately** |

- **Overlap is supported and intended:** a part can be confused **+** drained **+** shattered at once,
  so a single solve can carry several modifiers together. Only **freeze + burning never co-occur** —
  the host cancels them on apply (steam), matching the module's freeze⊻burning rule.
- **`decay`/`wander` act on the icons you're chaining** (`payloadType` = the component's own
  effect/verb), so an enemy's Drain on your Weapon makes *your* freeze icons evaporate mid-route.
- **Double-pressure is deliberate:** a frozen offense part already contributes ×0 firepower at
  resolve (§6) **and** now drags the cursor at build — two different moments. The per-status knobs
  (`freezeSlow`, `confuseChance`, `drain.{baseMs,stepMs}`, `shatterChance`, `burningDensity`) let
  playtest soften it. Watch that `drain.baseMs` stays high enough that the Min-Chain gate (below)
  remains reachable while icons decay.

### Min Chain is now an OBJECTIVE GATE, not a post-commit fail ✅
The module enforces **Min Chain** (§3.5/§4: 1 for scaled effects, 3 for Cleanse/Overclock) with a
**live objective gate**: reaching the goal while short is **blocked, not failed** — the path stays
drawn and a "Need X more" prompt shows, so you reroute and finish. The bridge configures
`objective: { type: payloadType, min: minChain }`; the old post-commit "you solved but under-chained,
so it fails + cools down" punishment is **gone**. (Don't run both — the gate replaces it.)

### Pre-start GO pause + fail banner ✅
A short **GO countdown** (`puzzle.countdown`) holds input until you're ready; its pause time is
**excluded from the solve clock**, which matters under the `realtime` credit model (the credit must
not drain during the pause). Any fail (hazard / timeout) shows a centred **FAIL banner**
(`puzzle.failText`).

### Generation = one shared source of truth ✅
The per-component palettes + route plans now come from the package preset
`grid-path-puzzle/presets/trs.js` (the same code the standalone playground uses, so the two can't
drift); `puzzle/palettes.js` is a thin adapter. Strategy keeps its **HP-gradient Launch Pad** model
(§7) by feeding the preset its `trsMods`; generation feel is driven by `config/game.json#puzzle.gen`
knobs. **Constraint:** `puzzle.gen.count.min ≥ 3` so Cleanse/Overclock (Min Chain 3) stay solvable.

---

## 4. Defense phase — detail ✅
Symmetric **build-then-resolve** (replaces the earlier real-time barrage). **Two picks, both on
your side** — this fills the gap that defense also needs an "apply to which part" step.

**Build action (repeatable):**
1. **Pick launcher component** = the *type* of defense (its palette — Table D).
2. **Solve its TRS.**
3. **Pick which of YOUR components receives it** (the destination). Its current condition adds a
   resolve rider (Burning destination → auto-cleanse; low HP → boosted repair).
4. **Queue.** Repeat freely until the 120s credit is gone.

**Components are REUSABLE in defense** (vs attack's one-use-per-phase) — triage means spreading
repairs/shields across several wounded parts. Capped only by the 120s credit. ✅

**Resolve:** the enemy attacks (archetype targeting + telegraphed strikes); your **pre-loaded**
defenses absorb/mitigate; **you lose HP only here**. Per-component order (v2):
`Cleanse(oldest 1) → combos (Deflect dodge / Bastion cap / Purified-Barrier status-immunity) →
Harden(first hit) → Evasion → Shield absorb (+ Reactive-Plating reflect) → HP → Repair pass`.
A part at 0 → destroyed → cascade. Survive → next attack phase; Core 0 → lose.

### Table D — defensive palette per component 🔧 *(refine later)*
| Component (defense use) | Defensive effect (v2) | Fits because |
|---|---|---|
| **Weapon Storage** | **Shield** — absorb a flat chunk | sturdy bulwark |
| **Power Generator** | **Repair** — restore HP | power = healing |
| **Tower (Sensors)** | **Cleanse** — strip the **oldest 1** status (FCFS) | scrub jamming |
| **Engine** | **Harden** — % off the **first** incoming hit | mobility = mitigation |
| **Launch Pad** | **Overclock** — **+2–3s build-credit next attack phase** (stacks) | supercharge tempo |

Loadout pressure mirrors attack: lose your Generator → no Repair; lose your Tower → no Cleanse.

#### Defensive verb reference (full) — ✅ v2, all config-driven (`defense.<verb>`)
Verbs are **queued** on your own parts then resolved through the chain (combos/breaks, §3.7). **Min
Chain** = minimum payload icons to chain for a successful solve (1 for potency-scaled; **3** for the
non-scaled Cleanse/Overclock). All defensive verbs **stack additively** (the policy is unchanged).

| Verb (source) | Potency-scaled? | Min Chain | Stacks? | Full effect |
|---|---|---|---|---|
| **Shield** 🛡️ (Weapon) | **Yes** — p×8 absorb | **1** | Additive | absorbs a flat chunk before HP; consumed at resolve **unless** a persistence combo (Sustain / Bastion / Reactive Plating) carries it to the **next defense resolve** |
| **Repair** 🔧 (Generator) | Yes — p×6 HP | **1** | Additive | heals HP in the post-strike repair pass (whether hit or not) |
| **Cleanse** 🧹 (Tower) | **No** | **3** | n/a | strips the **oldest 1** offensive status (FCFS) before strikes land; full strip only via **Reboot** |
| **Harden** 🪨 (Engine) | Yes — p×4%, cap 60% | **1** | Additive (to cap) | % off **only the first** incoming hit on that part (with evasion, total reduction capped 90%) |
| **Overclock** ⚡ (Launch Pad) | **No — flat +2.5s** | **3** | Additive / use | banks **+2.5s build-credit** for your **next attack phase**; no mitigation; grants nothing when consumed by a combo |

### Table E — defensive synergy matrix · v2 ✅ (implemented; engine = §3.7)
States: **Shielded, Repaired, Cleansed, Hardened, Overclocked**. A combo fires at **defense resolve
on a part that has both verbs** in its chain (adjacency + breaks per §3.7); a combo **replaces** both
base effects (so an Overclock in a combo grants **no** credit). Empty cells = no combo (the two just
apply independently). Numbers live in `config → defense.combos`.

|  | **Repaired** | **Cleansed** | **Hardened** | **Overclocked** |
|---|---|---|---|---|
| **Shielded** | **Sustain** | **Purified Barrier** | **Bastion** | **Reactive Plating** |
| **Repaired** | — | — | **Field Repair** | — |
| **Cleansed** | | — | **Deflect** | **Reboot** |
| **Hardened** | | | — | — |

**Sustain** (Shield + Repair) — *durability.*
- *Does:* the **shield persists to the next defense resolve** (carries through the attack phase); re-forming it refreshes it. Leftover absorbs again next time you're hit. The **Repair is consumed to power the persistence — it grants NO HP heal** (combo replaces both bases).
- *Example:* shield 40, takes 25 → 15 carries to next defense resolve instead of vanishing (and no HP was restored). *On:* any part.

**Purified Barrier** (Shield + Cleanse) — *status wall.*
- *Does:* while the shield holds, the part is **immune to incoming statuses** this resolve (debuffs bounce off).
- *Example:* a Disruptor's freeze hits your barrier'd Weapon → no freeze applied. *On:* any part.

**Bastion** (Shield + Harden) — *anti-burst cap.*
- *Does:* **caps** total damage to the part this resolve at **`bastion.capFrac` × maxHP**, however many enemies pile on. (vs lone Harden which only blunts the *first* hit.)
- *Example:* 3 enemies focus your Generator for 90 → capped to ~25. *On:* any part.

**Reactive Plating** (Shield + Overclock) — *thorns wall.*
- *Does:* damage the **shield absorbs is reflected** (`reactivePlating.reflectFrac`) back at the attacking enemy — to its **lowest-HP part, Core first if its shield is down**.
- *Example:* shield eats 40 → ~12 reflected to the attacker's lowest-HP part. *On:* any part.

**Field Repair** (Repair + Harden) — *heal-over-time.*
- *Does:* the repair **also repeats at the next defense resolve** (HoT under cover).
- *Example:* repair 18 now **and** 18 next defense resolve. *On:* any part.

**Deflect** (Cleanse + Harden) — *dodge.*
- *Does:* the part **fully dodges the 1st incoming hit** (the first entry in the strike queue) — 0 damage. **No** cleanse (the combo replaces Cleanse's base).
- *Example:* the first enemy strike on it whiffs entirely. *On:* any part.

**Reboot** (Cleanse + Overclock) — *full purge.*
- *Does:* **clears ALL** statuses on the part (vs lone Cleanse = oldest 1). **No** invulnerability.
- *Example:* a part hit by freeze+drain+confuse → all stripped. *On:* any part.

> **Cut** (redundant): Recovery, Power Surge, Combat Mode. **Parked (v3):** Spike (now lives as
> Reactive Plating), Status Ward, self-stack, the **Fortress** special.

---

## 5. Telegraph & the Tower (Tower-gated) ✅
**Telegraph is an *enemy* mechanic** (the player never arms telegraphs — all your offense lands in
your own attack-resolve). The enemy **declares its next attack at the start of your attack phase**;
it resolves in the following defense-resolve. The **Tower/Sensors** decides who can see/aim:
- **Your Tower alive** → you *see* the enemy's intended targets and pre-load the right defenses.
  **Destroyed or Frozen/Stasis-Locked** → you defend **blind** (no preview). **Confused** → the
  telegraph stays visible but **unreliable**: each predicted strike has a ~50% chance of being a
  false alarm (`telegraph.confuseFalseChance`), shown faded with a "?". The **true** plan still
  resolves as normal — only your *view* of it is jammed.
- **Enemy Tower** is how the *enemy aims*. Destroy it → its precise archetype targeting breaks and
  its attacks **scatter to random parts** — the "blind their Tower" payoff.

The telegraph is **truthful** (it matches what resolves) and **Tower-gated** (`telegraph.gated`):
you see it only while your Tower is up, and a **Confused** Tower jams the *view* with decoys
(`telegraph.confuseFalseChance`). *(The earlier "deterministic ↔ variance" predictability switch was
never wired and has been removed.)*

---

## 6. The condition → firepower loop (the heartbeat) ✅ concept / 🔧 numbers in config

What stops attack and defense from being two separate games. Your attack-resolve damage is:

```
resolveDamage = ( base  +  Σ queued TRS add-ons )  ×  firepowerMult
```
- **base** — aircraft's inherent output.  **Σ add-ons** — the combo chain you built this phase.
- **firepowerMult** — driven by your **Combat Condition**, a weighted blend of your
  offense-critical components (so the enemy choking the *right* parts strangles your offense):

| Component | Weight 🔧 | Why |
|---|---|---|
| Power Generator | 40% | the power supply |
| Weapon Storage | 35% | the guns |
| Engine | 10% | targeting / accuracy |
| Tower | 8% | lock-on |
| Launch Pad | 7% | combat-routing throughput (also governs TRS quality, §7) |

```
Condition%   = Σ ( componentHP%  ×  debuffFactor )  ×  weight        ✅ debuffs count
firepowerMult = curve(Condition%)   // default smooth gradient 0.4–1.0; floor avoids death-spiral
```

**✅ The whole mapping is config-driven** (`firepower` block): the curve **shape** (smooth
gradient / hard thresholds / steep), the **floor** (default ×0.4), the component **weights**, and
the per-status **debuffFactor** are all tunable in `games/strategy/config/game.json` — playtest the
feel without code changes.

**Why it binds the phases:** enemy wrecks your Generator/Weapon Storage → Condition drops → your
*whole* next chain hits softer → spiral. **Counter:** repair high-weight *offense* parts in defense
(not just shield the Core) — that's the only reason to repair offense, and it's what makes defense
matter to offense.

- **Destruction is a cliff, not a slope:** a *damaged* Generator lowers the gradient; a *destroyed*
  one zeroes its 40% weight **and** fires the cascade brownout (§7). Losing a part ≫ chipping it.
- **Debuffs choke firepower** (`debuffFactor`): Frozen offense part ≈ ×0 this phase, Drained ≈ ×0.6
  — so enemy *statuses* sap your offense, and **Cleanse** becomes a firepower-restoring tool.

---

## 7. Systemic cascade — hybrid (gradient + cliff) ✅ model / 🔧 numbers
Mirrored on both aircraft. A **gradient** while a part is merely damaged; a hard **cliff** on
destruction. The cliff is always worse than the slope — that's what makes a kill decisive.

| Component | While damaged (gradient) | When **DESTROYED** (cliff) |
|---|---|---|
| **Power Generator** | 40% firepower weight (no gradient on the Core shield — it's binary) | **Core shield drops** (its 100% contribution, by default) + **brownout**: all output ×0.5 |
| **Weapon Storage** | 35% firepower weight; base damage scales | **base firepower collapses** (only weakened TRS add-ons remain) |
| **Tower (Sensors)** | no change until destroyed (binary in v1) | **your** Tower → defend **blind** (no telegraph); **enemy** Tower → its aim **scatters to random parts** + lands ~40% softer (aimMult) |
| **Engine** | evasion fades 15%→0% with HP (reduces incoming in defense; dodges the player's focus-fire when it's the *enemy's* Engine) | evasion → 0 (no dodge). *Initiative/resolve-order parked for v2 — no effect in v1's fixed turn order.* |
| **Launch Pad** | **TRS quality scales with HP** — full HP *eases* your grids (fewer blockers/traps, smaller grid); damage fades the bonus to baseline. Also 7% firepower weight | TRS **congests** past baseline: grid +2, extra blockers/traps → routing harder, more fails. Loses its 7% firepower weight |
| **Reactor Core** | — | **match over** |

**Win:** **every** enemy **Reactor Core** → 0. **Lose:** yours → 0.

### Multiple enemies ✅ (implemented)
A battle fields a **roster of up to 4 non-Boss enemies** (config-panel "＋ Add enemy"; any archetype,
repeatable; duplicates get numbered labels). Each enemy is a full aircraft with its own
HP/condition/cascade/Core-shield, archetype and telegraph. **Attack:** you pick which *enemy + part*
each status lands on, and the single firepower pool detonates on **one** component of **one** enemy
per resolve (multi-Focus stays a v2 power-up). **Defense:** **every** living enemy strikes each
defense-resolve (telegraphs and budgets stack). **Win** needs all enemy Cores down; a defeated
enemy greys out and stops acting.

### Enemy archetypes (the targeting brains) ✅ (Boss = v2)
Each enemy commits its attack at the **start of your attack phase** (visible as a telegraph if your
Tower's alive), and it lands in your defense-resolve.

| Archetype | Targets | Personality | Counter |
|---|---|---|---|
| **Brute** | highest-HP part, focus-fire | big, predictable | over-shield it / sacrifice a cheap part |
| **Saboteur** | your **Generator / Weapon Storage** | chokes firepower + forces cascade | pre-shield & repair offense core |
| **Hunter** | your **Tower / Engine** (sensors+mobility) | information warfare | repair Tower for vision |
| **Swarm** | spreads thin + small debuffs (Burning/Confuse) | wide chip | Fortress / cleanse-all spikes |
| **Disruptor** | status-heavy (freeze/drain/confuse) | debuff-chokes firepower (§6) | Cleanse-heavy defense |
| **Boss** 🔧 v2 | switches policy at Core 66%/33% | multi-phase + telegraphed "ultimate" | adapt; drops a **Trophy** |

> **Predictability:** the telegraph always reflects the true plan (deterministic). The earlier
> "with variance" difficulty switch was never implemented and has been **removed**; unreliability now
> comes only from a **Confused** Tower (decoy predictions) or a destroyed/frozen Tower (blind).

---

## 8. Roguelike meta ✅ concept / 🔧 detail
Slay-the-Spire node map, seeded with rules (every path ≥1 Battle before Boss; ≥1 Shop; no
adjacent Rests). Currency = **Salvage** (`10 + 5×parts destroyed`).

| Node | Effect |
|---|---|
| **Battle / Elite** | enemy aircraft (Elite tougher, more Salvage) |
| **Shop** | buy component variants / cleanse charges / items |
| **Modify** | swap a component's **TRS config** (re-spec a weapon) |
| **Develop** | permanent-for-run stat (HP / move budget / time discount) |
| **Rest** | repair + cleanse all |
| **Boss** | archetype Boss → **choose 1 Trophy** |

**Trophies** = permanent meta in `localStorage`, survive death (e.g. *Veteran Router* +1 move
budget forever, *Reinforced Core* +20% Core HP, *Sensor Suite* telegraphs always visible).
Component HP carries between battles within a run (Rest heals); death loses the run, keeps Trophies.

---

## 9. How it reuses existing code (build reference, not in scope here)
- **Verbatim module:** `games/grid-path-puzzle/module/GridPathPuzzle.js` + `combo/ComboEngine.js`.
  The strategy bridge passes the module's optional options — `modifiers`, `objective`, `countdownMs`/
  `flashStart`/`countdownText`, `failText`, `trapEntryMode:'failFast'`, and (via the route plan) the
  `firehazard` `burningType`/`burningDensity` — none of which require touching the module.
- **Shared generation preset:** `games/grid-path-puzzle/presets/trs.js` is the single source of
  truth for the per-component palettes + route plans (the playground uses the same file). Strategy's
  `puzzle/palettes.js` is a thin re-export adapter; `ATTACK_EFFECT`/`DEFENSE_VERB` stay authoritative
  in `core/components.js` and a test asserts they match the preset's mirror.
- **New host (`games/strategy/`):** state = 2 aircraft × 6 components; a **bridge** like the
  shmup's `puzzle/bridge.js` that **queues** actions during build and **applies them at resolve**;
  a **handler registry** (mirrors `games/shmup/effects/handlers.js`) implementing the status
  matrix, firepower formula, and cascade; the phase/credit/resolve loop; enemy AI; map + trophy
  persistence; renderer for the two boards.
- **Register:** add `strategy:` entry to `vite.config.js` + a menu tile in root `index.html`.

### Implementation & config reference (§3.8 reflect-back)
- **`puzzle/bridge.js`**
  - `statusFriction(component, payloadType, mods)` — pure, exported, unit-tested. Reads the
    component's live statuses and returns `{ modifiers | null, burningOn }`: freeze→`slow`,
    confuse→`confusion`, drain→`decay{type,baseMs,stepMs}`, shatter→`wander{type,chance}`; `burningOn`
    drives the generation `burningDensity`. Overlapping statuses combine; freeze+burning can't co-occur.
  - `open()` assembles `knobs` (`config.puzzle.gen` + per-solve `burningDensity`), the `modifiers`,
    the `objective` (`{type: payloadType, min: minChain}`), and the GO/failText options, then mounts
    the puzzle. `finish()` no longer does a post-commit Min-Chain check (the gate owns it).
- **`config/game.json#puzzle`** — the tuning surface (all live-editable, no code changes):
  - `gen` `{cluster, count:{min,max}, placement, trapDensity, blockerDensity, channeling,
    primaryLengthTarget, alternateRoutes, chainPlacement, chainChance}` → preset genPlan knobs.
  - `modifiers` `{freezeSlow, confuseChance, drain:{baseMs,stepMs}, shatterChance, burningDensity}`
    → the per-status route-friction strengths.
  - `countdown` `{ms, flashStart, text}`, `failText`, `trapEntryMode:'failFast'`.
- **Per-effect `minChain`** lives in `effects.<status>.minChain` / `defense.<verb>.minChain` (matches
  the preset's `MIN_CHAIN`); it seeds the objective gate's `min`.

---

## 10. Open items to revisit (deliberately deferred) ❓
- Tables A/B/C + D/E + both matrices: balance pass (the user wants to refine these later).
- Exact **condition→firepower** curve and **base firepower** values.
- Whether attack's "one component use per phase" relaxes later (defense is already reusable).
- Cascade magnitudes; archetype roster; Trophy catalog breadth.
- Spike numbers (reflect %), Evade/Harden reduction caps, Overclock system-boost magnitudes.
- Telegraph fidelity (exact target vs. fuzzy intent) once the loop is balanced.
- **v2 — "Status Ward":** a defensive combo that grants a *ward / immunity* which **pre-empts the
  next incoming status** (blocks or reflects it). In v1, Cleanse only strips statuses already on a
  part and runs *before* the strike, so it cannot stop an incoming status (incoming statuses are
  shown greyed to make this timing clear). A Ward would be the deliberate counter to status-heavy
  enemies (Disruptor/Saboteur), resolving at the start of the mitigation order, before the strike.

---

# PART B — v1 Build Plan: the battle loop

> Goal: the **smallest playable single battle** that exercises the full loop with **attack v1**.
> Roguelike meta (§8) is explicitly a later phase. Builds as a new Vite page `games/strategy/`,
> reusing the TRS module the same way the shmup does.

## B.0 Defense v1 (minimal — defined here so the loop is complete) ✅ working set
Mirror of attack but simpler; no defensive synergy matrix in v1 (Table E parked). Build action:
pick component (= defense type) → solve → apply to one of **your** parts → queue; **repeatable**.

| Component (defense) | v1 effect |
|---|---|
| **Weapon Storage** | **Shield** — absorb incoming |
| **Power Generator** | **Repair** — restore HP |
| **Tower** | **Cleanse** — strip statuses |
| **Engine** | **Harden** — flat damage reduction |
| **Launch Pad** | **Overclock** — (v2) +build-credit next attack phase |

**Resolve order per part:** see §4 (v2). Defenses **stack additively**. The **Table E v2** synergy
matrix + the **status-queue/break engine** are specified in **§3.7** and **§4 Table E** (this is the
v2 pass; built on branch `TRS-Strategy-Design-V2`).

## B.1 Scope
- **In:** one battle, 6 components/side (HP only), alternating **Attack/Defense → Build(120 credit)
  → Resolve**; attack v1 (Focus + 5 statuses + 3 synergies); defense v1 (B.0); condition→firepower
  (§6); cascade hybrid (§7); **a roster of up to 4 non-Boss archetypes** (Saboteur/Brute/Hunter/Swarm/Disruptor — feel the targeting
  contrast); Tower-gated telegraph (basic); win/lose on Core; a **pre-game config panel** (B.6).
- **Layout:** **left rail = config/controls**, **center = the two aircraft boards**, **right =
  the TRS puzzle panel** (slides in on solve, like the shmup), **bottom = phase-aware info bar**
  (B.7) giving the player the guidance/state they need during attack & defense.
- **Out (later):** roguelike map/shop/trophies; multi-target power-ups; v2 matrices; Detonate/
  Multihack/Beam; Spike; extra archetypes.

## B.2 Reuse (do not modify the module)
- **Verbatim:** `grid-path-puzzle/module/GridPathPuzzle.js`, `combo/ComboEngine.js` — the bridge only
  *passes* the module's optional features (`modifiers`/`objective`/`countdown`/`failText`/`failFast`/
  `firehazard`); the module itself is never edited (§3.8, §9).
- **Shared preset, not copies:** the per-component palettes + route plans come from
  `grid-path-puzzle/presets/trs.js` (one source of truth with the playground); `puzzle/palettes.js`
  re-exports it. Pattern mirrors `games/shmup/puzzle/bridge.js` + `effects/handlers.js` +
  `config/game.json`.

## B.3 File map (`games/strategy/`)
```
index.html · main.js (boot + loop + phase FSM)
config/game.json            // ALL tuning (see B.5)
core/   state.js  components.js  phases.js  firepower.js  cascade.js
combat/ attack.js  defense.js  statuses.js  enemyAI.js
puzzle/ bridge.js (mount per-component palette; QUEUE on solve; apply at RESOLVE)  palettes.js
view/   render.js (two boards, HP/status, build-queue preview, telegraph, resolve anim)
        configPanel.js (left rail — B.6)  infoBar.js (bottom help — B.7)
combo/configs/  offensive-*.json  defensive-*.json
```

## B.4 Build order (milestones, each independently checkable)
1. **Scaffold:** Vite entry + menu tile + static three-pane layout (left config rail · center
   two-board render · right puzzle slot) + the **config panel** (B.6) wired to seed `game.json`.
2. **Loop skeleton:** state + phase FSM + 120 credit + Build→Resolve, with **stubbed** actions.
3. **TRS bridge:** mount the right palette per chosen component; on solve, **queue** an action.
4. **Attack resolve:** Focus targeting + firepower formula (§6) + the 3 synergies (§3.6 v1).
5. **Defense:** B.0 build + resolve mitigation order.
6. **Systems:** condition→firepower curve + cascade (gradient + cliff).
7. **Enemy + telegraph:** Saboteur + Brute targeting policies; Tower-gated intent preview.
8. **Win/lose + HUD polish:** Core death, build-queue preview, resolve animation.

## B.5 `game.json` keys
`components` (HP), `firepower` {curve, floor, weights, debuffFactor}, `credit`, `cooldowns`
(incl. `failCooldownMult`), `coreShield` {threshold, contributors:{part:%}}, `cascade`
(brownout/evasion/TRS-congestion numbers), `potency` {stackCurve, chainMultiplier},
`archetypes` (Saboteur/Brute/Hunter/Swarm/Disruptor — each {priority, spread, statusChance,
status|statusPool, damageBudget}), `telegraph` {gated, confuseFalseChance},
`phase.attackTimeModel` (fixed `realtime`), `ui` (config-panel defaults incl. `enemies:[...]`, `maxEnemies`).
The config panel (B.6) edits these live before Start.

## B.6 Pre-game config panel (left rail)
Before a battle starts, the left rail exposes the knobs so you can playtest variants without
editing files; pressing **Start Battle** locks them into the run's config:
- **Enemy roster:** "＋ Add enemy" rows (up to **4**), each Saboteur · Brute · Hunter · Swarm ·
  Disruptor · Random; repeatable (duplicates auto-numbered).
- **Phase length:** slider (default **15 s**), applies to both attack & defense credits.
- **(optional) component HP preset** + a **seed** field for reproducible TRS grids.
- **Language:** a selector (English / 繁體中文) — see the i18n layer (`games/strategy/i18n/`).

*(Removed: the Attack-time-model and Telegraph-predictability selectors — the game ships realtime,
and the predictability switch was never wired.)*

During the battle the same rail switches to a **status readout** (current phase, remaining credit,
whose resolve, a short event log). All values default from `game.json#ui`; the panel just mutates a
copy before Start.

## B.7 Bottom info bar (phase-aware help + state)
A persistent bar across the bottom that updates with phase and selection so the player always has
the info at hand:
- **Attack phase:** the current step ("pick a Focus → pick a weapon → solve → queue"), the
  selected Focus + its statuses, what the chosen weapon's effect does and **which targets it's
  valid on** (Table B), active synergies (Shatter-amp / Frozen-brittle / Wildfire), and the
  **projected resolve damage** to the Focus.
- **Defense phase:** the incoming threat (telegraphed targets if Tower alive), the chosen defense
  verb and where it'll apply, the **resolve mitigation order**, and remaining credit.
- Always: a one-line tooltip for whatever the player is hovering/selecting. Rendered by
  `view/infoBar.js`, driven off the same state — no new game logic.

---

## Verification

**Design (Part A):** review pass — every status in §3 maps to a real engine effect in
`grid-path-puzzle/combo/configs/*` (true by construction); the reuse seam matches the shmup
(`games/shmup/puzzle/bridge.js`, `effects/handlers.js`, `config/game.json`).

**Build (Part B):** mirror the shmup's approach —
- **Headless logic tests** (`npm run test:strategy`): phase/credit transitions, Build→Resolve,
  firepower formula across conditions, cascade gradient+cliff, the 3 attack synergies, defense
  mitigation order, queue→resolve application via **real** `ComboEngine` results, win/lose on Core.
- **Headless browser smoke:** mount a component's TRS, solve, confirm the queued effect resolves on
  the Focus and HP changes only at resolve; defense pre-load mitigates a Saboteur strike.
- Debug handle `window.__strategy`; `npm run dev` → menu → Strategy.
