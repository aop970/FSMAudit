// Check 13 — PO Number
// Reads cell E17 of the first tab and verifies it matches the configured PO#.

import type { CheckResult } from '../types';

export function check13PoNumber(
  e17Value: string | null,
  configuredPo: string,
): CheckResult {
  if (!e17Value) {
    return {
      checkId: 13,
      checkName: 'PO Number (E17)',
      status: 'warning',
      stats: 'Cell E17 of first tab is empty or unreadable',
      flaggedCount: 1,
      flaggedRows: [{ issue: 'E17 is empty or unreadable', configuredPo }],
    };
  }

  const match = e17Value.trim().toLowerCase() === configuredPo.trim().toLowerCase();
  return {
    checkId: 13,
    checkName: 'PO Number (E17)',
    status: match ? 'pass' : 'fail',
    stats: match
      ? `PO# "${e17Value}" matches configured value`
      : `PO# mismatch — E17 has "${e17Value}", expected "${configuredPo}"`,
    flaggedCount: match ? 0 : 1,
    flaggedRows: match
      ? []
      : [{ cell: 'E17', found: e17Value, expected: configuredPo, issue: 'PO# does not match configured value' }],
  };
}
