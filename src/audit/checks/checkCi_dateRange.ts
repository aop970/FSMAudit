// checkCi_dateRange.ts — Check 11 for CI program
// Every Detail row date must fall within Activity Dates range.
// Confirm all 4 weeks (W19-W22 for this cycle) are represented — at least 4 distinct week numbers.

import type { CheckResult, CiDetailRow, CiCoverMeta } from '../types';

export function checkCiDateRange(
  detailRows: CiDetailRow[],
  coverMeta: CiCoverMeta,
): CheckResult {
  const periodStart = coverMeta.activityDateStart;
  const periodEnd = coverMeta.activityDateEnd;

  if (!periodStart || !periodEnd) {
    return {
      checkId: 11,
      checkName: 'Date Range',
      status: 'warning',
      stats: 'Activity date range not found in cover — date range check skipped',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const rangeStart = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate());
  const rangeEnd   = new Date(periodEnd.getFullYear(),   periodEnd.getMonth(),   periodEnd.getDate());

  const failures: Record<string, unknown>[] = [];
  const weekNumbers = new Set<number>();

  for (const r of detailRows) {
    if (!r.visitDate) continue;
    const d = new Date(r.visitDate.getFullYear(), r.visitDate.getMonth(), r.visitDate.getDate());

    if (d < rangeStart || d > rangeEnd) {
      failures.push({
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        associateId: r.associateId,
        visitDate: r.visitDate.toLocaleDateString(),
        rangeStart: rangeStart.toLocaleDateString(),
        rangeEnd: rangeEnd.toLocaleDateString(),
        issue: 'Visit date outside declared activity date range',
      });
    }

    if (r.week !== null) {
      weekNumbers.add(r.week);
    }
  }

  const totalDated = detailRows.filter((r) => r.visitDate !== null).length;
  const weeksArray = Array.from(weekNumbers).sort((a, b) => a - b);
  const weeksCovered = weeksArray.length;

  // Warn if fewer than 4 distinct weeks are represented
  const weekWarning = weeksCovered < 4 && totalDated > 0
    ? ` — WARNING: only ${weeksCovered} distinct week${weeksCovered === 1 ? '' : 's'} represented (expected ≥ 4)`
    : '';

  const hasOutOfRange = failures.length > 0;
  const hasWeekWarning = weeksCovered < 4 && totalDated > 0;
  const status = hasOutOfRange ? 'fail' : hasWeekWarning ? 'warning' : 'pass';

  const statsBase = `${totalDated} dated rows checked against ${rangeStart.toLocaleDateString()} – ${rangeEnd.toLocaleDateString()}, ${failures.length} out of range`;

  return {
    checkId: 11,
    checkName: 'Date Range',
    status,
    stats: statsBase + weekWarning,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
    details: {
      rangeStart: rangeStart.toLocaleDateString(),
      rangeEnd: rangeEnd.toLocaleDateString(),
      weeksCovered: weeksArray,
      totalDated,
      outOfRangeCount: failures.length,
    },
  };
}
