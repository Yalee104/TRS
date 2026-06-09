// =============================================================================
//  input/KeyboardController.js  —  arrow-key drawing (accessibility)
// =============================================================================
//
//  Not everyone can drag a mouse. Arrow keys extend the path from its head
//  (or backtrack if you press back onto the previous cell); Enter commits when
//  on the goal; Esc resets. It calls the SAME facade methods as the pointer
//  controller, so the rules are identical. The grid gets role="application" +
//  tabindex so it's focusable and announced to screen readers.
// =============================================================================

const DIRS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

export class KeyboardController {
  constructor(gridEl, facade) {
    this.gridEl = gridEl;
    this.facade = facade;
    gridEl.tabIndex = 0;
    gridEl.setAttribute('role', 'application');
    gridEl.setAttribute('aria-label', 'Path puzzle grid. Arrow keys to draw a path from start to goal, Enter to finish.');
    this._onKey = this._onKey.bind(this);
    gridEl.addEventListener('keydown', this._onKey);
  }

  _onKey(e) {
    const f = this.facade;
    if (e.key in DIRS) {
      e.preventDefault();
      // First arrow press begins drawing from the start cell.
      if (!f.getHead()) f.tryBegin(f.level.start);
      const head = f.getHead();
      if (!head) return;
      const d = DIRS[e.key];
      f.tryMoveTo({ x: head.x + d.x, y: head.y + d.y });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      f.endDrag();
    } else if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      f.reset();
    }
  }

  destroy() {
    this.gridEl.removeEventListener('keydown', this._onKey);
  }
}
