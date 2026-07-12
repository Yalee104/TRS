// =============================================================================
//  view/loadoutPicker.js — pre-run loadout chooser (Core + pick N, or a preset)
// =============================================================================
//
//  Rendered into #run-screen before a run begins. The Reactor Core is always
//  equipped; the player picks `config.run.startComponents.pickCount` more parts —
//  either by clicking component chips, or by choosing a preset (which just
//  pre-selects two components so the idea of specialization is legible). On Begin
//  it hands { components, loadout, seed } back to main.js → createRun.
// =============================================================================

import { COMPONENT_IDS, ATTACK_EFFECT, DEFENSE_VERB } from '../core/components.js';
import { t, componentLabel, effectLabel, verbLabel } from '../i18n/index.js';

export function createLoadoutPicker(root, { config, onBegin, onTutorial = null }) {
  const rc = config.run || {};
  const pickCount = rc.startComponents?.pickCount ?? 2;
  const presets = rc.loadouts || {};
  const pickable = COMPONENT_IDS.filter((id) => id !== 'core');

  let preset = presets.burst ? 'burst' : (Object.keys(presets)[0] || 'custom');
  let selected = new Set((presets[preset]?.components) || []);
  let seed = 0;

  // role line for a chip, e.g. "Freeze · Shield"
  const roleOf = (id) => [ATTACK_EFFECT[id] && effectLabel(ATTACK_EFFECT[id]), DEFENSE_VERB[id] && verbLabel(DEFENSE_VERB[id])]
    .filter(Boolean).join(' · ');

  function presetHtml(key) {
    const active = key === preset ? ' active' : '';
    return `<div class="rs-preset${active}" data-preset="${key}">
      <div class="rs-pname">${t(`loadout.preset.${key}`)}</div>
      <div class="rs-pdesc">${t(`loadout.preset.${key}Desc`)}</div>
    </div>`;
  }

  function chipHtml(id) {
    const sel = selected.has(id) ? ' selected' : '';
    return `<div class="rs-chip${sel}" data-chip="${id}">
      <div class="rs-cname">${componentLabel(id)}</div>
      <div class="rs-crole">${roleOf(id)}</div>
    </div>`;
  }

  function render() {
    const ready = selected.size === pickCount;
    root.innerHTML = `
      <div class="rs-wrap">
        <h2 class="rs-title">${t('loadout.title')}</h2>
        <p class="rs-sub">${t('loadout.subtitle', { n: pickCount })}</p>

        <div class="rs-section-label">${t('loadout.presetsLabel')}</div>
        <div class="rs-presets">${Object.keys(presets).filter((k) => k !== '_comment').map(presetHtml).join('')}</div>

        <div class="rs-section-label">${t('loadout.pickN', { n: pickCount })}</div>
        <div class="rs-chips">
          <div class="rs-chip locked" title="${t('loadout.coreLocked')}">
            <div class="rs-cname">🔒 ${componentLabel('core')}</div>
            <div class="rs-crole">${t('loadout.coreLocked')}</div>
          </div>
          ${pickable.map(chipHtml).join('')}
        </div>

        <div class="rs-counter">${t('loadout.chosen', { n: selected.size, max: pickCount })}</div>
        <label class="rs-counter">${t('config.seed')}
          <input id="rs-seed" type="number" min="0" step="1" value="${seed}" style="width:80px;margin-left:6px" />
        </label>
        <div class="rs-foot">
          <button class="rs-btn" id="rs-begin"${ready ? '' : ' disabled'}>${t('loadout.beginRun')}</button>
          ${onTutorial ? `<button class="rs-btn ghost" id="rs-tutorial">${t('tutorial.replay')}</button>` : ''}
        </div>
      </div>`;

    root.querySelectorAll('[data-preset]').forEach((el) => el.addEventListener('click', () => {
      preset = el.dataset.preset;
      selected = new Set((presets[preset]?.components) || []);
      render();
    }));
    root.querySelectorAll('[data-chip]').forEach((el) => el.addEventListener('click', () => {
      const id = el.dataset.chip;
      if (selected.has(id)) selected.delete(id);
      else if (selected.size < pickCount) selected.add(id);
      preset = 'custom';   // hand-editing chips = a custom build
      render();
    }));
    const seedEl = root.querySelector('#rs-seed');
    if (seedEl) seedEl.addEventListener('input', () => { seed = Number(seedEl.value) || 0; });
    const begin = root.querySelector('#rs-begin');
    if (begin) begin.addEventListener('click', () => {
      if (selected.size !== pickCount) return;
      onBegin({ components: [...selected], loadout: preset, seed });
    });
    const tut = root.querySelector('#rs-tutorial');
    if (tut) tut.addEventListener('click', () => onTutorial());
  }

  return { render };
}
