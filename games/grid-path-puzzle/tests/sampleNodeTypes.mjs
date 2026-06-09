// A sample node-type catalog used by the tests (and mirrors the demo's catalog).
export const nodeTypes = {
  start:       { role: 'start',  passable: true,  color: '#ffffff', label: 'START' },
  goal:        { role: 'goal',   passable: true,  color: '#3ad07a', label: 'EXE' },
  normal:      { role: 'normal', passable: true,  color: '#3a3f4b' },
  blue:        { role: 'normal', passable: true,  color: '#3a7bd0', label: '+DMG',  onPass: (s) => { s.multiplier += 0.5; } },
  yellow:      { role: 'normal', passable: true,  color: '#e6c84a', label: 'Freeze', onPass: (s) => { s.skills.push('Freeze'); } },
  purple:      { role: 'normal', passable: true,  color: '#9b59b6', label: 'UP',     onPass: (s) => { s.multiplier *= 1.25; } },
  trapFail:    { role: 'normal', passable: true,  color: '#d04a4a', label: 'TRAP', failsOnPass: true, onPass: (s) => { s.fail = true; } },
  trapPenalty: { role: 'normal', passable: true,  color: '#aa8855', label: '-MULT', onPass: (s) => { s.multiplier = Math.max(0, s.multiplier - 0.5); } },
  blocker:     { role: 'normal', passable: false, color: '#2a2e39' },
};

// Reasonable decoration weights for the generator.
export const weights = { normal: 4, blue: 3, yellow: 2, purple: 1, trapPenalty: 2, trapFail: 1, blocker: 3 };
