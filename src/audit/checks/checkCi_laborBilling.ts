// checkCi_laborBilling.ts — Check 1 for CI program
// Validates each Detail row's math: flat 30% markup.
// Monthly layout: MU = PreMarkUpTotal × 0.30; SalaryTotal = PreMarkUpTotal + MU
// Hourly layout:  Bill = (TimeHours × BasePayRate) + (TimeHours × BasePayRate × 0.30)
//               = BasePayRate × TimeHours × 1.30
// OT rows: OT bill = OtHours × OtRate × 1.30 (separate row; validated when otHours > 0)
//
// Also validates base rate against ciControlMap if rate > 0 is configured.

import type { CheckResult, CiDetailRow, CiControlEntry } from '../types';
import { fmtMoney } from '../../lib/num';
import { getAuditRules } from '../auditRules';

export function checkCiLaborBilling(
  detailRows: CiDetailRow[],
  ciControlMap: Map<string, CiControlEntry>,
  program: 'ci',
): CheckResult {
  const rules = getAuditRules(program);
  const tolerance = rules.tolerances.dollar;

  if (detailRows.length === 0) {
    return {
      checkId: 1,
      checkName: 'Labor Billing Validation',
      status: 'na',
      stats: 'No detail rows found',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const failures: Record<string, unknown>[] = [];

  for (const r of detailRows) {
    if (r.timeHours === 0 && r.basePayRate === 0) continue;

    // Rate validation against ciControlMap
    const entry = ciControlMap.get(r.associateId);
    if (entry && entry.baseRate > 0) {
      if (Math.abs(r.basePayRate - entry.baseRate) > tolerance) {
        failures.push({
          rowNum: r.rowNum,
          sheet: r.sheet,
          employeeName: r.employeeName,
          associateId: r.associateId,
          visitDate: r.visitDate ? r.visitDate.toLocaleDateString() : '',
          issue: 'Base pay rate mismatch vs control table',
          invoicedRate: fmtMoney(r.basePayRate),
          configuredRate: fmtMoney(entry.baseRate),
          difference: fmtMoney(Math.abs(r.basePayRate - entry.baseRate)),
        });
        continue; // skip math check when base rate is wrong
      }
    }

    if (r.layoutType === 'Monthly') {
      // For Monthly: MU = PreMarkUpTotal × 0.30; SalaryTotal = PreMarkUpTotal + MU
      const expectedMu = r.preMarkUpTotal * 0.30;
      const expectedSalaryTotal = r.preMarkUpTotal + expectedMu;

      if (Math.abs(r.muValue - expectedMu) > tolerance) {
        failures.push({
          rowNum: r.rowNum,
          sheet: r.sheet,
          employeeName: r.employeeName,
          associateId: r.associateId,
          visitDate: r.visitDate ? r.visitDate.toLocaleDateString() : '',
          layoutType: r.layoutType,
          issue: 'MU amount mismatch (expected PreMarkUpTotal × 30%)',
          expectedMu: fmtMoney(expectedMu),
          invoicedMu: fmtMoney(r.muValue),
          preMarkUpTotal: fmtMoney(r.preMarkUpTotal),
          difference: fmtMoney(Math.abs(r.muValue - expectedMu)),
        });
      }

      if (Math.abs(r.salaryTotal - expectedSalaryTotal) > tolerance) {
        failures.push({
          rowNum: r.rowNum,
          sheet: r.sheet,
          employeeName: r.employeeName,
          associateId: r.associateId,
          visitDate: r.visitDate ? r.visitDate.toLocaleDateString() : '',
          layoutType: r.layoutType,
          issue: 'Salary total mismatch (expected PreMarkUpTotal + MU)',
          expectedSalaryTotal: fmtMoney(expectedSalaryTotal),
          invoicedSalaryTotal: fmtMoney(r.salaryTotal),
          difference: fmtMoney(Math.abs(r.salaryTotal - expectedSalaryTotal)),
        });
      }
    } else {
      // Hourly layout: Bill = BasePayRate × Hours × 1.30.
      // Regular rows carry TimeHours; separate Overtime rows carry OtHours with
      // TimeHours blank (0). Validate against total billable hours so OT rows are
      // not falsely flagged as $0-expected. The OT row stores its own rate in
      // basePayRate, so a single (timeHours + otHours) term covers both cases.
      const billableHours = r.timeHours + r.otHours;
      const baseBill = r.basePayRate * billableHours * 1.30;
      const expectedBill = Math.round(baseBill * 100) / 100;

      if (Math.abs(r.billValue - expectedBill) > tolerance) {
        const isOtRow = r.timeHours === 0 && r.otHours > 0;
        failures.push({
          rowNum: r.rowNum,
          sheet: r.sheet,
          employeeName: r.employeeName,
          associateId: r.associateId,
          visitDate: r.visitDate ? r.visitDate.toLocaleDateString() : '',
          layoutType: r.layoutType,
          timeHours: r.timeHours,
          otHours: r.otHours,
          basePayRate: fmtMoney(r.basePayRate),
          issue: isOtRow
            ? 'Overtime bill amount mismatch (expected BasePayRate × OtHours × 1.30)'
            : 'Hourly bill amount mismatch (expected BasePayRate × Hours × 1.30)',
          expectedBill: fmtMoney(expectedBill),
          invoicedBill: fmtMoney(r.billValue),
          difference: fmtMoney(Math.abs(r.billValue - expectedBill)),
        });
      }
    }
  }

  // Determine status: warning if ≤ 2 small failures, fail if more
  let status: 'pass' | 'fail' | 'warning';
  if (failures.length === 0) {
    status = 'pass';
  } else if (failures.length <= 2) {
    // Check if all differences are small
    const allSmall = failures.every((f) => {
      const diff = typeof f.difference === 'string'
        ? parseFloat((f.difference as string).replace(/[$,]/g, ''))
        : 0;
      return diff <= 0.05;
    });
    status = allSmall ? 'warning' : 'fail';
  } else {
    status = 'fail';
  }

  return {
    checkId: 1,
    checkName: 'Labor Billing Validation',
    status,
    stats: failures.length === 0
      ? `${detailRows.length} detail row${detailRows.length === 1 ? '' : 's'} checked — all labor billing math correct`
      : `${detailRows.length} rows checked, ${failures.length} billing discrepanc${failures.length === 1 ? 'y' : 'ies'} found`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
