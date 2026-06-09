// =============================================================================
//  view/Renderer.js  —  builds the DOM grid + the SVG path overlay
// =============================================================================
//
//  Rendering = DOM for structure (one <div> per cell, laid out with CSS grid)
//  + SVG for the smooth path line (one <polyline> through cell centers). The
//  renderer is "dumb": it only paints what it's told. All game logic lives in
//  the facade/core. That separation is the lesson — same idea as the fighting
//  game's state-machine-vs-renderer split.
// =============================================================================

import { injectStyles } from './styles.js';

const SVGNS = 'http://www.w3.org/2000/svg';

// Count user-perceived characters (graphemes), so a single emoji that uses a
// variation selector — '⚔️' is U+2694 U+FE0F — counts as 1, while '💥💥💥'
// counts as 3. Falls back to code-point count where Intl.Segmenter is missing.
const _seg = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
function glyphCount(str) {
  return _seg ? [..._seg.segment(str)].length : [...str].length;
}

export class Renderer {
  constructor(root, nodeTypes) {
    this.root = root;
    this.nodeTypes = nodeTypes;
    this.cellEls = []; // cellEls[y][x] -> the <div>
    injectStyles();
    this._build();
  }

  _build() {
    this.wrap = document.createElement('div');
    this.wrap.className = 'gpp-wrap';

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'gpp-grid';

    // SVG overlay. viewBox is in CELL units (0..cols, 0..rows) and stretches to
    // the grid box, so points at (x+0.5, y+0.5) are exact cell centers — no
    // pixel math, no resize listener needed.
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'gpp-svg');
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.poly = document.createElementNS(SVGNS, 'polyline');
    this.poly.setAttribute('class', 'gpp-path');
    this.svg.appendChild(this.poly);

    this.wrap.appendChild(this.gridEl);
    this.wrap.appendChild(this.svg);
    this.root.appendChild(this.wrap);
  }

  /** Repaint the whole board for a (new) level. */
  setLevel(level) {
    this.level = level;
    // Set --cols/--rows on BOTH the grid (for its layout) and the wrap (so icon
    // and floating-text font-sizes can scale with the grid via container units).
    this.wrap.style.setProperty('--cols', level.cols);
    this.wrap.style.setProperty('--rows', level.rows);
    this.gridEl.style.setProperty('--cols', level.cols);
    this.gridEl.style.setProperty('--rows', level.rows);
    this.gridEl.textContent = '';
    this.cellEls = [];

    for (let y = 0; y < level.rows; y++) {
      const row = [];
      for (let x = 0; x < level.cols; x++) {
        const def = this.nodeTypes[level.cells[y][x]];
        const cell = document.createElement('div');
        cell.className = 'gpp-cell';
        cell.dataset.x = x;
        cell.dataset.y = y;
        cell.style.background = def.color || '#333';
        if (def.role === 'start') cell.classList.add('gpp-start');
        if (def.role === 'goal') cell.classList.add('gpp-goal');
        if (def.passable === false) cell.classList.add('gpp-blocker');
        if (def.effectKind) cell.dataset.kind = def.effectKind; // tints pass animations
        // A node's "sprite": prefer an icon glyph, else fall back to a text label.
        const glyph = def.icon || def.label;
        if (glyph) {
          const span = document.createElement('span');
          span.className = def.icon ? 'gpp-icon' : 'gpp-label';
          // Multi-glyph icons (e.g. '💥💥💥') get a class that shrinks them to fit.
          if (def.icon && glyphCount(glyph) > 1) span.classList.add('gpp-icon-multi');
          span.textContent = glyph;
          cell.appendChild(span);
        }
        if (def.label) { cell.title = def.label; cell.setAttribute('aria-label', def.label); }
        this.gridEl.appendChild(cell);
        row.push(cell);
      }
      this.cellEls.push(row);
    }

    this.svg.setAttribute('viewBox', `0 0 ${level.cols} ${level.rows}`);
    this.update([], { status: 'idle' });
  }

  /** Reflect the current path: highlight cells, mark the head, draw the line.
   *  `added` = cells appended by the latest move; each plays a pass animation. */
  update(path, { pendingFail = false, status = 'idle', added = [] } = {}) {
    for (const row of this.cellEls) {
      for (const c of row) c.classList.remove('gpp-in-path', 'gpp-head', 'gpp-fail');
    }
    path.forEach((c, i) => {
      const el = this.cellEls[c.y]?.[c.x];
      if (!el) return;
      el.classList.add('gpp-in-path');
      if (i === path.length - 1) el.classList.add('gpp-head');
    });
    if (pendingFail && path.length) {
      const h = path[path.length - 1];
      this.cellEls[h.y]?.[h.x]?.classList.add('gpp-fail');
    }
    this.poly.setAttribute('points', path.map((c) => `${c.x + 0.5},${c.y + 0.5}`).join(' '));
    this.wrap.dataset.status = status;

    // Pass animation: pop the icon + float its label, for each newly-entered
    // cell that actually has an effect.
    for (const c of added) {
      const def = this.nodeTypes[this.level.cells[c.y][c.x]];
      if (typeof def.onPass === 'function' || def.effectKind) this._playPass(c, def);
    }
  }

  // One-shot "you passed through here" feedback: pop the glyph and float text up.
  _playPass(cell, def) {
    const el = this.cellEls[cell.y]?.[cell.x];
    const icon = el?.querySelector('.gpp-icon, .gpp-label');
    if (icon) { // retrigger the CSS animation
      icon.classList.remove('gpp-pop');
      void icon.offsetWidth; // force reflow so the animation restarts
      icon.classList.add('gpp-pop');
    }
    const float = document.createElement('div');
    float.className = 'gpp-float';
    if (def.effectKind) float.dataset.kind = def.effectKind;
    float.textContent = def.floatText || def.label || def.icon || '';
    float.style.left = `${((cell.x + 0.5) / this.level.cols) * 100}%`;
    float.style.top = `${((cell.y + 0.5) / this.level.rows) * 100}%`;
    this.wrap.appendChild(float);
    const remove = () => float.remove();
    float.addEventListener('animationend', remove);
    setTimeout(remove, 1200); // safety net if animationend doesn't fire
  }

  destroy() {
    this.wrap.remove();
  }
}
