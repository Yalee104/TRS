// puzzle/catalog.js — build the puzzle's nodeTypes from a combo config.
// (Same pattern as the puzzle demo: base cells + skills + powerups.)
export function catalogFromConfig(cfg) {
  const nt = { ...cfg.base };
  // Host override: show a flashing "START" label (no rocket glyph) on a vivid cell
  // so the entry point is obvious at a glance. Styled in the shmup's index.html.
  if (nt.start) nt.start = { ...nt.start, icon: null, label: 'START', color: '#2f6fd0' };
  for (const [k, d] of Object.entries(cfg.skills)) nt[k] = { role: 'normal', passable: true, ...d };
  if (cfg.powerups) for (const [k, d] of Object.entries(cfg.powerups)) nt[k] = { role: 'normal', passable: true, ...d };
  return nt;
}
