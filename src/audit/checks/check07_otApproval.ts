// Check 7 — OT > threshold hrs Validation
// From FSM I + FSM II: rows where Comments = "Over Time" AND Time Hours > rules.otThreshold.
// Each must appear on OT Approval tab.
// OT Approval tab: column for SEA DL must be populated for every data row.
// Ignore any image/screenshot objects (SheetJS doesn't surface those).

import type { CheckResult, LaborRow, OtApprovalRow } from '../types';
import { toStr } from '../../lib/num';
import { getAuditRules } from '../auditRules';

export function check07OtApproval(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
  otApprovalRows: OtApprovalRow[],
): CheckResult {
  const rules = getAuditRules();
  const otThreshold = rules.otThreshold;

  const qualifying = [...fsmI, ...fsmII].filter((r) => {
    const cat = toStr(r.comments).toLowerCase();
    return (cat === 'over time' || cat === 'overtime') && r.timeHours > otThreshold;
  });

  const failures: Record<string, unknown>[] = [];

  if (qualifying.length === 0 && otApprovalRows.length === 0) {
    return {
      checkId: 7,
      checkName: `OT > ${otThreshold} Hours Approval`,
      status: 'pass',
      stats: `No OT rows > ${otThreshold} hours found — no approvals required`,
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // Build set of names on OT Approval tab (normalized)
  const approvedNames = new Set(
    otApprovalRows.map((r) => toStr(r.associateName).toLowerCase()),
  );

  // Check each qualifying labor row has an OT approval entry
  for (const r of qualifying) {
    const nameNorm = toStr(r.employeeName).toLowerCase();
    if (!approvedNames.has(nameNorm)) {
      failures.push({
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        hours: r.timeHours.toFixed(2),
        issue: `OT > ${otThreshold}hrs with no matching OT Approval entry`,
      });
    }
  }

  // Check every OT Approval row has SEA DL status populated
  for (const r of otApprovalRows) {
    if (!r.seaDlStatus || r.seaDlStatus.trim() === '') {
      failures.push({
        row: r.rowNum,
        name: r.associateName,
        issue: 'OT Approval row missing SEA DL Approved/Not Approved status',
      });
    }
  }

  const pass = failures.length === 0;
  return {
    checkId: 7,
    checkName: `OT > ${otThreshold} Hours Approval`,
    status: pass ? 'pass' : 'fail',
    stats: `${qualifying.length} OT row(s) > ${otThreshold}hrs, ${otApprovalRows.length} approval row(s), ${failures.length} issue${failures.length === 1 ? '' : 's'}`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
