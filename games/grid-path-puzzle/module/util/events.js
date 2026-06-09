// =============================================================================
//  util/events.js  —  a minimal EventEmitter (so the module needs no deps)
// =============================================================================
//
//  The facade exposes both option-callbacks (onComplete: fn) AND a subscribe
//  API (game.on('complete', fn)). This tiny emitter powers the latter. Keeping
//  our own avoids pulling in any dependency, which is what keeps the whole
//  module copy-pasteable.
// =============================================================================

export class Emitter {
  constructor() {
    this._handlers = new Map(); // event name -> Set of fns
  }

  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this.off(event, fn); // return an unsubscribe fn for convenience
  }

  off(event, fn) {
    this._handlers.get(event)?.delete(fn);
  }

  emit(event, payload) {
    // Copy to an array first so a handler can safely unsubscribe during emit.
    const set = this._handlers.get(event);
    if (set) for (const fn of [...set]) fn(payload);
  }

  clear() {
    this._handlers.clear();
  }
}
