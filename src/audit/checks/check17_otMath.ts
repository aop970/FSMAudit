// Check 17 — OT Math Validation
// Validates that invoiced OT hours match expected OT hours computed from eligible time.
//
// Eligible time types (count toward OT thresholds): Work, Travel, Training, Meeting, Admin
// Excluded time types (never count):                Time Off, Termed PTO, Bereavement Leave, Overtime,
//                                                    CA Daily Overtime, CA Weekly Overtime,
//                                                    Puerto Rico Daily OT, Puerto Rico Weekly OT
// Unrecognized time types: surfaced as a warning; excluded from OT calc until confirmed.
//
// Non-CA employees — Weekly OT (40h threshold, Mon-Sun weeks):
//   Sum eligible hours per employee per work week. If > 40, expected OT = eligible - 40.
//   Compare against invoiced Overtime hours for that employee/week.
//
// California employees — Greater-of daily vs weekly OT:
//   Daily OT  = sum of max(0, eligibleHrsPerDay - 8) across all days in the week
//   Weekly OT = max(0, totalEligibleHrsInWeek - 40)
//   Correct OT = max(dailyOT, weeklyOT)
//
// Row label rules for CA OT rows:
//   "CA Daily Overtime"  — must have a single date (null visitDate → HARD STOP)
//   "CA Weekly Overtime" — date range is fine (null visitDate OK)
//   "Overtime"           — generic label on CA employee → WARNING, skip validation for that row
//
// Tolerance: +/-0.05 hours before flagging a fail.

import type { CheckResult, LaborRow } from '../types';

const TOLERANCE = 0.05;

const ELIGIBLE_TYPES = new Set([
  'work', 'travel', 'training', 'meeting', 'admin',
]);

