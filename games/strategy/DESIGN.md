# Design Doc — "TRS Command" (strategy game on the Tactical Routing System)

> **Deliverable of this plan:** a design document, no code. On approval this content is
> saved to the repo as **`games/strategy/DESIGN.md`**. Concept source images:
> `/home/user/GameDev/TRS-Straregy/` (Attack / Defense / Roguelike).
>
> **Status key:** ✅ agreed with user · 🔧 draft, will refine later · ❓ open / TBD.

---

## Context

`Hack & Blast` (the shmup) proved the **grid-path puzzle** ("TRS — Tactical Routing System")
works as an embedded verb: mount a puzzle → draw a route → `ComboEngine.evaluate()` returns a
combo result → a host "bridge" maps it onto game state. This second game makes TRS the *only*
verb but wraps it in a **deliberate, turn-programmed strategy loop** instead of arcade action.

Everything here is **buildable on the unchanged module**: the engine emits the base effects
(`freeze/confuse/drain` + `shatter/blast`; `shield/cleanse/overclock/repair`); the status
*interactions*, firepower model, phases, cascade, and AI are **host-side logic** — exactly the
layer the shmup keeps in `games/shmup/effects/` and `puzzle/bridge.js`.

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

### 3.1 The 120s credit — two selectable time-modes ✅ (decide by playtest)
A config flag `attackTimeModel`:
- **`cost`** — each queued action deducts a fixed chunk (~20). Phase = a *decision budget*
  (~6 actions). Calmer, chess-like.
- **`realtime`** — the **seconds you spend drawing the route** are deducted from the 120.
  Fast routing → more actions. Tenser, rewards mastery.

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

### 3.5 Table B — effect validity (which effects matter on which target) · v1 ✅
Kept (not dropped): an effect only does something on appropriate targets, so choosing your Focus
*and* your effects is a real matching decision (Confuse on a Generator is wasted).
| Effect | Valid / meaningful targets | What it does there |
|---|---|---|
| **Freeze** | any *functional* part (not Core) | ×0 firepower contribution **and** suspends the part's system for the duration: frozen **Tower** → owner's aim scatters + ~40% softer; frozen **Engine** → no evasion. (Generator shield/brownout + Launch Pad TRS stay tied to destruction.) |
| **Confuse** | parts that aim/fire — **Weapon Storage, Tower** | their fire scatters / telegraph mis-aims |
| **Drain** | best on **Generator & Core** (HP on any) | siphon HP to you (heals your Core); kill the Generator to drop the Core shield |
| **Burning** | any part | flat DoT; best on high-HP (Core, Generator) |
| **Shatter** | **Core, Generator** | brittle → the focus takes **+50%** from all your fire (no effect on a *shielded* Core until its shield drops) |

### 3.6 Table C — compounding · v1 ✅
v1 keeps compounding lean: stack statuses on the Focus; **three synergies** pay off the stack.
1. **Shatter = amplifier** — while the Focus is **Shattered**, all damage to it **+50%**. The reason
   to fold **Engine** into your stack: it multiplies the whole assault.
2. **Frozen = brittle** — a **Frozen** Focus takes **bonus damage** from your fire.
3. **Wildfire** — a Focus that is both **Burning + Confused** spreads Burning to an **adjacent
   component** (the one v1 way to hit a 2nd part; needs the Focus to be their Weapon Storage/Tower,
   where Confuse is valid). Foreshadows the multi-target power-ups.

