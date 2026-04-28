// Check 12 — Time Off Validation
// Time off reports are the source of truth.
// Report entries are grouped by (associateId, date) so that two separate report
// entries on the same day (e.g. 2 hrs PSL + 5.08 hrs vacation = 7.08 hrs) are
// compared as a combined total against the sum of invoice time-off-comment rows.

import type { CheckResult, LaborRow, TimeOffRow } from '../types';

const TIME_OFF_KEYWORDS = ['time off', 'pto', 'paid time off', 'sick', 'bereavement', 'vacation', 'leave', 'holiday'];

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

function hasTimeOffComment(comment: string): boolean {
  const lower = comment.toLowerCase();
  return TIME_OFF_KEYWORDS.some((kw) => lower.includes(kw));
}

interface GroupedEntry {
  associateId: string;
  workerName: string;
  timeOffType: string;   // first type seen (for display)
  totalHours: number;    // SUM of all entries for this employee+date
  date: Date;
}

function groupByEmployeeDate(timeOffRows: TimeOffRow[]): GroupedEntry[] {
  const map = new Map<string, GroupedEntry>();
  for (const to of timeOffRows) {
    if (to.totalHours === 0) continue;
    const d = to.timeOffDate;
    const key = `${to.associateId.toUpperCase()}|${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalHours += to.totalHours;
    } else {
      map.set(key, {
        associateId: to.associateId,
        workerName: to.workerName,
        timeOffType: to.timeOffType,
        totalHours: to.totalHours,
        date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
      });
    }
  }
  return Array.from(map.values());
}

export function check12TimeOff(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
  timeOffRows: TimeOffRow[],
): CheckResult {
  if (timeOffRows.length === 0) {
    return {
      checkId: 12,
      checkName: 'Time Off Validation',
      status: 'na',
      stats: 'No time off reports uploaded — skipped',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const laborRows = [...fsmI, ...fsmII];
  const groups = groupByEmployeeDate(timeOffRows);
  const failures: Record<string, unknown>[] = [];

  for (const group of groups) {
    const idUpper = group.associateId.toUpperCase();

    // Invoice rows for this employee+date that carry a time-off comment
    const timeOffInvoiceRows = laborRows.filter((r) => {
      if (r.associateId.toUpperCase() !== idUpper) return false;
      if (!r.visitDate) return false;
      if (!sameDay(group.date, r.visitDate)) return false;
      return hasTimeOffComment(r.comments);
    });

    if (timeOffInvoiceRows.length === 0) {
      failures.push({
        associateId: group.associateId,
        name: group.workerName,
        date: group.date.toLocaleDateString(),
        reportHours: group.totalHours.toFixed(2),
        timeOffType: group.timeOffType,
        issue: 'No time off entry found on invoice for this date',
      });
      continue;
    }

    const invoiceTimeOffHrs = timeOffInvoiceRows.reduce((s, r) => s + r.timeHours, 0);

    if (Math.abs(invoiceTimeOffHrs - group.totalHours) > 0.01) {
      failures.push({
        associateId: group.associateId,
        name: group.workerName,
        date: group.date.toLocaleDateString(),
        invoiceTimeOffHours: invoiceTimeOffHrs.toFixed(2),
        reportHours: group.totalHours.toFixed(2),
        delta: (invoiceTimeOffHrs - group.totalHours).toFixed(2),
        timeOffType: group.timeOffType,
        issue: 'Time off hours mismatch: invoice vs report',
      });
    }
  }

  const pass = failures.length === 0;
  return {
    checkId: 12,
    checkName: 'Time Off Validation',
    status: pass ? 'pass' : 'fail',
    stats: `${groups.length} employee-day group${groups.length === 1 ? '' : 's'} checked (from ${timeOffRows.filter((r) => r.totalHours > 0).length} report entries), ${failures.length} issue${failures.length === 1 ? '' : 's'}`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
