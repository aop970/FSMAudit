// Check 7 — Tiered OT Approval (per-entry, 2026-06-23 per Allan's spec)
//
// Business rule: Each individual OT row is evaluated on its OWN hours.
// Do NOT sum hours across entries. A row is subject to the approval check when:
//   1. Its Comments column matches one of the recognized OT types (below), AND
//   2. That single row's hours exceed the DL threshold (> 2.00 hrs).
//
// Multiple entries for the same employee can each produce their own finding.
// Two entries of 1.3 + 1.35 hrs = neither flags, even though 2.65 would flag
// if it were a single entry. (This is the "Antonio Grouzis" case.)
//
// OT type recognition (Comments column → canonical label):
//   "Overtime"               — generic (non-CA/PR weekly OT)
//   "CA Daily Overtime"      — CA daily OT (also matches "CA Daily OT")
//   "CA Weekly Overtime"     — CA weekly OT (also matches "CA Weekly OT")
//   "Puerto Rico Daily OT"   — PR daily OT (all PR Daily variants)
//   "Puerto Rico Weekly OT"  — PR weekly OT (all PR Weekly variants)
//
// Tier thresholds (configurable in auditRules via otApprovalDlMin / otApprovalExecMin):
//   ≤ OT_APPROVAL_MIN (2.00)    → no approval required, not flagged
//   > OT_APPROVAL_MIN (2.01+)   → Orange — "Needs DL Approval"
//   ≥ OT_APPROVAL_EXEC_MIN (4.00) → Red — "Needs Exec Approval"
//
// Approval check: employee is APPROVED if ANY row in the OT Approval tab has:
//   • associateName matches the employee name (case-insensitive, trimmed)
//   • status = "Approved" (case-insensitive)
//   • approvalType = "Overtime" (case-insensitive)
// A single approved Overtime row satisfies BOTH tiers (DL and Exec).
// There is no separate DL vs Exec signal in the tab — tier is severity/color only.
//
// Blanket exceptions (from rules.otExceptions) are still honored per entry.
//
// Matching uses column B "Associate" from the OT Approval tab.
// Names are compared case-insensitive with leading/trailing whitespace stripped.

import type { CheckResult, LaborRow, OtApprovalRow } from '../types';
import { toStr } from '../../lib/num';
import { getAuditRules } from '../auditRules';

// ── Threshold constants (sourced from auditRules — tune in Settings panel) ──
// These match the fields otApprovalDlMin and otApprovalExecMin in AuditRules.
// Defaults: 2.0 (DL tier) and 4.0 (Exec tier).

// ── OT type canonicalization ─────────────────────────────────────────────────
// Map every recognized LaborRow.comments OT label to a canonical bucket string.
// These are the same labels check17 recognizes (engine-level constants).

function canonicalOtType(comments: string): string | null {
  const t = comments.trim().toLowerCase();
  if (t === 'overtime') return 'Overtime';
  if (t === 'ca daily overtime' || t === 'ca daily ot') return 'CA Daily OT';
  if (t === 'ca weekly overtime' || t === 'ca weekly ot') return 'CA Weekly OT';
  if (
    t === 'puerto rico daily overtime' || t === 'puerto rico daily ot' ||
    t === 'pr daily overtime' || t === 'pr daily ot'
  ) return 'PR Daily OT';
  if (
    t === 'puerto rico weekly overtime' || t === 'puerto rico weekly ot' ||
    t === 'pr weekly overtime' || t === 'pr weekly ot'
  ) return 'PR Weekly OT';
  return null; // not an OT row
}

