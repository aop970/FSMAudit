// checkCi_rosterMapping.ts — Check 8 for CI program
// Every associate on the invoice must be assigned to that invoice's letter in the roster.
// Associates in roster for that letter who have no invoice rows → warn (may be on leave).
// Associates on invoice but not in roster → fail.
// Rate validation: if ciControlMap has entry with baseRate > 0, validate.

import type { CheckResult, CiDetailRow, CiRosterRow, CiControlEntry } from '../types';

function extractInvoiceLetter(fileBase: string): string | null {
  // VOC invoices: filename starts with "VOC"
  if (/^VOC/i.test(fileBase)) return null; // VOC invoices don't use letter mapping

  // CI letter invoices: e.g. CI26-W19-22X → last char before any extension or end
  // Pattern: ends with a capital letter after the week range
  const match = fileBase.match(/[A-Z]$/i);
  if (match) return match[0].toUpperCase();

  return null;
}

function getAssignedLetter(row: CiRosterRow): string | null {
  // Check notes field: "CI-X" pattern
  const notesMatch = row.notes.match(/CI-([A-Z])/i);
  if (notesMatch) return notesMatch[1].toUpperCase();

  // Check type3 field: "Invoice X" or "Invoice K" etc.
  const type3Match = row.type3.match(/Invoice\s+([A-Z])/i);
  if (type3Match) return type3Match[1].toUpperCase();

  return null;
}

export function checkCiRosterMapping(
  fileName: string,
  detailRows: CiDetailRow[],
  ciRosterRows: CiRosterRow[],
  _ciControlMap: Map<string, CiControlEntry>,  // reserved for future rate validation
): CheckResult {
  if (ciRosterRows.length === 0) {
    return {
      checkId: 8,
      checkName: 'Roster / Letter Mapping',
      status: 'na',
      stats: 'No Roster file uploaded',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const fileBase = fileName.replace(/\.[^/.]+$/, '').trim();
  const invoiceLetter = extractInvoiceLetter(fileBase);

  if (invoiceLetter === null) {
    // VOC or unrecognized format — skip letter mapping
    return {
      checkId: 8,
      checkName: 'Roster / Letter Mapping',
      status: 'na',
      stats: `Invoice "${fileBase}" is a VOC or non-letter invoice — roster letter mapping skipped`,
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // Build set of associate IDs on the invoice
  const invoiceAssociates = new Set<string>();
  const invoiceNameMap = new Map<string, string>();
  for (const r of detailRows) {
    if (r.associateId) {
      invoiceAssociates.add(r.associateId);
      invoiceNameMap.set(r.associateId, r.employeeName);
    }
  }

  // Build set of associate IDs assigned to this invoice letter from roster
  const rosterAssociatesForLetter = new Set<string>();
  const rosterNameMap = new Map<string, string>();
  for (const r of ciRosterRows) {
    const letter = getAssignedLetter(r);
    if (letter === invoiceLetter) {
      rosterAssociatesForLetter.add(r.associateId);
      rosterNameMap.set(r.associateId, r.employeeName);
    }
  }

  const failures: Record<string, unknown>[] = [];
  const warnings: Record<string, unknown>[] = [];

  // Fail: associate on invoice but NOT in roster for this letter
  for (const id of invoiceAssociates) {
    if (!rosterAssociatesForLetter.has(id)) {
      failures.push({
        associateId: id,
        employeeName: invoiceNameMap.get(id) ?? '',
        invoiceLetter,
        issue: `Associate on invoice but not assigned to CI-${invoiceLetter} in roster`,
      });
    }
  }

  // Warning: associate in roster for letter but not on invoice (may be on leave)
  for (const id of rosterAssociatesForLetter) {
    if (!invoiceAssociates.has(id)) {
      warnings.push({
        associateId: id,
        employeeName: rosterNameMap.get(id) ?? '',
        invoiceLetter,
        issue: `Associate assigned to CI-${invoiceLetter} in roster but has no invoice rows — may be on leave`,
      });
    }
  }

  const allFlags = [...failures, ...warnings];
  const status = failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass';

  return {
    checkId: 8,
    checkName: 'Roster / Letter Mapping',
    status,
    stats: status === 'pass'
      ? `CI-${invoiceLetter}: ${invoiceAssociates.size} invoice associate${invoiceAssociates.size === 1 ? '' : 's'} — all verified in roster`
      : `CI-${invoiceLetter}: ${failures.length} roster mismatch${failures.length === 1 ? '' : 'es'}, ${warnings.length} on-leave warning${warnings.length === 1 ? '' : 's'}`,
    flaggedCount: allFlags.length,
    flaggedRows: allFlags.slice(0, 200),
    details: {
      invoiceLetter,
      invoiceAssociateCount: invoiceAssociates.size,
      rosterAssignedCount: rosterAssociatesForLetter.size,
    },
  };
}
