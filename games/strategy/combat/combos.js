// =============================================================================
//  combat/combos.js — the v2 status-combo engine (DESIGN §3.7)
// =============================================================================
//
//  A component holds an ordered CHAIN of entries (statuses/verbs in FCFS order,
//  with `break` separators). Combos resolve GREEDILY left-to-right: the first
//  adjacent pair (no break between, ≥1 entry applied THIS phase, and a defined
//  combo) consumes BOTH entries and the scan advances past them; a result never
//  re-combos. So each entry joins at most one combo, earlier pairs win, and a
//  `break` lets the player opt out (keep both base effects).
//
//  This module is PURE: it only decides which pairs fire. Applying each combo's
//  effect to game state lives in attack.js / defense.js.
// =============================================================================

/** Order-independent pair key, e.g. ('shatter','freeze') → 'freeze+shatter'. */
export const pairKey = (a, b) => [a, b].sort().join('+');

/**
 * Offensive combos (DESIGN §3.6/§3.7). `kind`:
 *   'burst'   — fires once and CONSUMES both statuses (removed after).
 *   'ongoing' — replaces the two statuses with a single combo-status that
 *               persists and re-applies each resolve while present.
 * (Frozen+Burning has no entry — they cancel at apply time. Frozen+Drained is open.)
 */
export const OFFENSE_COMBOS = {
  'freeze+shatter':  { id: 'glass',      name: 'Glass',           kind: 'burst', focusOnly: true },
  'confuse+freeze':  { id: 'stasisLock', name: 'Stasis Lock',     kind: 'ongoing', status: 'stasisLock' },
  'burning+shatter': { id: 'meltdown',   name: 'Meltdown',        kind: 'ongoing', status: 'meltdown' },
  'confuse+shatter': { id: 'backfire',   name: 'Backfire',        kind: 'burst' },
  'drain+shatter':   { id: 'collapse',   name: 'Collapse',        kind: 'burst' },
  'burning+confuse': { id: 'wildfire',   name: 'Wildfire',        kind: 'ongoing', status: 'wildfire' },
  'burning+drain':   { id: 'vaporize',   name: 'Vaporize',        kind: 'burst' },
  'confuse+drain':   { id: 'feedback',   name: 'Feedback Cascade', kind: 'burst' },
};

/**
 * Defensive combos (DESIGN §4 Table E v2). Same kinds; ongoing ones leave a
 * carried defensive state (Sustain/Field Repair) that resolves again next round.
 */
export const DEFENSE_COMBOS = {
  'repair+shield':   { id: 'sustain',         name: 'Sustain',          kind: 'ongoing' },
  'cleanse+shield':  { id: 'purifiedBarrier', name: 'Purified Barrier', kind: 'burst' },
  'harden+shield':   { id: 'bastion',         name: 'Bastion',          kind: 'ongoing' },
  'overclock+shield':{ id: 'reactivePlating', name: 'Reactive Plating', kind: 'ongoing' },
  'harden+repair':   { id: 'fieldRepair',     name: 'Field Repair',     kind: 'ongoing' },
  'cleanse+harden':  { id: 'deflect',         name: 'Deflect',          kind: 'burst' },
  'cleanse+overclock': { id: 'reboot',        name: 'Reboot',           kind: 'burst' },
};

/** Look up a combo definition for two entry keys, or null. */
export function lookupCombo(table, a, b) {
  return table[pairKey(a, b)] || null;
}

/**
 * Greedy chain resolution.
 * @param entries ordered list of { key, fresh } status entries and { brk:true } breaks
 * @param table   OFFENSE_COMBOS or DEFENSE_COMBOS
 * @param allow   optional predicate(def) — e.g. skip focus-only combos off the focus
 * @returns { combos: [{ a, b, def }], leftovers: [entry] }
 */
export function resolveChain(entries, table, allow = () => true) {
  const combos = [];
  const leftovers = [];
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];
    if (e.brk) { i += 1; continue; }            // a break is just a separator
    const n = entries[i + 1];
    if (n && !n.brk) {
      const def = lookupCombo(table, e.key, n.key);
      if (def && allow(def) && (e.fresh || n.fresh)) {  // ≥1 entry applied this phase (C2)
        combos.push({ a: e, b: n, def });
        i += 2;                                  // consume both; results never re-combo
        continue;
      }
    }
    leftovers.push(e);
    i += 1;
  }
  return { combos, leftovers };
}
