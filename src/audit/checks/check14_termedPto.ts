// Check 14 — Termed PTO Validation
// Cross-checks payroll Termed PTO payout file against the invoice.
// Only rows with Program = "Samsung Field Sales Manager" (col D) are checked.
// For each such person, verifies that a matching "Termed PTO" time-type entry
// appears in FSM I, FSM II, or Management Detail tabs with the correct hours.

import type { CheckResult, LaborRow, MgmtRow, TermedPtoRow } from '../types';

const PROGRAM_FILTER = 'samsung field sales manager';
const TIME_TYPE      = 'termed pto';

export function check14TermedPto(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
  mgmt: MgmtRow[],
  termedPtoRows: TermedPtoRow[],
): CheckResult {
  if (termedPtoRows.length === 0) {
    return {
      checkId: 14,
      checkName: 'Termed PTO Validation',
      status: 'na',
      stats: 'No Termed PTO file uploaded — skipped',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const relevant = termedPtoRows.filter(
    (r) => r.program.trim().toLowerCase() === PROGRAM_FILTER,
  );

  if (relevant.length === 0) {
    return {
      checkId: 14,
      checkName: 'Termed PTO Validation',
      status: 'na',
      stats: `Termed PTO file loaded (${termedPtoRows.length} rows) but none match "Samsung Field Sales Manager" — skipped`,
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const laborRows = [...fsmI, ...fsmII];
  const failures: Record<string, unknown>[] = [];

  for (const pto of relevant) {
    const idUpper   = pto.employeeId.toUpperCase();
    const nameNorm  = pto.worker.trim().toLowerCase();

    // Match by associate ID first; fall back to name substring match
    const invoiceMatches = laborRows.filter((r) => {
      const idMatch   = r.associateId && r.associateId.toUpperCase() === idUpper;
      const nameMatch = r.employeeName.trim().toLowerCase().includes(nameNorm) ||
                        nameNorm.includes(r.employeeName.trim().toLowerCase());
      return idMatch || nameMatch;
    });

    // Also check management rows by name
    const mgmtMatches = mgmt.filter((r) => {
      const idMatch   = r.associateId && r.associateId.toUpperCase() === idUpper;
      const nameMatch = r.name.trim().toLowerCase().includes(nameNorm) ||
                        nameNorm.includes(r.name.trim().toLowerCase());
      return idMatch || nameMatch;
    });

    // Filter to Termed PTO time-type rows in FSM I/II
    const termedRows = invoiceMatches.filter(
      (r) => r.comments.trim().toLowerCase().includes(TIME_TYPE),
    );

    const termedMgmtRows = mgmtMatches.filter(
      (r) => r.title.trim().toLowerCase().includes(TIME_TYPE),
    );

    const invoiceHours =
      termedRows.reduce((s, r) => s + r.timeHours, 0) +
      termedMgmtRows.reduce((s, r) => s + r.hours, 0);

    if (termedRows.length === 0 && termedMgmtRows.length === 0) {
      failures.push({
        employeeId: pto.employeeId,
        worker: pto.worker,
        ptoHours: pto.hours.toFixed(2),
        issue: 'No "Termed PTO" entry found in invoice for this employee',
        hint: invoiceMatches.length + mgmtMatches.length > 0
          ? 'Employee found in invoice but no Termed PTO time type rows'
          : 'Employee not found in invoice at all',
      });
    } else if (Math.abs(invoiceHours - pto.hours) > 0.01) {
      failures.push({
        employeeId: pto.employeeId,
        worker: pto.worker,
        ptoHours: pto.hours.toFixed(2),
        invoiceTermedPtoHours: invoiceHours.toFixed(2),
        delta: (invoiceHours - pto.hours).toFixed(2),
        issue: 'Termed PTO hours mismatch: invoice vs payroll file',
      });
    }
  }

  const pass = failures.length === 0;
  return {
    checkId: 14,
    checkName: 'Termed PTO Validation',
    status: pass ? 'pass' : 'fail',
    stats: `${relevant.length} Samsung FSM employee${relevant.length === 1 ? '' : 's'} checked, ${failures.length} issue${failures.length === 1 ? '' : 's'}`,
    flaggedCount: failures.length,
    flaggedRows: failures,
  };
}
