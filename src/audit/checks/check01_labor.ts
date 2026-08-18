// Check 1 — Labor Billing Validation
// FT: Markup = Base × rules.markupRates.ft | PT: Markup = Base × rules.markupRates.pt | else: 0
// Loaded Rate = Base + Markup; Total Bill = Loaded Rate × Time Hours
// OT billing (effectiveBase = otHourlyRates.fsmI/II/Merit) applies to:
//   • "Overtime" rows for non-CA associates (note: "Over Time" is normalized at parse time)
//   • "CA Daily Overtime" / "CA Weekly Overtime" rows (always — billed at OT rate)
// Bill tolerance: BILL_TOL ($0.05) per row — wider than rules.tolerances.dollar to absorb
//   invoice-side per-unit rate truncation (the invoice truncates the loaded rate to 2 decimal
//   places before multiplying by hours; our full-precision computation diverges by up to $0.02
//   per row). Markup and rate comparisons still use rules.tolerances.dollar (default $0.01).
// If hourlyRates.fsmI/fsmII/Merit are set (> 0), validates base pay rate for non-OT rows.
//
// Excluded from Check 1 (validated by dedicated checks instead):
//   • "Paid Holiday" rows — validated by Check 18 (Holiday Pay Validation)
//   • "Time Off" rows    — validated by Check 12 (Time Off Reconciliation)
//   • "Termed PTO" rows  — validated by Check 14 (Termed PTO Validation)
// These row types do not follow the standard base×markup×hours billing formula;
// running Check 1 on them produces false positives when holiday/PTO billing is flat or base-only.

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

// Billing tolerance and the two base-rate conventions:
//
// Real invoices use two different base-rate rounding conventions, and both are correct:
//   A) Rounded convention (T-580, ae675c0): invoice uses the 2-decimal displayed rate.
//      e.g. rawBase=$18.285 → invoice bills at $18.29 → effectiveBase = round(rawBase, 2).
//   B) Full-precision convention (T-730): invoice multiplies at full sub-cent precision,
//      rounding only the final dollar figure.
//      e.g. rawBase=$15.525 → invoice bills at 15.525×1.2993×hours, then rounds.
//
// Both conventions appear in real FSM invoices — there is no single "correct" convention
// to hardcode. Applying only A produced 18 false positives on this week's FSM data (T-730),
// where all 18 rows at rawBase=$15.525 and $18.285 (full-day FT) were flagged.
//
// Fix (T-730): "either-way" check. A row passes if EITHER convention reproduces the
// invoice bill within BILL_TOL. Only rows that fail BOTH are genuine discrepancies.
// When reporting a genuine failure, use the closer of the two expectations so deltaBill
// reflects the true shortfall rather than an artifact of convention choice.
//
// MU_TOL matches BILL_TOL: vendors sometimes truncate the per-unit markup (e.g. $8.62→$8.60)
// before multiplying by hours. This produces a sub-$0.02 MU discrepancy that is cosmetic —
// the bill total is still within BILL_TOL. Using a tight dollarTol on MU produced 165 false
// positives in run #4 (T-496). Rate checks still use rules.tolerances.dollar ($0.01).
const BILL_TOL = 0.05;
const MU_TOL   = BILL_TOL; // absorb vendor-side markup truncation (mirrors bill tolerance)

