// =============================================================================
//  combo/ComboEngine.js  —  generic, data-driven combo evaluation
// =============================================================================
//
//  evaluate(skillSeq, config) takes the ORDERED list of skill-node keys the path
//  crossed (payloads + amplifiers, e.g. ['freeze','freeze','freeze','chain',
//  'multihack']) and the loaded config, and returns a combo result the host HUD
//  renders. The algorithm SHAPE is fixed code; its BEHAVIOR is driven by the
//  config's `rules` toggles, so offense and defense are just two configs.
//
//  Return envelope (uniform for the HUD):
//    { mode, label?, items: [ {skill,tier,value,gameValue,unit,targets,effects, magnitude?,durationSec?} ], special? }
//  Offense → 1 item (the locked status) OR a `special` (the Beam).
//  Defense → N items (one per distinct buff).
//
//  See COMBO_DESIGN_OFFENSIVE.md / COMBO_DESIGN_DEFENSIVE.md for the rules.
// =============================================================================

import { applyFormula } from './formulas.js';

export function evaluate(skillSeq, config) {
  const skills = config.skills || {};
  // Only real skill nodes count, capped at maxSlots (the rest are "wasted slots").
  const tokens = (skillSeq || [])
    .filter((k) => skills[k])
    .slice(0, config.rules?.maxSlots ?? 5)
    .map((key) => ({ key, def: skills[key] }));

  if (config.rules?.lockToFirstPayload) return evaluateOffensive(tokens, config);
  return evaluateDefensive(tokens, config);
}

// ---- helpers ----------------------------------------------------------------
const isPayload = (t) => t.def.class === 'payload';
const isAmplifier = (t) => t.def.class === 'amplifier';
const curveAt = (config, stack) => {
  const c = config.stackCurve || [1];
  return c[Math.min(Math.max(1, stack), c.length) - 1];
};
function resolveTier(skillDef, stack) {
  const tiers = skillDef.tiers || [];
  let best = null;
  for (const t of tiers) if (t.atStack <= stack && (!best || t.atStack > best.atStack)) best = t;
  return best || { name: skillDef.name || 'base', effects: [] };
}

// ---- OFFENSIVE: lock-to-first, leading run, amplifiers boost the run ---------
function evaluateOffensive(tokens, config) {
  // 1) special combos (the Beam) take precedence; a near-miss falls through.
  for (const sp of config.specialCombos || []) {
    if (matchesSpecial(tokens, sp)) {
      return { mode: 'offensive', label: sp.name, items: [], special: { id: sp.id, name: sp.name, ...sp.result } };
    }
  }

  // 2) lock to the first payload; everything before it (stray amplifiers) is wasted.
  const firstPayloadIdx = tokens.findIndex(isPayload);
  if (firstPayloadIdx < 0) return { mode: 'offensive', label: '—', items: [] };
  const lockKey = tokens[firstPayloadIdx].key;

  // leading consecutive run of the locked payload
  let stack = 0;
  let j = firstPayloadIdx;
  while (j < tokens.length && isPayload(tokens[j]) && tokens[j].key === lockKey) { stack++; j++; }

  // amplifiers AFTER the run apply, in order; any later payload wastes the rest.
  const amps = [];
  for (; j < tokens.length; j++) {
    if (isAmplifier(tokens[j])) amps.push(tokens[j].def);
    else break;
  }

  const skillDef = config.skills[lockKey];
  let value = curveAt(config, stack);
  let targets = 1;
  for (const amp of amps) {
    if (amp.op === 'multiply') value *= amp.potency ?? amp.duration ?? 1.5; // Chain ×1.5
    if (amp.op === 'scope') targets = amp.targets ?? 'all'; // Multihack → all
  }

  const tier = resolveTier({ ...skillDef, name: lockKey }, stack);
  return {
    mode: 'offensive',
    label: tier.name,
    items: [{
      skill: lockKey,
      tier: tier.name,
      value,
      gameValue: applyFormula(skillDef.value, value),
      unit: skillDef.value?.unit ?? null,
      targets,
      effects: tier.effects || [],
    }],
  };
}

function matchesSpecial(tokens, sp) {
  const req = sp.requires || {};
  const payloads = tokens.filter(isPayload);
  const counts = {};
  for (const t of payloads) counts[t.key] = (counts[t.key] || 0) + 1;
  const need = req.payloads || [];
  const each = req.eachCount ?? 1;
  const payloadsOk =
    payloads.length === need.length * each &&
    Object.keys(counts).length === need.length &&
    need.every((p) => counts[p] === each);
  if (!payloadsOk) return false;

  // finisher amplifiers must be exactly [chain, multihack] and come AFTER all payloads
  const ampKeys = tokens.filter(isAmplifier).map((t) => t.key);
  const fin = sp.finisher || [];
  if (ampKeys.length !== fin.length || !fin.every((k, i) => ampKeys[i] === k)) return false;
  const lastPayloadIdx = tokens.map(isPayload).lastIndexOf(true);
  const firstAmpIdx = tokens.findIndex(isAmplifier);
  return firstAmpIdx === -1 ? false : lastPayloadIdx < firstAmpIdx;
}

// ---- DEFENSIVE: every distinct payload applies; longest adjacent run ---------
function evaluateDefensive(tokens, config) {
  const payloads = tokens.filter(isPayload);
  const distinctKeys = [];
  for (const t of payloads) if (!distinctKeys.includes(t.key)) distinctKeys.push(t.key);

  // amplifier positions (an amplifier boosts buffs whose run ENDS before it)
  const ampInfos = tokens
    .map((t, idx) => ({ t, idx }))
    .filter(({ t }) => isAmplifier(t))
    .map(({ t, idx }) => ({ def: t.def, idx }));

  const items = distinctKeys.map((key) => {
    // longest run of adjacent identical copies of `key`
    let best = 0, bestEnd = -1, cur = 0;
    tokens.forEach((t, idx) => {
      if (t.key === key) { cur++; if (cur > best) { best = cur; bestEnd = idx; } }
      else cur = 0;
    });
    const stack = best;
    const skillDef = config.skills[key];
    let magnitude = curveAt(config, stack);
    let durationSec = skillDef.baseDurationSec ?? null;
    for (const amp of ampInfos) {
      if (amp.idx <= bestEnd) continue; // only amplifiers AFTER the run boost it
      if (amp.def.magnitude) magnitude *= amp.def.magnitude; // 💪 Amplify
      if (amp.def.duration && durationSec != null) durationSec *= amp.def.duration; // ⏳ Prolong
    }
    const tier = resolveTier({ ...skillDef, name: key }, stack);
    return {
      skill: key,
      tier: tier.name,
      value: magnitude,
      magnitude,
      gameValue: applyFormula(skillDef.value, magnitude),
      unit: skillDef.value?.unit ?? null,
      durationSec,
      targets: 1,
      effects: tier.effects || [],
    };
  });

  return { mode: 'defensive', label: matchesNamed(tokens, config), items };
}

function matchesNamed(tokens, config) {
  const fortress = config.named?.fortress;
  if (!fortress) return undefined;
  const present = new Set(tokens.map((t) => t.key));
  const w = fortress.when || {};
  const all = [...(w.payloads || []), ...(w.amplifiers || [])];
  return all.every((k) => present.has(k)) ? fortress.label : undefined;
}
