// =============================================================================
//  i18n/index.js — tiny no-library translator for the TRS strategy game
// =============================================================================
//
//  A catalog is a nested object of dotted keys → either a STRING (with {token}
//  placeholders interpolated from params) or a FUNCTION (params) => string for the
//  heavily-parameterised prose. `t(key, params)` resolves against the active locale,
//  falling back to English, then to the key itself (so a missing key is dev-visible).
//
//  Adding a language = add a catalog file + one row in LOCALES. The i18n test
//  (tests/i18n.test.mjs) asserts every non-English catalog has the full English key
//  set, so missing translations surface immediately.
// =============================================================================

import { en } from './en.js';
import { zhHant } from './zh-Hant.js';

export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'zh-Hant', label: '繁體中文' },
];

const CATALOGS = { en, 'zh-Hant': zhHant };
const STORAGE_KEY = 'trs.lang';

function detectInitial() {
  try { const s = localStorage.getItem(STORAGE_KEY); if (s && CATALOGS[s]) return s; } catch { /* no storage */ }
  try { if ((navigator.language || '').toLowerCase().startsWith('zh')) return 'zh-Hant'; } catch { /* no navigator */ }
  return 'en';
}

let locale = detectInitial();
const subscribers = new Set();

export function getLocale() { return locale; }

export function setLocale(code) {
  if (!CATALOGS[code] || code === locale) return;
  locale = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
  subscribers.forEach((fn) => fn(code));
}

/** Subscribe to locale changes; returns an unsubscribe fn. */
export function onLocaleChange(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

function lookup(catalog, key) {
  let v = catalog;
  for (const part of key.split('.')) { if (v == null) return undefined; v = v[part]; }
  return v;
}

const interpolate = (str, params) => str.replace(/\{(\w+)\}/g, (_, k) => (params && k in params ? params[k] : `{${k}}`));

/** Translate a dotted `key`. String values interpolate `{token}` from params; function values are called. */
export function t(key, params) {
  let v = lookup(CATALOGS[locale], key);
  if (v === undefined && locale !== 'en') v = lookup(en, key); // fall back to English
  if (v === undefined) return key;                              // dev-visible missing key
  if (typeof v === 'function') return v(params || {});
  return typeof v === 'string' && params ? interpolate(v, params) : v;
}

// ---- display-name helpers (localize the config/preset-driven names) ----------
export const componentLabel = (id) => t(`component.${id}`);
export const effectLabel = (k) => t(`effect.${k}`);
export const verbLabel = (k) => t(`verb.${k}`);
export const comboLabel = (id) => t(`combo.${id}.name`);
export const archetypeLabel = (k) => t(`archetype.${k}`);
/** A status/verb key shown in a recipe → its localized name (effect first, else verb). */
export const skillLabel = (k) => (en.effect[k] ? t(`effect.${k}`) : (en.verb[k] ? t(`verb.${k}`) : k));
/** Localized enemy label: translated archetype + the dedup number (e.g. "破壞者 2"). */
export const enemyLabel = (e) => `${t(`archetype.${e.archetype}`)}${e.num ? ` ${e.num}` : ''}`;

/** Test/introspection hook: the raw catalog map. */
export const CATALOGS_FOR_TEST = CATALOGS;
