// =============================================================================
//  states.js  —  THE CHARACTER STATE MACHINE, AS DATA
// =============================================================================
//
//  A fighter is ALWAYS in exactly one state. The state decides:
//    - which animation plays,
//    - what the character is allowed to do next (transitions),
//    - and (for attacks) the "frame data": how long until the hit is active,
//      how long it stays active, and how long you're stuck recovering.
//
//  Putting all of this in a plain data table (instead of scattered if/else)
//  is what makes character behavior easy to read, tweak, and debug. This is the
//  same idea behind Rive's state machines and XState — the pattern transfers
//  straight to "rich animation" UI work.
//
//  FRAME DATA (fighting-game core concept):
//    startup  → wind-up frames before the hit can connect
//    active   → frames where the hitbox is live and can damage the opponent
//    recovery → frames you're locked after, unable to act (your "punish window")
//  Times here are in milliseconds for simplicity.
// =============================================================================

// Which states a fighter may move INTO from a given state.
// (Grounded actions only start from idle/walk; you can't punch mid-hitstun.)
export const STATES = {
  idle:    { anim: 'idle',    loop: true,  canAct: true  },
  walk:    { anim: 'walk',    loop: true,  canAct: true  },
  jump:    { anim: 'idle',    loop: false, canAct: false }, // reuse idle pose in air
  block:   { anim: 'block',   loop: false, canAct: false },
  hitstun: { anim: 'hitstun', loop: false, canAct: false },
  ko:      { anim: 'ko',      loop: false, canAct: false },

  // --- attacks: note the frame-data windows -------------------------------
  punch: {
    anim: 'punch', loop: false, canAct: false,
    startup: 110, active: 90, recovery: 160,
    damage: 8, range: 60, knockback: 130,
  },
  kick: {
    anim: 'kick', loop: false, canAct: false,
    startup: 160, active: 110, recovery: 240,
    damage: 13, range: 78, knockback: 220,
  },
};

// Helpers so other files don't reach into the table directly.
export const isAttack = (name) => name === 'punch' || name === 'kick';
export const attackDuration = (name) => {
  const s = STATES[name];
  return s.startup + s.active + s.recovery;
};
