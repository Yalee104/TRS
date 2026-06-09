// =============================================================================
//  util/clamp.js  —  tiny numeric helpers (zero dependencies)
// =============================================================================

export const MIN_SIZE = 4;
export const MAX_SIZE = 15;

/** Clamp n into [lo, hi]. */
export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Coerce a requested grid size into the supported range [4, 15].
 * We *coerce* rather than throw (friendlier for a learning module) and warn so
 * the developer notices.
 */
export function clampGridSize(n, label = 'size') {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return MIN_SIZE;
  const clamped = clamp(v, MIN_SIZE, MAX_SIZE);
  if (clamped !== v) {
    // eslint-disable-next-line no-console
    console.warn(`[grid-path-puzzle] ${label}=${n} clamped to ${clamped} (range ${MIN_SIZE}..${MAX_SIZE}).`);
  }
  return clamped;
}
