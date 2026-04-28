// Check 11 — Date Range Validation
// All visit dates in FSM I and FSM II labor rows must fall within the declared
// period range from E14 of the first tab. Rows with null dates are skipped.

import type { CheckResult, LaborRow } from '../types';

export function check11DateRange(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
  declaredPeriod: { start: Date; end: Date } | null,
): CheckResult {
  if (!declaredPeriod) {
    return {
      checkId: 11,
      checkName: 'Date Range Validation',
      status: 'na',
      stats: 'No date range found in E14 of first tab — skipped',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const { start, end } = declaredPeriod;
  // Normalize to midnight for comparison
  const rangeStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const rangeEnd   = new Date(end.getFullYear(),   end.getMonth(),   end.getDate());

  const failures: Record<string, unknown>[] = [];

  for (const r of [...fsmI, ...fsmII]) {
    if (!r.visitDate) continue;
    const d = new Date(r.visitDate.getFullYear(), r.visitDate.getMonth(), r.visitDate.getDate());
    if (d < rangeStart || d > rangeEnd) {
      failures.push({
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        visitDate: r.visitDate.toLocaleDateString(),
        rangeStart: rangeStart.toLocaleDateString(),
        rangeEnd: rangeEnd.toLocaleDateString(),
        issue: 'Visit date outside declared pay period',
      });
    }
  }

  const total = [...fsmI, ...fsmII].filter(r => r.visitDate !== null).length;
  const pass = failures.length === 0;
  return {
    checkId: 11,
    checkName: 'Date Range Validation',
    status: pass ? 'pass' : 'fail',
    stats: `${total} dated rows checked against ${rangeStart.toLocaleDateString()} – ${rangeEnd.toLocaleDateString()}, ${failures.length} out of range`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
