// Check 13 — PO Number
// Reads cell E17 of the first tab and verifies it matches the configured PO#.

import type { CheckResult } from '../types';

export function check13PoNumber(
  cellValue: string | null,
  configuredPo: string,
  cellRef = 'E17',
): CheckResult {
  const label = `PO Number (${cellRef})`;
  if (!cellValue) {
    return {
      checkId: 13,
      checkName: label,
      status: 'warning',
      stats: `Cell ${cellRef} of first tab is empty or unreadable`,
      flaggedCount: 1,
      flaggedRows: [{ issue: `${cellRef} is empty or unreadable`, configuredPo }],
    };
  }

  const match = cellValue.trim().toLowerCase() === configuredPo.trim().toLowerCase();
  return {
    checkId: 13,
    checkName: label,
    status: match ? 'pass' : 'fail',
    stats: match
      ? `PO# "${cellValue}" matches configured value`
      : `PO# mismatch — ${cellRef} has "${cellValue}", expected "${configuredPo}"`,
    flaggedCount: match ? 0 : 1,
    flaggedRows: match
      ? []
      : [{ cell: cellRef, found: cellValue, expected: configuredPo, issue: 'PO# does not match configured value' }],
  };
}
