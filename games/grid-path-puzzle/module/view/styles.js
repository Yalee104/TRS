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
/* Looping "flame" flicker for the burning hazard icon (a few repeating frames). */
.gpp-anim-flame { animation: gpp-flame .5s steps(3, end) infinite; transform-origin: center 75%; }
@keyframes gpp-flame {
  0%   { filter: brightness(1) drop-shadow(0 0 1px #ff7a18); transform: scale(1) translateY(0); }
  50%  { filter: brightness(1.5) drop-shadow(0 0 5px #ff3b00); transform: scale(1.14) translateY(-4%); }
  100% { filter: brightness(.95) drop-shadow(0 0 2px #ff5a00); transform: scale(1.02) translateY(0); } }

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

/* Pre-start "GO" overlay (opt-in via the countdownMs option). */
.gpp-countdown { position: absolute; inset: 0; z-index: 10; display: flex;
  align-items: center; justify-content: center; pointer-events: none;
  font: 800 calc(46cqi) system-ui, sans-serif; color: #fff; letter-spacing: .02em;
  text-shadow: 0 3px 22px rgba(0,0,0,.7), 0 0 8px rgba(0,0,0,.5); }
.gpp-countdown[hidden] { display: none; }
.gpp-countdown.gpp-go { animation: gpp-go .85s ease-out; }
@keyframes gpp-go {
  0%   { opacity: 0; transform: scale(.4); }
  35%  { opacity: 1; transform: scale(1.18); }
  80%  { opacity: 1; transform: scale(1); }
  100% { opacity: .92; transform: scale(1); } }
/* Big "FAIL" banner (opt-in via the failText option) — reuses the overlay. */
.gpp-countdown.gpp-fail-banner { color: #ff5a5a; animation: gpp-failpop .5s ease-out;
  text-shadow: 0 3px 22px rgba(0,0,0,.8), 0 0 16px rgba(255,60,60,.55); }
@keyframes gpp-failpop {
  0%   { opacity: 0; transform: scale(.5) rotate(-5deg); }
  45%  { opacity: 1; transform: scale(1.15) rotate(2deg); }
  100% { opacity: 1; transform: scale(1) rotate(0); } }
/* START cell flashing during the pre-start pause (opt-in via flashStart). */
.gpp-start-flash { animation: gpp-startflash .5s steps(1,end) infinite; z-index: 3; }
@keyframes gpp-startflash {
  0%, 100% { box-shadow: inset 0 0 0 3px #ffffff, 0 0 14px 3px rgba(255,255,255,.85); }
  50%      { box-shadow: inset 0 0 0 3px #ffd34d, 0 0 18px 5px rgba(255,211,77,.9); } }

/* DRAIN: a ring on a payload that shrinks as its timer runs out, then it vanishes. */
.gpp-decay { position: absolute; inset: 14%; border-radius: 50%; box-sizing: border-box;
  border: 2px solid rgba(255,90,90,.9); pointer-events: none; z-index: 4; }
.gpp-decay.gpp-decay-run { animation-name: gpp-decay; animation-timing-function: linear; animation-fill-mode: forwards; }
@keyframes gpp-decay {
  0%   { transform: scale(1);   opacity: .9; }
  80%  { transform: scale(.25); opacity: .9; }
  100% { transform: scale(.1);  opacity: .2; } }

/* Objective gate (opt-in via the objective option): a "collect N" badge + a
   locked GOAL until the minimum payloads are chained. */
.gpp-objective { position: absolute; top: 0; left: 50%; transform: translate(-50%, -55%);
  z-index: 8; display: flex; align-items: center; gap: calc(10cqi / var(--cols));
  padding: calc(6cqi / var(--cols)) calc(12cqi / var(--cols));
  background: rgba(16,18,26,.92); border: 1px solid #3a4150; border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0,0,0,.5); white-space: nowrap; pointer-events: none; }
.gpp-objective[hidden] { display: none; }
.gpp-obj-icon { font-size: calc(34cqi / var(--cols)); line-height: 1; }
.gpp-obj-pips { display: flex; gap: calc(5cqi / var(--cols)); }
.gpp-obj-pip { width: calc(14cqi / var(--cols)); height: calc(14cqi / var(--cols));
  border-radius: 50%; background: transparent; border: 2px solid #6b7280; box-sizing: border-box; }
.gpp-obj-pip-filled { background: #ffd34d; border-color: #ffd34d; }
.gpp-obj-num { font: 700 calc(24cqi / var(--cols)) system-ui, sans-serif; color: #cdd2da;
  font-variant-numeric: tabular-nums; }
.gpp-objective-met .gpp-obj-pip-filled { background: #5ef08a; border-color: #5ef08a; }
.gpp-objective-met .gpp-obj-num { color: #5ef08a; }
/* Locked goal: hide the flag glyph, show the lock + the required count. */
.gpp-goal-locked .gpp-icon, .gpp-goal-locked .gpp-label { visibility: hidden; }
.gpp-goal-lock { position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; font: 700 calc(34cqi / var(--cols)) system-ui, sans-serif;
  color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.6); pointer-events: none; }
.gpp-goal-lock[hidden] { display: none; }
/* "Need X more" prompt shown when the player hits the locked goal. */
.gpp-obj-need { position: absolute; left: 50%; bottom: 8%; transform: translateX(-50%);
  z-index: 9; padding: calc(6cqi / var(--cols)) calc(12cqi / var(--cols)); border-radius: 8px;
  background: rgba(180,40,40,.92); color: #fff; font: 700 calc(30cqi / var(--cols)) system-ui, sans-serif;
  white-space: nowrap; pointer-events: none; }
.gpp-obj-need[hidden] { display: none; }
.gpp-obj-need.gpp-obj-need-show { animation: gpp-obj-need 1.1s ease-out; }
@keyframes gpp-obj-need {
  0%   { opacity: 0; transform: translate(-50%, 30%); }
  20%  { opacity: 1; transform: translate(-50%, 0); }
  80%  { opacity: 1; }
  100% { opacity: 0; } }
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
