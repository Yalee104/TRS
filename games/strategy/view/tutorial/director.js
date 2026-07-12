// =============================================================================
//  view/tutorial/director.js — the Training Sortie state machine (PURE, no DOM)
// =============================================================================
//
//  Consumes the script (steps/moments/hints) + ctx snapshots { state, run, screen }
//  and emits a view-model the presenter renders verbatim. All persistence goes
//  through the injected `storage` ({ get(k), set(k,v) }) so tests can pass a
//  Map-backed fake and the app a guarded localStorage wrapper.
//
//    status: 'idle'    — tutorial not running (hints still fire)
//            'active'  — walking the steps
//            'done'    — completed or skipped (hints still fire)
//
//  sync(ctx) → {
//    promptVisible,        — show the first-run Start/Skip modal (loadout screen only)
//    step: { id, anchor, textKey, params, manual, nextKey, onNext, final } | null,
//    moment: { id, textKey } | null,   — one-shot celebration toast
//    hint:   { id, anchor, textKey } | null,  — one-shot first-visit hint
//    active,               — true while the walkthrough runs (skip chip visible)
//  }
// =============================================================================

export const DONE_KEY = 'trs.tutorialDone';
export const HINTS_KEY = 'trs.tutorialHints';

export function createTutorialDirector({ steps, moments, hints, storage }) {
  let status = storage.get(DONE_KEY) ? 'done' : 'idle';
  let i = 0;
  const seenMoments = new Set();
  let activeMoment = null;
  let activeHint = null;
  const firedHints = new Set(String(storage.get(HINTS_KEY) || '').split(',').filter(Boolean));

  const persistHints = () => storage.set(HINTS_KEY, [...firedHints].join(','));
  const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

  /** Advance past steps whose skipIf or done predicate already holds. */
  function advance(ctx) {
    let guard = 0;
    while (i < steps.length && guard++ < steps.length + 2) {
      const s = steps[i];
      if (s.skipIf && s.skipIf(ctx)) { i += 1; continue; }
      if (s.done && s.done(ctx)) { i += 1; continue; }
      break;
    }
    if (i >= steps.length) finish();
  }

  function finish() {
    status = 'done';
    storage.set(DONE_KEY, '1');
  }

  function start() {
    status = 'active';
    i = 0;
    storage.set(DONE_KEY, '1');   // starting counts as seen — the prompt never nags again
  }

  function skip() {
    finish();
  }

  /** Manual steps advance only here (the presenter's Next button). */
  function next() {
    if (status !== 'active' || i >= steps.length) return;
    const s = steps[i];
    if (s.final) { finish(); return; }
    i += 1;
  }

  function sync(ctx) {
    // Moments + hints run regardless of walkthrough status (one-shot, arrival-gated).
    if (!activeMoment) {
      const m = moments.find((x) => !seenMoments.has(x.id) && x.when(ctx));
      if (m) { seenMoments.add(m.id); activeMoment = { id: m.id, textKey: m.textKey }; }
    }
    if (!activeHint) {
      const h = hints.find((x) => !firedHints.has(x.id) && x.when(ctx));
      if (h) { firedHints.add(h.id); persistHints(); activeHint = { id: h.id, anchor: h.anchor, textKey: h.textKey }; }
    }

    let step = null;
    if (status === 'active') {
      advance(ctx);
      if (status === 'active' && i < steps.length) {
        const s = steps[i];
        // hold (hide the card) while the player is on a different screen, or while a
        // puzzle is open and this isn't the solve step (its anchors are hidden anyway)
        const puzzleHold = !!ctx.state?.activePuzzle && s.id !== 'solve';
        if ((!s.screen || s.screen === ctx.screen) && !puzzleHold) {
          step = {
            id: s.id,
            anchor: resolve(s.anchor, ctx) || null,
            textKey: resolve(s.textKey, ctx) || `tutorial.step.${s.id}`,
            params: resolve(s.params, ctx) || {},
            manual: !!s.manual,
            nextKey: s.nextKey || 'tutorial.next',
            onNext: s.onNext || null,
            final: !!s.final,
          };
        }
      }
    }

    return {
      promptVisible: status === 'idle' && ctx.screen === 'loadout',
      step,
      moment: activeMoment,
      hint: activeHint,
      active: status === 'active',
    };
  }

  return {
    sync, start, skip, next,
    dismissMoment: () => { activeMoment = null; },
    dismissHint: () => { activeHint = null; },
    get status() { return status; },
    get stepIndex() { return i; },
  };
}
