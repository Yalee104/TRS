// =============================================================================
//  combo/effects.js  —  named effect handlers (host glue)
// =============================================================================
//
//  Tiers can list named `effects` (e.g. "shatter", "reflect"). In a real game the
//  host would implement these as gameplay (apply shatter damage, spawn a shield…).
//  Our demo is a *readout/visualizer*, so each handler just supplies a HUD badge
//  { label, fxClass }. An unknown effect name never crashes — it's shown as-is
//  with a console.warn, exactly as the design docs specify.
// =============================================================================

const REGISTRY = {
  // offensive
  shatter: { label: 'Shatter', fxClass: 'fx-shatter' },
  blast: { label: 'Blast', fxClass: 'fx-blast' },
  pullIn: { label: 'Pull-In', fxClass: 'fx-pull' },
  ownDamage: { label: 'Own Damage', fxClass: 'fx-own' },
  beam: { label: 'BEAM', fxClass: 'fx-beam' },
  // shared / defensive
  shield: { label: 'Shield', fxClass: 'fx-shield' },
  regen: { label: 'Regen', fxClass: 'fx-regen' },
  reflect: { label: 'Reflect', fxClass: 'fx-reflect' },
  invuln: { label: 'Invuln', fxClass: 'fx-invuln' },
  ward: { label: 'Ward', fxClass: 'fx-ward' },
  pierce: { label: 'Pierce', fxClass: 'fx-pierce' },
  maxRate: { label: 'Max Rate', fxClass: 'fx-max' },
  immunityShort: { label: 'Immunity', fxClass: 'fx-immunity' },
};

export function resolveEffect(name) {
  const e = REGISTRY[name];
  if (!e) {
    // eslint-disable-next-line no-console
    console.warn(`[combo] no handler registered for effect "${name}" — showing raw name.`);
    return { label: name, fxClass: 'fx-unknown' };
  }
  return e;
}

export function effectBadges(names) {
  return (names || []).map(resolveEffect);
}
