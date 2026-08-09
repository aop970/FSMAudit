// neverFailPolicy.ts — T-670: some checks are cheap for Allan to verify by
// eye, so per his decision a fail there is downgraded to a warning — a fail
// just means "go look at this," which is exactly what warning already
// signals in this app. This matters for token budget too: T-670 narrows all
// AI analysis to FAIL-only (see aiGate.ts), so a check that's easily
// hand-verified but noisy would otherwise both lose AI attention AND still
// read as a scary red FAIL with no analysis behind it. Downgrading keeps it
// visible without spending AI tokens on it.
//
// SES and FSM are expressed with DIFFERENT policy shapes on purpose — see
// each section below — but both funnel through the same applyNeverFailPolicy
// entry point, and downgrading never touches flaggedRows/flaggedCount/stats:
// the check still reports full detail as a warning, it just can never
// surface as a hard fail.

import type { CheckResult } from './types';

// ── SES — explicit inclusion list, keyed by checkName ───────────────────────
// Allan named this list explicitly (T-670). Unchanged by T-677 — do not edit
// as part of the FSM work; SES's list is keyed by name because none of its
// never-fail checks have a dynamic checkName.
export const NEVER_FAIL_CHECK_NAMES: Readonly<Record<'ses', ReadonlySet<string>>> = {
  ses: new Set<string>([
    '2020CO Internal Rows',    // checkSes_2020co.ts
    'Payroll Tag Exceptions',  // checkSes_payrollTag.ts
    'Holiday Pay Validation',  // check18_holidays.ts — SES-scoped only; FSM's copy is expressed
                                // independently below (T-677), not merged into this entry.
    // NOTE: 'OT Flag' is deliberately NOT listed — runSesAudit.ts's inline
    // check07SesOt already only ever returns 'pass' | 'warning' (verified
    // T-670; no code change needed there).
  ]),
};

// ── FSM — explicit EXCLUSION list, keyed by checkId (T-677) ─────────────────
//
// Allan's ruling (2026-08-09), verbatim: "For FSM, the ones that should be
// never fail are all with exception of: Punch Reconciliation, Management
// Billing Validation, Cloud services Validation, Invoice Tie-Out, and
// Formula Compliance."
//
// That is a rule stated BY EXCEPTION — "everything except these five" — so
// it is expressed here as an exclusion list of the five checks that stay
// fail-capable, rather than an inclusion list of the other fourteen. Two
// reasons:
//   1. It matches how Allan actually phrased it — the five are what he named,
//      not the fourteen.
//   2. A FUTURE check added to runAudit.ts (checkId 20+) is never-fail BY
//      DEFAULT under this scheme, with no code change required here. Under
//      an inclusion list, a newly added check would silently stay
//      fail-capable until someone remembered to add it — the exact silent
//      drift this policy exists to prevent.
//
// Keyed by checkId, NOT checkName: Check 13 (PO Number) builds a DYNAMIC
// checkName that bakes in a cell reference — `PO Number (E17)` on FSM,
// `PO Number (E19)` on SES (check13_poNumber.ts:11) — so a static string key
// would silently stop matching the moment the default cell ref changes, and
// would risk cross-matching the SES variant's name if it ever collided.
// checkId 13 is stable and, per T-670's SES checkId-collision fix, unique
// within a single program's result array, so id-keying is safe here — and
// this list only ever runs against FSM's own results (see runAudit.ts),
// so there is no risk of an FSM checkId accidentally matching an SES result.
//
// checkId <-> checkName pairing, confirmed against source T-677:
//   2 = Formula Compliance            (check02_formulas.ts)
//   3 = Punch Reconciliation          (check03_punchRecon.ts)
//   5 = Management Billing Validation (check05_management.ts)
//   6 = Cloud Services Validation     (check06_cloud.ts)
//   9 = Invoice Tie-Out               (check09_tieOut.ts)
// fsm.fixture.ts / runAudit-coverage assertions cross-check this pairing
// against the live checkName so a future rename trips a test, not a silent
// re-scoping of the policy.
export const FSM_FAIL_CAPABLE_CHECK_IDS: ReadonlySet<number> = new Set<number>([2, 3, 5, 6, 9]);

/**
 * Downgrade any 'fail' result to 'warning' per the program's never-fail
 * policy. flaggedRows/flaggedCount/stats/details are preserved verbatim —
 * the check still reports full detail as a warning, it just can never
 * surface as a hard fail. Non-downgraded results are returned by the same
 * object reference (no unnecessary copy).
 *
 * - 'ses': inclusion — only checks named in NEVER_FAIL_CHECK_NAMES.ses are
 *   downgraded; everything else stays fail-capable.
 * - 'fsm': exclusion — every check is downgraded EXCEPT the checkIds in
 *   FSM_FAIL_CAPABLE_CHECK_IDS, which stay fail-capable. See T-677 above.
 */
export function applyNeverFailPolicy(results: CheckResult[], program: 'fsm' | 'ses'): CheckResult[] {
  if (program === 'fsm') {
    return results.map((r) =>
      r.status === 'fail' && !FSM_FAIL_CAPABLE_CHECK_IDS.has(r.checkId) ? { ...r, status: 'warning' } : r,
    );
  }
  const neverFail = NEVER_FAIL_CHECK_NAMES.ses;
  if (neverFail.size === 0) return results;
  return results.map((r) =>
    r.status === 'fail' && neverFail.has(r.checkName) ? { ...r, status: 'warning' } : r,
  );
}