export function check01Labor(fsmI: LaborRow[], fsmII: LaborRow[], program?: 'fsm' | 'ses'): CheckResult {
  const rules = getAuditRules(program);
  const dollarTol = rules.tolerances.dollar;
  const ftRate = rules.markupRates.ft;
  const ptRate = rules.markupRates.pt;

  const all = [...fsmI, ...fsmII];
  const failures: Record<string, unknown>[] = [];

  for (const r of all) {
    if (r.timeHours === 0 && r.basePayRate === 0) continue;
    const commentLower = r.comments.trim().toLowerCase();
    // Skip row types that have their own dedicated checks and do not follow
    // the standard base×markup×hours formula (Check 12, 14, 18 own these).
    if (
      commentLower === 'paid holiday' ||
      commentLower === 'time off' ||
      commentLower === 'termed pto'
    ) continue;
    const type = r.associateType.toUpperCase().trim();
    const isOverTime    = /overtime/i.test(r.comments);
    const isCADailyOT  = commentLower === 'ca daily overtime' || commentLower === 'ca daily ot';
    const isCAWeeklyOT = commentLower === 'ca weekly overtime' || commentLower === 'ca weekly ot';
    // Accept both "...overtime" and "...ot" forms for PR OT labels.
    const isPRDailyOT  = commentLower === 'puerto rico daily overtime' || commentLower === 'puerto rico daily ot';
    const isPRWeeklyOT = commentLower === 'puerto rico weekly overtime' || commentLower === 'puerto rico weekly ot';
    // RI Sunday Premium Pay rows intentionally carry HALF the configured base rate
    // (basePayRate = base/2, rounded to the cent) — validated by Check 16, not here.
    // Their bill/markup still follow the standard formula (and are checked below), but
    // the configured-rate comparison would false-flag the half-rate against the full rate.
    const isRiSundayPremium = commentLower === 'ri sunday premium pay';
    const isCA = /^ca$/i.test(r.associateState.trim()) || /california/i.test(r.associateState);
    const isPR = /^pr$/i.test(r.associateState.trim()) || /puerto rico/i.test(r.associateState);

    // CA Daily/Weekly OT and PR OT always get OT billing; generic Overtime gets OT billing for non-CA/PR only.
    const useOtBilling = isCADailyOT || isCAWeeklyOT || isPRDailyOT || isPRWeeklyOT || (isOverTime && !isCA && !isPR);
    const isAnyOT = isOverTime || isCADailyOT || isCAWeeklyOT || isPRDailyOT || isPRWeeklyOT; // used to skip rate check

    const { expectedRate, otRate } = resolveRates(r.sheet, rules);
    const rawBase = (useOtBilling && otRate > 0) ? otRate : r.basePayRate;

    // Two base-rate conventions occur in real FSM invoices (see comment block above).
    // Convention A: effectiveBase = round(rawBase, 2) — invoice uses displayed 2-decimal rate.
    // Convention B: effectiveBase = rawBase — invoice uses full sub-cent precision, rounds final bill.
    // When rawBase already has ≤2 decimal places the two are identical (no change in behaviour).
    const effectiveBaseA = Math.round(rawBase * 100) / 100;
    const effectiveBaseB = rawBase; // full precision

    const muA = type === 'FT'
      ? effectiveBaseA * ftRate
      : type === 'PT'
        ? effectiveBaseA * ptRate
        : 0;
    const muB = type === 'FT'
      ? effectiveBaseB * ftRate
      : type === 'PT'
        ? effectiveBaseB * ptRate
        : 0;
    const billA = Math.round((effectiveBaseA + muA) * r.timeHours * 100) / 100;
    const billB = Math.round((effectiveBaseB + muB) * r.timeHours * 100) / 100;

    // Row passes bill check if EITHER convention reproduces the invoice amount within tolerance.
    const billOkA = Math.abs(billA - r.billValue) <= BILL_TOL;
    const billOkB = Math.abs(billB - r.billValue) <= BILL_TOL;
    const billOk  = billOkA || billOkB;

    const muOkA = Math.abs(muA - r.muValue) <= MU_TOL;
    const muOkB = Math.abs(muB - r.muValue) <= MU_TOL;
    const muOk  = muOkA || muOkB;

    // For failure reporting: use the convention whose expected bill is closer to actual,
    // so deltaBill reflects the true shortfall rather than a convention-choice artefact.
    const deltaA = Math.abs(billA - r.billValue);
    const deltaB = Math.abs(billB - r.billValue);
    const closerConvention = deltaA <= deltaB ? 'A' : 'B';
    const mu   = closerConvention === 'A' ? muA   : muB;
    const bill = closerConvention === 'A' ? billA : billB;

    // Hourly rate validation — only for non-OT rows (OT rows store full base rate in
    // the spreadsheet but bill at the OT rate, so the rate check is skipped for them).
    const rateOk = expectedRate === 0 || r.basePayRate === 0 || isAnyOT || isRiSundayPremium
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
        // Which base-rate convention was closer: A=rounded-to-2-decimals, B=full-precision
        closerConvention: closerConvention === 'A' ? 'rounded' : 'full-precision',
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
