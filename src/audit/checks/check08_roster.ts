// Check 8 — Roster Validation
// Unique employees (Name + Associate ID) from FSM I + FSM II must appear
// in Roster or Roster II. Flag missing employees with Name and Associate ID.

import type { CheckResult, LaborRow, RosterEntry } from '../types';
import { toStr } from '../../lib/num';

export function check08Roster(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
  rosterEntries: RosterEntry[],
): CheckResult {
  const rosterIds = new Set(
    rosterEntries.map((r) => toStr(r.associateId).toUpperCase()),
  );

  // Unique by associate ID from labor sheets
  const laborById = new Map<string, { name: string; totalHrs: number }>();
  for (const r of [...fsmI, ...fsmII]) {
    const id = toStr(r.associateId).toUpperCase();
    if (!id) continue;
    const existing = laborById.get(id);
    if (existing) {
      existing.totalHrs += r.timeHours;
    } else {
      laborById.set(id, { name: r.employeeName, totalHrs: r.timeHours });
    }
  }

  const failures: Record<string, unknown>[] = [];
  for (const [id, info] of laborById) {
    if (!rosterIds.has(id)) {
      failures.push({
        name: info.name,
        associateId: id,
        totalHours: info.totalHrs.toFixed(2),
        issue: 'Not found in Roster or Roster II',
      });
    }
  }

  const pass = failures.length === 0;
  return {
    checkId: 8,
    checkName: 'Roster Validation',
    status: pass ? 'pass' : 'fail',
    stats: `${laborById.size} unique employees in labor, ${rosterEntries.length} roster entries, ${failures.length} not found`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
