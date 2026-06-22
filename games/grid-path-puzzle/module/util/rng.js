// =============================================================================
//  util/rng.js  —  a tiny seeded PRNG (mulberry32), shared across the module
// =============================================================================
//
//  Same generator the level builder uses, factored out so RUNTIME modifiers
//  (confusion, shatter wander) can be reproducible per seed and deterministic
//  in tests (inject a fixed `makeRng(seed)`), instead of using Math.random.
// =============================================================================

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded [0,1) generator. `seed` null → random; the function carries `.seed`. */
export function makeRng(seed) {
  const s = seed == null ? (Math.floor(Math.random() * 0xffffffff) >>> 0) : (seed >>> 0);
  const fn = mulberry32(s);
  fn.seed = s;
  return fn;
}
