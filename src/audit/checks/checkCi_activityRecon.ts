// checkCi_activityRecon.ts — Check 3 for CI program
// Three-way: Invoice detail hours ↔ BUP Activity hours (for hourly associates).
// Monthly associates: skip per-day recon; check total headcount.
// Hourly associates: invoice Time Hours per person/date must reconcile to Activity hours within tolerances.hours.

import type { CheckResult, CiDetailRow, CiActivityRow, CiControlEntry } from '../types';
import { getAuditRules } from '../auditRules';

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function checkCiActivityRecon(
  detailRows: CiDetailRow[],
  activityRows: CiActivityRow[],
  ciControlMap: Map<string, CiControlEntry>,
): CheckResult {
  if (activityRows.length === 0) {
    return {
      checkId: 3,
      checkName: 'Activity Reconciliation',
      status: 'na',
      stats: 'No Activity files uploaded — recon skipped',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const rules = getAuditRules('ci');
  const tolerance = rules.tolerances.hours;

  // Build invoice hours map: (associateId|dateKey) → total invoiced hours
  const invoiceMap = new Map<string, { hours: number; name: string }>();
  for (const r of detailRows) {
    if (!r.visitDate) continue;
    const entry = ciControlMap.get(r.associateId);
    const billFormat = entry?.billFormat ?? r.layoutType;
    if (billFormat !== 'Hourly') continue; // skip Monthly for per-day recon

    const key = `${r.associateId}|${dateKey(r.visitDate)}`;
    const existing = invoiceMap.get(key);
    if (existing) {
      existing.hours += r.timeHours;
    } else {
      invoiceMap.set(key, { hours: r.timeHours, name: r.employeeName });
    }
  }

  // Build activity hours map: (associateId|dateKey) → total activity hours
  const activityMap = new Map<string, number>();
  for (const r of activityRows) {
    if (!r.visitDate) continue;
    const key = `${r.associateId}|${dateKey(r.visitDate)}`;
    activityMap.set(key, (activityMap.get(key) ?? 0) + r.timeHours);
  }

  const failures: Record<string, unknown>[] = [];

  // Check each invoiced hourly row against activity
  for (const [key, invoiced] of invoiceMap) {
    const activityHours = activityMap.get(key) ?? 0;
    const diff = Math.abs(invoiced.hours - activityHours);
    if (diff > tolerance) {
      const [associateId, dk] = key.split('|');
      failures.push({
        associateId,
        employeeName: invoiced.name,
        date: dk,
        invoicedHours: invoiced.hours.toFixed(2),
        activityHours: activityHours.toFixed(2),
        difference: diff.toFixed(2),
        issue: activityHours === 0
          ? 'No activity record found for this associate/date'
          : 'Hours mismatch between invoice and activity report',
      });
    }
  }

  const totalChecked = invoiceMap.size;
  const pass = failures.length === 0;
  return {
    checkId: 3,
    checkName: 'Activity Reconciliation',
    status: pass ? 'pass' : 'fail',
    stats: `${totalChecked} hourly associate/date combination${totalChecked === 1 ? '' : 's'} checked — ${failures.length} discrepanc${failures.length === 1 ? 'y' : 'ies'} found`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
