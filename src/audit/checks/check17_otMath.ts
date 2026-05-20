// Check 17 — OT Math Validation
// Validates that invoiced OT hours match expected OT hours computed from eligible time.
//
// Eligible time types (count toward OT thresholds): Work, Travel, Training, Meeting, Admin
// Excluded time types (never count):                Time Off, Termed PTO, Bereavement Leave, Overtime
// Unrecognized time types: surfaced as a warning; excluded from OT calc until confirmed.
//
// Non-CA employees — Weekly OT (40h threshold, Mon-Sun weeks):
//   Sum eligible hours per employee per work week. If > 40, expected OT = eligible - 40.
//   Compare against invoiced Overtime hours for that employee/week.
//
// California employees — Daily OT (8h threshold per calendar date):
//   Pre-check: if any CA Overtime row has a date range instead of a single date -> HARD STOP.
//   For each CA employee, for each calendar day, sum eligible hours.
//   If > 8, expected daily OT = eligible - 8.
//   Compare against invoiced Overtime hours for that employee/date.
//
// Tolerance: +/-0.05 hours before flagging a fail.

import type { CheckResult, LaborRow } from '../types';

const TOLERANCE = 0.05;

const ELIGIBLE_TYPES = new Set([
  'work', 'travel', 'training', 'meeting', 'admin',
]);

const EXCLUDED_TYPES = new Set([
  'time off', 'termed pto', 'bereavement leave', 'overtime',
]);

function isCA(state: string): boolean {
  const s = state.trim().toLowerCase();
  return s === 'ca' || s === 'california';
}

function normalizeType(comments: string): string {
  return comments.trim().toLowerCase();
}