*(With #1 and #2 both on a Frozen+Shattered Focus you get both bonuses — that's "Glass" for free.)*

#### Parked as v2 depth — the full pairwise matrix + self-stack + specials 🔧
5 statuses: **Frozen, Shattered, Burning, Confused, Drained**. Interactions resolve during RESOLVE.

|  | **Shattered** | **Burning** | **Confused** | **Drained** |
|---|---|---|---|---|
| **Frozen** | **Glass** ×2 next hit | **Thermal Shock** burst + auto-Shatter | **System Lock** extend freeze | **Cryo-Siphon** drain ×1.5 |
| **Shattered** | — | **Open Burn** DoT ×2 | **Exposed Misfire** backlash ×2 | **Hemorrhage** drain ×2 |
| **Burning** | | — | **Wildfire** spreads to neighbour | **Accelerant** DoT up |
| **Confused** | | | — | **Power Bleed** heal+brownout |

**Self-stack:** Freeze²→longer/lock · Shatter²→vuln climbs · Burn²→faster ticks · Confuse²→100%
misfire then self-hit · Drain²→rate ramps.
**Specials:** **Detonate** (Engine/Chain) consumes all stacked statuses → burst (each ×1.5),
then clears · **Multihack** copies one status to all parts · **Beam** (engine special) =
freeze+confuse+drain on all.

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
defenses absorb/mitigate; **you lose HP only here**. Per-component order:
`1) Cleanse → 2) Harden/Evade → 3) Shield (+ Spike trap check) → 4) Repair regen → overflow → HP`.
A part at 0 → destroyed → cascade. Survive → next attack phase; Core 0 → lose.

### Table D — defensive palette per component 🔧 *(refine later)*
| Component (defense use) | Defensive effect | Fits because |
|---|---|---|
| **Weapon Storage** | **Shield** (+ **Spike** at high tier) | sturdy bulwark |
| **Power Generator** | **Repair** (restore HP) | power = healing |
| **Tower (Sensors)** | **Cleanse** + **Evade** | scrub jamming, spot hits |
| **Engine** | **Harden** (damage reduction) | mobility = mitigation |
| **Launch Pad** | **Overclock** (system boost) | supercharge a system |

Loadout pressure mirrors attack: lose your Generator → no Repair; lose your Tower → no Cleanse.

### Table E — defensive compounding matrix 🔧 *(refine later)*
5 states: **Shielded, Repaired, Cleansed, Hardened, Overclocked**.

|  | **Repaired** | **Cleansed** | **Hardened** | **Overclocked** |
|---|---|---|---|---|
| **Shielded** | **Sustain** (heal refreshes shield) | **Purified Barrier** (shield blocks statuses) | **Bastion** (reduction → shield lasts) | **Reactive Plating** (shield → Spike) |
| **Repaired** | — | **Recovery** (strip DoT then heal) | **Field Repair** (heals faster) | **Power Surge** (heal boosted) |
| **Cleansed** | | — | **Evasive Scrub** (dodge + immunity) | **System Reboot** (clear all + brief invuln) |
| **Hardened** | | | — | **Combat Mode** (reduction + system boost) |

**Self-stack:** Shield²→bigger pool · Repair²→more HP · Cleanse²→longer ward · Harden²→more
reduction (capped) · Overclock²→stronger/longer. **Special:** **Fortress** (shield+cleanse+
overclock + both amps) = whole-aircraft layered defense, the panic button.

### Spike — conditional thorns ✅ concept / 🔧
A high-tier shield combo **places Spike on a chosen component**. During resolve, **if the enemy
hits that component, a portion of the damage reflects back** to the attacking enemy part. It's
*conditional*, so it pairs directly with the Tower telegraph — place spikes where you predict the
blow. Maps to the engine's `reflect` effect, reframed as a placed status; keeps "enemy loses HP
only from the player's deliberate setups" honest.

### Overclock = pure defensive system boost ✅
Supercharges the *target* component's own system: Tower → sharper/longer telegraph vision,
Engine → more evasion/initiative, Generator → reinforced (extra damage reduction), Launch Pad →
bigger next TRS. No offense-prep bridge. *(v1: Overclock resolves as flat damage reduction on the
target, like Harden.)*

---

## 5. Telegraph & the Tower (Tower-gated) ✅
**Telegraph is an *enemy* mechanic** (the player never arms telegraphs — all your offense lands in
your own attack-resolve). The enemy **declares its next attack at the start of your attack phase**;
it resolves in the following defense-resolve. The **Tower/Sensors** decides who can see/aim:
- **Your Tower alive** → you *see* the enemy's intended targets and pre-load the right defenses.
  **Destroyed** → you defend **blind** (no preview).
- **Enemy Tower** is how the *enemy aims*. Destroy it → its precise archetype targeting breaks and
  its attacks **scatter to random parts** — the "blind their Tower" payoff.

Telegraph fidelity (exact vs fuzzy) and predictability (deterministic vs variance) are a
**config/difficulty switch** set at game start, tuned by playtest (§7). 🔧

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

**Win:** enemy **Reactor Core** → 0. **Lose:** yours → 0.

### Enemy archetypes (the targeting brains) 🔧
The enemy commits its attack at the **start of your attack phase** (visible as a telegraph if your
Tower's alive), and it lands in your defense-resolve.

| Archetype | Targets | Personality | Counter |
|---|---|---|---|
| **Brute** | highest-HP part, focus-fire | big, predictable | over-shield it / sacrifice a cheap part |
| **Saboteur** | your **Generator / Weapon Storage** | chokes firepower + forces cascade | pre-shield & repair offense core |
| **Hunter** | your **Tower** first, then blind strikes | information warfare | repair Tower for vision |
| **Swarm** | spreads thin + many small debuffs | wide chip | Fortress / cleanse-all spikes |
| **Disruptor** | status-heavy (freeze/drain/confuse) | debuff-chokes firepower (§6) | Cleanse-heavy defense |
| **Boss** | switches policy at Core 66%/33% | multi-phase + telegraphed "ultimate" | adapt; drops a **Trophy** |

**✅ Predictability is a config/difficulty switch** (set at game start, tuned by playtest):
*deterministic* (archetype always follows policy; perfectly counterable puzzle) ↔ *telegraphed
with variance* (you see the intent but targets/damage wobble so you can't always pre-load
perfectly). Both run on the same AI; flip in `game.json`.

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
- **Verbatim:** `games/grid-path-puzzle/module/GridPathPuzzle.js` (mount/`generate`/`timeLimitMs`/
  `onComplete`/`onFail`) + `combo/ComboEngine.js` (`evaluate(skillSeq, config)`).
- **Retuned copies:** `offensive.json` + `defensive.json` under `games/strategy/combo/configs/`,
  one palette per component (Table A) for the "both matter" grid.
- **New host (`games/strategy/`):** state = 2 aircraft × 6 components; a **bridge** like the
  shmup's `puzzle/bridge.js` that **queues** actions during build and **applies them at resolve**;
  a **handler registry** (mirrors `games/shmup/effects/handlers.js`) implementing the status
  matrix, firepower formula, and cascade; the phase/credit/resolve loop; enemy AI; map + trophy
  persistence; renderer for the two boards.
- **Register:** add `strategy:` entry to `vite.config.js` + a menu tile in root `index.html`.

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
| **Launch Pad** | **Overclock** — system boost (Tower vision / Engine evasion / etc.) |

**Resolve order per part:** `Cleanse → Harden → Shield → Repair → overflow → HP`. Defenses **stack
additively** in v1. **Spike** and Table E synergies = v2.

## B.1 Scope
- **In:** one battle, 6 components/side (HP only), alternating **Attack/Defense → Build(120 credit)
  → Resolve**; attack v1 (Focus + 5 statuses + 3 synergies); defense v1 (B.0); condition→firepower
  (§6); cascade hybrid (§7); **two enemy archetypes** (Saboteur + Brute — feel the targeting
  contrast); Tower-gated telegraph (basic); win/lose on Core; a **pre-game config panel** (B.6).
- **Layout:** **left rail = config/controls**, **center = the two aircraft boards**, **right =
  the TRS puzzle panel** (slides in on solve, like the shmup), **bottom = phase-aware info bar**
  (B.7) giving the player the guidance/state they need during attack & defense.
- **Out (later):** roguelike map/shop/trophies; multi-target power-ups; v2 matrices; Detonate/
  Multihack/Beam; Spike; extra archetypes.

## B.2 Reuse (do not modify the module)
- **Verbatim:** `grid-path-puzzle/module/GridPathPuzzle.js`, `combo/ComboEngine.js`.
- **Copy & retune:** `offensive.json`/`defensive.json` → `games/strategy/combo/configs/`, one
  per-component palette (Table A / B.0). Pattern mirrors `games/shmup/puzzle/bridge.js` +
  `effects/handlers.js` + `config/game.json`.

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
(brownout/evasion/TRS-congestion numbers), `archetypes` (Saboteur + Brute),
`telegraph` {gated, mode: deterministic|variance}, `attackTimeModel: cost|realtime`,
`ui` (config-panel defaults). The config panel (B.6) edits these live before Start.

## B.6 Pre-game config panel (left rail)
Before a battle starts, the left rail exposes the knobs so you can playtest variants without
editing files; pressing **Start Battle** locks them into the run's config:
- **Enemy archetype:** Saboteur · Brute · Both · Random.
- **Phase length:** slider (default **120 s**), applies to both attack & defense credits.
- **Attack time model:** `cost` (fixed per action) ↔ `realtime` (seconds-solving drain).
- **Telegraph:** on/off + `deterministic` ↔ `variance`.
- **(optional) component HP preset** + a **seed** field for reproducible TRS grids.

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
