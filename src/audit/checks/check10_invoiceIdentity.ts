// Check 10 — Invoice Identity
// E13 of the first tab = invoice number.
// Verify: (1) first tab name matches invoice number, (2) filename (no extension) matches invoice number.

import type { CheckResult } from '../types';

export function check10InvoiceIdentity(
  invoiceNumber: string | null,
  firstTabName: string | null,
  fileName: string,
): CheckResult {
  if (!invoiceNumber) {
    return {
      checkId: 10,
      checkName: 'Invoice Identity',
      status: 'warning',
      stats: 'Invoice number not found in cell E13 of first tab',
      flaggedCount: 1,
      flaggedRows: [{ issue: 'E13 is empty or unreadable', fileName, firstTabName: firstTabName ?? '—' }],
    };
  }

  const fileBase = fileName.replace(/\.[^/.]+$/, ''); // strip extension
  const failures: Record<string, unknown>[] = [];

  if (firstTabName && firstTabName.trim().toLowerCase() !== invoiceNumber.trim().toLowerCase()) {
    failures.push({
      field: 'Tab Name',
      expected: invoiceNumber,
      actual: firstTabName,
      issue: 'First tab name does not match invoice number in E13',
    });
  }

  if (fileBase.trim().toLowerCase() !== invoiceNumber.trim().toLowerCase()) {
    failures.push({
      field: 'File Name',
      expected: invoiceNumber,
      actual: fileBase,
      issue: 'File name does not match invoice number in E13',
    });
  }

  const pass = failures.length === 0;
  return {
    checkId: 10,
    checkName: 'Invoice Identity',
    status: pass ? 'pass' : 'fail',
    stats: pass
      ? `Invoice number "${invoiceNumber}" matches tab name and file name`
      : `${failures.length} identity mismatch${failures.length > 1 ? 'es' : ''} — invoice number "${invoiceNumber}"`,
    flaggedCount: failures.length,
    flaggedRows: failures,
  };
}