// Returns ISO week-start date key (Monday) for a given date: "YYYY-MM-DD"
function weekStartKey(d: Date): string {
  const day = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const diff = (day === 0 ? -6 : 1 - day); // offset to Monday
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function check17OtMath(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
): CheckResult {
  const allRows = [...fsmI, ...fsmII];

  if (allRows.length === 0) {
    return {
      checkId: 17,
      checkName: 'OT Math Validation',
      status: 'na',
      stats: 'No labor rows — skipped',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // ── Identify unrecognized time types ─────────────────────────────────────────

  const unrecognized = new Set<string>();

  for (const r of allRows) {
    const t = normalizeType(r.comments);
    // ca daily ot is a known special type — treat as excluded
    if (!ELIGIBLE_TYPES.has(t) && !EXCLUDED_TYPES.has(t) && t !== 'ca daily ot') {
      unrecognized.add(r.comments.trim() || '(blank)');
    }
  }

  // ── CA pre-check: detect date ranges in CA Overtime rows ─────────────────────
  // SheetJS cannot parse date range strings as Date objects; they parse as null.
  // Any CA Overtime row with a null visitDate is treated as a date range.

  const caOtRows = allRows.filter((r) => {
    const t = normalizeType(r.comments);
    return isCA(r.associateState) && (t === 'overtime' || t === 'ca daily ot');
  });

  const caOtRangeRows = caOtRows.filter((r) => r.visitDate === null);

  if (caOtRangeRows.length > 0) {
    return {
      checkId: 17,
      checkName: 'OT Math Validation',
      status: 'fail',
      stats: `CA OT rows contain date ranges — daily OT must be broken out by individual date before this check can run. ${caOtRangeRows.length} row${caOtRangeRows.length === 1 ? '' : 's'} affected.`,
      flaggedCount: caOtRangeRows.length,
      flaggedRows: caOtRangeRows.map((r) => ({
        section: 'Blocking Error — CA OT Date Ranges',
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        state: r.associateState,
        issue: 'CA OT rows contain date ranges — daily OT must be broken out by individual date before this check can run. Please correct and re-upload.',
      })),
      details: {
        blockingError: 'CA OT rows contain date ranges — daily OT must be broken out by individual date before this check can run. Please correct and re-upload.',
      },
    };
  }

  // ── Non-CA: weekly OT (40h threshold) ────────────────────────────────────────

  type WeekAccum = {
    employeeName: string;
    state: string;
    weekKey: string;
    eligibleHrs: number;
    invoicedOtHrs: number;
  };

  const nonCaWeekMap = new Map<string, WeekAccum>();

  for (const r of allRows) {
    if (isCA(r.associateState)) continue;
    if (!r.visitDate) continue;

    const t = normalizeType(r.comments);
    const wk = weekStartKey(r.visitDate);
    const mapKey = `${r.employeeName.toLowerCase()}|${wk}`;

    if (!nonCaWeekMap.has(mapKey)) {
      nonCaWeekMap.set(mapKey, {
        employeeName: r.employeeName,
        state: r.associateState,
        weekKey: wk,
        eligibleHrs: 0,
        invoicedOtHrs: 0,
      });
    }
    const entry = nonCaWeekMap.get(mapKey)!;

    if (ELIGIBLE_TYPES.has(t)) {
      entry.eligibleHrs += r.timeHours;
    } else if (t === 'overtime') {
      entry.invoicedOtHrs += r.timeHours;
    }
  }

  const nonCaFailures: Record<string, unknown>[] = [];

  for (const entry of nonCaWeekMap.values()) {
    const expectedOt = entry.eligibleHrs > 40 ? entry.eligibleHrs - 40 : 0;
    const diff = Math.abs(expectedOt - entry.invoicedOtHrs);
    if (diff > TOLERANCE) {
      nonCaFailures.push({
        section: 'OT Math Validation — Non-CA',
        employeeName: entry.employeeName,
        state: entry.state,
        week: entry.weekKey,
        expectedOtHrs: parseFloat(expectedOt.toFixed(2)),
        invoicedOtHrs: parseFloat(entry.invoicedOtHrs.toFixed(2)),
        eligibleHrs: parseFloat(entry.eligibleHrs.toFixed(2)),
        issue: expectedOt === 0 && entry.invoicedOtHrs > 0
          ? 'OT row exists but no OT expected'
          : entry.invoicedOtHrs === 0 && expectedOt > 0
          ? 'Expected OT but no OT row found'
          : 'OT hours mismatch',
      });
    }
  }

  // ── CA: daily OT (8h threshold) ───────────────────────────────────────────────

  type DayAccum = {
    employeeName: string;
    state: string;
    dk: string;
    eligibleHrs: number;
    invoicedOtHrs: number;
  };

  const caDayMap = new Map<string, DayAccum>();

  for (const r of allRows) {
    if (!isCA(r.associateState)) continue;
    if (!r.visitDate) continue;

    const t = normalizeType(r.comments);
    const dk = toDateKey(r.visitDate);
    const mapKey = `${r.employeeName.toLowerCase()}|${dk}`;

    if (!caDayMap.has(mapKey)) {
      caDayMap.set(mapKey, {
        employeeName: r.employeeName,
        state: r.associateState,
        dk,
        eligibleHrs: 0,
        invoicedOtHrs: 0,
      });
    }
    const entry = caDayMap.get(mapKey)!;

    if (ELIGIBLE_TYPES.has(t)) {
      entry.eligibleHrs += r.timeHours;
    } else if (t === 'overtime' || t === 'ca daily ot') {
      entry.invoicedOtHrs += r.timeHours;
    }
  }

  const caFailures: Record<string, unknown>[] = [];

  for (const entry of caDayMap.values()) {
    const expectedOt = entry.eligibleHrs > 8 ? entry.eligibleHrs - 8 : 0;
    const diff = Math.abs(expectedOt - entry.invoicedOtHrs);
    if (diff > TOLERANCE) {
      caFailures.push({
        section: 'OT Math Validation — CA Daily',
        employeeName: entry.employeeName,
        state: entry.state,
        date: entry.dk,
        expectedOtHrs: parseFloat(expectedOt.toFixed(2)),
        invoicedOtHrs: parseFloat(entry.invoicedOtHrs.toFixed(2)),
        eligibleHrs: parseFloat(entry.eligibleHrs.toFixed(2)),
        issue: expectedOt === 0 && entry.invoicedOtHrs > 0
          ? 'CA OT row exists but no OT expected'
          : entry.invoicedOtHrs === 0 && expectedOt > 0
          ? 'Expected CA daily OT but no OT row found'
          : 'CA daily OT hours mismatch',
      });
    }
  }

  // ── Build result ─────────────────────────────────────────────────────────────

  const totalFailures = nonCaFailures.length + caFailures.length;

  const nonCaEmployeeWeekCount = nonCaWeekMap.size;
  const caEmployeeDayCount = caDayMap.size;
  const totalChecked = nonCaEmployeeWeekCount + caEmployeeDayCount;

  // Warning prefix rows for unrecognized types (displayed before OT results)
  const warningRows: Record<string, unknown>[] = unrecognized.size > 0
    ? [{ section: 'Warning — Unrecognized Time Types', issue: `Unrecognized time types excluded from OT calculations: ${Array.from(unrecognized).join(', ')}` }]
    : [];

  const allFlagged = [...warningRows, ...nonCaFailures, ...caFailures];

  const parts: string[] = [];
  if (nonCaEmployeeWeekCount > 0) {
    parts.push(`${nonCaFailures.length} of ${nonCaEmployeeWeekCount} non-CA employee-week${nonCaEmployeeWeekCount === 1 ? '' : 's'} failed`);
  }
  if (caEmployeeDayCount > 0) {
    parts.push(`${caFailures.length} of ${caEmployeeDayCount} CA employee-day${caEmployeeDayCount === 1 ? '' : 's'} failed`);
  }
  if (totalChecked === 0) {
    parts.push('No dated labor rows found');
  }
  if (unrecognized.size > 0) {
    parts.push(`${unrecognized.size} unrecognized time type${unrecognized.size === 1 ? '' : 's'} warned`);
  }

  const statsStr = parts.join('; ') || 'No OT rows to validate';

  let status: CheckResult['status'];
  if (totalChecked === 0) {
    status = 'na';
  } else if (totalFailures > 0) {
    status = 'fail';
  } else if (unrecognized.size > 0) {
    status = 'warning';
  } else {
    status = 'pass';
  }

  return {
    checkId: 17,
    checkName: 'OT Math Validation',
    status,
    stats: statsStr,
    flaggedCount: totalFailures,
    flaggedRows: allFlagged.slice(0, 300),
    details: {
      nonCaSummary: nonCaEmployeeWeekCount > 0
        ? `${nonCaFailures.length} of ${nonCaEmployeeWeekCount} non-CA employee-week checks failed`
        : null,
      caSummary: caEmployeeDayCount > 0
        ? `${caFailures.length} of ${caEmployeeDayCount} CA employee-day checks failed`
        : null,
      unrecognizedTypes: unrecognized.size > 0 ? Array.from(unrecognized) : null,
    },
  };
}
