// =============================================================================
//  view/styles.js  —  self-contained CSS (so the module needs no external file)
// =============================================================================
//
//  We inject ONE <style data-gpp> tag, ref-counted so multiple puzzle instances
//  on a page share it and the last instance to be destroyed removes it. Cell
//  COLORS come from each node type's `color` (set inline by the renderer); this
//  sheet only handles layout + path/animation styling. A host can override any
//  of this with its own CSS.
//
//  KEY LAYOUT TRICK: the grid uses `gap: 0` so each cell is exactly 1/cols of
//  the width. That makes cell centers land exactly at (x+0.5, y+0.5) in the SVG
//  overlay's viewBox — so the drawn path line is pixel-accurate with no resize
//  math. Cells are visually separated by an inset box-shadow "grid line".
// =============================================================================

const CSS = `
.gpp-wrap { position: relative; width: 100%; aspect-ratio: 1 / 1; user-select: none;
  -webkit-user-select: none; touch-action: none; container-type: inline-size; }
.gpp-grid { position: absolute; inset: 0; display: grid; gap: 0;
  grid-template-columns: repeat(var(--cols), 1fr);
  grid-template-rows: repeat(var(--rows), 1fr);
  background: #0c0d12; border-radius: 8px; overflow: hidden; }
.gpp-cell { position: relative; display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 0 0 1.5px #0c0d12; transition: filter .08s ease, transform .06s ease; }
.gpp-label { font: 600 10px/1 system-ui, sans-serif; color: rgba(0,0,0,.6);
  text-transform: uppercase; letter-spacing: .02em; pointer-events: none; }
/* The node "sprite": an emoji/glyph sized relative to the grid via container
   query units (cqi = 1% of the grid width), divided by the column count. */
.gpp-icon { font-size: calc(58cqi / var(--cols)); line-height: 1; pointer-events: none;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.45)); }
/* Multi-glyph icons: smaller + tightened so several emojis fit in one cell. */
.gpp-icon.gpp-icon-multi { font-size: calc(30cqi / var(--cols)); letter-spacing: -0.12em;
  white-space: nowrap; }
.gpp-icon.gpp-pop, .gpp-label.gpp-pop { animation: gpp-pop .32s ease; }
@keyframes gpp-pop { 0% { transform: scale(1); } 32% { transform: scale(1.5); } 100% { transform: scale(1); } }

/* Floating "+DMG" / "Freeze" / "-MULT" text that rises and fades on pass. */
.gpp-float { position: absolute; transform: translate(-50%, -50%); z-index: 5;
  font: 700 calc(42cqi / var(--cols)) system-ui, sans-serif; white-space: nowrap;
  color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.7); pointer-events: none;
  animation: gpp-float .9s ease-out forwards; }
.gpp-float[data-kind="buff"], .gpp-float[data-kind="skill"] { color: #7cffb0; }
.gpp-float[data-kind="debuff"], .gpp-float[data-kind="danger"] { color: #ff8080; }
@keyframes gpp-float {
  0%   { opacity: 0; transform: translate(-50%, -25%) scale(.7); }
  25%  { opacity: 1; }
  100% { opacity: 0; transform: translate(-50%, -170%) scale(1.05); } }
.gpp-start { box-shadow: inset 0 0 0 3px #ffffff; }
.gpp-goal  { box-shadow: inset 0 0 0 3px rgba(255,255,255,.85); }
.gpp-blocker { background-image: repeating-linear-gradient(45deg,
  rgba(0,0,0,.35) 0 6px, transparent 6px 12px); }
.gpp-in-path { filter: brightness(1.35) saturate(1.2); }
.gpp-head { transform: scale(1.04); z-index: 2;
  box-shadow: inset 0 0 0 2px #fff, 0 0 10px 2px rgba(255,255,255,.45); }
.gpp-fail { animation: gpp-alarm .22s steps(2,end) infinite; }
@keyframes gpp-alarm {
  0%   { box-shadow: inset 0 0 0 3px #ff3b3b, 0 0 12px 2px rgba(255,59,59,.7); }
  100% { box-shadow: inset 0 0 0 3px rgba(255,59,59,0); } }
.gpp-svg { position: absolute; inset: 0; width: 100%; height: 100%;
  pointer-events: none; overflow: visible; }
.gpp-path { fill: none; stroke: #ffffff; stroke-width: .16; stroke-linejoin: round;
  stroke-linecap: round; opacity: .92; }
.gpp-wrap[data-status="done"] .gpp-path   { stroke: #5ef08a; }
.gpp-wrap[data-status="failed"] .gpp-path { stroke: #ff5a5a; }
`;

let refCount = 0;
let styleEl = null;

export function injectStyles() {
  refCount += 1;
  if (styleEl) return;
  styleEl = document.createElement('style');
  styleEl.setAttribute('data-gpp', '');
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);
}

export function releaseStyles() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && styleEl) {
    styleEl.remove();
    styleEl = null;
  }
}
