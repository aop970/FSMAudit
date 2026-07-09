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
// Salesforce Type 3 field truncation: program names ending in "-M" are treated as
// the Merit variant of the base program (e.g. "FSM I-M" → "FSM I Merit",
// "FSM II-M" → "FSM II Merit"). This covers any program that hits the same
// Salesforce character-limit truncation (Option B: general suffix rule).
//
// IDs on a labor tab that are absent from the roster are NOT flagged here — that is
// Check 8's job (Roster Validation). This check only reports wrong-tab placements,
// deduplicated to one flag per (associate, tab).
//
// Roster Status filter: the "expected tab" lookup is built from ACTIVE Type-3 rows
// only (Col B "Status" === "Active", case-insensitive). The FSM Roster tab retains a
// large volume of Inactive rows (turned-over associates); using their stale Type-3
// value as "the correct tab" produces false wrong-tab flags whenever a person moves
// or the roster wasn't cleaned up. A billed associate who exists on the roster but
// has NO Active row is surfaced as a separate "not Active — manual verify" flag
// instead of being silently skipped or wrongly judged against a stale program.

import type { CheckResult, LaborRow, RosterEntry } from '../types';
import { toStr } from '../../lib/num';

// Canonical program key: lowercase, strip everything but a–z/0–9.
//   'FSM I'        → 'fsmi'        'FSM I Merit' / 'FSM I-Merit'  → 'fsmimerit'
//   'FSM II'       → 'fsmii'       'FSM II Merit' / 'FSM II-Merit' → 'fsmiimerit'
// Roman numerals survive stripping, so 'fsmi' and 'fsmii' never collide (exact match only).
function canon(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Salesforce truncates "FSM I Merit" → "FSM I-M" and "FSM II Merit" → "FSM II-M"
// due to a Type 3 field character limit. Normalize any program ending in "-M"
// (case-insensitive) to its full Merit form so the canonical lookup succeeds.
// General suffix rule — applies to any base program (FSM I, FSM II, or others).
function normalizeSalesforceTruncation(prog: string): string {
  return /^(.+)-M$/i.test(prog) ? prog.replace(/-M$/i, ' Merit') : prog;
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

  // Roster: Associate ID (Col F) → set of program labels (Col E "Type 3"), ACTIVE rows only.
  // A person listed under multiple active programs is valid on any of their tabs.
  // Inactive rows do not define a "correct tab" — they're stale roster history.
  const rosterById = new Map<string, Set<string>>();
  // Every associate ID that appears anywhere on the roster, regardless of status —
  // used only to distinguish "on roster but not Active" from "absent" (Check 8's job).
  const rosterAnyStatusIds = new Set<string>();
  for (const r of rosterEntries) {
    const id = toStr(r.associateId).toUpperCase();
    if (!id) continue;
    rosterAnyStatusIds.add(id);
    const isActive = toStr(r.status).trim().toLowerCase() === 'active';
    if (!isActive) continue;
    const prog = normalizeSalesforceTruncation(toStr(r.program).trim());
    if (!prog) continue;
    if (!rosterById.has(id)) rosterById.set(id, new Set());
    rosterById.get(id)!.add(prog);
  }

  const failures: Record<string, unknown>[] = [];
  const notActiveFlags: Record<string, unknown>[] = [];
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
    if (!rosterPrograms || rosterPrograms.size === 0) {
      // Not Active on the roster. If they're on the roster at all (Inactive-only),
      // that's a distinct, surfaced callout — not a silent skip. If they're absent
      // entirely, Check 8 (Roster Validation) owns it — skip here to avoid double-flagging.
      if (rosterAnyStatusIds.has(id)) {
        // Same key shape as the wrong-tab failures below (name/associateId/actualTab/
        // rosterProgram/expectedTab/issue) so the flagged-rows table renders a single
        // consistent column set — the "issue" text is what visually distinguishes
        // this manual-verify category from a wrong-tab failure.
        notActiveFlags.push({
          name: r.employeeName,
          associateId: id,
          actualTab: tab,
          rosterProgram: '(not Active)',
          expectedTab: '(not Active)',
          issue: `On "${tab}" tab and billed, but not Active on FSM Roster — manual verify`,
        });
      }
      continue;
    }
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

  const allFlags = [...failures, ...notActiveFlags];
  const pass = allFlags.length === 0;
  return {
    checkId: 19,
    checkName: 'Roster Tab Placement',
    status: pass ? 'pass' : 'fail',
    stats: `${checkedAssociates} active associate-tab placements checked against FSM Roster, ${failures.length} on wrong tab, ${notActiveFlags.length} billed but not Active on roster`,
    flaggedCount: allFlags.length,
    flaggedRows: allFlags.slice(0, 200),
  };
}
