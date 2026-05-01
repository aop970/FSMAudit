// Check 1 — Labor Billing Validation
// FT: Markup = Base × rules.markupRates.ft | PT: Markup = Base × rules.markupRates.pt | else: 0
// Loaded Rate = Base + Markup; Total Bill = Loaded Rate × Time Hours
// Tolerance ≤ rules.tolerances.dollar per row
// If hourlyRates.fsmI/fsmII are set (> 0), also validates base pay rate against expected rate.

import type { CheckResult, LaborRow } from '../types';
import { fmtMoney } from '../../lib/num';
import { getAuditRules } from '../auditRules';

export function check01Labor(fsmI: LaborRow[], fsmII: LaborRow[], program?: 'fsm' | 'ses'): CheckResult {
  const rules = getAuditRules(program);
  const dollarTol = rules.tolerances.dollar;
  const ftRate = rules.markupRates.ft;
  const ptRate = rules.markupRates.pt;
  const expectedRateI  = rules.hourlyRates.fsmI;
  const expectedRateII = rules.hourlyRates.fsmII;

  const all = [...fsmI, ...fsmII];
  const failures: Record<string, unknown>[] = [];

  for (const r of all) {
    if (r.timeHours === 0 && r.basePayRate === 0) continue;
    const type = r.associateType.toUpperCase().trim();
    // Round MU to 2dp — invoices compute markup as ROUND(base × rate, 2) before multiplying by hours.
    // Using unrounded MU causes compounding deltas (e.g. 8h × $0.005 rounding = $0.04 bill delta).
    const muRaw = type === 'FT'
      ? r.basePayRate * ftRate
      : type === 'PT'
        ? r.basePayRate * ptRate
        : 0;
    const mu   = Math.round(muRaw * 100) / 100;
    const loaded = r.basePayRate + mu;
    const bill   = loaded * r.timeHours;

    const billOk = Math.abs(bill - r.billValue) <= dollarTol;
    const muOk   = Math.abs(mu - r.muValue)     <= dollarTol;

    // Hourly rate validation — only when configured (> 0) and row has a non-zero base rate.
    // OT rows are intentionally billed at half the base rate — skip the rate check for them.
    const isOT = /over.?time/i.test(r.comments);
    const expectedRate = r.sheet === 'FSM I' ? expectedRateI : expectedRateII;
    const rateOk = expectedRate === 0 || r.basePayRate === 0 || isOT
      ? true
      : Math.abs(r.basePayRate - expectedRate) <= dollarTol;

    if (!billOk || !muOk || !rateOk) {
      const entry: Record<string, unknown> = {
        sheet: r.sheet,
        row: r.rowNum,
        name: r.employeeName,
        type: r.associateType,
        hours: r.timeHours.toFixed(2),
        baseRate: fmtMoney(r.basePayRate),
        expectedMU: fmtMoney(mu),
        actualMU: fmtMoney(r.muValue),
        expectedBill: fmtMoney(bill),
        actualBill: fmtMoney(r.billValue),
        deltaBill: fmtMoney(r.billValue - bill),
      };
      if (!rateOk) {
        entry.expectedBaseRate = fmtMoney(expectedRate);
        entry.rateIssue = `Base rate ${fmtMoney(r.basePayRate)} does not match configured ${r.sheet} rate ${fmtMoney(expectedRate)}`;
      }
      failures.push(entry);
    }
  }

  const pass = failures.length === 0;
  return {
    checkId: 1,
    checkName: 'Labor Billing Validation',
    status: pass ? 'pass' : 'fail',
    stats: `${all.length} rows checked, ${failures.length} billing discrepanc${failures.length === 1 ? 'y' : 'ies'} found`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
