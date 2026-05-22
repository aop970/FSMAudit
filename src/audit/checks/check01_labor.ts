// Check 1 — Labor Billing Validation
// FT: Markup = Base × rules.markupRates.ft | PT: Markup = Base × rules.markupRates.pt | else: 0
// Loaded Rate = Base + Markup; Total Bill = Loaded Rate × Time Hours
// OT billing (effectiveBase = otHourlyRates.fsmI/II/Merit) applies to:
//   • "Overtime" rows for non-CA associates (note: "Over Time" is normalized at parse time)
//   • "CA Daily Overtime" / "CA Weekly Overtime" rows (always — billed at OT rate)
// Tolerance ≤ rules.tolerances.dollar per row
// If hourlyRates.fsmI/fsmII/Merit are set (> 0), validates base pay rate for non-OT rows.

import type { CheckResult, LaborRow } from '../types';
import { fmtMoney } from '../../lib/num';
import { getAuditRules } from '../auditRules';

// Resolve the configured base/OT rate for a labor row based on its sheet label.
function resolveRates(
  sheet: string,
  rules: ReturnType<typeof getAuditRules>,
): { expectedRate: number; otRate: number } {
  const sheetLower = sheet.toLowerCase();
  if (sheetLower === 'fsm i merit') {
    return {
      expectedRate: rules.hourlyRates.fsmIMerit ?? 0,
      otRate: rules.otHourlyRates.fsmIMerit ?? 0,
    };
  }
  if (sheetLower === 'fsm ii merit') {
    return {
      expectedRate: rules.hourlyRates.fsmIIMerit ?? 0,
      otRate: rules.otHourlyRates.fsmIIMerit ?? 0,
    };
  }
  if (sheetLower === 'fsm i') {
    return {
      expectedRate: rules.hourlyRates.fsmI,
      otRate: rules.otHourlyRates.fsmI,
    };
  }
  // Default: FSM II (and any other sheet label)
  return {
    expectedRate: rules.hourlyRates.fsmII,
    otRate: rules.otHourlyRates.fsmII,
  };
}

export function check01Labor(fsmI: LaborRow[], fsmII: LaborRow[], program?: 'fsm' | 'ses'): CheckResult {
  const rules = getAuditRules(program);
  const dollarTol = rules.tolerances.dollar;
  const ftRate = rules.markupRates.ft;
  const ptRate = rules.markupRates.pt;

  const all = [...fsmI, ...fsmII];
  const failures: Record<string, unknown>[] = [];

  for (const r of all) {
    if (r.timeHours === 0 && r.basePayRate === 0) continue;
    const type = r.associateType.toUpperCase().trim();
    const commentLower = r.comments.trim().toLowerCase();
    const isOverTime    = /overtime/i.test(r.comments);
    const isCADailyOT  = commentLower === 'ca daily overtime';
    const isCAWeeklyOT = commentLower === 'ca weekly overtime';
    const isPRDailyOT  = commentLower === 'puerto rico daily ot';
    const isPRWeeklyOT = commentLower === 'puerto rico weekly ot';
    const isCA = /^ca$/i.test(r.associateState.trim()) || /california/i.test(r.associateState);

    // CA Daily/Weekly OT and PR OT always get OT billing; generic Overtime gets OT billing for non-CA only.
    const useOtBilling = isCADailyOT || isCAWeeklyOT || isPRDailyOT || isPRWeeklyOT || (isOverTime && !isCA);
    const isAnyOT = isOverTime || isCADailyOT || isCAWeeklyOT || isPRDailyOT || isPRWeeklyOT; // used to skip rate check

    const { expectedRate, otRate } = resolveRates(r.sheet, rules);
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
