// sourceSlice.ts — Builds the associate-scoped SOURCE ROW slice for Deep Dive calls (T-669).
//
// This is the fix for "Analyze with Bragi doesn't actually help source the
// error": every prior AI path only ever saw a check's flaggedRows (its
// conclusions), never the underlying source rows (punch detail with
// timeType, invoice labor rows with comments/category, shift detail, etc).
// This module assembles that slice from ParsedData/CiParsedData, which is
// already sitting in browser App state for the session — nothing new is
// fetched, and NOTHING here is ever written to AuditPayload (see
// buildDeepDivePrompt / runDeepDive for the boundary — the source slice only
// ever flows into the Anthropic API call, never into postRun()'s payload).

import type { CheckResult, ParsedData, CiParsedData, LaborRow } from '../audit/types';
import {
  extractRowIdentity,
  rowMatchesIdentity,
  type AssociateIdentity,
} from './associateIdentity';

// ── Caps — named constants, not magic numbers ───────────────────────────────
//
// Every failed/warned check can now trigger a Deep Dive (DEEP_DIVE_CHECKS
// gate removed in CheckCard.tsx), so an uncapped slice could pull in
// hundreds of associates' full punch/labor/shift history. Caps keep a
// single Deep Dive call bounded and affordable while still surfacing the
// associates that matter most (ranked by severity, not first-N — see
// rankIdentities below).

/** Max distinct associates included in one Deep Dive's source slice. */
export const MAX_ASSOCIATES_PER_DEEP_DIVE = 8;

/** Max source rows per associate, per individual source (punch, labor, shift, ...). */
export const MAX_SOURCE_ROWS_PER_ASSOCIATE_PER_SOURCE = 15;

/**
 * Max distinct dates shown per associate in the date-level variance pivot
 * (T-672). Ranked by |variance| — the worst days survive truncation, not
 * the earliest ones (mirrors the associate-ranking philosophy above).
 */
export const MAX_DATES_PER_ASSOCIATE_PIVOT = 10;

// ── Types ────────────────────────────────────────────────────────────────

export interface SourceGroup {
  label: string;
  rows: Record<string, unknown>[];
  trimmed: number;
}

/** One date's invoice-vs-punch(-vs-shift) comparison for one associate (T-672). */
export interface DatePivotEntry {
  /** YYYY-MM-DD */
  date: string;
  /** null = no Work invoice rows found on this date (not the same as 0 hours found). */
  invoiceHours: number | null;
  /** null = no Work punch rows found on this date. */
  punchHours: number | null;
  /** null = no shift row this date, OR this run's shift data isn't date-attributable at all (see DatePivot.shiftDateAttributable). */
  shiftHours: number | null;
  /** Non-Work punch categories present this date, for context (e.g. "Travel 2.00h, Admin 1.00h") — never folded into punchHours. */
  otherPunchCategories: string | null;
  /** Ranking signal — max pairwise |diff| among the legs that have data this date. */
  variance: number;
  /**
   * True when NONE of the date-attributable legs has any row this date — the
   * entry exists only because a non-Work punch category (Travel, Training, …)
   * created the date bucket. Carries zero reconciliation signal (variance is
   * always 0), but rendering it as `Invoice — | Punch — | Shift —` invites
   * exactly the misread it caused during this review: three em-dashes read as
   * "all three sources are missing on this date," i.e. a variance driver, when
   * the truth is "this associate simply had no Work hours that day."
   * renderDatePivot states that in words instead (Vera, T-672 review).
   */
  noReconcilableHours: boolean;
}

/**
 * Per-run, per-source "does this leg carry usable dates at all" flags (Vera,
 * T-672 review). T-672 shipped this guard for shift ONLY. That asymmetry is a
 * fabrication risk: on an older punch export with no "Date In" column, every
 * pivot line renders `Punch —`, which the legend defines as "no rows found for
 * that leg on that date" — so a model told to name the dates driving a
 * variance reads a parsing artifact as "this associate's punch rows are
 * missing on every single date" and reports a fabricated missing-punch
 * finding. Same for a dateless invoice. Reproduced against both legs before
 * the fix; a leg that isn't date-attributable is now suppressed from the
 * per-date lines entirely and disclosed in a note, exactly as shift already
 * was.
 */
