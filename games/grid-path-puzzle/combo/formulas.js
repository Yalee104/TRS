// =============================================================================
//  combo/formulas.js  —  the fixed menu of value.kind formulas
// =============================================================================
//
//  A skill's `value` block in the config names a formula `kind` plus parameters,
//  e.g. { kind:'linear', base:0.4, unit:'s frozen' }. The engine turns an abstract
//  combo "Value" (V) into a game-facing number via one of these. Adding a new kind
//  here makes it available to every config — config stays pure data (no code).
// =============================================================================

export function applyFormula(value, V) {
  if (!value) return null; // some skills (e.g. Cleanse) have no magnitude value
  switch (value.kind) {
    case 'linear': // gameValue = base * V
      return value.base * V;
    case 'multiply': // gameValue = base * V^exp
      return value.base * Math.pow(V, value.exp ?? 1);
    case 'table': // explicit breakpoints indexed by round(V) (1-based), clamped
    case 'curve': {
      const t = value.table || value.curve || [];
      if (t.length === 0) return value.base ?? null;
      const i = Math.min(Math.max(1, Math.round(V)), t.length) - 1;
      return t[i];
    }
    default:
      return value.base != null ? value.base * V : null;
  }
}
