// Check 9 — Invoice Tie-Out
// Reconstruct total: Field Labor (FSM I+II) + Management Total + Cloud Services Total.
// Compare to Invoice Summary total. Tolerance ≤ rules.tolerances.dollar.

import type { CheckResult, TieOutData } from '../types';
import { fmtMoney } from '../../lib/num';
import { getAuditRules } from '../auditRules';

export function check09TieOut(tieOut: TieOutData | null): CheckResult {
  if (!tieOut) {
    return {
      checkId: 9,
      checkName: 'Invoice Tie-Out',
      status: 'na',
      stats: 'No Invoice Summary tab found — cannot verify tie-out',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const rules = getAuditRules();
  const passTol    = rules.tolerances.dollar;   // ≤ $0.01 → pass
  const warnTol    = 0.03;                      // ≤ $0.03 → warning, > $0.03 → fail

  const fieldLaborTotal = tieOut.fsmITotal + tieOut.fsmIITotal;
  const reconstructed = fieldLaborTotal + tieOut.mgmtTotal + tieOut.cloudTotal;
  const invoiceTotal = tieOut.invoiceTotal;

  if (invoiceTotal === null) {
    return {
      checkId: 9,
      checkName: 'Invoice Tie-Out',
      status: 'warning',
      stats: `Reconstructed total: ${fmtMoney(reconstructed)} — Invoice total not found in Invoice Summary tab`,
      flaggedCount: 1,
      flaggedRows: [
        {
          fsmITotal: fmtMoney(tieOut.fsmITotal),
          fsmIITotal: fmtMoney(tieOut.fsmIITotal),
          mgmtTotal: fmtMoney(tieOut.mgmtTotal),
          cloudTotal: fmtMoney(tieOut.cloudTotal),
          reconstructed: fmtMoney(reconstructed),
          invoiceTotal: 'Not found',
          variance: 'Unknown',
        },
      ],
    };
  }

  const variance = invoiceTotal - reconstructed;
  const absVar = Math.abs(variance);
  const status = absVar <= passTol ? 'pass' : absVar <= warnTol ? 'warning' : 'fail';

  return {
    checkId: 9,
    checkName: 'Invoice Tie-Out',
    status,
    stats: `Reconstructed ${fmtMoney(reconstructed)} vs Invoice ${fmtMoney(invoiceTotal)} — variance ${fmtMoney(variance)}`,
    flaggedCount: status === 'pass' ? 0 : 1,
    flaggedRows: status === 'pass' ? [] : [
      {
        fsmITotal: fmtMoney(tieOut.fsmITotal),
        fsmIITotal: fmtMoney(tieOut.fsmIITotal),
        mgmtTotal: fmtMoney(tieOut.mgmtTotal),
        cloudTotal: fmtMoney(tieOut.cloudTotal),
        reconstructed: fmtMoney(reconstructed),
        invoiceTotal: fmtMoney(invoiceTotal),
        variance: fmtMoney(variance),
      },
    ],
    details: {
      fsmITotal: tieOut.fsmITotal,
      fsmIITotal: tieOut.fsmIITotal,
      fieldLaborTotal,
      mgmtTotal: tieOut.mgmtTotal,
      cloudTotal: tieOut.cloudTotal,
      reconstructed,
      invoiceTotal,
      variance,
    },
  };
}
