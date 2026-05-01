// Check 18 (SES) — Payroll Tag Exception Validation
// Exception rows (Payroll Tag contains "EXC") must have dates within the billing period.
// Payroll Tag format: "2020_PAYROLL_YYYYMMDD" or "2020_PAYROLL_YYYYMMDD_EXC_..."
// The date portion is the 3rd underscore-separated segment (index 2).
// Valid period dates are derived from all non-EXC payroll tags in the punch file.
// Flag any EXC row whose tag date doesn't match one of the two billing period dates.

import type { CheckResult, SesPunchRow } from '../types';

function extractTagDate(tag: string): string | null {
  // Segment at index 2 after splitting on "_" — e.g. "2020_PAYROLL_20260301_EXC_..."
  const parts = tag.split('_');
  if (parts.length < 3) return null;
  const datePart = parts[2];
  // Must be 8 digits YYYYMMDD
  return /^\d{8}$/.test(datePart) ? datePart : null;
}

export function checkSesPayrollTag(
  punchRows: SesPunchRow[],
  _declaredPeriod: { start: Date; end: Date } | null,
): CheckResult {
  if (punchRows.length === 0) {
    return {
      checkId: 18,
      checkName: 'Payroll Tag Exceptions',
      status: 'na',
      stats: 'No punch rows uploaded — skipped',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // Collect valid period dates from non-EXC tags
  const validDates = new Set<string>();
  for (const r of punchRows) {
    const tag = r.payrollTag ?? '';
    if (!tag.includes('EXC')) {
      const d = extractTagDate(tag);
      if (d) validDates.add(d);
    }
  }

  if (validDates.size === 0) {
    return {
      checkId: 18,
      checkName: 'Payroll Tag Exceptions',
      status: 'warning',
      stats: 'No non-EXC payroll tags found — cannot determine valid billing period dates',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // Flag EXC rows whose tag date is not in the valid set
  const excRows = punchRows.filter((r) => (r.payrollTag ?? '').includes('EXC'));
  const flagged = excRows.filter((r) => {
    const d = extractTagDate(r.payrollTag ?? '');
    if (!d) return true; // malformed tag — flag it
    return !validDates.has(d);
  });

  const validDatesDisplay = Array.from(validDates).sort().join(', ');

  return {
    checkId: 18,
    checkName: 'Payroll Tag Exceptions',
    status: flagged.length === 0 ? 'pass' : 'fail',
    stats: flagged.length === 0
      ? `${excRows.length} EXC row${excRows.length === 1 ? '' : 's'} verified — all within billing period dates (${validDatesDisplay})`
      : `${flagged.length} EXC row${flagged.length === 1 ? '' : 's'} have dates outside billing period (${validDatesDisplay})`,
    flaggedCount: flagged.length,
    flaggedRows: flagged.map((r) => ({
      rowNum: r.rowNum,
      employeeName: r.employeeName,
      associateId: r.associateId,
      payrollTag: r.payrollTag,
      tagDate: extractTagDate(r.payrollTag ?? '') ?? 'malformed',
      validPeriodDates: validDatesDisplay,
      issue: `EXC tag date not in billing period — expected one of: ${validDatesDisplay}`,
    })),
  };
}
