// Check 5 — Management Billing Validation
// For each row on Management Detail Hours:
//   - Name, Associate ID, Title, Hourly Rate, Allocation % all match control table
//   - Total = Hours × Hourly Rate (≤ rules.tolerances.dollar)
//   - Total Bill = Hours × Hourly Rate × Allocation % (≤ rules.tolerances.dollar)

import type { CheckResult, ControlTableEntry, MgmtRow } from '../types';
import { fmtMoney, toStr } from '../../lib/num';
import { getAuditRules } from '../auditRules';

export function check05Management(
  mgmtRows: MgmtRow[],
  controlMap: Map<string, ControlTableEntry>,
): CheckResult {
  if (mgmtRows.length === 0) {
    return {
      checkId: 5,
      checkName: 'Management Billing Validation',
      status: 'na',
      stats: 'No Management Detail Hours rows found',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const rules = getAuditRules();
  const dollarTol = rules.tolerances.dollar;
  const within = (a: number, b: number) => Math.abs(a - b) <= dollarTol;

  const failures: Record<string, unknown>[] = [];

  for (const r of mgmtRows) {
    const ctrl = controlMap.get(r.associateId.toUpperCase());
    const issues: string[] = [];

    if (!ctrl) {
      failures.push({
        row: r.rowNum,
        week: r.week,
        name: r.name,
        associateId: r.associateId,
        issue: 'Associate ID not found in control table',
      });
      continue;
    }

    // Field match checks
    if (toStr(r.name).toLowerCase() !== toStr(ctrl.name).toLowerCase())
      issues.push(`Name mismatch: got "${r.name}", expected "${ctrl.name}"`);
    if (toStr(r.title).toLowerCase() !== toStr(ctrl.title).toLowerCase())
      issues.push(`Title mismatch: got "${r.title}", expected "${ctrl.title}"`);
    if (!within(r.hourlyRate, ctrl.hourlyRate))
      issues.push(`Rate mismatch: got ${fmtMoney(r.hourlyRate)}, expected ${fmtMoney(ctrl.hourlyRate)}`);
    if (Math.abs(r.allocation - ctrl.allocationPct) > 0.0001)
      issues.push(`Allocation mismatch: got ${(r.allocation * 100).toFixed(2)}%, expected ${(ctrl.allocationPct * 100).toFixed(2)}%`);

    // Math checks
    const expectedTotal = r.hours * r.hourlyRate;
    const expectedBill  = r.hours * r.hourlyRate * r.allocation;
    if (!within(r.total, expectedTotal))
      issues.push(`Total calc wrong: got ${fmtMoney(r.total)}, expected ${fmtMoney(expectedTotal)}`);
    if (!within(r.totalBill, expectedBill))
      issues.push(`Total Bill calc wrong: got ${fmtMoney(r.totalBill)}, expected ${fmtMoney(expectedBill)}`);

    if (issues.length > 0) {
      failures.push({
        row: r.rowNum,
        week: r.week,
        name: r.name,
        associateId: r.associateId,
        issues: issues.join('; '),
      });
    }
  }

  const pass = failures.length === 0;
  return {
    checkId: 5,
    checkName: 'Management Billing Validation',
    status: pass ? 'pass' : 'fail',
    stats: `${mgmtRows.length} management rows checked, ${failures.length} discrepanc${failures.length === 1 ? 'y' : 'ies'}`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
