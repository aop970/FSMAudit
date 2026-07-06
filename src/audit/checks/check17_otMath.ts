// Check 17 — OT Math Validation
// Validates that invoiced OT hours match expected OT hours computed from eligible time.
// Paid Holiday validation has been moved to Check 18 (check18_holidays.ts).
//
// Eligible time types (OT-counting): driven by punchCategories.supported in AuditRules.
// Excluded time types (non-counting): driven by punchCategories.exceptions in AuditRules.
//
// ⚠️  BREAK BEHAVIOR CHANGE: punchCategories.supported now includes "Break" by default.
//     The old hardcoded ELIGIBLE_TYPES did NOT include break. Wiring to config means Break
//     NOW COUNTS toward OT thresholds. If Break should not count, remove it from
//     Punch Categories → Supported in the Settings panel.
//
// OT row labels are engine-level constants (not configurable):
//   "Overtime"                — generic label (non-CA/PR weekly OT)
//   "CA Daily Overtime"       — CA daily OT row (must have single date)
//   "CA Weekly Overtime"      — CA weekly OT row (date range OK)
//   "Puerto Rico Daily Overtime" / "Puerto Rico Daily OT" / "PR Daily Overtime" / "PR Daily OT"
//   "Puerto Rico Weekly Overtime" / "Puerto Rico Weekly OT" / "PR Weekly Overtime" / "PR Weekly OT"
//   "RI Sunday Premium Pay"   — RI retail Sunday premium (non-CA/PR only)
//
// Non-CA/PR employees — Weekly OT (40h threshold, Mon-Sun weeks):
//   Sum eligible hours per employee per work week. If > 40, expected OT = eligible - 40.
//
//   RI RETAIL SUNDAY EXCLUSION (§ 28-12-4.1(b)):
//   Sunday hours are EXCLUDED from the weekly OT base. No hour carries two premiums.
//     expectedOt = max(0, (totalEligibleHrs − sundayRiEligibleHrs) − 40)
//     invoicedRiPremHrs must ≈ sundayRiEligibleHrs (±0.05)
//   Both assertions are independent. For non-RI weeks sundayRiEligibleHrs = 0 and
//   assertion (a) collapses to the existing OT check unchanged.
//
// California AND Puerto Rico employees — Greater-of daily vs weekly OT:
//   Daily OT  = sum of max(0, eligibleHrsPerDay - 8) across all days in the week
//   Weekly OT = max(0, totalEligibleHrsInWeek - 40)
//   Correct OT = max(dailyOT, weeklyOT)
//
// PR OT row labels:
//   "Puerto Rico Daily Overtime" / "Puerto Rico Daily OT" / "PR Daily Overtime" / "PR Daily OT"  — must have single date (HARD STOP if null)
//   "Puerto Rico Weekly Overtime" / "Puerto Rico Weekly OT" / "PR Weekly Overtime" / "PR Weekly OT" — date range OK
//   generic "Overtime" on PR employee → same "generic OT label" warning as CA
//
// Tolerance: +/-0.05 hours before flagging a fail.

import type { CheckResult, LaborRow } from '../types';
import { getAuditRules } from '../auditRules';
import { isRhodeIsland } from './check16_riSundayPremium';

const TOLERANCE = 0.05;
// RI retail Sunday exclusion assertions use a tighter spec tolerance (±0.01, note 41 /
// DL-2026-0706b). Applied to assertion (b) always, and to assertion (a) only when the
// Sunday exclusion is active — non-RI weeks retain the existing ±0.05 OT-math tolerance
// so no v1 employee-week regresses ("collapses to the existing check unchanged").
const RI_TOLERANCE = 0.01;

// ── State classifiers ─────────────────────────────────────────────────────────

function isCA(state: string): boolean {
  const s = state.trim().toLowerCase();
  return s === 'ca' || s === 'california';
}

function isPR(state: string): boolean {
  const s = state.trim().toLowerCase();
  return s === 'pr' || s === 'puerto rico';
}

