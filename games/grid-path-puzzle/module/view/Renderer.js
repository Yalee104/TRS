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
    // FREEZE: an icy "preview" line under the solid path (where the cursor dragged).
    this.polyPreview = document.createElementNS(SVGNS, 'polyline');
    this.polyPreview.setAttribute('class', 'gpp-path-preview');
    this.svg.appendChild(this.polyPreview);
    this.poly = document.createElementNS(SVGNS, 'polyline');
    this.poly.setAttribute('class', 'gpp-path');
    this.svg.appendChild(this.poly);

    this.wrap.appendChild(this.gridEl);
    this.wrap.appendChild(this.svg);

    // Pre-start "GO" overlay (hidden until showCountdown()).
    this.overlay = document.createElement('div');
    this.overlay.className = 'gpp-countdown';
    this.overlay.hidden = true;
    this.wrap.appendChild(this.overlay);

    // Objective badge (hidden until setObjective()).
    this.objBadge = document.createElement('div');
    this.objBadge.className = 'gpp-objective';
    this.objBadge.hidden = true;
    this.wrap.appendChild(this.objBadge);

    this.root.appendChild(this.wrap);
  }

  // ---- objective gate (optional) ------------------------------------------
  /** Configure the objective badge + locked-goal visual. Idempotent. */
  setObjective({ min = 1, icon = '' } = {}) {
    if (!this.objBadge) return;
    this._objMin = min;
    this.objBadge.textContent = '';
    const ico = document.createElement('span');
    ico.className = 'gpp-obj-icon';
    ico.textContent = icon;
    const pips = document.createElement('div');
    pips.className = 'gpp-obj-pips';
    this._pipEls = [];
    for (let i = 0; i < min; i++) {
      const pip = document.createElement('i');
      pip.className = 'gpp-obj-pip';
      pips.appendChild(pip);
      this._pipEls.push(pip);
    }
    this._objNumEl = document.createElement('span');
    this._objNumEl.className = 'gpp-obj-num';
    this.objBadge.appendChild(ico);
    this.objBadge.appendChild(pips);
    this.objBadge.appendChild(this._objNumEl);
    this.objBadge.hidden = false;
    this.objBadge.classList.remove('gpp-objective-met');
    this._setGoalLocked(true, min);
  }

  /** Reflect live progress: fill pips, color when met, lock/unlock the goal. */
  updateObjective(current = 0, min = this._objMin || 1, met = false) {
    this._pipEls?.forEach((pip, i) => pip.classList.toggle('gpp-obj-pip-filled', i < current));
    if (this._objNumEl) this._objNumEl.textContent = `${current}/${min}`;
    this.objBadge?.classList.toggle('gpp-objective-met', !!met);
    // The lock shows how many MORE payloads are needed — counts down to 0.
    this._setGoalLocked(!met, Math.max(0, min - current));
  }

  _setGoalLocked(locked, remaining) {
    if (!this.goalEl) return;
    this.goalEl.classList.toggle('gpp-goal-locked', !!locked);
    if (locked) {
      if (!this._goalLockEl) {
        this._goalLockEl = document.createElement('span');
        this._goalLockEl.className = 'gpp-goal-lock';
        this.goalEl.appendChild(this._goalLockEl);
      }
      this._goalLockEl.textContent = `🔒${remaining}`;
      this._goalLockEl.hidden = false;
    } else if (this._goalLockEl) {
      this._goalLockEl.hidden = true;
    }
  }

  /** Brief "Need X more" prompt when the player hits a locked goal. */
  showObjectiveNeed(missing = 0) {
    if (!this.wrap) return;
    if (!this.objNeedEl) {
      this.objNeedEl = document.createElement('div');
      this.objNeedEl.className = 'gpp-obj-need';
      this.wrap.appendChild(this.objNeedEl);
    }
    this.objNeedEl.textContent = missing > 0 ? `Need ${missing} more` : 'Need more';
    this.objNeedEl.hidden = false;
    this.objNeedEl.classList.remove('gpp-obj-need-show');
    void this.objNeedEl.offsetWidth; // restart the fade animation
    this.objNeedEl.classList.add('gpp-obj-need-show');
    if (this._objNeedTimer) clearTimeout(this._objNeedTimer);
    this._objNeedTimer = setTimeout(() => { if (this.objNeedEl) this.objNeedEl.hidden = true; }, 1100);
  }

  /** Show the centred pre-start label ("GO"); replays its pop animation each call. */
  showCountdown(text = 'GO') {
    if (!this.overlay) return;
    this.overlay.textContent = text;
    this.overlay.hidden = false;
    this.overlay.classList.remove('gpp-go');
    void this.overlay.offsetWidth; // force reflow so the animation restarts
    this.overlay.classList.add('gpp-go');
  }

  hideCountdown() {
    if (this.overlay) { this.overlay.hidden = true; this.overlay.classList.remove('gpp-go', 'gpp-fail-banner'); }
  }

  /** Big centred "FAIL" banner (reuses the overlay; stays until reset/rebuild). */
  showFail(text = 'FAIL') {
    if (!this.overlay) return;
    this.overlay.textContent = text;
    this.overlay.hidden = false;
    this.overlay.classList.remove('gpp-go', 'gpp-fail-banner');
    void this.overlay.offsetWidth; // restart the pop animation
    this.overlay.classList.add('gpp-fail-banner');
  }

  /** Toggle the flashing highlight on the START cell (during the pre-start pause). */
  setStartFlash(on) {
    this.startEl?.classList.toggle('gpp-start-flash', !!on);
  }

  /** CONFUSED indicator: wobble the grid + purple path + a 🌀 badge. */
  setConfused(on) {
    this.wrap?.classList.toggle('gpp-confused', !!on);
    if (on && !this._confusedBadge && this.wrap) {
      this._confusedBadge = document.createElement('div');
      this._confusedBadge.className = 'gpp-confused-badge';
      this._confusedBadge.textContent = '🌀 CONFUSED';
      this.wrap.appendChild(this._confusedBadge);
    } else if (!on && this._confusedBadge) {
      this._confusedBadge.remove();
      this._confusedBadge = null;
    }
  }

  // ---- live cell mutation (drain removes / shatter moves a node) ----------
  /** Repaint ONE cell to a new node type (background + glyph). */
  updateCell(x, y, typeKey) {
    const el = this.cellEls[y]?.[x];
    if (!el) return;
    const def = this.nodeTypes[typeKey] || {};
    el.style.background = def.color || '#333';
    el.classList.toggle('gpp-blocker', def.passable === false);
    el.querySelector('.gpp-icon, .gpp-label')?.remove();
    const glyph = def.icon || def.label;
    if (glyph) {
      const span = document.createElement('span');
      span.className = def.icon ? 'gpp-icon' : 'gpp-label';
      if (def.icon && glyphCount(glyph) > 1) span.classList.add('gpp-icon-multi');
      if (def.anim) span.classList.add(`gpp-anim-${def.anim}`);
      span.textContent = glyph;
      el.appendChild(span);
    }
  }

  /** A shrinking ring on a payload that's about to drain (duration = its timer). */
  startDecay(x, y, ms) {
    const el = this.cellEls[y]?.[x];
    if (!el) return;
    let ring = el.querySelector('.gpp-decay');
    if (!ring) { ring = document.createElement('div'); ring.className = 'gpp-decay'; el.appendChild(ring); }
    ring.style.animationDuration = `${ms}ms`;
    ring.classList.remove('gpp-decay-run');
    void ring.offsetWidth; // restart the countdown animation
    ring.classList.add('gpp-decay-run');
  }

  clearDecay(x, y) {
    this.cellEls[y]?.[x]?.querySelector('.gpp-decay')?.remove();
  }

  /** FREEZE: draw the icy preview polyline (where the cursor has dragged). */
  setPreview(path) {
    this.polyPreview?.setAttribute('points', (path || []).map((c) => `${c.x + 0.5},${c.y + 0.5}`).join(' '));
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
    this.startEl = null; // captured below; used by setStartFlash()
    this.goalEl = null;  // captured below; used by the locked-goal visual
    this._goalLockEl = null; // stale after a rebuild (old goal cell was dropped)

    for (let y = 0; y < level.rows; y++) {
      const row = [];
      for (let x = 0; x < level.cols; x++) {
        const def = this.nodeTypes[level.cells[y][x]];
        const cell = document.createElement('div');
        cell.className = 'gpp-cell';
        cell.dataset.x = x;
        cell.dataset.y = y;
        cell.style.background = def.color || '#333';
        if (def.role === 'start') { cell.classList.add('gpp-start'); this.startEl = cell; }
        if (def.role === 'goal') { cell.classList.add('gpp-goal'); this.goalEl = cell; }
        if (def.passable === false) cell.classList.add('gpp-blocker');
        if (def.effectKind) cell.dataset.kind = def.effectKind; // tints pass animations
        // A node's "sprite": prefer an icon glyph, else fall back to a text label.
        const glyph = def.icon || def.label;
        if (glyph) {
          const span = document.createElement('span');
          span.className = def.icon ? 'gpp-icon' : 'gpp-label';
          // Multi-glyph icons (e.g. '💥💥💥') get a class that shrinks them to fit.
          if (def.icon && glyphCount(glyph) > 1) span.classList.add('gpp-icon-multi');
          if (def.anim) span.classList.add(`gpp-anim-${def.anim}`); // looping icon animation
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
    this.polyPreview?.setAttribute('points', ''); // clear any icy freeze preview
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
    if (this._objNeedTimer) clearTimeout(this._objNeedTimer);
    this.wrap.remove();
  }
}
