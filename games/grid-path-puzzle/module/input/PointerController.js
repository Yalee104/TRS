// =============================================================================
//  input/PointerController.js  —  drag-to-draw with mouse / touch / pen
// =============================================================================
//
//  Pointer Events cover mouse, touch, AND stylus with one API, so this single
//  controller handles all input devices. Its only jobs are (1) translate a
//  screen position into a grid cell and (2) call the facade. ALL the rules
//  (adjacency, no-revisit, backtrack, traps, budget) live in the facade/core —
//  this file has no game logic, so pointer and keyboard can never disagree.
// =============================================================================

export class PointerController {
  constructor(gridEl, facade) {
    this.gridEl = gridEl;
    this.facade = facade;
    this.dragging = false;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);

    gridEl.addEventListener('pointerdown', this._onDown);
    gridEl.addEventListener('pointermove', this._onMove);
    // listen on window for up: the release can happen off the grid
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
  }

  // Map a screen point to {x,y} grid coords (or null). elementFromPoint works
  // even when the pointer is captured and outside the grid (returns whatever is
  // actually under the cursor; if not a cell, we get null).
  _cellFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const cellEl = el && el.closest ? el.closest('[data-x]') : null;
    if (!cellEl || !this.gridEl.contains(cellEl)) return null;
    return { x: Number(cellEl.dataset.x), y: Number(cellEl.dataset.y) };
  }

  _onDown(e) {
    const cell = this._cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    if (this.facade.tryBegin(cell)) {
      this.dragging = true;
      try { this.gridEl.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
      e.preventDefault();
    }
  }

  _onMove(e) {
    if (!this.dragging) return;
    const cell = this._cellFromPoint(e.clientX, e.clientY);
    if (cell) this.facade.tryMoveTo(cell);
  }

  _onUp(e) {
    if (!this.dragging) return;
    this.dragging = false;
    try { this.gridEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    this.facade.endDrag();
  }

  destroy() {
    this.gridEl.removeEventListener('pointerdown', this._onDown);
    this.gridEl.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
  }
}
