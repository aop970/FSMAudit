// aiGate.ts — single choke point for "is this check eligible for AI analysis"
// (T-670). Allan's instruction: in the interest of token budget, AI analysis
// (Haiku per-check, Sonnet synthesis, Sonnet Deep Dive) should run on FAIL
// checks only — never PASS, WARNING, or N/A.
//
// Every AI entry point imports this instead of re-writing the predicate:
// bragiClient.ts (runTieredAnalysis), CheckCard.tsx (Analyze with Bragi
// button), AnalyzeAllButton.tsx, and App.tsx's Analyze-All gates. One
// function, no drift between call sites.

import type { CheckResult, CheckStatus } from '../audit/types';

export function isAiEligible(status: CheckStatus): boolean {
  return status === 'fail';
}

export function countAiEligible(results: CheckResult[]): number {
  return results.filter((r) => isAiEligible(r.status)).length;
}

// T-671: the "Analyze All" affordance used to require >= 2 eligible checks —
// a threshold written back when eligibility meant fail-or-warning, so it was
// almost always satisfied. T-670 narrowed eligibility to fail-only, and a
// real SES run can easily have exactly one FAIL (confirmed live: Allan's
// production run had one — Check 3). With the old ">= 2" hardcoded
// separately in AnalyzeAllButton.tsx AND App.tsx, that single fail made the
// button vanish entirely from both surfaces. One eligible check is worth a
// combined-report button on its own; both call sites now derive from this
// single constant so they cannot drift again.
export const MIN_AI_ELIGIBLE_FOR_ANALYZE_ALL = 1;

export function shouldShowAnalyzeAll(results: CheckResult[]): boolean {
  return countAiEligible(results) >= MIN_AI_ELIGIBLE_FOR_ANALYZE_ALL;
}
