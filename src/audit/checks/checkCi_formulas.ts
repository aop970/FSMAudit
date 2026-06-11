// checkCi_formulas.ts — Check 2 for CI program
// Validates that MU and Bill cells are live formulas (cell.f present).
// CiDetailRow has muFormula and billFormula fields.

import type { CheckResult, CiDetailRow } from '../types';

export function checkCiFormulas(detailRows: CiDetailRow[]): CheckResult {
  if (detailRows.length === 0) {
    return {
      checkId: 2,
      checkName: 'Formula Compliance',
      status: 'na',
      stats: 'No detail rows found',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const failures: Record<string, unknown>[] = [];

  for (const r of detailRows) {
    if (r.timeHours === 0 && r.basePayRate === 0) continue;

    const muIsFormula = r.muFormula !== undefined && r.muFormula !== '';
    const billIsFormula = r.billFormula !== undefined && r.billFormula !== '';

    if (!muIsFormula) {
      failures.push({
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        associateId: r.associateId,
        visitDate: r.visitDate ? r.visitDate.toLocaleDateString() : '',
        cell: 'MU',
        value: r.muValue,
        issue: 'Hardcoded value — no formula',
      });
    }
    if (!billIsFormula) {
      failures.push({
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        associateId: r.associateId,
        visitDate: r.visitDate ? r.visitDate.toLocaleDateString() : '',
        cell: 'Bill',
        value: r.billValue,
        issue: 'Hardcoded value — no formula',
      });
    }
  }

  const pass = failures.length === 0;
  return {
    checkId: 2,
    checkName: 'Formula Compliance',
    status: pass ? 'pass' : 'fail',
    stats: `${detailRows.length} rows checked, ${failures.length} hardcoded cell${failures.length === 1 ? '' : 's'} found`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
