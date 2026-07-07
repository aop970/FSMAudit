// Check 19 — Roster Tab Placement
// Verifies each associate is billed on the labor tab that matches their program
// assignment on the FSM Roster tab. Matches labor "Associate ID" to FSM Roster
// Column F (Associate ID), then compares the labor tab to FSM Roster Column E
// ("Type 3" — the program): FSM I → FSM I tab, FSM I-Merit → FSM I Merit tab,
// FSM II → FSM II tab, FSM II-Merit → FSM II Merit tab.
//
// Program labels are compared canonically (lowercased, punctuation/space-stripped)
// so the roster's hyphenated "FSM I-Merit" matches the tab label "FSM I Merit".
//
// IDs on a labor tab that are absent from the roster are NOT flagged here — that is
// Check 8's job (Roster Validation). This check only reports wrong-tab placements,
// deduplicated to one flag per (associate, tab).

import type { CheckResult, LaborRow, RosterEntry } from '../types';
import { toStr } from '../../lib/num';

// Canonical program key: lowercase, strip everything but a–z/0–9.
//   'FSM I'        → 'fsmi'        'FSM I Merit' / 'FSM I-Merit'  → 'fsmimerit'
//   'FSM II'       → 'fsmii'       'FSM II Merit' / 'FSM II-Merit' → 'fsmiimerit'
// Roman numerals survive stripping, so 'fsmi' and 'fsmii' never collide (exact match only).
function canon(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Friendly tab name for a canonical program key (for the "expected tab" message).
const CANON_TO_TAB: Record<string, string> = {
  fsmi: 'FSM I',
  fsmimerit: 'FSM I Merit',
  fsmii: 'FSM II',
  fsmiimerit: 'FSM II Merit',
};

export function check19RosterTab(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
  rosterEntries: RosterEntry[],
): CheckResult {
  if (rosterEntries.length === 0) {
    return {
      checkId: 19,
      checkName: 'Roster Tab Placement',
      status: 'na',
      stats: 'No FSM Roster tab found — tab placement not validated',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // Roster: Associate ID (Col F) → set of program labels (Col E "Type 3").
  // A person listed under multiple programs is valid on any of their tabs.
  const rosterById = new Map<string, Set<string>>();
  for (const r of rosterEntries) {
    const id = toStr(r.associateId).toUpperCase();
    if (!id) continue;
    const prog = toStr(r.program).trim();
    if (!prog) continue;
    if (!rosterById.has(id)) rosterById.set(id, new Set());
    rosterById.get(id)!.add(prog);
  }

  const failures: Record<string, unknown>[] = [];
  const seen = new Set<string>();          // dedupe key: `${id}|${tab}`
  let checkedAssociates = 0;

  for (const r of [...fsmI, ...fsmII]) {
    const id = toStr(r.associateId).toUpperCase();
    const tab = toStr(r.sheet).trim();
    if (!id || !tab) continue;

    const dedupeKey = `${id}|${canon(tab)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const rosterPrograms = rosterById.get(id);
    if (!rosterPrograms || rosterPrograms.size === 0) continue; // not on roster → Check 8 owns it
    checkedAssociates++;

    const tabCanon = canon(tab);
    const rosterCanons = new Set(Array.from(rosterPrograms, canon));
    if (rosterCanons.has(tabCanon)) continue; // correct tab

    const expectedTabs = Array.from(rosterCanons, (c) => CANON_TO_TAB[c] ?? '(unknown)');
    failures.push({
      name: r.employeeName,
      associateId: id,
      actualTab: tab,
      rosterProgram: Array.from(rosterPrograms).join(', '),
      expectedTab: expectedTabs.join(', '),
      issue: `On "${tab}" tab but FSM Roster lists program "${Array.from(rosterPrograms).join(', ')}" → expected "${expectedTabs.join(', ')}" tab`,
    });
  }

  const pass = failures.length === 0;
  return {
    checkId: 19,
    checkName: 'Roster Tab Placement',
    status: pass ? 'pass' : 'fail',
    stats: `${checkedAssociates} associate-tab placements checked against FSM Roster, ${failures.length} on wrong tab`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
