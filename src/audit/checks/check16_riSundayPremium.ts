// Check 16 — Rhode Island Sunday Premium Pay
// Rhode Island law requires premium pay for employees working on Sundays.
// Flag any FSM I or FSM II labor row where:
//   - The associate's state is Rhode Island (value may be "Rhode Island" or "RI")
//   - The visit date falls on a Sunday (getDay() === 0)
//
// This is a flag-for-review only — no rate calculation, no billing verification.
// Status is 'warning' (not 'fail') so Allan can do a manual rate adjustment.

import type { CheckResult, LaborRow } from '../types';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isRhodeIsland(state: string): boolean {
  const s = state.trim().toLowerCase();
  return s === 'rhode island' || s === 'ri';
}

function isSunday(date: Date): boolean {
  return date.getDay() === 0;
}

export function check16RiSundayPremium(fsmI: LaborRow[], fsmII: LaborRow[]): CheckResult {
  const flagged: Record<string, unknown>[] = [];

  const allRows = [
    ...fsmI.map((r) => ({ ...r, _tab: 'FSM I' as const })),
    ...fsmII.map((r) => ({ ...r, _tab: 'FSM II' as const })),
  ];

  for (const row of allRows) {
    if (!isRhodeIsland(row.associateState)) continue;
    if (!row.visitDate) continue;
    if (!isSunday(row.visitDate)) continue;

    flagged.push({
      name: row.employeeName,
      associateId: row.associateId,
      visitDate: row.visitDate.toLocaleDateString(),
      dayOfWeek: DAY_NAMES[row.visitDate.getDay()],
      state: row.associateState,
      hours: row.timeHours.toFixed(2),
      category: row.comments,
      tab: row._tab,
    });
  }

  const found = flagged.length > 0;
  return {
    checkId: 16,
    checkName: 'RI Sunday Premium Pay',
    status: found ? 'warning' : 'pass',
    stats: found
      ? `${flagged.length} row${flagged.length === 1 ? '' : 's'} flagged — RI Sunday entries require manual premium pay review`
      : 'No RI Sunday entries found',
    flaggedCount: flagged.length,
    flaggedRows: flagged,
  };
}
