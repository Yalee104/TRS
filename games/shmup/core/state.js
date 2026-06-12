// =============================================================================
//  core/state.js  —  the game state (plain data) + status-effect helpers
// =============================================================================
//
//  Everything the game knows lives in ONE plain object built from game.json.
//  Systems are pure-ish functions that read/mutate this object — no behaviour
//  lives on the entities themselves. That separation (data vs. systems vs.
//  rendering) is what keeps the game modular and easy to expand.
// =============================================================================

let _uid = 1;
export const uid = () => _uid++;

// Build the initial game state from the loaded config.
export function createState(config) {
  const p = config.player;
  const player = {
    pos: { x: p.startX, y: p.startY },
    hp: p.hp, maxHp: p.maxHp,
    radius: p.radius,
    speed: p.speed,
    baseFireRate: p.fireRate,   // shots/sec
    fireRateMult: 1,            // derived from 'overclock' statuses
    fireCooldown: 0,            // ms until next shot
    bulletSpeed: p.bulletSpeed, bulletDmg: p.bulletDmg, bulletRadius: p.bulletRadius,
    color: p.color,
    shield: { amount: 0, remainingMs: 0 },
    statuses: [],
    input: { left: false, right: false, firing: true },
  };

  const shieldMult = config.tuning?.enemyShieldMult ?? 0;
  const enemies = [];
  const boss = config.enemies.boss;
  enemies.push(makeEnemy(boss, shieldMult));
  for (const s of config.enemies.smalls) enemies.push(makeEnemy(s, shieldMult));

  return {
    config,
    phase: 'playing',          // 'playing' | 'puzzle' | 'won' | 'lost'
    timeScale: 1,
    time: 0,                   // accumulated sim ms
    canvas: { ...config.canvas },
    player,
    enemies,
    bullets: [],
    cooldowns: { offensive: 0, defensive: 0 },
    cooldownMax: { offensive: 1, defensive: 1 }, // for HUD progress bars
    activePuzzle: null,
    fx: [],
    banner: null,
  };
}

function makeEnemy(def, shieldMult = 0) {
  // Shield = HP × multiplier (per-enemy `shieldMult` overrides the global default).
  // `disabledMs > 0` means the shield is temporarily bypassed (offensive-puzzle reward).
  // Chips, no regen: `amount` only ever decreases.
  const s = def.hp * (def.shieldMult ?? shieldMult);
  return {
    id: uid(),
    kind: def.kind,
    pos: { x: def.pos.x, y: def.pos.y },
    hp: def.hp, maxHp: def.maxHp ?? def.hp,
    radius: def.radius,
    color: def.color,
    shield: { amount: s, max: s, disabledMs: 0 },
    fireTimer: def.fireMs ?? 0,     // smalls use a simple timer
    patternState: { index: 0, phaseTimer: 0, telegraphing: false },
    statuses: [],
    def,                             // reference to the config block (patterns, etc.)
  };
}

// ---- status-effect helpers (shared by player + enemies) ---------------------
// A status is { type, remainingMs, magnitude, meta }.

export function hasStatus(entity, type) {
  return entity.statuses.some((s) => s.type === type && s.remainingMs > 0);
}

export function getStatus(entity, type) {
  return entity.statuses.find((s) => s.type === type && s.remainingMs > 0) || null;
}

// Add (or refresh) a status. Default policy keeps the longest remaining time and
// the strongest magnitude (configurable later via tuning.statusStackPolicy).
export function addStatus(entity, type, remainingMs, magnitude = 0, meta = {}) {
  const existing = getStatus(entity, type);
  if (existing) {
    existing.remainingMs = Math.max(existing.remainingMs, remainingMs);
    existing.magnitude = Math.max(existing.magnitude, magnitude);
    existing.meta = { ...existing.meta, ...meta };
    return existing;
  }
  const s = { type, remainingMs, magnitude, meta };
  entity.statuses.push(s);
  return s;
}

export function removeStatusesOfType(entity, types) {
  const set = new Set(types);
  entity.statuses = entity.statuses.filter((s) => !set.has(s.type));
}

// Deal `amount` damage to an enemy, routed through its shield. An active shield
// (amount left AND not disabled) absorbs first; the remainder spills to HP.
// `bypassShield` (e.g. the Drain skill) ignores the shield and hits HP directly.
// Enemies without a `shield` field (bare test literals) just take HP damage.
export function damageEnemy(enemy, amount, { bypassShield = false } = {}) {
  const sh = enemy.shield;
  if (!bypassShield && sh && sh.amount > 0 && sh.disabledMs <= 0) {
    const absorbed = Math.min(sh.amount, amount);
    sh.amount -= absorbed;
    amount -= absorbed;
  }
  if (amount > 0) enemy.hp -= amount;
}

// Spawn a bullet into the state (used by player + enemy fire systems).
export function spawnBullet(state, b) {
  state.bullets.push({ id: uid(), ...b });
}

// Convenience: the elite/boss is the default offensive target.
export function bossOf(state) {
  return state.enemies.find((e) => e.kind === 'boss') || state.enemies[0] || null;
}
