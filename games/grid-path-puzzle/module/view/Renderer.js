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
        if (def.label) {
          const span = document.createElement('span');
          span.className = 'gpp-label';
          span.textContent = def.label;
          cell.appendChild(span);
        }
        this.gridEl.appendChild(cell);
        row.push(cell);
      }
      this.cellEls.push(row);
    }

    this.svg.setAttribute('viewBox', `0 0 ${level.cols} ${level.rows}`);
    this.update([], { status: 'idle' });
  }

  /** Reflect the current path: highlight cells, mark the head, draw the line. */
  update(path, { pendingFail = false, status = 'idle' } = {}) {
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
  }

  destroy() {
    this.wrap.remove();
  }
}
