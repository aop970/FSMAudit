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
import { check16RiSundayPremium } from './checks/check16_riSundayPremium';
import { check17OtMath } from './checks/check17_otMath';
import { getAuditRules } from './auditRules';

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function runAudit(parsed: ParsedData, controlTable: ControlTableEntry[]): AuditPayload {
  const controlMap = buildControlMap(controlTable);
  const rules = getAuditRules();

  const allFsmI  = [...parsed.fsmIRows,  ...parsed.fsmIMeritRows];
  const allFsmII = [...parsed.fsmIIRows, ...parsed.fsmIIMeritRows];
  const laborRows = [...allFsmI, ...allFsmII];
  const fieldLaborTotal = laborRows.reduce((s, r) => s + r.billValue, 0);
  const managementTotal = parsed.mgmtRows.reduce((s, r) => s + r.totalBill, 0);
  const cloudTotal = parsed.cloudRows.reduce((s, r) => s + r.amount, 0);
  const reconstructedTotal = fieldLaborTotal + managementTotal + cloudTotal;
  const invoiceTotal = parsed.tieOutData?.invoiceTotal ?? null;
  const variance = invoiceTotal !== null ? invoiceTotal - reconstructedTotal : null;

  const uniqueIds = new Set<string>();
  for (const r of laborRows) if (r.associateId) uniqueIds.add(r.associateId);

  const results: CheckResult[] = [
    check01Labor(allFsmI, allFsmII),
    check02Formulas(allFsmI, allFsmII),
    check03PunchRecon(allFsmI, allFsmII, parsed.punchRows),
    check04PunchIntegrity(parsed.punchRows),
    check05Management(parsed.mgmtRows, controlMap),
    check06Cloud(parsed.cloudRows, parsed.mgmtRows),
    check07OtApproval(allFsmI, allFsmII, parsed.otApprovalRows),
    check08Roster(allFsmI, allFsmII, parsed.rosterEntries),
    check09TieOut(parsed.tieOutData),
    check10InvoiceIdentity(
      parsed.invoiceNumber,
      parsed.tabNames[0] ?? null,
      parsed.fileName,
    ),
    check11DateRange(allFsmI, allFsmII, parsed.declaredPeriod),
    check12TimeOff(allFsmI, allFsmII, parsed.timeOffRows, parsed.mgmtRows),
    check13PoNumber(parsed.e17Value, rules.poNumber),
    check14TermedPto(allFsmI, allFsmII, parsed.mgmtRows, parsed.termedPtoRows),
    check15CustomRules(allFsmI, allFsmII),
    check16RiSundayPremium(allFsmI, allFsmII),
    check17OtMath(allFsmI, allFsmII),
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
