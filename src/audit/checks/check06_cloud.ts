// Check 6 — Cloud Services Validation
// Cloud Services rows must be billed at 100% allocation.
// Cloud Services Manager rows must use the allocation from the Management Detail Hours tab
// for that associate (averaged across all weeks in the period).

import type { CheckResult, CloudRow, MgmtRow } from '../types';
import { fmtMoney } from '../../lib/num';
import { getAuditRules } from '../auditRules';

function buildMgmtAllocMap(mgmtRows: MgmtRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const m of mgmtRows) {
    const id = m.associateId.toUpperCase();
    totals.set(id, (totals.get(id) ?? 0) + m.allocation);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const avg = new Map<string, number>();
  for (const [id, total] of totals) {
    avg.set(id, total / (counts.get(id) ?? 1));
  }
  return avg;
}

export function check06Cloud(cloudRows: CloudRow[], mgmtRows: MgmtRow[]): CheckResult {
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
  const mgmtAllocMap = buildMgmtAllocMap(mgmtRows);

  const failures: Record<string, unknown>[] = [];

  for (const r of cloudRows) {
    const qty = r.quantity ?? 0;
    const isManager = r.licenseType.toLowerCase().includes('manager');

    if (!isManager) {
      // Cloud Services rows must be billed at 100% allocation
      if (Math.abs(r.allocation - 1.0) > 0.001) {
        const expectedAmt = qty * r.rate * 1.0;
        failures.push({
          row: r.rowNum,
          name: r.associateName,
          id: r.associateId,
          licenseType: r.licenseType,
          allocation: (r.allocation * 100).toFixed(2) + '%',
          expectedAlloc: '100.00%',
          billedAmt: fmtMoney(r.amount),
          expectedAmt: fmtMoney(expectedAmt),
          delta: fmtMoney(r.amount - expectedAmt),
          issue: 'Cloud Services allocation must be 100%',
        });
      }
    } else {
      // Cloud Services Manager rows must match the management table allocation
      const mgmtAlloc = mgmtAllocMap.get(r.associateId.toUpperCase());
      if (mgmtAlloc === undefined) {
        failures.push({
          row: r.rowNum,
          name: r.associateName,
          id: r.associateId,
          licenseType: r.licenseType,
          allocation: (r.allocation * 100).toFixed(2) + '%',
          issue: 'Associate not found in Management Detail Hours tab',
        });
        continue;
      }

      const expectedAmt = qty * r.rate * mgmtAlloc;
      if (Math.abs(r.amount - expectedAmt) > dollarTol) {
        failures.push({
          row: r.rowNum,
          name: r.associateName,
          id: r.associateId,
          licenseType: r.licenseType,
          billedAlloc: (r.allocation * 100).toFixed(2) + '%',
          expectedAlloc: (mgmtAlloc * 100).toFixed(2) + '%',
          billedAmt: fmtMoney(r.amount),
          expectedAmt: fmtMoney(expectedAmt),
          delta: fmtMoney(r.amount - expectedAmt),
          issue: 'Allocation does not match Management Detail Hours',
        });
      }
    }
  }

  // Every manager in the management table must have a row on the Cloud Services tab
  const cloudMgrIds = new Set(
    cloudRows
      .filter((r) => r.licenseType.toLowerCase().includes('manager'))
      .map((r) => r.associateId.toUpperCase()),
  );
  for (const [id, alloc] of mgmtAllocMap) {
    if (!cloudMgrIds.has(id)) {
      const mgmtRow = mgmtRows.find((m) => m.associateId.toUpperCase() === id);
      failures.push({
        name: mgmtRow?.name ?? id,
        id,
        licenseType: 'Cloud Services Manager',
        expectedAlloc: (alloc * 100).toFixed(2) + '%',
        issue: 'Manager present in Management Detail Hours but missing from Cloud Services tab',
      });
    }
  }

  const managerCount  = cloudRows.filter((r) => r.licenseType.toLowerCase().includes('manager')).length;
  const standardCount = cloudRows.length - managerCount;
  const pass = failures.length === 0;

  return {
    checkId: 6,
    checkName: 'Cloud Services Validation',
    status: pass ? 'pass' : 'fail',
    stats: `${cloudRows.length} rows checked (${managerCount} manager @ mgmt allocation, ${standardCount} standard @ 100%), ${failures.length} issue${failures.length === 1 ? '' : 's'}`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
