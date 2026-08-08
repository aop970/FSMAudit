// neverFailPolicy.ts — T-670: some checks are cheap for Allan to verify by
// eye, so per his decision a fail there is downgraded to a warning — a fail
// just means "go look at this," which is exactly what warning already
// signals in this app. This matters for token budget too: T-670 narrows all
// AI analysis to FAIL-only (see aiGate.ts), so a check that's easily
// hand-verified but noisy would otherwise both lose AI attention AND still
// read as a scary red FAIL with no analysis behind it. Downgrading keeps it
// visible without spending AI tokens on it.
//
// Keyed by canonical checkName (stable across renumbering — see T-670's
// SES duplicate-checkId fix in runSesAudit.ts) rather than checkId.
//
// Adding a program's list here is the ENTIRE change needed to downgrade a
// check — no code edits anywhere else. Allan named the SES list explicitly
// and said the FSM list is coming next ("essentially the same ones"); when
// he gives it, add the names to NEVER_FAIL_CHECK_NAMES.fsm and nothing else
// changes.

import type { CheckResult } from './types';

export const NEVER_FAIL_CHECK_NAMES: Readonly<Record<'fsm' | 'ses', ReadonlySet<string>>> = {
  ses: new Set<string>([
    '2020CO Internal Rows',    // checkSes_2020co.ts
    'Payroll Tag Exceptions',  // checkSes_payrollTag.ts
    'Holiday Pay Validation',  // check18_holidays.ts — SES-scoped only; FSM behavior is untouched
    // NOTE: 'OT Flag' is deliberately NOT listed — runSesAudit.ts's inline
    // check07SesOt already only ever returns 'pass' | 'warning' (verified
    // T-670; no code change needed there).
  ]),
  fsm: new Set<string>(), // Allan's FSM list not yet provided (T-670) — add names here, nothing else.
};

/**
 * Downgrade any 'fail' result whose checkName is in this program's
 * never-fail set to 'warning'. flaggedRows/flaggedCount/stats/details are
 * preserved verbatim — the check still reports full detail as a warning,
 * it just can never surface as a hard fail.
 */
export function applyNeverFailPolicy(results: CheckResult[], program: 'fsm' | 'ses'): CheckResult[] {
  const neverFail = NEVER_FAIL_CHECK_NAMES[program];
  if (neverFail.size === 0) return results;
  return results.map((r) =>
    r.status === 'fail' && neverFail.has(r.checkName) ? { ...r, status: 'warning' } : r,
  );
}
