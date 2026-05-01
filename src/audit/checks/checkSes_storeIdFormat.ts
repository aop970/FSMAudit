// Check 17 (SES) — Client Store ID Format
// Client Store ID must have ≥2 digit numeric suffix (e.g. BB-07 not BB-7).
// Flag rows where the numeric suffix after the last hyphen is a single digit.

import type { CheckResult, LaborRow } from '../types';

export function checkSesStoreIdFormat(detailRows: LaborRow[]): CheckResult {
  const flagged = detailRows.filter((r) => {
    const id = r.clientStoreId.trim();
    if (!id || id.toUpperCase() === '2020CO') return false;
    const parts = id.split('-');
    const suffix = parts[parts.length - 1];
    // Flag if suffix is exactly one digit (e.g. "7")
    return /^\d{1}$/.test(suffix);
  });

  return {
    checkId: 17,
    checkName: 'Store ID Format',
    status: flagged.length === 0 ? 'pass' : 'fail',
    stats: flagged.length === 0
      ? 'All Client Store IDs have correctly formatted numeric suffix'
      : `${flagged.length} row${flagged.length === 1 ? '' : 's'} with single-digit store ID suffix`,
    flaggedCount: flagged.length,
    flaggedRows: flagged.map((r) => ({
      rowNum: r.rowNum,
      employeeName: r.employeeName,
      associateId: r.associateId,
      clientStoreId: r.clientStoreId,
      visitDate: r.visitDate ? r.visitDate.toLocaleDateString() : '',
      issue: `Store ID "${r.clientStoreId}" has single-digit suffix — expected 2-digit (e.g. "${r.clientStoreId.replace(/-(\d)$/, '-0$1')}")`,
    })),
  };
}
