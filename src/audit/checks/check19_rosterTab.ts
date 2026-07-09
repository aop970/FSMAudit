// Check 19 — Roster Tab Placement
//
// Allan's rule, verbatim: "Regardless of the period the invoice covers, 1 person to
// 1 tab for the entire period. On the Roster Tab, if Active then search for the
// Associate ID, and that same ID should be on the tab that matches the Type 3.
// So if ID 123456 is Active and Type 3 is FSM II-M, then rep 123456 must only be
// on the FSM II Merit tab. It is that simple."
//
// Implementation (ID-centric, one flag per person, complete in one pass):
//   1. Iterate ACTIVE roster rows (Col B "Status" === Active). For each Active
//      associate ID, their Type 3 (Col E) says which tab they're allowed on.
//   2. Build the set of tabs that ID actually appears on across ALL labor rows
//      (all weeks, both FSM I and FSM II tabs, base + Merit) — built once, up front.
//   3. If any of those tabs is NOT the required tab, flag the PERSON ONCE, listing
//      every stray tab they were found on. An Active associate not billed at all
//      this period is not checked (nothing to flag). An Active associate billed
//      only on their required tab passes.
//
// This deliberately does NOT flag per-occurrence or per-(id,tab) pair. The prior
// version iterated labor rows and deduped on `${id}|${tab}`, so a person who was
// wrong on TWO tabs produced TWO separate flag rows for the same person, and
// fixing one tab still left the other as a "new" flag on the next run — that's
// why Allan saw flags dribble out across runs (72, then 17, then ~65) instead of
// a single stable worklist. Iterating Active roster IDs once, and building the
// complete stray-tab set per person before emitting a single flag, guarantees one
// full worklist per run: fixing everyone once converges the check to zero.
//
// Program labels are compared canonically (lowercased, punctuation/space-stripped)
// so the roster's hyphenated "FSM I-Merit" matches the tab label "FSM I Merit".
//
// Salesforce Type 3 field truncation: program names ending in "-M" are treated as
// the Merit variant of the base program (e.g. "FSM I-M" → "FSM I Merit",
// "FSM II-M" → "FSM II Merit"). This covers any program that hits the same
// Salesforce character-limit truncation (Option B: general suffix rule).
//
// Billed-but-not-Active: an Associate ID that appears on a labor tab but has NO
// Active roster row is surfaced as a distinct "manual verify" flag (one per
// person, listing every tab they were billed on) — Allan wants this callout kept.
// An ID entirely absent from the roster (no row at any status) is NOT flagged
// here — that stays Check 8's (Roster Validation) job, to avoid double-flagging.

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

  // Roster: Active associate ID → set of program labels (Col E "Type 3").
  // A person with more than one Active row (different Type 3 each) is allowed on
  // any of those tabs — confirmed in real data this is essentially never the case
  // (0 people observed with >1 Active row of differing programs), but we don't
  // assume it.
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

  // Labor: Associate ID → set of DISTINCT tabs they were actually billed on across
  // ALL weeks and ALL four tabs (FSM I, FSM I Merit, FSM II, FSM II Merit) — built
  // once, up front, so the per-person check below sees the complete picture and
  // can emit one complete flag instead of one flag per occurrence.
  const tabsByAssociate = new Map<string, Set<string>>();
  const nameByAssociate = new Map<string, string>();
  for (const r of [...fsmI, ...fsmII]) {
    const id = toStr(r.associateId).toUpperCase();
    const tab = toStr(r.sheet).trim();
    if (!id || !tab) continue;
    if (!tabsByAssociate.has(id)) tabsByAssociate.set(id, new Set());
    tabsByAssociate.get(id)!.add(tab);
    if (!nameByAssociate.has(id)) nameByAssociate.set(id, r.employeeName);
  }

  const failures: Record<string, unknown>[] = [];
  const notActiveFlags: Record<string, unknown>[] = [];
  let billedActiveCount = 0;

  // Pass 1 — one flag per Active associate, listing every stray tab at once.
  for (const [id, rosterPrograms] of rosterById) {
    const actualTabs = tabsByAssociate.get(id);
    if (!actualTabs || actualTabs.size === 0) continue; // not billed this period — nothing to check
    billedActiveCount++;

    const rosterCanons = new Set(Array.from(rosterPrograms, canon));
    const strayTabs = Array.from(actualTabs).filter((tab) => !rosterCanons.has(canon(tab)));
    if (strayTabs.length === 0) continue; // billed only on required tab(s) — pass

    const expectedTabs = Array.from(rosterCanons, (c) => CANON_TO_TAB[c] ?? '(unknown)');
    const name = nameByAssociate.get(id) ?? '';
    const rosterProgramLabel = Array.from(rosterPrograms).join(', ');
    failures.push({
      name,
      associateId: id,
      rosterProgram: rosterProgramLabel,
      expectedTab: expectedTabs.join(', '),
      actualTab: Array.from(actualTabs).join(', '),
      strayTabs: strayTabs.join(', '),
      issue: `${id} (${name}) — Type 3 '${rosterProgramLabel}' requires ${expectedTabs.join(', ')} tab only, but billed on: ${strayTabs.join(', ')}`,
    });
  }

  // Pass 2 — billed but no Active roster row at all (manual verify), one flag per person.
  // Skip anyone entirely absent from the roster (no row at any status) — that's Check 8's job.
  for (const [id, actualTabs] of tabsByAssociate) {
    if (rosterById.has(id)) continue; // has an Active row — handled in pass 1
    if (!rosterAnyStatusIds.has(id)) continue; // absent from roster entirely — Check 8 owns it
    const name = nameByAssociate.get(id) ?? '';
    const tabsLabel = Array.from(actualTabs).join(', ');
    notActiveFlags.push({
      name,
      associateId: id,
      actualTab: tabsLabel,
      rosterProgram: '(not Active)',
      expectedTab: '(not Active)',
      issue: `${id} (${name}) — billed on ${tabsLabel} but not Active on FSM Roster — manual verify`,
    });
  }

  const allFlags = [...failures, ...notActiveFlags];
  const pass = allFlags.length === 0;
  return {
    checkId: 19,
    checkName: 'Roster Tab Placement',
    status: pass ? 'pass' : 'fail',
    stats: `${billedActiveCount} active associates billed checked, ${failures.length} on the wrong tab, ${notActiveFlags.length} billed but not Active`,
    flaggedCount: allFlags.length,
    flaggedRows: allFlags.slice(0, 200),
  };
}
