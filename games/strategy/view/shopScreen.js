// =============================================================================
//  view/shopScreen.js — the Scrap shop (factory, renders into #run-screen)
// =============================================================================
//
//  Priced cards built from run.shop.items (reuses the reward `describe` helper for
//  labels). Unaffordable / sold cards are disabled; a Leave button exits the node.
// =============================================================================

import { t } from '../i18n/index.js';
import { describe } from './rewardScreen.js';

const keyOf = (item) => `${item.type}:${item.id || item.modId || ''}`;

export function createShopScreen(root, { onBuy, onLeave, getRun }) {
  function render() {
    const run = getRun();
    if (!run) return;
    const shop = run.shop || { items: [], sold: [] };
    root.innerHTML = `
      <div class="rs-wrap">
        <h2 class="rs-title">${t('shop.title')}</h2>
        <p class="rs-sub">${t('shop.balance', { n: run.scrap })}</p>
        <div class="rs-rewards">
          ${shop.items.map((item, i) => {
            const d = describe(item);
            const sold = shop.sold.includes(keyOf(item));
            const afford = run.scrap >= item.price;
            const cls = ['rs-reward'];
            if (sold) cls.push('sold'); else if (!afford) cls.push('unaffordable');
            return `<div class="${cls.join(' ')}" data-i="${i}">
              <div class="rs-rtype">${d.type}</div>
              <div class="rs-rname">${d.name}</div>
              <div class="rs-rdesc">${d.desc}</div>
              <div class="rs-price">${sold ? t('shop.sold') : t('shop.price', { n: item.price })}</div>
            </div>`;
          }).join('')}
        </div>
        <div class="rs-foot"><button class="rs-btn secondary" id="rs-leave">${t('shop.leave')}</button></div>
      </div>`;

    root.querySelectorAll('.rs-reward').forEach((el) => {
      if (el.classList.contains('sold') || el.classList.contains('unaffordable')) return;
      el.addEventListener('click', () => onBuy(shop.items[Number(el.dataset.i)]));
    });
    const leave = root.querySelector('#rs-leave');
    if (leave) leave.onclick = () => onLeave();
  }
  return { render };
}