/** Returns true for states that use daily+weekly greater-of OT (CA and PR). */
function isDailyOtState(state: string): boolean {
  return isCA(state) || isPR(state);
}

// ── OT label classifiers ──────────────────────────────────────────────────────

function normalizeType(comments: string): string {
  return comments.trim().toLowerCase();
}

/** Matches both "...overtime" and "...ot" forms for CA/PR daily/weekly OT rows. */
function isCaDailyOt(t: string): boolean {
  return t === 'ca daily overtime' || t === 'ca daily ot';
}

function isCaWeeklyOt(t: string): boolean {
  return t === 'ca weekly overtime' || t === 'ca weekly ot';
}

function isPrDailyOt(t: string): boolean {
  return t === 'puerto rico daily overtime' || t === 'puerto rico daily ot' || t === 'pr daily overtime' || t === 'pr daily ot';
}

function isPrWeeklyOt(t: string): boolean {
  return t === 'puerto rico weekly overtime' || t === 'puerto rico weekly ot' || t === 'pr weekly overtime' || t === 'pr weekly ot';
}

function isRiSundayPremium(t: string): boolean {
  return t === 'ri sunday premium pay';
}

/** True if this is any recognized OT-row label (engine level — not in eligible/excluded config). */
function isOtRowLabel(t: string): boolean {
  return t === 'overtime' || isCaDailyOt(t) || isCaWeeklyOt(t)
      || isPrDailyOt(t) || isPrWeeklyOt(t) || isRiSundayPremium(t);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

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

function isSunday(d: Date): boolean {
  return d.getDay() === 0;
}

// ── Formatting ────────────────────────────────────────────────────────────────

// Formats location as unique tab/sheet name(s) — e.g. "FSM I" or "FSM I; FSM II"
function formatLocation(sourceRows: { sheet: string; rowNum: number }[]): string {
  const sheets = [...new Set(sourceRows.map((sr) => sr.sheet))];
  return sheets.join('; ') || '(no rows tracked)';
}

// ── Main export ───────────────────────────────────────────────────────────────

export function check17OtMath(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
  program?: 'fsm' | 'ses',
): CheckResult {
  const allRows = [...fsmI, ...fsmII];
  const rules = getAuditRules(program);

  // Build eligible/excluded sets from config (normalized lowercase).
  // OT row labels are engine-level and NOT sourced from punchCategories.
  const configEligible = new Set(rules.punchCategories.supported.map((s) => s.trim().toLowerCase()));
  const configExcluded = new Set(rules.punchCategories.exceptions.map((s) => s.trim().toLowerCase()));

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
  const genericOtWarnings: Record<string, unknown>[] = [];

  for (const r of allRows) {
    const t = normalizeType(r.comments);
    // OT row labels are handled by the engine — skip classification check
    if (isOtRowLabel(t)) {
      // Generic "Overtime" on a daily-OT-state employee → warning
      if (t === 'overtime' && isDailyOtState(r.associateState)) {
        const stateLabel = isCA(r.associateState) ? 'CA' : 'PR';
        genericOtWarnings.push({
          section: `Warning — ${stateLabel} Generic OT Label`,
          sheet: r.sheet,
          row: r.rowNum,
          employeeName: r.employeeName,
          state: r.associateState,
          issue: `${stateLabel} OT row uses generic 'Overtime' label — cannot determine daily vs weekly basis. Validation skipped for this row.`,
        });
      }
      continue;
    }
    // Eligible or excluded via config — recognized
    if (configEligible.has(t) || configExcluded.has(t)) continue;
    // Truly unrecognized
    const typeName = r.comments.trim() || '(blank)';
    unrecognizedTypeNames.add(typeName);
    unrecognizedRows.push({ sheet: r.sheet, rowNum: r.rowNum, type: typeName });
  }

  // ── Daily-OT-state pre-check: "Daily OT" rows must have a single date ────────
  // CA Daily Overtime and PR Daily Overtime rows must have a visitDate (not a date range).

  const dailyOtRangeRows = allRows.filter((r) => {
    const t = normalizeType(r.comments);
    return isDailyOtState(r.associateState) &&
      (isCaDailyOt(t) || isPrDailyOt(t)) &&
      r.visitDate === null;
  });

  if (dailyOtRangeRows.length > 0) {
    const stateTypes = [...new Set(dailyOtRangeRows.map((r) => isCA(r.associateState) ? 'CA' : 'PR'))].join('/');
    return {
      checkId: 17,
      checkName: 'OT Math Validation',
      status: 'fail',
      stats: `${stateTypes} Daily Overtime rows contain date ranges — exact dates required. ${dailyOtRangeRows.length} row${dailyOtRangeRows.length === 1 ? '' : 's'} affected.`,
      flaggedCount: dailyOtRangeRows.length,
      flaggedRows: dailyOtRangeRows.map((r) => ({
        section: `Blocking Error — ${isCA(r.associateState) ? 'CA' : 'PR'} Daily OT Date Ranges`,
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        state: r.associateState,
        issue: `${isCA(r.associateState) ? 'CA' : 'Puerto Rico'} Daily Overtime rows contain date ranges — exact dates required. Please correct and re-upload.`,
      })),
      details: {
        blockingError: `${stateTypes} Daily Overtime rows contain date ranges — exact dates required. Please correct and re-upload.`,
      },
    };
  }

  // ── Non-CA/PR: weekly OT (40h threshold) with RI retail Sunday exclusion ──────

  type WeekAccum = {
    employeeName: string;
    state: string;
    weekKey: string;
    eligibleHrs: number;
    sundayRiEligibleHrs: number;    // Pass 1: RI Sunday eligible hours (excluded from OT base)
    invoicedOtHrs: number;
    invoicedRiPremHrs: number;      // Pass 2: hours from 'ri sunday premium pay' rows
    sourceRows: { sheet: string; rowNum: number }[];
  };

  const nonCaPrWeekMap = new Map<string, WeekAccum>();
  const nonCaPrWeekNumIndex = new Map<string, string>();

  // Pass 1 — accumulate eligible hours (and sundayRiEligibleHrs for RI associates).
  for (const r of allRows) {
    if (isDailyOtState(r.associateState)) continue;
    if (!r.visitDate) continue;

    const t = normalizeType(r.comments);
    if (!configEligible.has(t)) continue;

    const wk = weekStartKey(r.visitDate);
    const mapKey = `${r.employeeName.toLowerCase()}|${wk}`;

    if (!nonCaPrWeekMap.has(mapKey)) {
      nonCaPrWeekMap.set(mapKey, {
        employeeName: r.employeeName,
        state: r.associateState,
        weekKey: wk,
        eligibleHrs: 0,
        sundayRiEligibleHrs: 0,
        invoicedOtHrs: 0,
        invoicedRiPremHrs: 0,
        sourceRows: [],
      });
    }
    const entry = nonCaPrWeekMap.get(mapKey)!;
    entry.eligibleHrs += r.timeHours;
    entry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });

    // Accumulate RI Sunday eligible hours for retail exclusion.
    if (isSunday(r.visitDate) && isRhodeIsland(r.associateState)) {
      entry.sundayRiEligibleHrs += r.timeHours;
    }

    if (r.week != null) {
      const numKey = `${r.employeeName.toLowerCase()}|${r.week}`;
      if (!nonCaPrWeekNumIndex.has(numKey)) nonCaPrWeekNumIndex.set(numKey, wk);
    }
  }

  // Pass 2 — accumulate invoiced OT hours and RI Sunday premium hours.
  for (const r of allRows) {
    if (isDailyOtState(r.associateState)) continue;
    const t = normalizeType(r.comments);

    const isOtRow = t === 'overtime';
    const isRiPremRow = isRiSundayPremium(t);
    if (!isOtRow && !isRiPremRow) continue;

    let mapKey: string | null = null;

    if (r.visitDate) {
      mapKey = `${r.employeeName.toLowerCase()}|${weekStartKey(r.visitDate)}`;
    } else if (r.week != null) {
      const wk = nonCaPrWeekNumIndex.get(`${r.employeeName.toLowerCase()}|${r.week}`);
      if (wk) mapKey = `${r.employeeName.toLowerCase()}|${wk}`;
    }

    if (!mapKey) continue;

    if (!nonCaPrWeekMap.has(mapKey)) {
      const wk = mapKey.split('|')[1];
      nonCaPrWeekMap.set(mapKey, {
        employeeName: r.employeeName,
        state: r.associateState,
        weekKey: wk,
        eligibleHrs: 0,
        sundayRiEligibleHrs: 0,
        invoicedOtHrs: 0,
        invoicedRiPremHrs: 0,
        sourceRows: [],
      });
    }
    const entry = nonCaPrWeekMap.get(mapKey)!;

    if (isOtRow) {
      // 'Overtime' rows accumulate into invoicedOtHrs (unchanged from v1).
      entry.invoicedOtHrs += r.timeHours;
    } else {
      // 'RI Sunday Premium Pay' rows accumulate into invoicedRiPremHrs (NOT invoicedOtHrs).
      entry.invoicedRiPremHrs += r.timeHours;
    }
    entry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });
  }

  const nonCaPrFailures: Record<string, unknown>[] = [];

  for (const entry of nonCaPrWeekMap.values()) {
    // RI retail Sunday exclusion: Sunday hours are excluded from the OT base.
    // For non-RI weeks sundayRiEligibleHrs = 0 → collapses to the existing check.
    const otBase = entry.eligibleHrs - entry.sundayRiEligibleHrs;
    const expectedOt = otBase > 40 ? otBase - 40 : 0;

    // Assertion (a): invoiced OT must match expected OT on non-Sunday hours.
    // Tighten to ±0.01 only when the RI Sunday exclusion is in play; otherwise the
    // check is the unchanged v1 OT-math check at ±0.05.
    const otTolerance = entry.sundayRiEligibleHrs > 0 ? RI_TOLERANCE : TOLERANCE;
    const otDiff = Math.abs(expectedOt - entry.invoicedOtHrs);
    if (otDiff > otTolerance) {
      nonCaPrFailures.push({
        section: 'OT Math Validation — Non-CA/PR',
        employeeName: entry.employeeName,
        state: entry.state,
        week: entry.weekKey,
        location: formatLocation(entry.sourceRows),
        expectedOtHrs: parseFloat(expectedOt.toFixed(2)),
        invoicedOtHrs: parseFloat(entry.invoicedOtHrs.toFixed(2)),
        eligibleHrs: parseFloat(entry.eligibleHrs.toFixed(2)),
        sundayRiEligibleHrs: parseFloat(entry.sundayRiEligibleHrs.toFixed(2)),
        issue: expectedOt === 0 && entry.invoicedOtHrs > 0
          ? 'OT row exists but no OT expected'
          : entry.invoicedOtHrs === 0 && expectedOt > 0
          ? 'Expected OT but no OT row found'
          : 'OT hours mismatch',
      });
    }

    // Assertion (b): RI Sunday premium hours must match Sunday eligible hours.
    // Only fires when there are RI Sunday hours or invoiced RI premium rows.
    if (entry.sundayRiEligibleHrs > 0 || entry.invoicedRiPremHrs > 0) {
      const premDiff = Math.abs(entry.invoicedRiPremHrs - entry.sundayRiEligibleHrs);
      if (premDiff > RI_TOLERANCE) {
        nonCaPrFailures.push({
          section: 'OT Math Validation — RI Sunday Premium',
          employeeName: entry.employeeName,
          state: entry.state,
          week: entry.weekKey,
          location: formatLocation(entry.sourceRows),
          sundayRiEligibleHrs: parseFloat(entry.sundayRiEligibleHrs.toFixed(2)),
          invoicedRiPremHrs: parseFloat(entry.invoicedRiPremHrs.toFixed(2)),
          issue: entry.invoicedRiPremHrs === 0 && entry.sundayRiEligibleHrs > 0
            ? 'Expected RI Sunday premium hours but no premium row found'
            : entry.invoicedRiPremHrs > 0 && entry.sundayRiEligibleHrs === 0
            ? 'RI Sunday premium row exists but no Sunday eligible hours'
            : 'RI Sunday premium hours mismatch',
        });
      }
    }
  }

  // ── CA + PR: greater-of daily vs weekly OT ────────────────────────────────────
  //
  // Both CA and PR employees use the same daily+weekly greater-of logic.
  // The section label in flaggedRows identifies which state is which.

  type DailyOtStateWeekAccum = {
    employeeName: string;
    state: string;
    weekKey: string;
    dailyEligible: Map<string, number>; // dateKey → hours
    totalEligibleHrs: number;
    invoicedOtHrs: number;
    sourceRows: { sheet: string; rowNum: number }[];
  };

  const dailyOtStateWeekMap = new Map<string, DailyOtStateWeekAccum>();
  // "employeeName.lower()|weekNum" → weekKey — for matching Weekly OT orphan rows
  const dailyOtStateWeekNumIndex = new Map<string, string>();

  for (const r of allRows) {
    if (!isDailyOtState(r.associateState)) continue;

    const t = normalizeType(r.comments);
    const hasDate = r.visitDate !== null;
    const wk = hasDate ? weekStartKey(r.visitDate!) : null;

    // ── Invoiced OT rows (dated, CA or PR-specific labels) ───────────────────
    if (isCaDailyOt(t) || isCaWeeklyOt(t) || isPrDailyOt(t) || isPrWeeklyOt(t)) {
      // Daily OT rows always have visitDate after the pre-check above.
      // Weekly OT rows with no date are handled by orphan pass below.
      if (!wk) continue;
      const mapKey = `${r.employeeName.toLowerCase()}|${wk}`;
      if (!dailyOtStateWeekMap.has(mapKey)) {
        dailyOtStateWeekMap.set(mapKey, {
          employeeName: r.employeeName,
          state: r.associateState,
          weekKey: wk,
          dailyEligible: new Map(),
          totalEligibleHrs: 0,
          invoicedOtHrs: 0,
          sourceRows: [],
        });
      }
      const otEntry = dailyOtStateWeekMap.get(mapKey)!;
      otEntry.invoicedOtHrs += r.timeHours;
      otEntry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });
      continue;
    }

    // Generic "Overtime" on daily-OT-state employee → warned above, skip here
    if (t === 'overtime') continue;

    // Eligible time — must have a date
    if (!wk || !hasDate) continue;
    if (!configEligible.has(t)) continue;

    const mapKey = `${r.employeeName.toLowerCase()}|${wk}`;
    if (!dailyOtStateWeekMap.has(mapKey)) {
      dailyOtStateWeekMap.set(mapKey, {
        employeeName: r.employeeName,
        state: r.associateState,
        weekKey: wk,
        dailyEligible: new Map(),
        totalEligibleHrs: 0,
        invoicedOtHrs: 0,
        sourceRows: [],
      });
    }
    const entry = dailyOtStateWeekMap.get(mapKey)!;
    const dk = toDateKey(r.visitDate!);
    entry.dailyEligible.set(dk, (entry.dailyEligible.get(dk) ?? 0) + r.timeHours);
    entry.totalEligibleHrs += r.timeHours;
    entry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });

    if (r.week != null) {
      const numKey = `${r.employeeName.toLowerCase()}|${r.week}`;
      if (!dailyOtStateWeekNumIndex.has(numKey)) dailyOtStateWeekNumIndex.set(numKey, wk);
    }
  }

  // Handle Weekly OT orphan rows (visitDate=null) for CA and PR
  const weeklyOtOrphans: LaborRow[] = [];
  for (const r of allRows) {
    if (!isDailyOtState(r.associateState)) continue;
    const t = normalizeType(r.comments);
    if ((isCaWeeklyOt(t) || isPrWeeklyOt(t)) && r.visitDate === null) {
      weeklyOtOrphans.push(r);
    }
  }

  for (const r of weeklyOtOrphans) {
    const empKey = r.employeeName.toLowerCase();
    let mapKey: string | null = null;

    if (r.week != null) {
      const wk = dailyOtStateWeekNumIndex.get(`${empKey}|${r.week}`);
      if (wk) mapKey = `${empKey}|${wk}`;
    }

    if (!mapKey) {
      const empEntries = Array.from(dailyOtStateWeekMap.entries()).filter(([k]) => k.startsWith(empKey + '|'));
      if (empEntries.length === 1) mapKey = empEntries[0][0];
    }

    if (mapKey) {
      if (!dailyOtStateWeekMap.has(mapKey)) {
        const wkPart = mapKey.split('|')[1];
        dailyOtStateWeekMap.set(mapKey, {
          employeeName: r.employeeName,
          state: r.associateState,
          weekKey: wkPart,
          dailyEligible: new Map(),
          totalEligibleHrs: 0,
          invoicedOtHrs: 0,
          sourceRows: [],
        });
      }
      const orphanEntry = dailyOtStateWeekMap.get(mapKey)!;
      orphanEntry.invoicedOtHrs += r.timeHours;
      orphanEntry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });
    } else {
      const sentinelKey = `${empKey}|(unknown)`;
      if (!dailyOtStateWeekMap.has(sentinelKey)) {
        dailyOtStateWeekMap.set(sentinelKey, {
          employeeName: r.employeeName,
          state: r.associateState,
          weekKey: '(unknown)',
          dailyEligible: new Map(),
          totalEligibleHrs: 0,
          invoicedOtHrs: 0,
          sourceRows: [],
        });
      }
      const sentinelEntry = dailyOtStateWeekMap.get(sentinelKey)!;
      sentinelEntry.invoicedOtHrs += r.timeHours;
      sentinelEntry.sourceRows.push({ sheet: r.sheet, rowNum: r.rowNum });
    }
  }

  const caFailures: Record<string, unknown>[] = [];
  const prFailures: Record<string, unknown>[] = [];

  for (const entry of dailyOtStateWeekMap.values()) {
    let dailyOt = 0;
    for (const hrs of entry.dailyEligible.values()) {
      if (hrs > 8) dailyOt += hrs - 8;
    }

    const weeklyOt = entry.totalEligibleHrs > 40 ? entry.totalEligibleHrs - 40 : 0;
    const correctOt = Math.max(dailyOt, weeklyOt);
    const otBasis = dailyOt >= weeklyOt ? 'Daily OT' : 'Weekly OT';
    const stateLabel = isCA(entry.state) ? 'CA' : 'PR';

    const diff = Math.abs(correctOt - entry.invoicedOtHrs);
    if (diff > TOLERANCE) {
      let billingStatus: string;
      if (entry.invoicedOtHrs > correctOt + TOLERANCE) {
        billingStatus = 'OVER-BILLED';
      } else if (entry.invoicedOtHrs < correctOt - TOLERANCE) {
        billingStatus = 'UNDER-BILLED';
      } else {
        billingStatus = 'MATCH';
      }

      const row = {
        section: `OT Math Validation — ${stateLabel}`,
        employeeName: entry.employeeName,
        state: entry.state,
        week: entry.weekKey,
        location: formatLocation(entry.sourceRows),
        otBasis: `${stateLabel} ${otBasis}`,
        dailyOtHrs: parseFloat(dailyOt.toFixed(2)),
        weeklyOtHrs: parseFloat(weeklyOt.toFixed(2)),
        correctOtHrs: parseFloat(correctOt.toFixed(2)),
        invoicedOtHrs: parseFloat(entry.invoicedOtHrs.toFixed(2)),
        status: billingStatus,
        issue: correctOt === 0 && entry.invoicedOtHrs > 0
          ? `${stateLabel} OT row exists but no OT expected`
          : entry.invoicedOtHrs === 0 && correctOt > 0
          ? `Expected ${stateLabel} OT (${otBasis}) but no OT row found`
          : `${stateLabel} OT hours mismatch (${otBasis})`,
      };

      if (isCA(entry.state)) {
        caFailures.push(row);
      } else {
        prFailures.push(row);
      }
    }
  }

  // ── Build result ─────────────────────────────────────────────────────────────

  const caWeekCount = Array.from(dailyOtStateWeekMap.values()).filter((e) => isCA(e.state)).length;
  const prWeekCount = Array.from(dailyOtStateWeekMap.values()).filter((e) => isPR(e.state)).length;
  const totalDailyOtFails = caFailures.length + prFailures.length;
  const totalFailures = nonCaPrFailures.length + totalDailyOtFails;

  const nonCaPrEmployeeWeekCount = nonCaPrWeekMap.size;
  const totalChecked = nonCaPrEmployeeWeekCount + dailyOtStateWeekMap.size;

  const unrecognizedWarningRows: Record<string, unknown>[] = unrecognizedRows.map((r) => ({
    section: 'Warning — Unrecognized Time Type',
    sheet: r.sheet,
    row: r.rowNum,
    type: r.type,
    issue: 'Unrecognized time type — excluded from OT calculations until confirmed.',
  }));

  const allFlagged = [
    ...unrecognizedWarningRows,
    ...genericOtWarnings,
    ...nonCaPrFailures,
    ...caFailures,
    ...prFailures,
  ];

  const parts: string[] = [];
  if (nonCaPrEmployeeWeekCount > 0) {
    parts.push(`${nonCaPrFailures.length} of ${nonCaPrEmployeeWeekCount} non-CA/PR employee-week${nonCaPrEmployeeWeekCount === 1 ? '' : 's'} failed`);
  }
  if (caWeekCount > 0) {
    parts.push(`${caFailures.length} of ${caWeekCount} CA employee-week${caWeekCount === 1 ? '' : 's'} failed`);
  }
  if (prWeekCount > 0) {
    parts.push(`${prFailures.length} of ${prWeekCount} PR employee-week${prWeekCount === 1 ? '' : 's'} failed`);
  }
  if (totalChecked === 0) {
    parts.push('No dated labor rows found');
  }
  if (unrecognizedTypeNames.size > 0) {
    parts.push(`${unrecognizedTypeNames.size} unrecognized time type${unrecognizedTypeNames.size === 1 ? '' : 's'} warned`);
  }
  if (genericOtWarnings.length > 0) {
    parts.push(`${genericOtWarnings.length} generic OT row${genericOtWarnings.length === 1 ? '' : 's'} warned`);
  }

  const statsStr = parts.join('; ') || 'No OT rows to validate';

  let status: CheckResult['status'];
  if (totalChecked === 0) {
    status = 'na';
  } else if (totalFailures > 0) {
    status = 'fail';
  } else if (unrecognizedTypeNames.size > 0 || genericOtWarnings.length > 0) {
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
      nonCaPrSummary: nonCaPrEmployeeWeekCount > 0
        ? `${nonCaPrFailures.length} of ${nonCaPrEmployeeWeekCount} non-CA/PR employee-week checks failed`
        : null,
      caSummary: caWeekCount > 0
        ? `${caFailures.length} of ${caWeekCount} CA employee-week checks failed`
        : null,
      prSummary: prWeekCount > 0
        ? `${prFailures.length} of ${prWeekCount} PR employee-week checks failed`
        : null,
      unrecognizedTypes: unrecognizedTypeNames.size > 0 ? Array.from(unrecognizedTypeNames) : null,
    },
  };
}
