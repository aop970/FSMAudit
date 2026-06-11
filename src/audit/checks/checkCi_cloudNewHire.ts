// checkCi_cloudNewHire.ts — Check 6 for CI program
// CI Check: Cloud Services tab total must be $0.
// New Hire Fees tab total must be $0.
// Both tabs exist as legacy templates — any non-zero amount is a FAIL.

import type { CheckResult } from '../types';
import { fmtMoney } from '../../lib/num';

export function checkCiCloudNewHire(cloudTotal: number, newHireFeeTotal: number): CheckResult {
  const cloudFail = cloudTotal > 0.01;
  const newHireFail = newHireFeeTotal > 0.01;

  if (cloudFail || newHireFail) {
    const failures: Record<string, unknown>[] = [];
    if (cloudFail) {
      failures.push({
        tab: 'Cloud Services',
        total: fmtMoney(cloudTotal),
        expected: fmtMoney(0),
        issue: 'Cloud Services total must be $0 for CI program',
      });
    }
    if (newHireFail) {
      failures.push({
        tab: 'New Hire Fees',
        total: fmtMoney(newHireFeeTotal),
        expected: fmtMoney(0),
        issue: 'New Hire Fees total must be $0 for CI program',
      });
    }
    return {
      checkId: 6,
      checkName: 'Cloud & New Hire Fees = $0',
      status: 'fail',
      stats: [
        cloudFail ? `Cloud Services: ${fmtMoney(cloudTotal)} (expected $0)` : null,
        newHireFail ? `New Hire Fees: ${fmtMoney(newHireFeeTotal)} (expected $0)` : null,
      ].filter(Boolean).join('; '),
      flaggedCount: failures.length,
      flaggedRows: failures,
    };
  }

  return {
    checkId: 6,
    checkName: 'Cloud & New Hire Fees = $0',
    status: 'pass',
    stats: `Cloud Services ${fmtMoney(cloudTotal)}, New Hire Fees ${fmtMoney(newHireFeeTotal)} — correct for CI`,
    flaggedCount: 0,
    flaggedRows: [],
  };
}
