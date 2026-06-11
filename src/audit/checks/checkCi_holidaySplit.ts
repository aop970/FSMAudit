// checkCi_holidaySplit.ts — Check 4 for CI program
// Holiday billing split by billing format:
// - Monthly/Salaried → holiday IS billed (OK at standard configured hours; flag wrong hours or wrong rate)
// - Hourly → holiday billed ONLY if Activity report shows worked hours that day
//            Un-worked holiday billed → FAIL
//            No Activity → skip hourly holiday check (conservative)

import type { CheckResult, CiDetailRow, CiActivityRow, CiControlEntry, CiCoverMeta } from '../types';
import { getAuditRules } from '../auditRules';

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseHolidayDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function checkCiHolidaySplit(
  detailRows: CiDetailRow[],
  activityRows: CiActivityRow[],
  ciControlMap: Map<string, CiControlEntry>,
  coverMeta: CiCoverMeta,
): CheckResult {
  const rules = getAuditRules('ci');
  const tolerance = rules.tolerances.hours;
  const hasActivity = activityRows.length > 0;

  // Determine period from coverMeta
  const periodStart = coverMeta.activityDateStart;
  const periodEnd = coverMeta.activityDateEnd;

  if (!periodStart || !periodEnd) {
    return {
      checkId: 4,
      checkName: 'Holiday Billing (Format Split)',
      status: 'warning',
      stats: 'Activity date range not found in cover — holiday check skipped',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // Filter holidays within the billing period
  const holidaysInPeriod = rules.holidays.filter((h) => {
    const hd = parseHolidayDate(h.date);
    return hd >= periodStart && hd <= periodEnd;
  });

  if (holidaysInPeriod.length === 0) {
    return {
      checkId: 4,
      checkName: 'Holiday Billing (Format Split)',
      status: 'pass',
      stats: 'No holidays fall within the billing period',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // Build activity hours map: (associateId|dateKey) → total activity hours
  const activityMap = new Map<string, number>();
  for (const r of activityRows) {
    if (!r.visitDate) continue;
    const key = `${r.associateId}|${dateKey(r.visitDate)}`;
    activityMap.set(key, (activityMap.get(key) ?? 0) + r.timeHours);
  }

  const failures: Record<string, unknown>[] = [];
  const warnings: Record<string, unknown>[] = [];

  for (const holiday of holidaysInPeriod) {
    const holidayDate = parseHolidayDate(holiday.date);
    const hKey = dateKey(holidayDate);

    // Find all detail rows on this holiday date
    const rowsOnHoliday = detailRows.filter(
      (r) => r.visitDate && dateKey(r.visitDate) === hKey,
    );

    for (const r of rowsOnHoliday) {
      const entry = ciControlMap.get(r.associateId);
      const billFormat = entry?.billFormat ?? r.layoutType;

      if (billFormat === 'Monthly') {
        // Monthly: flag only if hours ≠ configured holiday hours
        if (Math.abs(r.timeHours - holiday.hours) > tolerance) {
          warnings.push({
            associateId: r.associateId,
            employeeName: r.employeeName,
            date: hKey,
            holidayName: holiday.name,
            billFormat: 'Monthly',
            invoicedHours: r.timeHours.toFixed(2),
            expectedHours: holiday.hours.toFixed(2),
            issue: `Monthly associate holiday hours mismatch — expected ${holiday.hours}h for ${holiday.name}`,
          });
        }
      } else {
        // Hourly: holiday billed only if worked.
        // If hours = 0 the associate was correctly zeroed out — no flag needed.
        if (r.timeHours <= 0) continue;

        if (!hasActivity) {
          // No activity file — conservative warning, not fail
          warnings.push({
            associateId: r.associateId,
            employeeName: r.employeeName,
            date: hKey,
            holidayName: holiday.name,
            billFormat: 'Hourly',
            invoicedHours: r.timeHours.toFixed(2),
            issue: `Hourly associate billed on holiday ${holiday.name} — no Activity file uploaded to verify`,
          });
        } else {
          const activityKey = `${r.associateId}|${hKey}`;
          const activityHours = activityMap.get(activityKey) ?? 0;
          if (activityHours <= 0) {
            failures.push({
              associateId: r.associateId,
              employeeName: r.employeeName,
              date: hKey,
              holidayName: holiday.name,
              billFormat: 'Hourly',
              invoicedHours: r.timeHours.toFixed(2),
              activityHours: '0.00',
              issue: `Hourly associate billed unworked holiday: ${holiday.name} — no activity hours found`,
            });
          }
          // else: worked it, billing is correct — no flag
        }
      }
    }

    // Check Monthly associates with no detail row on holiday date (warning only)
    if (rowsOnHoliday.length === 0) {
      // Look for any Monthly associate with rows in the same week but no holiday row
      const holidayWeek = holiday.date; // just informational
      const monthlyAssociates = new Set<string>();
      for (const r of detailRows) {
        const entry = ciControlMap.get(r.associateId);
        const billFormat = entry?.billFormat ?? r.layoutType;
        if (billFormat === 'Monthly') {
          monthlyAssociates.add(r.associateId);
        }
      }
      if (monthlyAssociates.size > 0) {
        // Only warn if this is a notable holiday (8h standard days)
        if (holiday.hours >= 8) {
          warnings.push({
            date: hKey,
            holidayName: holiday.name,
            issue: `No detail rows found on ${holiday.name} (${holidayWeek}) — Monthly associates may have bundled billing`,
            monthlyAssociateCount: monthlyAssociates.size,
          });
        }
      }
    }
  }

  const allFlags = [...failures, ...warnings];
  let status: 'pass' | 'fail' | 'warning';
  if (failures.length > 0) {
    status = 'fail';
  } else if (warnings.length > 0) {
    status = 'warning';
  } else {
    status = 'pass';
  }

  return {
    checkId: 4,
    checkName: 'Holiday Billing (Format Split)',
    status,
    stats: status === 'pass'
      ? `${holidaysInPeriod.length} holiday${holidaysInPeriod.length === 1 ? '' : 's'} in period — all holiday billing correct`
      : `${holidaysInPeriod.length} holiday${holidaysInPeriod.length === 1 ? '' : 's'} in period — ${failures.length} failure${failures.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
    flaggedCount: allFlags.length,
    flaggedRows: allFlags.slice(0, 200),
  };
}
