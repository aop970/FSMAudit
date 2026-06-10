// Check 18 — Holiday Pay Validation
// Validates Paid Holiday rows against the per-program holiday schedule in AuditRules.holidays.
//
// Three sub-checks:
//   1. Wrong hours  — Paid Holiday row exists for a scheduled date but hours ≠ configured
//   2. Off schedule — Paid Holiday row exists for a date NOT in the schedule
//   3. Missing (FT) — FT employee visible in the period has no Paid Holiday row on a scheduled
//                     holiday date that falls within the audited period
//
// Returns status 'na' if the holiday schedule is empty AND no Paid Holiday rows are present.

import type { CheckResult, LaborRow } from '../types';
import { getAuditRules } from '../auditRules';

const TOLERANCE = 0.05;

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeType(comments: string): string {
  return comments.trim().toLowerCase();
}

export function check18Holidays(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
  program?: 'fsm' | 'ses',
): CheckResult {
  const allRows = [...fsmI, ...fsmII];
  const rules = getAuditRules(program);
  const holidaySchedule = rules.holidays ?? [];

  const paidHolidayRows = allRows.filter((r) => normalizeType(r.comments) === 'paid holiday');

  // N/A if no schedule configured and no Paid Holiday rows present
  if (holidaySchedule.length === 0 && paidHolidayRows.length === 0) {
    return {
      checkId: 18,
      checkName: 'Holiday Pay Validation',
      status: 'na',
      stats: 'No holiday schedule configured — skipped',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const holidayByDate = new Map<string, { hours: number; name: string }>();
  for (const h of holidaySchedule) {
    holidayByDate.set(h.date, { hours: h.hours, name: h.name });
  }

  // Determine audited period from min/max visitDate in all labor rows
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  for (const r of allRows) {
    if (!r.visitDate) continue;
    const dk = toDateKey(r.visitDate);
    if (periodStart === null || dk < periodStart) periodStart = dk;
    if (periodEnd === null || dk > periodEnd) periodEnd = dk;
  }

  const paidHolidayWrongHours: Record<string, unknown>[] = [];
  const paidHolidayOffSchedule: Record<string, unknown>[] = [];
  const paidHolidayMissingFt: Record<string, unknown>[] = [];

  // Validate individual Paid Holiday rows
  for (const r of paidHolidayRows) {
    if (!r.visitDate) continue; // date-range row — skip individual validation
    const dk = toDateKey(r.visitDate);
    const scheduled = holidayByDate.get(dk);

    if (!scheduled) {
      paidHolidayOffSchedule.push({
        section: 'Paid Holiday — Off Schedule',
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        date: dk,
        hours: r.timeHours,
        issue: `Paid Holiday on ${dk} is not in the configured holiday schedule.`,
      });
    } else if (Math.abs(r.timeHours - scheduled.hours) > TOLERANCE) {
      paidHolidayWrongHours.push({
        section: 'Paid Holiday — Wrong Hours',
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        date: dk,
        holidayName: scheduled.name,
        invoicedHours: r.timeHours,
        expectedHours: scheduled.hours,
        issue: `Paid Holiday hours ${r.timeHours} do not match configured ${scheduled.hours} for ${scheduled.name} (${dk}).`,
      });
    }
  }

  // Completeness: for each scheduled holiday within the audited period,
  // flag FT employees present in the data who have no Paid Holiday row on that date.
  let ftEmployeeCount = 0;
  let holidaysCheckedCount = 0;

  if (periodStart !== null && periodEnd !== null && holidaySchedule.length > 0) {
    // Build set of FT employees visible in the audited labor data
    const ftEmployees = new Set<string>();
    for (const r of allRows) {
      if (r.associateType.toUpperCase().trim() === 'FT') {
        ftEmployees.add(r.employeeName.toLowerCase());
      }
    }
    ftEmployeeCount = ftEmployees.size;

    // Build set of "employeeName.lower()|date" Paid Holiday rows that exist
    const paidHolidayCoverage = new Set<string>();
    for (const r of paidHolidayRows) {
      if (!r.visitDate) continue;
      paidHolidayCoverage.add(`${r.employeeName.toLowerCase()}|${toDateKey(r.visitDate)}`);
    }

    // FT employee → original casing for reporting
    const ftNameMap = new Map<string, string>();
    for (const r of allRows) {
      if (r.associateType.toUpperCase().trim() === 'FT') {
        ftNameMap.set(r.employeeName.toLowerCase(), r.employeeName);
      }
    }

    for (const holiday of holidaySchedule) {
      // Only flag holidays within the audited period
      if (holiday.date < periodStart || holiday.date > periodEnd) continue;
      holidaysCheckedCount++;

      for (const empLower of ftEmployees) {
        const coverageKey = `${empLower}|${holiday.date}`;
        if (!paidHolidayCoverage.has(coverageKey)) {
          paidHolidayMissingFt.push({
            section: 'Paid Holiday — Missing (FT)',
            name: ftNameMap.get(empLower) ?? empLower,
            date: holiday.date,
            holidayName: holiday.name,
            issue: `FT employee has no Paid Holiday row on ${holiday.date} (${holiday.name}).`,
          });
        }
      }
    }
  }

  const totalFails =
    paidHolidayWrongHours.length + paidHolidayOffSchedule.length + paidHolidayMissingFt.length;

  const allFlagged = [
    ...paidHolidayWrongHours,
    ...paidHolidayOffSchedule,
    ...paidHolidayMissingFt,
  ];

  // Build stats string
  const statParts: string[] = [];
  if (ftEmployeeCount > 0 && holidaysCheckedCount > 0) {
    statParts.push(`${ftEmployeeCount} FT employee${ftEmployeeCount === 1 ? '' : 's'} × ${holidaysCheckedCount} holiday${holidaysCheckedCount === 1 ? '' : 's'} checked`);
  }
  if (paidHolidayMissingFt.length > 0) {
    statParts.push(`${paidHolidayMissingFt.length} missing`);
  }
  if (paidHolidayWrongHours.length > 0) {
    statParts.push(`${paidHolidayWrongHours.length} wrong hours`);
  }
  if (paidHolidayOffSchedule.length > 0) {
    statParts.push(`${paidHolidayOffSchedule.length} off-schedule`);
  }

  let statsStr: string;
  if (statParts.length === 0) {
    if (paidHolidayRows.length > 0) {
      statsStr = `${paidHolidayRows.length} Paid Holiday row${paidHolidayRows.length === 1 ? '' : 's'} validated — no issues`;
    } else {
      statsStr = 'No Paid Holiday rows in period';
    }
  } else {
    statsStr = statParts.join(', ');
  }

  let status: CheckResult['status'];
  if (totalFails > 0) {
    status = 'fail';
  } else {
    status = 'pass';
  }

  return {
    checkId: 18,
    checkName: 'Holiday Pay Validation',
    status,
    stats: statsStr,
    flaggedCount: totalFails,
    flaggedRows: allFlagged,
    details: {
      wrongHours: paidHolidayWrongHours.length,
      offSchedule: paidHolidayOffSchedule.length,
      missingFt: paidHolidayMissingFt.length,
    },
  };
}