export interface DateAttributability {
  invoice: boolean;
  punch: boolean;
  shift: boolean;
}

export interface DatePivot {
  /** Whether THIS run's shift data carries per-date rows at all. False = every ShiftRow.visitDate in this run's ParsedData is null (older export). */
  shiftDateAttributable: boolean;
  /** Per-leg date-attributability for this run (see DateAttributability). `shift` mirrors shiftDateAttributable. */
  attributable: DateAttributability;
  /** Ranked by |variance| desc, capped at MAX_DATES_PER_ASSOCIATE_PIVOT. */
  dates: DatePivotEntry[];
  totalDatesFound: number;
  omittedDateCount: number;
}

export interface AssociateSource {
  identity: AssociateIdentity;
  /** The severity score used to rank/cap this associate — surfaced for transparency in the prompt. */
  severity: number;
  groups: SourceGroup[];
  /** Present only for FSM/SES (not CI) associates with at least one dated row in any of invoice/punch/shift. */
  datePivot: DatePivot | null;
}

export interface SourceSlice {
  associates: AssociateSource[];
  /** Total distinct associates found in the flagged rows, before capping. */
  totalCandidates: number;
  /** How many associates were cut by MAX_ASSOCIATES_PER_DEEP_DIVE. */
  omittedCount: number;
  /** Set when no source rows could be attempted at all (e.g. parsedData is null). */
  degradedReason: string | null;
}

// ── Severity ranking ─────────────────────────────────────────────────────
//
// "Rank by the check's own severity signal" — for recon-style checks
// (check03) that's the variance/delta fields the check itself computed on
// that row (invoiceVsPunch, invoiceVsShift, punchVsShift). We prefer any
// field whose name suggests it IS a variance/delta ("vs", "variance",
// "delta", "diff") since those are the discrepancy magnitudes, not just any
// large number on the row (e.g. invoiceHrs itself). Checks with no such
// field fall back to the largest numeric value present (e.g. OT hours,
// dollar amounts) — still a signal from the check's own output, never row
// order.

const VARIANCE_KEY_RE = /vari|delta|diff|vs/i;
const EXCLUDED_NUMERIC_KEYS = new Set([
  'row', 'rowNum', 'row_num', 'week', 'checkId', 'associateId', 'employeeId',
]);

