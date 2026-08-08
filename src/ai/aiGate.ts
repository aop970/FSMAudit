// aiGate.ts — single choke point for "is this check eligible for AI analysis"
// (T-670). Allan's instruction: in the interest of token budget, AI analysis
// (Haiku per-check, Sonnet synthesis, Sonnet Deep Dive) should run on FAIL
// checks only — never PASS, WARNING, or N/A.
//
// Every AI entry point imports this instead of re-writing the predicate:
// bragiClient.ts (runTieredAnalysis), CheckCard.tsx (Analyze + Deep Dive
// buttons), AnalyzeAllButton.tsx, and App.tsx's Analyze-All gate. One
// function, no drift between call sites.

import type { CheckStatus } from '../audit/types';

export function isAiEligible(status: CheckStatus): boolean {
  return status === 'fail';
}