const EXCLUDED_TYPES = new Set([
  'time off', 'termed pto', 'bereavement leave', 'overtime',
  'ca daily overtime', 'ca weekly overtime',
  'puerto rico daily ot', 'puerto rico weekly ot',
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

// Formats source rows as "TabName: rows 5, 12, 18; TabName2: rows 3, 9"
function formatLocation(sourceRows: { sheet: string; rowNum: number }[]): string {
  const grouped = new Map<string, Set<number>>();
  for (const sr of sourceRows) {
    if (!grouped.has(sr.sheet)) grouped.set(sr.sheet, new Set());
    grouped.get(sr.sheet)!.add(sr.rowNum);
  }
  return Array.from(grouped.entries())
    .map(([sheet, rows]) => `${sheet}: rows ${[...rows].sort((a, b) => a - b).join(', ')}`)
    .join('; ') || '(no rows tracked)';
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

  const unrecognizedTypeNames = new Set<string>();
  const unrecognizedRows: { sheet: string; rowNum: number; type: string }[] = [];
  const caGenericOtWarnings: Record<string, unknown>[] = [];

  for (const r of allRows) {
    const t = normalizeType(r.comments);
    if (!ELIGIBLE_TYPES.has(t) && !EXCLUDED_TYPES.has(t)) {
      // CA employee with generic "Overtime" label → warning (not unrecognized)
      if (isCA(r.associateState) && t === 'overtime') {
        caGenericOtWarnings.push({
          section: 'Warning — CA Generic OT Label',
          sheet: r.sheet,
          row: r.rowNum,
          employeeName: r.employeeName,
          state: r.associateState,
          issue: "CA OT row uses generic 'Overtime' label — cannot determine daily vs weekly basis. Validation skipped for this row.",
        });
      } else {
        const typeName = r.comments.trim() || '(blank)';
        unrecognizedTypeNames.add(typeName);
        unrecognizedRows.push({ sheet: r.sheet, rowNum: r.rowNum, type: typeName });
      }
    }
  }

  // ── CA pre-check: detect date ranges in "CA Daily Overtime" rows ─────────────
  // "CA Daily Overtime" must have a single date. null visitDate = date range = HARD STOP.
  // "CA Weekly Overtime" with null visitDate is fine.

  const caDailyOtRangeRows = allRows.filter((r) => {
    const t = normalizeType(r.comments);
    return isCA(r.associateState) && t === 'ca daily overtime' && r.visitDate === null;
  });

  if (caDailyOtRangeRows.length > 0) {
    return {
      checkId: 17,
      checkName: 'OT Math Validation',
      status: 'fail',
      stats: `CA Daily Overtime rows contain date ranges — exact dates required. ${caDailyOtRangeRows.length} row${caDailyOtRangeRows.length === 1 ? '' : 's'} affected.`,
      flaggedCount: caDailyOtRangeRows.length,
      flaggedRows: caDailyOtRangeRows.map((r) => ({
        section: 'Blocking Error — CA Daily OT Date Ranges',
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        state: r.associateState,
        issue: 'CA Daily Overtime rows contain date ranges — exact dates required. Please correct and re-upload.',
      })),
      details: {
        blockingError: 'CA Daily Overtime rows contain date ranges — exact dates required. Please correct and re-upload.',
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
    sourceRows: { sheet: string; rowNum: number }[];
  };

  const nonCaWeekMap = new Map<string, WeekAccum>();
  // Secondary index: "employeeName.lower()|weekNum" → weekKey (ISO Monday date string).
  // Used to match OT rows that carry a null visitDate (date-range rows) against the
  // correct employee-week bucket using the numeric "Week" column instead.
  const nonCaWeekNumIndex = new Map<string, string>();

  // Pass 1 — accumulate eligible hours (rows always have a visitDate).
  for (const r of allRows) {
    if (isCA(r.associateState)) continue;
    if (!r.visitDate) continue;

    const t = normalizeType(r.comments);
    if (!ELIGIBLE_TYPES.has(t)) continue;

    const wk = weekStartKey(r.visitDate);
    const mapKey = `${r.employeeName.toLowerCase()}|${wk}`;

    if (!nonCaWeekMap.has(mapKey)) {
      nonCaWeekMap.set(mapKey, {
        employeeName: r.employeeName,
        state: r.associateState,
        weekKey: wk,
        eligibleHrs: 0,
        invoicedOtHrs: 0,
        sourceRows: [],
      });
    }
    const entry = nonCaWeekMap.get(mapKey)!;
    entry.eligibleHrs += r.timeHours;
    entry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });

    // Record week-number → weekKey for this employee (so OT date-range rows can find us).
    if (r.week != null) {
      const numKey = `${r.employeeName.toLowerCase()}|${r.week}`;
      if (!nonCaWeekNumIndex.has(numKey)) nonCaWeekNumIndex.set(numKey, wk);
    }
  }

  // Pass 2 — accumulate invoiced OT hours.
  // OT rows on invoices often cover the full Mon–Sun week as a date range, which SheetJS
  // cannot parse as a Date object — those rows arrive with visitDate === null.
  // When visitDate is present, use it directly. When null, fall back to the numeric
  // "Week" column (r.week) to locate the correct employee-week bucket.
  for (const r of allRows) {
    if (isCA(r.associateState)) continue;
    const t = normalizeType(r.comments);
    if (t !== 'overtime') continue;

    let mapKey: string | null = null;

    if (r.visitDate) {
      // Single-date OT row — map directly.
      mapKey = `${r.employeeName.toLowerCase()}|${weekStartKey(r.visitDate)}`;
    } else if (r.week != null) {
      // Date-range OT row — resolve via the week-number index built in pass 1.
      const wk = nonCaWeekNumIndex.get(`${r.employeeName.toLowerCase()}|${r.week}`);
      if (wk) mapKey = `${r.employeeName.toLowerCase()}|${wk}`;
    }

    if (!mapKey) continue;

    if (!nonCaWeekMap.has(mapKey)) {
      // OT row exists but no eligible rows found for this employee-week — still track it
      // so the "OT row exists but no OT expected" failure is surfaced correctly.
      const wk = mapKey.split('|')[1];
      nonCaWeekMap.set(mapKey, {
        employeeName: r.employeeName,
        state: r.associateState,
        weekKey: wk,
        eligibleHrs: 0,
        invoicedOtHrs: 0,
        sourceRows: [],
      });
    }
    const entry = nonCaWeekMap.get(mapKey)!;
    entry.invoicedOtHrs += r.timeHours;
    entry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });
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
        location: formatLocation(entry.sourceRows),
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

  // ── CA: greater-of daily vs weekly OT ────────────────────────────────────────
  //
  // Step 1: Build per-employee, per-week accumulators.
  //   - Daily eligible: keyed by employee+date
  //   - Weekly eligible: keyed by employee+week
  //   - Invoiced OT: sum "CA Daily Overtime" + "CA Weekly Overtime" rows per employee+week
  //     (generic "Overtime" rows on CA employees are warned above and excluded here)

  type CaWeekAccum = {
    employeeName: string;
    state: string;
    weekKey: string;
    // eligible hours per calendar day within this week
    dailyEligible: Map<string, number>; // dateKey → hours
    totalEligibleHrs: number;
    invoicedOtHrs: number;
    sourceRows: { sheet: string; rowNum: number }[];
  };

  const caWeekMap = new Map<string, CaWeekAccum>();
  // "employeeName.lower()|weekNum" → weekKey (ISO Monday date string).
  // Used to match CA Weekly OT orphan rows (visitDate=null date-range) to the
  // correct employee-week bucket via the numeric "Week" column, exactly as
  // nonCaWeekNumIndex does for non-CA employees.
  const caWeekNumIndex = new Map<string, string>();

  for (const r of allRows) {
    if (!isCA(r.associateState)) continue;

    const t = normalizeType(r.comments);

    // Determine the week key. For CA Daily OT rows we must have visitDate (enforced above).
    // For CA Weekly OT rows, visitDate may be null — we skip them for eligible accumulation
    // but still need to count their hours toward invoiced OT.
    // For eligible time rows without a date, skip entirely.
    const hasDate = r.visitDate !== null;
    const wk = hasDate ? weekStartKey(r.visitDate!) : null;

    // ── Invoiced OT rows (CA Daily or CA Weekly, dated or date-range) ──────────
    if (t === 'ca daily overtime' || t === 'ca weekly overtime') {
      // For CA Weekly OT rows with no date, we can't determine the week key from the row.
      // We'll handle them separately using a best-effort approach: skip for now if no date.
      // (CA Daily rows always have dates after the pre-check above.)
      if (!wk) {
        // CA Weekly OT row with no date — we can't bin it to a week. Skip from per-week math.
        // (These rows have no visitDate so we can't map them to a week.)
        continue;
      }
      const mapKey = `${r.employeeName.toLowerCase()}|${wk}`;
      if (!caWeekMap.has(mapKey)) {
        caWeekMap.set(mapKey, {
          employeeName: r.employeeName,
          state: r.associateState,
          weekKey: wk,
          dailyEligible: new Map(),
          totalEligibleHrs: 0,
          invoicedOtHrs: 0,
          sourceRows: [],
        });
      }
      const caOtEntry = caWeekMap.get(mapKey)!;
      caOtEntry.invoicedOtHrs += r.timeHours;
      caOtEntry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });
      continue;
    }

    // Generic "Overtime" on CA employee already warned — skip
    if (t === 'overtime') continue;

    // Eligible time — must have a date
    if (!wk || !hasDate) continue;
    if (!ELIGIBLE_TYPES.has(t)) continue;

    const mapKey = `${r.employeeName.toLowerCase()}|${wk}`;
    if (!caWeekMap.has(mapKey)) {
      caWeekMap.set(mapKey, {
        employeeName: r.employeeName,
        state: r.associateState,
        weekKey: wk,
        dailyEligible: new Map(),
        totalEligibleHrs: 0,
        invoicedOtHrs: 0,
        sourceRows: [],
      });
    }
    const entry = caWeekMap.get(mapKey)!;
    const dk = toDateKey(r.visitDate!);
    entry.dailyEligible.set(dk, (entry.dailyEligible.get(dk) ?? 0) + r.timeHours);
    entry.totalEligibleHrs += r.timeHours;
    entry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });

    if (r.week != null) {
      const numKey = `${r.employeeName.toLowerCase()}|${r.week}`;
      if (!caWeekNumIndex.has(numKey)) caWeekNumIndex.set(numKey, wk);
    }
  }

  // Handle CA Weekly OT rows with no visitDate — try to match to existing employee+week buckets
  // by finding a week bucket for that employee (heuristic: if only one week, assign there).
  // Collect them first, then assign.
  const caWeeklyOtOrphans: LaborRow[] = [];
  for (const r of allRows) {
    if (!isCA(r.associateState)) continue;
    const t = normalizeType(r.comments);
    if (t === 'ca weekly overtime' && r.visitDate === null) {
      caWeeklyOtOrphans.push(r);
    }
  }

  if (caWeeklyOtOrphans.length > 0) {
    for (const r of caWeeklyOtOrphans) {
      const empKey = r.employeeName.toLowerCase();
      let mapKey: string | null = null;

      // Primary: use the numeric Week column to find the correct bucket.
      if (r.week != null) {
        const wk = caWeekNumIndex.get(`${empKey}|${r.week}`);
        if (wk) mapKey = `${empKey}|${wk}`;
      }

      // Fallback: if exactly one week bucket exists for this employee, assign there.
      if (!mapKey) {
        const empEntries = Array.from(caWeekMap.entries()).filter(([k]) => k.startsWith(empKey + '|'));
        if (empEntries.length === 1) mapKey = empEntries[0][0];
      }

      if (mapKey) {
        if (!caWeekMap.has(mapKey)) {
          const wkPart = mapKey.split('|')[1];
          caWeekMap.set(mapKey, {
            employeeName: r.employeeName,
            state: r.associateState,
            weekKey: wkPart,
            dailyEligible: new Map(),
            totalEligibleHrs: 0,
            invoicedOtHrs: 0,
            sourceRows: [],
          });
        }
        const orphanEntry = caWeekMap.get(mapKey)!;
        orphanEntry.invoicedOtHrs += r.timeHours;
        orphanEntry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });
      } else {
        // Cannot determine week — create sentinel bucket so it surfaces as an anomaly.
        const sentinelKey = `${empKey}|(unknown)`;
        if (!caWeekMap.has(sentinelKey)) {
          caWeekMap.set(sentinelKey, {
            employeeName: r.employeeName,
            state: r.associateState,
            weekKey: '(unknown)',
            dailyEligible: new Map(),
            totalEligibleHrs: 0,
            invoicedOtHrs: 0,
            sourceRows: [],
          });
        }
        const sentinelEntry = caWeekMap.get(sentinelKey)!;
        sentinelEntry.invoicedOtHrs += r.timeHours;
        sentinelEntry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });
      }
    }
  }

  const caFailures: Record<string, unknown>[] = [];

  for (const entry of caWeekMap.values()) {
    // Calculate daily OT: sum max(0, dailyHrs - 8) per day
    let caDailyOt = 0;
    for (const hrs of entry.dailyEligible.values()) {
      if (hrs > 8) caDailyOt += hrs - 8;
    }

    const caWeeklyOt = entry.totalEligibleHrs > 40 ? entry.totalEligibleHrs - 40 : 0;
    const correctOt = Math.max(caDailyOt, caWeeklyOt);
    const otBasis = caDailyOt >= caWeeklyOt ? 'CA Daily OT' : 'CA Weekly OT';

    const diff = Math.abs(correctOt - entry.invoicedOtHrs);
    if (diff > TOLERANCE) {
      let status: string;
      if (entry.invoicedOtHrs > correctOt + TOLERANCE) {
        status = 'OVER-BILLED';
      } else if (entry.invoicedOtHrs < correctOt - TOLERANCE) {
        status = 'UNDER-BILLED';
      } else {
        status = 'MATCH';
      }

      caFailures.push({
        section: 'OT Math Validation — CA',
        employeeName: entry.employeeName,
        state: entry.state,
        week: entry.weekKey,
        location: formatLocation(entry.sourceRows),
        otBasis,
        caDailyOtHrs: parseFloat(caDailyOt.toFixed(2)),
        caWeeklyOtHrs: parseFloat(caWeeklyOt.toFixed(2)),
        correctOtHrs: parseFloat(correctOt.toFixed(2)),
        invoicedOtHrs: parseFloat(entry.invoicedOtHrs.toFixed(2)),
        status,
        issue: correctOt === 0 && entry.invoicedOtHrs > 0
          ? 'CA OT row exists but no OT expected'
          : entry.invoicedOtHrs === 0 && correctOt > 0
          ? `Expected CA OT (${otBasis}) but no OT row found`
          : `CA OT hours mismatch (${otBasis})`,
      });
    }
  }

  // ── Build result ─────────────────────────────────────────────────────────────

  const totalFailures = nonCaFailures.length + caFailures.length;

  const nonCaEmployeeWeekCount = nonCaWeekMap.size;
  const caEmployeeWeekCount = caWeekMap.size;
  const totalChecked = nonCaEmployeeWeekCount + caEmployeeWeekCount;

  // Warning rows for unrecognized types — one row per occurrence with sheet/row info
  const unrecognizedWarningRows: Record<string, unknown>[] = unrecognizedRows.map((r) => ({
    section: 'Warning — Unrecognized Time Type',
    sheet: r.sheet,
    row: r.rowNum,
    type: r.type,
    issue: 'Unrecognized time type — excluded from OT calculations until confirmed.',
  }));

  const allFlagged = [
    ...unrecognizedWarningRows,
    ...caGenericOtWarnings,
    ...nonCaFailures,
    ...caFailures,
  ];

  const parts: string[] = [];
  if (nonCaEmployeeWeekCount > 0) {
    parts.push(`${nonCaFailures.length} of ${nonCaEmployeeWeekCount} non-CA employee-week${nonCaEmployeeWeekCount === 1 ? '' : 's'} failed`);
  }
  if (caEmployeeWeekCount > 0) {
    parts.push(`${caFailures.length} of ${caEmployeeWeekCount} CA employee-week${caEmployeeWeekCount === 1 ? '' : 's'} failed`);
  }
  if (totalChecked === 0) {
    parts.push('No dated labor rows found');
  }
  if (unrecognizedTypeNames.size > 0) {
    parts.push(`${unrecognizedTypeNames.size} unrecognized time type${unrecognizedTypeNames.size === 1 ? '' : 's'} warned`);
  }
  if (caGenericOtWarnings.length > 0) {
    parts.push(`${caGenericOtWarnings.length} CA generic OT row${caGenericOtWarnings.length === 1 ? '' : 's'} warned`);
  }

  const statsStr = parts.join('; ') || 'No OT rows to validate';

  let status: CheckResult['status'];
  if (totalChecked === 0) {
    status = 'na';
  } else if (totalFailures > 0) {
    status = 'fail';
  } else if (unrecognizedTypeNames.size > 0 || caGenericOtWarnings.length > 0) {
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
      caSummary: caEmployeeWeekCount > 0
        ? `${caFailures.length} of ${caEmployeeWeekCount} CA employee-week checks failed`
        : null,
      unrecognizedTypes: unrecognizedTypeNames.size > 0 ? Array.from(unrecognizedTypeNames) : null,
    },
  };
}