function numericValue(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function severityScore(row: Record<string, unknown>): number {
  let varianceMax: number | null = null;
  let genericMax = 0;
  for (const [k, v] of Object.entries(row)) {
    if (EXCLUDED_NUMERIC_KEYS.has(k)) continue;
    const n = numericValue(v);
    if (n === null) continue;
    const abs = Math.abs(n);
    if (VARIANCE_KEY_RE.test(k)) {
      varianceMax = varianceMax === null ? abs : Math.max(varianceMax, abs);
    }
    genericMax = Math.max(genericMax, abs);
  }
  return varianceMax !== null ? varianceMax : genericMax;
}

/** Group flagged rows by associate identity and rank by severity, worst first. */
function rankIdentities(flaggedRows: Record<string, unknown>[]): { identity: AssociateIdentity; severity: number }[] {
  const byKey = new Map<string, { identity: AssociateIdentity; rows: Record<string, unknown>[] }>();
  for (const row of flaggedRows) {
    const identity = extractRowIdentity(row);
    if (!identity) continue;
    const dk = `${identity.kind}:${identity.key}`;
    const entry = byKey.get(dk);
    if (entry) entry.rows.push(row);
    else byKey.set(dk, { identity, rows: [row] });
  }
  return [...byKey.values()]
    .map((e) => ({ identity: e.identity, severity: Math.max(...e.rows.map(severityScore)) }))
    .sort((a, b) => b.severity - a.severity);
}

// ── Source-row filtering per program shape ──────────────────────────────

function filterAndCap(
  label: string,
  rows: Record<string, unknown>[] | undefined,
  identity: AssociateIdentity,
): SourceGroup | null {
  if (!rows || rows.length === 0) return null;
  const matched = rows.filter((r) => rowMatchesIdentity(r, identity));
  if (matched.length === 0) return null;
  const capped = matched.slice(0, MAX_SOURCE_ROWS_PER_ASSOCIATE_PER_SOURCE);
  return { label, rows: capped, trimmed: matched.length - capped.length };
}

function isCiParsedData(pd: ParsedData | CiParsedData): pd is CiParsedData {
  return 'detailRows' in pd;
}

// ── Date-level variance pivot (T-672) ──────────────────────────────────────
//
// Allan: "I am wondering however if it can go deep enough to actually source
// the date(s) that caused the variance. for example, Tom Johnson had 8 hours
// on invoice on Jan 1 but only 6.5 hours on punch report for Jan 1" — this
// builds exactly that, per associate: invoice-vs-punch(-vs-shift) hours for
// each date, ranked by variance so the worst days survive truncation.
//
// Mirrors check03SesThreeWayRecon's own Work-only definition on both legs
// (PUNCH_SUPPORTED / isWorkPunch) so the per-date numbers are apples-to-
// apples with what the check itself flagged — mixing categories here would
// reproduce exactly the T-668 bug (a pivot that "explains" a variance the
// check never actually has, or hides the one it does).

const WORK_CATEGORY = 'work';

function dateKey(d: Date | null | undefined): string | null {
  if (!d) return null;
  const t = d.getTime();
  if (Number.isNaN(t)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface DateAccumEntry {
  invoiceSeen: boolean;
  invoiceHours: number;
  punchSeen: boolean;
  punchHours: number;
  shiftSeen: boolean;
  shiftHours: number;
  otherCats: Map<string, number>;
}

function newDateAccumEntry(): DateAccumEntry {
  return { invoiceSeen: false, invoiceHours: 0, punchSeen: false, punchHours: 0, shiftSeen: false, shiftHours: 0, otherCats: new Map() };
}

/**
 * Build the per-date invoice/punch/shift pivot for one associate. Returns
 * null when there is no dated row at all for this associate on any leg
 * (nothing to pivot) — the caller falls back to the existing period-level
 * SourceGroup rows in that case, so no information is lost, just not
 * date-bucketed.
 */
function buildDatePivot(pd: ParsedData, identity: AssociateIdentity, attributable: DateAttributability): DatePivot | null {
  const shiftDateAttributable = attributable.shift;

  // A per-date pivot only means something if at least TWO legs can be placed
  // on dates — one dated leg on its own can't show a per-date variance, and
  // rendering it next to two columns of em-dashes is precisely the fabricated
  // "missing on every date" reading this guard exists to prevent. Fall back to
  // the period-level SourceGroup rows instead; no information is lost.
  const attributableLegs = [attributable.invoice, attributable.punch, attributable.shift].filter(Boolean).length;
  if (attributableLegs < 2) return null;

  const laborRows = attributable.invoice
    ? (([...pd.fsmIRows, ...pd.fsmIIRows, ...pd.fsmIMeritRows, ...pd.fsmIIMeritRows] as unknown as Record<string, unknown>[])
        .filter((r) => rowMatchesIdentity(r, identity)) as unknown as LaborRow[])
    : [];
  const punchRowsForAssoc = attributable.punch
    ? pd.sesPunchRows.filter((r) => rowMatchesIdentity(r as unknown as Record<string, unknown>, identity))
    : [];
  const shiftRowsForAssoc = shiftDateAttributable
    ? pd.shiftRows.filter((r) => rowMatchesIdentity(r as unknown as Record<string, unknown>, identity))
    : [];

  const byDate = new Map<string, DateAccumEntry>();

  for (const r of laborRows) {
    const k = dateKey(r.visitDate);
    if (!k) continue;
    if (r.comments.trim().toLowerCase() !== WORK_CATEGORY) continue; // non-Work invoice categories excluded, same as the check's own PUNCH_SUPPORTED
    const e = byDate.get(k) ?? newDateAccumEntry();
    e.invoiceSeen = true;
    e.invoiceHours += r.timeHours;
    byDate.set(k, e);
  }

  for (const r of punchRowsForAssoc) {
    const k = dateKey(r.visitDate);
    if (!k) continue;
    const t = (r.timeType ?? '').toLowerCase().trim();
    const e = byDate.get(k) ?? newDateAccumEntry();
    if (!t || t === WORK_CATEGORY) {
      e.punchSeen = true;
      e.punchHours += r.timeHours;
    } else {
      // Context only — never folded into punchHours. This is exactly the
      // information a model needs to answer "is the gap explained by a
      // non-Work punch category the check correctly excluded."
      e.otherCats.set(r.timeType!, (e.otherCats.get(r.timeType!) ?? 0) + r.timeHours);
    }
    byDate.set(k, e);
  }

  if (shiftDateAttributable) {
    for (const r of shiftRowsForAssoc) {
      const k = dateKey(r.visitDate);
      if (!k) continue;
      const e = byDate.get(k) ?? newDateAccumEntry();
      e.shiftSeen = true;
      e.shiftHours += r.actualMinutes / 60;
      byDate.set(k, e);
    }
  }

  if (byDate.size === 0) return null;

  const entries: DatePivotEntry[] = [...byDate.entries()].map(([date, e]) => {
    const inv = e.invoiceSeen ? e.invoiceHours : null;
    const pch = e.punchSeen ? e.punchHours : null;
    const sft = e.shiftSeen ? e.shiftHours : null;
    // Treat an absent leg as 0 for ranking only — never for the displayed
    // value (which stays null so "no rows this date" reads distinctly from
    // "rows totaling zero hours this date").
    const pairs: number[] = [];
    if (attributable.invoice && attributable.punch && (inv !== null || pch !== null)) pairs.push(Math.abs((inv ?? 0) - (pch ?? 0)));
    if (attributable.invoice && shiftDateAttributable && (inv !== null || sft !== null)) pairs.push(Math.abs((inv ?? 0) - (sft ?? 0)));
    if (attributable.punch && shiftDateAttributable && (pch !== null || sft !== null)) pairs.push(Math.abs((pch ?? 0) - (sft ?? 0)));
    const variance = pairs.length > 0 ? Math.max(...pairs) : 0;

    const otherPunchCategories = e.otherCats.size > 0
      ? [...e.otherCats.entries()].map(([cat, hrs]) => `${cat} ${hrs.toFixed(2)}h`).join(', ')
      : null;

    const noReconcilableHours = inv === null && pch === null && sft === null;

    return { date, invoiceHours: inv, punchHours: pch, shiftHours: sft, otherPunchCategories, variance, noReconcilableHours };
  });

  entries.sort((a, b) => b.variance - a.variance || a.date.localeCompare(b.date));

  const totalDatesFound = entries.length;
  const capped = entries.slice(0, MAX_DATES_PER_ASSOCIATE_PIVOT);

  return {
    shiftDateAttributable,
    attributable,
    dates: capped,
    totalDatesFound,
    omittedDateCount: totalDatesFound - capped.length,
  };
}

function buildFsmSesSourceGroups(pd: ParsedData, identity: AssociateIdentity): SourceGroup[] {
  const combinedLabor: LaborRow[] = [...pd.fsmIRows, ...pd.fsmIIRows, ...pd.fsmIMeritRows, ...pd.fsmIIMeritRows];

  const defs: { label: string; rows: Record<string, unknown>[] }[] = [
    { label: 'SES Punch Detail (sesPunchRows — timeType intact)', rows: pd.sesPunchRows as unknown as Record<string, unknown>[] },
    { label: 'FSM Punch Detail (punchRows)', rows: pd.punchRows as unknown as Record<string, unknown>[] },
    { label: 'Invoice Labor Rows (fsmI/fsmII/Merit — comments = category)', rows: combinedLabor as unknown as Record<string, unknown>[] },
    { label: 'Shift Detail (shiftRows)', rows: pd.shiftRows as unknown as Record<string, unknown>[] },
    { label: 'Management Billing (mgmtRows)', rows: pd.mgmtRows as unknown as Record<string, unknown>[] },
    { label: 'OT Approval Tab (otApprovalRows)', rows: pd.otApprovalRows as unknown as Record<string, unknown>[] },
    { label: 'Time Off (timeOffRows)', rows: pd.timeOffRows as unknown as Record<string, unknown>[] },
    { label: 'Termed PTO (termedPtoRows)', rows: pd.termedPtoRows as unknown as Record<string, unknown>[] },
    { label: 'Roster (rosterEntries)', rows: pd.rosterEntries as unknown as Record<string, unknown>[] },
  ];

  const groups: SourceGroup[] = [];
  for (const d of defs) {
    const g = filterAndCap(d.label, d.rows, identity);
    if (g) groups.push(g);
  }
  return groups;
}

function buildCiSourceGroups(pd: CiParsedData, identity: AssociateIdentity): SourceGroup[] {
  const defs: { label: string; rows: Record<string, unknown>[] }[] = [
    { label: 'Invoice Detail Rows (detailRows — comments = category)', rows: pd.detailRows as unknown as Record<string, unknown>[] },
    { label: 'Activity Detail (activityRows — timeIn/timeOut/isOt)', rows: pd.activityRows as unknown as Record<string, unknown>[] },
    { label: 'Roster (ciRosterRows)', rows: pd.ciRosterRows as unknown as Record<string, unknown>[] },
    { label: 'Time Off (timeOffRows)', rows: pd.timeOffRows as unknown as Record<string, unknown>[] },
  ];

  const groups: SourceGroup[] = [];
  for (const d of defs) {
    const g = filterAndCap(d.label, d.rows, identity);
    if (g) groups.push(g);
  }
  return groups;
}

// ── Entry point ──────────────────────────────────────────────────────────

/**
 * Build the associate-scoped source-row slice for a Deep Dive.
 *
 * Handles both program shapes: ParsedData (FSM/SES) and CiParsedData (CI) —
 * detected structurally via 'detailRows' presence, since program isn't
 * passed here. Degrades explicitly (never crashes, never silently sends
 * nothing) when parsedData is null — e.g. a session where the source files
 * were never held in memory (shouldn't happen in the live app, but a
 * fixture/test can construct this).
 */
export function buildAssociateSourceSlice(
  targetResult: CheckResult,
  parsedData: ParsedData | CiParsedData | null,
): SourceSlice {
  const ranked = rankIdentities(targetResult.flaggedRows);
  const totalCandidates = ranked.length;

  if (totalCandidates === 0) {
    return { associates: [], totalCandidates: 0, omittedCount: 0, degradedReason: null };
  }

  if (parsedData === null) {
    return {
      associates: [],
      totalCandidates,
      omittedCount: totalCandidates,
      degradedReason: 'No source data available in this session (parsedData is null) — falling back to check output only.',
    };
  }

  const capped = ranked.slice(0, MAX_ASSOCIATES_PER_DEEP_DIVE);
  const omittedCount = totalCandidates - capped.length;
  const ci = isCiParsedData(parsedData);

  // T-672: computed once per run, not per associate — reflects whether each
  // SOURCE FILE itself carries dates at all (older exports may not). When a
  // leg is false, buildDatePivot never touches its rows and the prompt states
  // that leg is period-level only, rather than rendering an em-dash a model
  // would read as "no rows on this date" (Vera, T-672 review — T-672 shipped
  // this guard for shift only; invoice and punch had the same exposure).
  const attributable: DateAttributability = ci
    ? { invoice: false, punch: false, shift: false }
    : {
        invoice: [...parsedData.fsmIRows, ...parsedData.fsmIIRows, ...parsedData.fsmIMeritRows, ...parsedData.fsmIIMeritRows]
          .some((r) => r.visitDate != null),
        punch: parsedData.sesPunchRows.some((r) => r.visitDate != null),
        shift: parsedData.shiftRows.some((r) => r.visitDate != null),
      };

  const associates: AssociateSource[] = capped.map(({ identity, severity }) => ({
    identity,
    severity,
    groups: ci ? buildCiSourceGroups(parsedData, identity) : buildFsmSesSourceGroups(parsedData, identity),
    datePivot: ci ? null : buildDatePivot(parsedData, identity, attributable),
  }));

  return { associates, totalCandidates, omittedCount, degradedReason: null };
}
