// runSesAudit.ts — SES audit orchestrator. Returns AuditPayload.
// Runs 18 checks: 1-2,4-15 reuse FSM checks; 3,16,17,18 are SES-specific.

import type { AuditPayload, CheckResult, ControlTableEntry, ParsedData } from './types';
import { buildSesControlMap } from './sesControlTable';
import { check02Formulas } from './checks/check02_formulas';
import { check03SesThreeWayRecon } from './checks/check03_ses_threeWayRecon';
import { check04PunchIntegrity } from './checks/check04_punchIntegrity';
import { check05Management } from './checks/check05_management';
import { check06Cloud } from './checks/check06_cloud';
import { check09TieOut } from './checks/check09_tieOut';
import { check10InvoiceIdentity } from './checks/check10_invoiceIdentity';
import { check11DateRange } from './checks/check11_dateRange';
import { check12TimeOff } from './checks/check12_timeOff';
import { check13PoNumber } from './checks/check13_poNumber';
import { check14TermedPto } from './checks/check14_termedPto';
import { check15CustomRules } from './checks/check15_customRules';
import { checkSes2020co } from './checks/checkSes_2020co';
import { checkSesStoreIdFormat } from './checks/checkSes_storeIdFormat';
import { checkSesPayrollTag } from './checks/checkSes_payrollTag';
import { getAuditRules } from './auditRules';

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function runSesAudit(parsed: ParsedData, controlTable: ControlTableEntry[]): AuditPayload {
  const controlMap = buildSesControlMap(controlTable);
  const rules = getAuditRules('ses');

  const laborRows = [...parsed.fsmIRows, ...parsed.fsmIIRows];
  const fieldLaborTotal = laborRows.reduce((s, r) => s + r.billValue, 0);
  const managementTotal = parsed.mgmtRows.reduce((s, r) => s + r.totalBill, 0);
  const cloudTotal = parsed.cloudRows.reduce((s, r) => s + r.amount, 0);
  const reconstructedTotal = fieldLaborTotal + managementTotal + cloudTotal;
  const invoiceTotal = parsed.tieOutData?.invoiceTotal ?? null;
  const variance = invoiceTotal !== null ? invoiceTotal - reconstructedTotal : null;

  const uniqueIds = new Set<string>();
  for (const r of laborRows) if (r.associateId) uniqueIds.add(r.associateId);

  // Check 7 — SES OT Flag (inline; no OT Approval tab)
  const check07SesOt: CheckResult = (() => {
    const otRows = laborRows.filter((r) => {
      const c = r.comments.toLowerCase();
      return (c.includes('over time') || c.includes('overtime')) && r.timeHours > rules.otThreshold;
    });
    return {
      checkId: 7,
      checkName: 'OT Flag',
      status: otRows.length === 0 ? 'pass' : 'warning',
      stats: otRows.length === 0
        ? `No OT rows exceed ${rules.otThreshold}h threshold`
        : `${otRows.length} OT row${otRows.length === 1 ? '' : 's'} exceed ${rules.otThreshold}h threshold`,
      flaggedCount: otRows.length,
      flaggedRows: otRows.map((r) => ({
        rowNum: r.rowNum,
        employeeName: r.employeeName,
        associateId: r.associateId,
        timeHours: r.timeHours,
        comments: r.comments,
        visitDate: r.visitDate ? r.visitDate.toLocaleDateString() : '',
      })),
    };
  })();

  // Check 8 — Roster: N/A for SES
  const check08SesRoster: CheckResult = {
    checkId: 8,
    checkName: 'Roster',
    status: 'na',
    stats: 'Roster check not applicable for SES',
    flaggedCount: 0,
    flaggedRows: [],
  };

  const results: CheckResult[] = [
    { checkId: 1, checkName: 'Labor Billing Validation', status: 'na', stats: 'Not applicable for SES — associates have individual rates', flaggedCount: 0, flaggedRows: [] },
    check02Formulas(parsed.fsmIRows, parsed.fsmIIRows),
    check03SesThreeWayRecon(parsed.fsmIRows, parsed.sesPunchRows, parsed.shiftRows),
    check04PunchIntegrity(parsed.punchRows),
    check05Management(parsed.mgmtRows, controlMap),
    check06Cloud(parsed.cloudRows),
    check07SesOt,
    check08SesRoster,
    check09TieOut(parsed.tieOutData),
    check10InvoiceIdentity(
      parsed.invoiceNumber,
      parsed.tabNames[0] ?? null,
      parsed.fileName,
    ),
    check11DateRange(parsed.fsmIRows, parsed.fsmIIRows, parsed.declaredPeriod),
    check12TimeOff(parsed.fsmIRows, parsed.fsmIIRows, parsed.timeOffRows),
    check13PoNumber(parsed.e17Value, rules.poNumber, 'E19'),
    check14TermedPto(parsed.fsmIRows, parsed.fsmIIRows, parsed.mgmtRows, parsed.termedPtoRows),
    check15CustomRules(parsed.fsmIRows, parsed.fsmIIRows),
    checkSes2020co(parsed.fsmIRows),
    checkSesStoreIdFormat(parsed.fsmIRows),
    checkSesPayrollTag(parsed.sesPunchRows, parsed.declaredPeriod),
  ];

  const period = parsed.declaredPeriod
    ? { start: fmtDate(parsed.declaredPeriod.start), end: fmtDate(parsed.declaredPeriod.end) }
    : null;

  return {
    invoiceFile: parsed.fileName,
    punchFile: parsed.punchFileName,
    generatedAt: new Date().toISOString(),
    weeksCovered: parsed.weeksCovered,
    declaredPeriod: period,
    summary: {
      totalLaborRows: laborRows.length,
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