export function check07OtApproval(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
  otApprovalRows: OtApprovalRow[],
  program?: 'fsm' | 'ses',
): CheckResult {
  const rules = getAuditRules(program);
  const OT_APPROVAL_MIN  = rules.otApprovalDlMin  ?? 2.0;
  const OT_EXEC_MIN      = rules.otApprovalExecMin ?? 4.0;
  const otExceptions     = rules.otExceptions ?? [];

  // ── Step 1: Build approved-name set from OT Approval tab ────────────────────
  // An employee is approved if ANY row has Status="Approved" AND ApprovalType="Overtime"
  // (case-insensitive, trimmed). A single such row covers both DL and Exec tiers.

  const approvedNames = new Set<string>();
  for (const r of otApprovalRows) {
    const statusOk = toStr(r.status).trim().toLowerCase() === 'approved';
    const typeOk   = toStr(r.approvalType).trim().toLowerCase() === 'overtime';
    if (statusOk && typeOk) {
      approvedNames.add(toStr(r.associateName).trim().toLowerCase());
    }
  }

  // ── Step 2: Evaluate each OT-labeled source row individually ────────────────
  // NO aggregation or summing. Each row stands on its own hours.

  const flagged: Record<string, unknown>[] = [];
  const blanketApproved: Record<string, unknown>[] = [];
  let belowThresholdCount = 0;
  let approvedCount = 0;
  let otRowCount = 0;

  for (const r of [...fsmI, ...fsmII]) {
    const bucket = canonicalOtType(toStr(r.comments));
    if (!bucket) continue; // not an OT row — skip

    otRowCount++;
    const hrs = r.timeHours;
    const sheet = r.sheet ?? 'Unknown';

    // ≤ OT_APPROVAL_MIN: no approval needed for this entry
    if (hrs <= OT_APPROVAL_MIN) {
      belowThresholdCount++;
      continue;
    }

    // Check blanket exceptions (per-week, per-hours cap)
    const week = r.week ?? null;
    const matchingException = week != null
      ? otExceptions.find((ex) => ex.week === week && hrs <= ex.maxHours)
      : undefined;

    if (matchingException) {
      blanketApproved.push({
        section: 'blanketApproved',
        location: sheet,
        name: r.employeeName,
        otType: bucket,
        hours: hrs.toFixed(2),
        week: matchingException.week,
        issue: `Blanket-approved: week ${matchingException.week}, ≤ ${matchingException.maxHours}hrs — ${matchingException.note || '(blanket approval)'}`,
      });
      continue;
    }

    // Determine tier
    const isExecTier = hrs >= OT_EXEC_MIN;
    const tier = isExecTier ? 'Needs Exec Approval' : 'Needs DL Approval';
    const severity = isExecTier ? 'red' : 'orange';

    // Check approval
    const nameKey = toStr(r.employeeName).trim().toLowerCase();
    const isApproved = approvedNames.has(nameKey);

    if (isApproved) {
      approvedCount++;
      // Approved: pass silently (no flagged row)
    } else {
      flagged.push({
        location: sheet,
        name: r.employeeName,
        otType: bucket,
        hours: hrs.toFixed(2),
        tier,
        severity,
        approved: false,
        issue: `${bucket} ${hrs.toFixed(2)}hrs — ${tier} — no matching Approved/Overtime row found in OT Approval tab`,
      });
    }
  }

  // ── Step 3: Build result ─────────────────────────────────────────────────────

  if (otRowCount === 0 && otApprovalRows.length === 0) {
    return {
      checkId: 7,
      checkName: 'OT Approval (Tiered)',
      status: 'pass',
      stats: `No OT rows found — no approvals required`,
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const statParts: string[] = [];
  statParts.push(`${otRowCount} OT entr${otRowCount === 1 ? 'y' : 'ies'} evaluated`);
  if (belowThresholdCount > 0) statParts.push(`${belowThresholdCount} at/below ${OT_APPROVAL_MIN}hr threshold (exempt)`);
  if (blanketApproved.length > 0) statParts.push(`${blanketApproved.length} blanket-approved`);
  if (approvedCount > 0) statParts.push(`${approvedCount} approved`);
  statParts.push(`${flagged.length} flagged`);

  const allDetails = [
    ...blanketApproved,
    ...flagged,
  ];

  const pass = flagged.length === 0;

  return {
    checkId: 7,
    checkName: 'OT Approval (Tiered)',
    status: pass ? 'pass' : 'fail',
    stats: statParts.join(', '),
    flaggedCount: flagged.length,
    flaggedRows: allDetails.slice(0, 200),
  };
}
