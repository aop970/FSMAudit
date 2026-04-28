// Check 2 — Formula Compliance
// Every MU amount cell and Total Bill cell on FSM I/II must be a formula,
// not a hardcoded value. Uses cell.f from SheetJS (cellFormula:true parse).

import type { CheckResult, LaborRow } from '../types';

export function check02Formulas(fsmI: LaborRow[], fsmII: LaborRow[]): CheckResult {
  const all = [...fsmI, ...fsmII];
  const failures: Record<string, unknown>[] = [];

  for (const r of all) {
    if (r.timeHours === 0 && r.basePayRate === 0) continue;
    const muIsFormula   = r.muFormula !== undefined;
    const billIsFormula = r.billFormula !== undefined;

    if (!muIsFormula) {
      failures.push({
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
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
    stats: `${all.length} rows checked, ${failures.length} hardcoded cell${failures.length === 1 ? '' : 's'} found`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
