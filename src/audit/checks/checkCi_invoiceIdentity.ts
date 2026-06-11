// checkCi_invoiceIdentity.ts — Check 10 for CI program
// filename (no ext) == cover tab name == Invoice # value (case-insensitive).
// Also validate constant header block constants.

import type { CheckResult, CiCoverMeta } from '../types';

export function checkCiInvoiceIdentity(
  fileName: string,
  coverMeta: CiCoverMeta,
): CheckResult {
  const fileBase = fileName.replace(/\.[^/.]+$/, '').trim();
  const failures: Record<string, unknown>[] = [];

  if (!coverMeta.invoiceNumber) {
    return {
      checkId: 10,
      checkName: 'Invoice Identity',
      status: 'warning',
      stats: 'Invoice number not found in cover tab',
      flaggedCount: 1,
      flaggedRows: [{ issue: 'Invoice number is empty or unreadable', fileName, tabName: coverMeta.tabName ?? '—' }],
    };
  }

  const invoiceNum = coverMeta.invoiceNumber.trim().toLowerCase();
  const fileBaseLow = fileBase.toLowerCase();
  const tabNameLow = coverMeta.tabName?.trim().toLowerCase() ?? null;

  // File name must match invoice number
  if (fileBaseLow !== invoiceNum) {
    failures.push({
      field: 'File Name',
      expected: coverMeta.invoiceNumber,
      actual: fileBase,
      issue: 'File name does not match invoice number',
    });
  }

  // Tab name must match invoice number
  if (tabNameLow !== null && tabNameLow !== invoiceNum) {
    failures.push({
      field: 'Tab Name',
      expected: coverMeta.invoiceNumber,
      actual: coverMeta.tabName,
      issue: 'Cover tab name does not match invoice number',
    });
  }

  // Validate constant header fields
  if (coverMeta.billTo) {
    const billToLow = coverMeta.billTo.toLowerCase();
    if (!billToLow.includes('samsung electronics america')) {
      failures.push({
        field: 'Bill To',
        actual: coverMeta.billTo,
        expected: 'Should contain "Samsung Electronics America"',
        issue: 'Bill To field does not contain expected client name',
      });
    }
  }

  if (coverMeta.remitTo) {
    const remitToLow = coverMeta.remitTo.toLowerCase();
    const hasWellsFargo = remitToLow.includes('wells fargo');
    const has2020 = remitToLow.includes('2020 companies');
    if (!hasWellsFargo && !has2020) {
      failures.push({
        field: 'Remit To',
        actual: coverMeta.remitTo,
        expected: 'Should contain "Wells Fargo" or "2020 Companies"',
        issue: 'Remit To field does not contain expected payment routing',
      });
    }
  }

  const pass = failures.length === 0;
  return {
    checkId: 10,
    checkName: 'Invoice Identity',
    status: pass ? 'pass' : 'fail',
    stats: pass
      ? `Invoice number "${coverMeta.invoiceNumber}" matches tab name and file name; header constants verified`
      : `${failures.length} identity mismatch${failures.length > 1 ? 'es' : ''} — invoice number "${coverMeta.invoiceNumber}"`,
    flaggedCount: failures.length,
    flaggedRows: failures,
  };
}
