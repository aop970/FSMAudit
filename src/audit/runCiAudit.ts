// runCiAudit.ts — CI audit orchestrator.
// Runs checks: 1(Labor), 2(Formulas), 3(Activity Recon), 4(Holiday Split),
//   6(Cloud+NewHire=$0), 9(TieOut), 10(Identity), 11(DateRange), 13(PO),
//   8(Roster), 15(CustomRules), and N/A stubs for 5(Mgmt), 7(OT), 12(TimeOff),
//   14(TermedPTO), 16(RI Sunday), 17(OT Math), 18(Holiday Pay Validation).

import type { AuditPayload, CheckResult, CiControlEntry, CiParsedData } from './types';
import { checkCiLaborBilling } from './checks/checkCi_laborBilling';
import { checkCiFormulas } from './checks/checkCi_formulas';
import { checkCiActivityRecon } from './checks/checkCi_activityRecon';
import { checkCiHolidaySplit } from './checks/checkCi_holidaySplit';
import { checkCiCloudNewHire } from './checks/checkCi_cloudNewHire';
import { checkCiTieOut } from './checks/checkCi_tieOut';
import { checkCiInvoiceIdentity } from './checks/checkCi_invoiceIdentity';
import { checkCiDateRange } from './checks/checkCi_dateRange';
import { checkCiPoNumber } from './checks/checkCi_poNumber';
import { checkCiRosterMapping } from './checks/checkCi_rosterMapping';
import { checkCiCustomRules } from './checks/checkCi_customRules';

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function runCiAudit(parsed: CiParsedData, controlTable: CiControlEntry[]): AuditPayload {
  // Build ciControlMap: associateId → CiControlEntry
  const ciControlMap = new Map<string, CiControlEntry>();
  for (const entry of controlTable) {
    if (entry.associateId) {
      ciControlMap.set(entry.associateId, entry);
    }
  }

  const detailRows = parsed.detailRows;

  // Summary calculations
  const fieldLaborTotal = detailRows.reduce((s, r) => s + r.billValue, 0);
  const managementTotal = 0; // CI has no management allocation tab
  const cloudTotal = parsed.cloudTotal;
  const reconstructedTotal = fieldLaborTotal + managementTotal + cloudTotal;
  const invoiceTotal = parsed.tieOutInvoiceTotal !== null
    ? parsed.tieOutInvoiceTotal
    : parsed.coverMeta.totalDue ?? null;
  const variance = invoiceTotal !== null ? invoiceTotal - reconstructedTotal : null;

  const uniqueIds = new Set<string>();
  for (const r of detailRows) if (r.associateId) uniqueIds.add(r.associateId);

  // N/A stubs for checks not applicable to CI
  const naManagement: CheckResult = {
    checkId: 5,
    checkName: 'Management Billing',
    status: 'na',
    stats: 'CI bills field associates per manager; no management allocation tab.',
    flaggedCount: 0,
    flaggedRows: [],
  };

  const naOtApproval: CheckResult = {
    checkId: 7,
    checkName: 'OT Approval',
    status: 'na',
    stats: 'CI does not use OT Approval tab.',
    flaggedCount: 0,
    flaggedRows: [],
  };

  const naTimeOff: CheckResult = {
    checkId: 12,
    checkName: 'Time Off Reconciliation',
    status: 'na',
    stats: parsed.timeOffRows.length > 0
      ? 'Time Off file uploaded but recon not yet implemented for CI.'
      : 'No Time Off file uploaded — skipped.',
    flaggedCount: 0,
    flaggedRows: [],
  };

  const naTermedPto: CheckResult = {
    checkId: 14,
    checkName: 'Termed PTO',
    status: 'na',
    stats: 'No Termed PTO file for CI.',
    flaggedCount: 0,
    flaggedRows: [],
  };

  const naRiSunday: CheckResult = {
    checkId: 16,
    checkName: 'RI Sunday Premium',
    status: 'na',
    stats: 'Not applicable for CI.',
    flaggedCount: 0,
    flaggedRows: [],
  };

  const naOtMath: CheckResult = {
    checkId: 17,
    checkName: 'OT Math',
    status: 'na',
    stats: 'CI OT math validated in Check 1.',
    flaggedCount: 0,
    flaggedRows: [],
  };

  const naHolidayPay: CheckResult = {
    checkId: 18,
    checkName: 'Holiday Pay Validation',
    status: 'na',
    stats: 'CI holiday logic handled in Check 4 (Holiday Split).',
    flaggedCount: 0,
    flaggedRows: [],
  };

  // Run active checks
  const check01 = checkCiLaborBilling(detailRows, ciControlMap, 'ci');
  const check02 = checkCiFormulas(detailRows);
  const check03 = checkCiActivityRecon(detailRows, parsed.activityRows, ciControlMap);
  const check04 = checkCiHolidaySplit(detailRows, parsed.activityRows, ciControlMap, parsed.coverMeta);
  const check06 = checkCiCloudNewHire(parsed.cloudTotal, parsed.newHireFeeTotal);
  const check08 = checkCiRosterMapping(parsed.fileName, detailRows, parsed.ciRosterRows, ciControlMap);
  const check09 = checkCiTieOut(detailRows, parsed.tieOutInvoiceTotal, parsed.coverMeta.totalDue ?? null);
  const check10 = checkCiInvoiceIdentity(parsed.fileName, parsed.coverMeta);
  const check11 = checkCiDateRange(detailRows, parsed.coverMeta);
  const check13 = checkCiPoNumber(parsed.fileName, parsed.coverMeta);
  const check15 = checkCiCustomRules([], []);

  // Assemble results sorted by checkId ascending
  const results: CheckResult[] = [
    check01,
    check02,
    check03,
    check04,
    naManagement,
    check06,
    naOtApproval,
    check08,
    check09,
    check10,
    check11,
    naTimeOff,
    check13,
    naTermedPto,
    check15,
    naRiSunday,
    naOtMath,
    naHolidayPay,
  ].sort((a, b) => a.checkId - b.checkId);

  // Declared period from cover meta
  const declaredPeriod =
    parsed.coverMeta.activityDateStart && parsed.coverMeta.activityDateEnd
      ? {
          start: fmtDate(parsed.coverMeta.activityDateStart),
          end: fmtDate(parsed.coverMeta.activityDateEnd),
        }
      : null;

  return {
    invoiceFile: parsed.fileName,
    punchFile: null,
    generatedAt: new Date().toISOString(),
    weeksCovered: parsed.weeksCovered,
    declaredPeriod,
    summary: {
      totalLaborRows: detailRows.length,
      totalFieldAssociates: uniqueIds.size,
      fieldLaborTotal,
      managementTotal,
      cloudTotal,
      reconstructedTotal,
      invoiceTotal,
      variance,
    },
    results,
    crossTabNotes: parsed.crossTabNotes,
  };
}
