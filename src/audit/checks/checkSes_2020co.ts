// Check 16 (SES) — 2020CO Internal Rows
// Flag any Detail rows where Client Store ID = "2020CO" — internal corporate entries
// that should have been removed before invoicing.

import type { CheckResult, LaborRow } from '../types';

export function checkSes2020co(detailRows: LaborRow[]): CheckResult {
  const flagged = detailRows.filter(
    (r) => r.clientStoreId.toUpperCase() === '2020CO',
  );

  return {
    checkId: 16,
    checkName: '2020CO Internal Rows',
    status: flagged.length === 0 ? 'pass' : 'fail',
    stats: flagged.length === 0
      ? 'No 2020CO internal rows found'
      : `${flagged.length} row${flagged.length === 1 ? '' : 's'} with Client Store ID = 2020CO`,
    flaggedCount: flagged.length,
    flaggedRows: flagged.map((r) => ({
      rowNum: r.rowNum,
      employeeName: r.employeeName,
      associateId: r.associateId,
      clientStoreId: r.clientStoreId,
      visitDate: r.visitDate ? r.visitDate.toLocaleDateString() : '',
      timeHours: r.timeHours,
      billValue: r.billValue,
      issue: 'Internal 2020CO store entry — should not appear on invoice',
    })),
  };
}
