// runAudit.ts — orchestrates all 9 Tier 1 checks.
// Accepts ParsedData + the loaded control table map.

import type { AuditPayload, CheckResult, ControlTableEntry, ParsedData } from './types';
import { buildControlMap } from './controlTable';
import { check01Labor } from './checks/check01_labor';
import { check02Formulas } from './checks/check02_formulas';
import { check03PunchRecon } from './checks/check03_punchRecon';
import { check04PunchIntegrity } from './checks/check04_punchIntegrity';
import { check05Management } from './checks/check05_management';
import { check06Cloud } from './checks/check06_cloud';
import { check07OtApproval } from './checks/check07_otApproval';
import { check08Roster } from './checks/check08_roster';
import { check09TieOut } from './checks/check09_tieOut';
import { check10InvoiceIdentity } from './checks/check10_invoiceIdentity';
import { check11DateRange } from './checks/check11_dateRange';
import { check12TimeOff } from './checks/check12_timeOff';
import { check13PoNumber } from './checks/check13_poNumber';
import { check14TermedPto } from './checks/check14_termedPto';
import { check15CustomRules } from './checks/check15_customRules';
import { getAuditRules } from './auditRules';

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function runAudit(parsed: ParsedData, controlTable: ControlTableEntry[]): AuditPayload {
  const controlMap = buildControlMap(controlTable);
  const rules = getAuditRules();

  const laborRows = [...parsed.fsmIRows, ...parsed.fsmIIRows];
  const fieldLaborTotal = laborRows.reduce((s, r) => s + r.billValue, 0);
  const managementTotal = parsed.mgmtRows.reduce((s, r) => s + r.totalBill, 0);
  const cloudTotal = parsed.cloudRows.reduce((s, r) => s + r.amount, 0);
  const reconstructedTotal = fieldLaborTotal + managementTotal + cloudTotal;
  const invoiceTotal = parsed.tieOutData?.invoiceTotal ?? null;
  const variance = invoiceTotal !== null ? invoiceTotal - reconstructedTotal : null;

  const uniqueIds = new Set<string>();
  for (const r of laborRows) if (r.associateId) uniqueIds.add(r.associateId);

  const results: CheckResult[] = [
    check01Labor(parsed.fsmIRows, parsed.fsmIIRows),
    check02Formulas(parsed.fsmIRows, parsed.fsmIIRows),
    check03PunchRecon(parsed.fsmIRows, parsed.fsmIIRows, parsed.punchRows),
    check04PunchIntegrity(parsed.punchRows),
    check05Management(parsed.mgmtRows, controlMap),
    check06Cloud(parsed.cloudRows),
    check07OtApproval(parsed.fsmIRows, parsed.fsmIIRows, parsed.otApprovalRows),
    check08Roster(parsed.fsmIRows, parsed.fsmIIRows, parsed.rosterEntries),
    check09TieOut(parsed.tieOutData),
    check10InvoiceIdentity(
      parsed.invoiceNumber,
      parsed.tabNames[0] ?? null,
      parsed.fileName,
    ),
    check11DateRange(parsed.fsmIRows, parsed.fsmIIRows, parsed.declaredPeriod),
    check12TimeOff(parsed.fsmIRows, parsed.fsmIIRows, parsed.timeOffRows),
    check13PoNumber(parsed.e17Value, rules.poNumber),
    check14TermedPto(parsed.fsmIRows, parsed.fsmIIRows, parsed.mgmtRows, parsed.termedPtoRows),
    check15CustomRules(parsed.fsmIRows, parsed.fsmIIRows),
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
