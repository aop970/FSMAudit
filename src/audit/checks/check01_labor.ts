// Check 1 — Labor Billing Validation
// FT: Markup = Base × rules.markupRates.ft | PT: Markup = Base × rules.markupRates.pt | else: 0
// Loaded Rate = Base + Markup; Total Bill = Loaded Rate × Time Hours
// OT billing (effectiveBase = otHourlyRates.fsmI/II) applies to:
//   • "Overtime" rows for non-CA associates (note: "Over Time" is normalized at parse time)
//   • "CA Daily OT" rows (always — this type is always billed at OT rate)
// Tolerance ≤ rules.tolerances.dollar per row
// If hourlyRates.fsmI/fsmII are set (> 0), validates base pay rate for non-OT rows.

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
  const otRateI  = rules.otHourlyRates.fsmI;
  const otRateII = rules.otHourlyRates.fsmII;

  const all = [...fsmI, ...fsmII];
  const failures: Record<string, unknown>[] = [];

  for (const r of all) {
    if (r.timeHours === 0 && r.basePayRate === 0) continue;
    const type = r.associateType.toUpperCase().trim();
    const isOverTime  = /overtime/i.test(r.comments);
    const isCADailyOT = /ca\s*daily\s*ot/i.test(r.comments);
    const isCA = /^ca$/i.test(r.associateState.trim()) || /california/i.test(r.associateState);

    // CA Daily OT always gets OT billing; regular Over Time gets OT billing only for non-CA.
    const useOtBilling = isCADailyOT || (isOverTime && !isCA);
    const isAnyOT = isOverTime || isCADailyOT; // used to skip rate check

    const otRate = r.sheet === 'FSM I' ? otRateI : otRateII;
    const effectiveBase = (useOtBilling && otRate > 0) ? otRate : r.basePayRate;

    const mu = type === 'FT'
      ? effectiveBase * ftRate
      : type === 'PT'
        ? effectiveBase * ptRate
        : 0;
    const loaded = effectiveBase + mu;
    const bill   = loaded * r.timeHours;

    const billOk = Math.abs(bill - r.billValue) <= dollarTol;
    const muOk   = Math.abs(mu - r.muValue)     <= dollarTol;

    // Hourly rate validation — only for non-OT rows (OT rows store full base rate in
    // the spreadsheet but bill at the OT rate, so the rate check is skipped for them).
    const expectedRate = r.sheet === 'FSM I' ? expectedRateI : expectedRateII;
    const rateOk = expectedRate === 0 || r.basePayRate === 0 || isAnyOT
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
