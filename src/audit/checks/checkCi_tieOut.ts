// checkCi_tieOut.ts — Check 9 for CI program
// CI tie-out: sum of all Detail bill rows must equal cover Total Due.
// Tolerance: ≤ $0.01 pass, ≤ $0.03 warn, > $0.03 fail.

import type { CheckResult, CiDetailRow } from '../types';
import { fmtMoney } from '../../lib/num';
import { getAuditRules } from '../auditRules';

export function checkCiTieOut(
  detailRows: CiDetailRow[],
  tieOutInvoiceTotal: number | null,
  coverTotalDue: number | null,
): CheckResult {
  const rules = getAuditRules('ci');
  const passTol = rules.tolerances.dollar; // ≤ $0.01 → pass
  const warnTol = 0.03;                   // ≤ $0.03 → warning, > $0.03 → fail

  // Reconstruct from detail rows
  const reconstructed = Math.round(
    detailRows.reduce((s, r) => s + r.billValue, 0) * 100,
  ) / 100;

  // Prefer tieOutInvoiceTotal (from Tie-Out tab), fall back to coverTotalDue
  const invoiceTotal = tieOutInvoiceTotal !== null
    ? tieOutInvoiceTotal
    : coverTotalDue;

  if (invoiceTotal === null) {
    return {
      checkId: 9,
      checkName: 'Invoice Tie-Out',
      status: 'warning',
      stats: `Reconstructed total: ${fmtMoney(reconstructed)} — Invoice total not found in Tie-Out tab or Cover`,
      flaggedCount: 1,
      flaggedRows: [
        {
          reconstructed: fmtMoney(reconstructed),
          invoiceTotal: 'Not found',
          variance: 'Unknown',
          source: 'Neither Tie-Out tab total nor cover Total Due was available',
        },
      ],
    };
  }

  const variance = invoiceTotal - reconstructed;
  const absVar = Math.abs(variance);
  const status = absVar <= passTol ? 'pass' : absVar <= warnTol ? 'warning' : 'fail';

  const totalSource = tieOutInvoiceTotal !== null ? 'Tie-Out tab' : 'Cover Total Due';

  return {
    checkId: 9,
    checkName: 'Invoice Tie-Out',
    status,
    stats: `Reconstructed ${fmtMoney(reconstructed)} vs Invoice ${fmtMoney(invoiceTotal)} (${totalSource}) — variance ${fmtMoney(variance)}`,
    flaggedCount: status === 'pass' ? 0 : 1,
    flaggedRows: status === 'pass' ? [] : [
      {
        reconstructed: fmtMoney(reconstructed),
        invoiceTotal: fmtMoney(invoiceTotal),
        variance: fmtMoney(variance),
        source: totalSource,
        detailRowCount: detailRows.length,
      },
    ],
    details: {
      reconstructed,
      invoiceTotal,
      variance,
      detailRowCount: detailRows.length,
      source: totalSource,
    },
  };
}
