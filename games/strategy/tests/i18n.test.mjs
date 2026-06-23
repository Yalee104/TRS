// =============================================================================
//  tests/i18n.test.mjs — locale catalog parity + t() resolution
// =============================================================================
//  The parity tests are the extensibility guard: adding a language can't silently
//  ship with missing/extra keys.
// =============================================================================

import { test, assert } from './harness.mjs';
import { en } from '../i18n/en.js';
import { zhHant } from '../i18n/zh-Hant.js';
import { t, setLocale, getLocale } from '../i18n/index.js';

// Collect [dottedKey, typeofValue] for every leaf (string | function) in a catalog.
function leaves(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...leaves(v, key));
    else out.push([key, typeof v]);
  }
  return out;
}
const get = (cat, key) => key.split('.').reduce((v, p) => (v == null ? undefined : v[p]), cat);

test('zh-Hant has every English key, with the same value type', () => {
  for (const [key, type] of leaves(en)) {
    const v = get(zhHant, key);
    assert(v !== undefined, `zh-Hant MISSING key: ${key}`);
    assert(typeof v === type, `zh-Hant key ${key}: type ${typeof v} != en ${type}`);
  }
});

test('zh-Hant has no extra keys beyond English (catches typos)', () => {
  for (const [key] of leaves(zhHant)) {
    assert(get(en, key) !== undefined, `zh-Hant EXTRA key not in en: ${key}`);
  }
});

test('t() resolves per-locale and falls back to the key when missing', () => {
  assert(getLocale() === 'en', 'defaults to en under node');
  assert(t('ui.you') === 'YOU', 'en lookup');
  assert(t('ui.banner.attack', { n: 3 }) === 'Round 3 — ATTACK ⚔️', 'en interpolation');
  assert(t('totally.missing.key') === 'totally.missing.key', 'missing key → key (dev-visible)');
  setLocale('zh-Hant');
  assert(t('ui.you') === '我方', 'zh lookup');
  assert(t('totally.missing.key') === 'totally.missing.key', 'missing key → key (zh)');
  assert(typeof t('tooltip.status.freeze', { turns: 2 }) === 'string', 'zh function message returns a string');
  setLocale('en'); // restore (shared process)
});
