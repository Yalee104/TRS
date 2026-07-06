// =============================================================================
//  view/mapScreen.js — the StS-style act map (factory, renders into #run-screen)
// =============================================================================
//
//  Renders run.map as rows of node chips (start at top, boss at bottom) with an
//  SVG edge overlay drawn behind them. Only the nodes reachable from where the
//  player stands (run.mapPos) are clickable; visited nodes dim, the current node
//  highlights. Edges are measured after layout (rAF) so they line up with the DOM.
// =============================================================================

import { t } from '../i18n/index.js';
import { reachableNext } from '../core/map.js';

const ICON = { start: '▶', enemy: '⚔️', elite: '💀', boss: '👑', shop: '🛒', heal: '❤️', upgrade: '⬆️' };

export function createMapScreen(root, { onPickNode, getRun }) {
  function render() {
    const run = getRun();
    if (!run || !run.map) return;
    const map = run.map;
    const reachable = new Set(reachableNext(map, run.mapPos).map((n) => n.id));

    const rowsHtml = map.rows.map((row) => `
      <div class="rs-maprow">
        ${row.map((n) => {
          const cls = ['rs-mapnode', `t-${n.type}`];
          if (n.id === run.mapPos) cls.push('current');
          else if (reachable.has(n.id)) cls.push('reachable');
          else if (n.visited) cls.push('visited');
          else cls.push('locked');
          return `<div class="${cls.join(' ')}" data-node="${n.id}" title="${t(`map.node.${n.type}`)}">
            <span class="rs-mapic">${ICON[n.type] || '?'}</span></div>`;
        }).join('')}
      </div>`).join('');

    root.innerHTML = `
      <div class="rs-wrap rs-map">
        <h2 class="rs-title">${t('map.title')}</h2>
        <p class="rs-sub">${t('map.pickNode')}</p>
        <svg class="rs-mapedges" aria-hidden="true"></svg>
        <div class="rs-maprows">${rowsHtml}</div>
      </div>`;

    root.querySelectorAll('.rs-mapnode.reachable').forEach((el) =>
      el.addEventListener('click', () => onPickNode(el.dataset.node)));

    drawEdges(root, map, reachable, run.mapPos);
  }
  return { render };
}

function drawEdges(root, map, reachable, mapPos) {
  const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (fn) => fn();
  raf(() => {
    const svg = root.querySelector('.rs-mapedges');
    const wrap = root.querySelector('.rs-map');
    if (!svg || !wrap || !wrap.getBoundingClientRect) return;
    const base = wrap.getBoundingClientRect();
    const center = (id) => {
      const el = root.querySelector(`[data-node="${id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 };
    };
    let lines = '';
    for (const row of map.rows) {
      for (const n of row) {
        const a = center(n.id);
        if (!a) continue;
        for (const nx of n.next) {
          const b = center(nx);
          if (!b) continue;
          const hot = (n.id === mapPos && reachable.has(nx)) ? ' hot' : '';
          lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="rs-edge${hot}" />`;
        }
      }
    }
    svg.style.width = `${base.width}px`;
    svg.style.height = `${base.height}px`;
    svg.innerHTML = lines;
  });
}
