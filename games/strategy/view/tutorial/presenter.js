// =============================================================================
//  view/tutorial/presenter.js — DOM layer for the Training Sortie
// =============================================================================
//
//  Renders the director's view-model and nothing else: first-run modal, the OPS
//  coach card, a glow ring around the current anchor, one-shot celebration
//  toasts and first-visit hint cards. Mounted on <body> (like tooltip.js) so the
//  battle/board innerHTML re-renders never wipe it; re-anchors on every sync,
//  on resize, and on a light interval while visible. It NEVER intercepts game
//  pointer events — only its own buttons are clickable.
// =============================================================================

import { t } from '../../i18n/index.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// minimal markdown: **bold** only (the catalogs use it for emphasis)
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

export function createTutorialPresenter({ director, getCtx, beginTutorialRun, onChange = () => {} }) {
  if (typeof document === 'undefined') {                    // headless guard (tests)
    return { sync: () => {}, startTutorial: () => director.start() };
  }

  const el = {
    modal: mk('div', 'tut-modal-backdrop'),
    coach: mk('div', 'tut-coach'),
    ring: mk('div', 'tut-ring'),
    toast: mk('div', 'tut-toast'),
    hint: mk('div', 'tut-coach tut-hint'),
  };
  Object.values(el).forEach((n) => { n.style.display = 'none'; document.body.appendChild(n); });

  let vm = null;
  let toastTimer = null;

  function mk(tag, cls) { const n = document.createElement(tag); n.className = cls; return n; }

  function anchorRect(sel) {
    if (!sel) return null;
    const node = document.querySelector(sel);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return (r.width || r.height) ? r : null;
  }

  /** Place the coach card adjacent to the rect (below → above → centered). */
  function placeCard(card, rect) {
    card.style.transform = '';
    if (!rect) {
      card.style.left = '50%';
      card.style.top = '20%';
      card.style.transform = 'translateX(-50%)';
      return;
    }
    const cw = card.offsetWidth || 340;
    const ch = card.offsetHeight || 140;
    let x = Math.min(Math.max(8, rect.left), window.innerWidth - cw - 8);
    let y = rect.bottom + 12;
    if (y + ch > window.innerHeight - 8) y = rect.top - ch - 12;
    if (y < 8) y = Math.max(8, (window.innerHeight - ch) / 2);
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }

  function placeRing(rect) {
    if (!rect) { el.ring.style.display = 'none'; return; }
    el.ring.style.display = 'block';
    el.ring.style.left = `${rect.left - 5}px`;
    el.ring.style.top = `${rect.top - 5}px`;
    el.ring.style.width = `${rect.width + 10}px`;
    el.ring.style.height = `${rect.height + 10}px`;
  }

  function renderModal(show) {
    el.modal.style.display = show ? 'flex' : 'none';
    if (!show) return;
    el.modal.innerHTML = `
      <div class="tut-modal">
        <div class="tut-ops">▮ ${esc(t('tutorial.ops'))}</div>
        <h3>${esc(t('tutorial.prompt.title'))}</h3>
        <p>${rich(t('tutorial.prompt.body'))}</p>
        <div class="tut-modal-btns">
          <button class="rs-btn" data-tut="start">${esc(t('tutorial.prompt.start'))}</button>
          <button class="rs-btn ghost" data-tut="declinePrompt">${esc(t('tutorial.prompt.skip'))}</button>
        </div>
      </div>`;
  }

  function renderCoach(step) {
    el.coach.style.display = step ? 'block' : 'none';
    if (!step) { if (!vm?.hint) el.ring.style.display = 'none'; return; }
    el.coach.innerHTML = `
      <div class="tut-ops">▮ ${esc(t('tutorial.ops'))}</div>
      <div class="tut-text">${rich(t(step.textKey, step.params))}</div>
      <div class="tut-btns">
        ${step.manual ? `<button class="rs-btn tut-next" data-tut="next">${esc(t(step.nextKey))}</button>` : ''}
        <button class="tut-skip" data-tut="skip">✖ ${esc(t('tutorial.skip'))}</button>
      </div>`;
    const rect = anchorRect(step.anchor);
    placeRing(rect);
    placeCard(el.coach, rect);
  }

  function renderToast(moment) {
    if (!moment) { el.toast.style.display = 'none'; return; }
    if (el.toast.style.display !== 'block') {
      el.toast.innerHTML = `<div class="tut-toast-text">${rich(t(moment.textKey))}</div>`;
      el.toast.style.display = 'block';
      el.toast.classList.remove('celebrate');
      void el.toast.offsetWidth;                 // restart the pulse animation
      el.toast.classList.add('celebrate');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { director.dismissMoment(); sync(); }, 3500);
    }
  }

  function renderHint(hint, coachVisible) {
    // the sequential coach card wins the screen; hold the hint until it's gone
    el.hint.style.display = (hint && !coachVisible) ? 'block' : 'none';
    if (!hint || coachVisible) return;
    el.hint.innerHTML = `
      <div class="tut-ops">▮ ${esc(t('tutorial.ops'))}</div>
      <div class="tut-text">${rich(t(hint.textKey))}</div>
      <div class="tut-btns"><button class="rs-btn tut-next" data-tut="dismissHint">${esc(t('tutorial.gotIt'))}</button></div>`;
    const rect = anchorRect(hint.anchor);
    if (!vm?.step) placeRing(rect);
    placeCard(el.hint, rect);
  }

  function sync() {
    vm = director.sync(getCtx());
    renderModal(vm.promptVisible);
    renderCoach(vm.step);
    renderToast(vm.moment);
    renderHint(vm.hint, !!vm.step);
  }

  // one delegated listener for all tutorial buttons
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tut]');
    if (!btn) return;
    const action = btn.dataset.tut;
    if (action === 'start') { director.start(); sync(); onChange(); }
    else if (action === 'declinePrompt') { director.skip(); sync(); }
    else if (action === 'skip') { director.skip(); sync(); }
    else if (action === 'dismissHint') { director.dismissHint(); sync(); }
    else if (action === 'next') {
      const wasBegin = vm?.step?.onNext === 'begin';
      director.next();
      if (wasBegin) beginTutorialRun();           // triggers draw() → sync()
      else { sync(); onChange(); }
    }
  });

  // re-anchor on viewport changes and on a light tick while anything is visible
  window.addEventListener('resize', () => { if (vm && (vm.step || vm.hint)) sync(); });
  setInterval(() => {
    if (!vm || (!vm.step && !vm.hint)) return;
    const target = vm.step || vm.hint;
    const rect = anchorRect(target.anchor);
    placeRing(vm.step ? rect : (vm.hint && !vm.step ? rect : null));
    placeCard(vm.step ? el.coach : el.hint, rect);
  }, 300);

  return {
    sync,
    startTutorial: () => { director.start(); beginTutorialRun(); },
  };
}
