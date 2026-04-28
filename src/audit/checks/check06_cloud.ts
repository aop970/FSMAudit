// Check 6 — Cloud Services Validation
// For each row: Billed Amount = Quantity × Rate × Allocation. Tolerance ≤ rules.tolerances.dollar.
// N/A if tab has no rows or all quantities are null.

import type { CheckResult, CloudRow } from '../types';
import { fmtMoney } from '../../lib/num';
import { getAuditRules } from '../auditRules';

export function check06Cloud(cloudRows: CloudRow[]): CheckResult {
  if (cloudRows.length === 0) {
    return {
      checkId: 6,
      checkName: 'Cloud Services Validation',
      status: 'na',
      stats: 'Cloud Services tab not found or empty',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const allNullQty = cloudRows.every((r) => r.quantity === null);
  if (allNullQty) {
    return {
      checkId: 6,
      checkName: 'Cloud Services Validation',
      status: 'na',
      stats: `${cloudRows.length} rows present — all quantities null (cloud charges not billed this period)`,
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const rules = getAuditRules();
  const dollarTol = rules.tolerances.dollar;

  const failures: Record<string, unknown>[] = [];
  let totalBilled = 0;
  let totalExpected = 0;

  for (const r of cloudRows) {
    const qty = r.quantity ?? 0;
    const expected = qty * r.rate * r.allocation;
    totalBilled   += r.amount;
    totalExpected += expected;

    if (Math.abs(r.amount - expected) > dollarTol) {
      failures.push({
        row: r.rowNum,
        name: r.associateName,
        id: r.associateId,
        qty,
        rate: fmtMoney(r.rate),
        allocation: (r.allocation * 100).toFixed(2) + '%',
        expectedAmt: fmtMoney(expected),
        billedAmt: fmtMoney(r.amount),
        delta: fmtMoney(r.amount - expected),
      });
    }
  }

  const pass = failures.length === 0;
  return {
    checkId: 6,
    checkName: 'Cloud Services Validation',
    status: pass ? 'pass' : 'fail',
    stats: `${cloudRows.length} cloud rows checked — billed ${fmtMoney(totalBilled)}, expected ${fmtMoney(totalExpected)}, ${failures.length} error${failures.length === 1 ? '' : 's'}`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
