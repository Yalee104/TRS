// =============================================================================
//  view/rewardScreen.js — between-battle reward choice
// =============================================================================
//
//  Rendered into #run-screen after a battle is won (and it wasn't the last).
//  Lays out run.offer as a row of choice cards; clicking one hands it back to
//  main.js → applyRewardChoice → next battle. All copy is i18n-driven; combo-mod
//  / component-mod names+blurbs come from the catalog-keyed reward.* groups.
// =============================================================================

import { t, componentLabel } from '../i18n/index.js';

/** { typeLabel, name, desc } for one reward / shop item, all localized. Shared with the shop. */
export function describe(r) {
  switch (r.type) {
    case 'component':
      return { type: t('reward.type.component'), name: componentLabel(r.id), desc: t('reward.component.desc', { name: componentLabel(r.id) }) };
    case 'comboMod':
      return { type: t('reward.type.comboMod'), name: t(`reward.comboMod.${r.modId}.name`), desc: t(`reward.comboMod.${r.modId}.desc`) };
    case 'componentMod':
      return { type: t('reward.type.componentMod'), name: t(`reward.componentMod.${r.modId}.name`), desc: t(`reward.componentMod.${r.modId}.desc`) };
    case 'repair':
      return { type: t('reward.type.repair'), name: componentLabel(r.id), desc: t('reward.repair.desc', { name: componentLabel(r.id) }) };
    case 'repairAll':
      return { type: t('reward.type.repair'), name: t('shop.repairAll'), desc: '' };
    default:
      return { type: '', name: r.type, desc: '' };
  }
}

export function createRewardScreen(root, { onPick }) {
  function render(run) {
    const offer = run.offer || [];
    const multi = (run.offerPicks || 0) > 1;
    const report = run.lastBattleReport;
    const fastWinLine = (!run.offerFree && report && report.fastWin)
      ? `<p class="rs-sub">⚡ ${t('reward.fastWin', { rounds: report.rounds, par: report.par })}</p>`
      : '';
    root.innerHTML = `
      <div class="rs-wrap">
        <h2 class="rs-title">${run.offerFree ? t('reward.upgradeTitle') : t('reward.title')}</h2>
        ${fastWinLine}
        <p class="rs-sub">${multi ? t('reward.pickTwo', { n: run.offerPicks }) : t('reward.pickOne')}</p>
        <div class="rs-rewards">
          ${offer.map((r, i) => {
            const d = describe(r);
            return `<div class="rs-reward" data-i="${i}">
              <div class="rs-rtype">${d.type}</div>
              <div class="rs-rname">${d.name}</div>
              <div class="rs-rdesc">${d.desc}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    root.querySelectorAll('[data-i]').forEach((el) => el.addEventListener('click', () => {
      onPick(offer[Number(el.dataset.i)]);
    }));
  }
  return { render };
}
