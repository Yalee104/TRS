// puzzle/catalog.js — build the puzzle's nodeTypes from a combo config.
// (Same pattern as the puzzle demo: base cells + skills + powerups.)
export function catalogFromConfig(cfg) {
  const nt = { ...cfg.base };
  for (const [k, d] of Object.entries(cfg.skills)) nt[k] = { role: 'normal', passable: true, ...d };
  if (cfg.powerups) for (const [k, d] of Object.entries(cfg.powerups)) nt[k] = { role: 'normal', passable: true, ...d };
  return nt;
}
