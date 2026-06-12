# Hack & Blast — a SHMUP that embeds the grid-path-puzzle

A vertical shoot-'em-up (vanilla Canvas 2D) where the **grid-path-puzzle is the
"hack" mechanic**. Move the ship (auto-fires up) and open a puzzle to turn the
tide:

- **🔓 Hack** (top button / `J`) → the **offensive** puzzle. The combo result
  hits enemies (Freeze / Confuse / Drain; Multihack → all; the Beam → everything).
- **🛡️ Protect** (bottom button / `K`) → the **defensive** puzzle. The result
  buffs the player (Shield / Overclock / Cleanse; Repair power-up).

While a puzzle is open the battle runs in **slow motion** (the puzzle's own time
limit runs at real time). One puzzle at a time; each side has its own cooldown,
shorter on success than on fail/timeout. Clear all enemies = win; HP 0 = lose.

Run: `npm run dev` → open `/games/shmup/`. Tests: `npm run test:shmup`.

## How it's wired (modular, JSON-driven)

```
config/game.json   EVERYTHING tunable: canvas, fps + slowFps, player, enemy
                   patterns, cooldowns, puzzle size/time-limit, effect tuning.
core/loop.js       fixed-timestep loop; `timeScale` = slowFps/normalFps for slow-mo
core/state.js      plain-data state + status-effect helpers
core/sim.js        one fixed tick = run every system in order
systems/*          input, playerFire, enemyAI (pattern dispatcher), bullets,
                   collision, status, winLose — pure fn(state, dt)
effects/handlers.js + apply.js   combo result → game-state mutations (+ targeting)
puzzle/bridge.js   the seam: gating, GridPathPuzzle lifecycle, skillSeq→evaluate,
                   slow-mo + cooldowns
render/*           canvas drawing (primitive shapes; sprite-ready seam)
ui/hud.js          DOM buttons + cooldown overlays, HP bars, status chips, banner
```

The puzzle + combo engine are **imported, never modified**
(`../grid-path-puzzle/module`, `../grid-path-puzzle/combo`). Effects are a
data-driven handler registry — unknown effects are ignored with a warn.

## Boss fire patterns (in `config/game.json`)

The boss cycles a `patterns[]` array — `aimed`, `spread` (fan), `radial` (ring),
each with its own `rateMs` / `count` / `bulletSpeed` / `telegraphMs` (and an
optional `inflict` debuff). Small enemies fire one aimed shot on a timer. Add a
new pattern = one `case` in `systems/enemyAI.js` + data here.

## Enemy shields (the puzzle as core strategy)

Every enemy spawns with a **shield = HP × `tuning.enemyShieldMult`** (default 5×) that absorbs
incoming fire before HP. It **chips but never regenerates** — grinding it down with normal fire is
slow by design. **Passing the offensive (Hack) puzzle disables ALL enemy shields for
`tuning.shieldDisableMs` (default 5s)** — the main window to actually burn HP. The **Drain** skill
**bypasses** the shield and hits HP directly (which skills bypass is the `tuning.shieldBypassSkills`
list — not hard-coded). Shields render as a ring around each enemy (solid + thinning while up,
dashed/pulsing while disabled) with break/restore flashes, plus a thin shield bar above the boss HP bar.

Configure it all in `config/game.json`:
| Key | Meaning |
|---|---|
| `tuning.enemyShieldMult` | shield = N × HP (global default) |
| `enemies.boss.shieldMult` / `enemies.smalls[].shieldMult` | per-enemy override of the default |
| `tuning.shieldDisableMs` | how long an offensive-puzzle win disables shields |
| `tuning.shieldBypassSkills` | offensive skills that ignore the shield (e.g. `["drain"]`) |
| `enemies.boss.pos.y` | boss vertical position (kept clear of the Hack button) |

## Tuning ideas (all JSON)
- Slower/faster hacking pause: `slowFps` (set `0` for a hard pause).
- Difficulty: enemy `patterns` rates/counts, `cooldowns`, puzzle `size`/`timeLimitMs`,
  `enemyShieldMult` (shield wall thickness) and `shieldDisableMs` (reward window).
- Combo strength/feel: the puzzle's own `combo/configs/*.json` (see that module's
  `CONFIG_GUIDE.md`) + `tuning` here (shatter bonus, beam drain, cleansable debuffs).

## Debug
`window.__shmup` exposes `state`, `bridge`, `restart()`, and `solveActivePuzzle()`.

> v1 scope: a single encounter (1 boss + 3 small). The design is modular so waves,
> levels, more patterns/effects, and sprites can be added incrementally.
