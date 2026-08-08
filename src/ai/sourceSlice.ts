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

// ── Types ────────────────────────────────────────────────────────────────

export interface SourceGroup {
  label: string;
  rows: Record<string, unknown>[];
  trimmed: number;
}

export interface AssociateSource {
  identity: AssociateIdentity;
  /** The severity score used to rank/cap this associate — surfaced for transparency in the prompt. */
  severity: number;
  groups: SourceGroup[];
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

  const associates: AssociateSource[] = capped.map(({ identity, severity }) => ({
    identity,
    severity,
    groups: ci ? buildCiSourceGroups(parsedData, identity) : buildFsmSesSourceGroups(parsedData, identity),
  }));

  return { associates, totalCandidates, omittedCount, degradedReason: null };
}
