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
});

game.on('complete', (r) => console.log(r.runState));   // reached goal
game.on('fail',     (f) => console.log(f.reason));     // 'trap' | 'timeout'
game.on('pathChange', (i) => updateHud(i.previewRunState));
```

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
