// bragiClient.ts — Tiered AI orchestrator
// Tier 1: Haiku per-check (fast, cheap, 20-row cap) — feeds the "Analyze
//         All" combined report only (see T-671 decision below).
// Synthesis: Sonnet (assembles full report from all Haiku outputs)
// Per-check: Sonnet source-data analysis on demand (full context bundle +
//         associate-scoped source rows — this is what the single "Analyze
//         with Bragi" button on each check card calls, as of T-671)
//
// T-671 decision — why the report path (Tier 1 + Synthesis) stays on Haiku
// while the per-check button moved to source-data Sonnet:
// Allan's complaint ("does not actually help source the error, it just
// summarizes it") was specifically about the PER-CHECK button — the one he
// clicks when investigating a single finding. That's exactly what the
// source-data path is for: deep, associate-scoped, more expensive.
// "Analyze All" is a different job — a quick combined overview across every
// failed check — and T-670 already exists specifically because Allan asked
// to cut AI token spend. Moving Tier 1 to a full source-data Sonnet call per
// failed check would multiply the batch report's cost by roughly
// (source-data price / Haiku price) × number of failed checks, which cuts
// directly against the token-budget intent that produced T-670. Fail-only
// gating keeps N small today, but "cheap because N is small" is not the
// same guarantee as "cheap by design" — a run with several real failures
// should still produce an affordable combined report. If Allan later wants
// the batch report to be source-data-backed too, that's a deliberate
// follow-up ask, not something to fold in unprompted here.

import type { CheckResult, ParsedData, CiParsedData } from '../audit/types';
import { getAuditRules } from '../audit/auditRules';
import { buildContextBundle } from './contextBundle';
import { buildAssociateSourceSlice } from './sourceSlice';
import { buildSystemPrompt, buildHaikuPrompt, buildSynthesisPrompt, buildDeepDivePrompt } from './promptTemplates';
import { isAiEligible } from './aiGate';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6';

const HAIKU_MAX_TOKENS = 800;
const SYNTHESIS_MAX_TOKENS = 4000;
// T-669: Deep Dive now carries per-associate source rows (punch/labor/shift/etc.),
// not just the flagged-row summary — bumped from 2000 to give the model room to
// actually reason about the comparison instead of truncating mid-analysis.
const DEEP_DIVE_MAX_TOKENS = 2500;

// Claude Sonnet 4.6 list pricing ($/million tokens) — used only for the UI cost
// estimate shown before a Deep Dive call. Keep in sync with SONNET_MODEL above.
const SONNET_INPUT_PER_M = 3.0;
const SONNET_OUTPUT_PER_M = 15.0;

const API_HEADERS = {
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
  'anthropic-beta': 'prompt-caching-2024-07-31',
  'content-type': 'application/json',
};

export interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

// ── Re-exported email types (kept for backward compat) ────────────────────

export interface EmailEntry {
  subject: string;
  body: string;
  date?: string;
}

// ── Internal API call ────────────────────────────────────────────────────

async function callClaude(
  apiKey: string,
  model: string,
  maxTokens: number,
  systemBlocks: object[],
  userMessage: string,
): Promise<CallResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { ...API_HEADERS, 'x-api-key': apiKey },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemBlocks,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const status = response.status;
    if (status === 401) throw new Error('Invalid API key. Check the key and try again.');
    if (status === 429) throw new Error('Rate limited by Anthropic. Wait ~60 seconds and retry.');
    if (status >= 500) throw new Error('Anthropic API unavailable. Try again shortly.');
    const body = await response.text().catch(() => '');
    throw new Error(`API error ${status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json() as {
    content: { type: string; text: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };

  return {
    text: data.content?.[0]?.text ?? '(No response)',
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

// ── Progress callback type ────────────────────────────────────────────────

export type ProgressCallback = (msg: string) => void;

// ── Tier 1 + Synthesis — full analysis run ───────────────────────────────

export interface TieredAnalysisResult {
  reportMarkdown: string;
  haikuOutputs: HaikuOutput[];
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface HaikuOutput {
  checkId: number;
  checkName: string;
  status: string;
  stats: string;
  text: string;
}

export async function runTieredAnalysis(
  apiKey: string,
  allResults: CheckResult[],
  parsedData: ParsedData | null,
  program: 'fsm' | 'ses' | 'ci' | undefined,
  onProgress: ProgressCallback,
): Promise<TieredAnalysisResult> {
  const rules = getAuditRules(program);
  const systemBlocks = buildSystemPrompt(rules.bragiSystemPrompt);

  // T-670: token-budget cut — AI analysis runs on FAIL checks only. A
  // WARNING is still shown in the report (see buildSynthesisPrompt) but
  // does not get an AI call; PASS/N/A never did.
  const failed = allResults.filter((r) => isAiEligible(r.status));

  if (failed.length === 0) {
    return {
      reportMarkdown: '## No Failures Detected\n\nAI analysis runs on FAIL checks only — nothing required it. See the summary above for any PASS/WARNING/N/A results.',
      haikuOutputs: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };
  }

  let totalInput = 0;
  let totalOutput = 0;
  const haikuOutputs: HaikuOutput[] = [];

  // ── Tier 1: Haiku pass over all FAILED checks ──────────────────────────
  for (let i = 0; i < failed.length; i++) {
    const result = failed[i];
    onProgress(`Analyzing ${result.checkName}… ${i + 1} of ${failed.length}`);

    const userPrompt = buildHaikuPrompt(result);
    const callResult = await callClaude(
      apiKey,
      HAIKU_MODEL,
      HAIKU_MAX_TOKENS,
      systemBlocks,
      userPrompt,
    );

    totalInput += callResult.inputTokens;
    totalOutput += callResult.outputTokens;
    haikuOutputs.push({
      checkId: result.checkId,
      checkName: result.checkName,
      status: result.status,
      stats: result.stats,
      text: callResult.text,
    });
  }

  // ── Synthesis: Sonnet assembles full report ──────────────────────────
  onProgress('Generating final report…');
  const synthesisPrompt = buildSynthesisPrompt(haikuOutputs, allResults, parsedData);
  const synthesisResult = await callClaude(
    apiKey,
    SONNET_MODEL,
    SYNTHESIS_MAX_TOKENS,
    systemBlocks,
    synthesisPrompt,
  );

  totalInput += synthesisResult.inputTokens;
  totalOutput += synthesisResult.outputTokens;

  return {
    reportMarkdown: synthesisResult.text,
    haikuOutputs,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
  };
}

// ── Tier 2 — per-check Deep Dive ─────────────────────────────────────────

export async function runDeepDive(
  apiKey: string,
  targetResult: CheckResult,
  allResults: CheckResult[],
  parsedData: ParsedData | CiParsedData | null,
  program: 'fsm' | 'ses' | 'ci' | undefined,
  onProgress: ProgressCallback,
): Promise<CallResult> {
  const rules = getAuditRules(program);
  const systemBlocks = buildSystemPrompt(rules.bragiSystemPrompt);

  onProgress(`Running deep dive on ${targetResult.checkName}…`);

  const bundle = buildContextBundle(targetResult, allResults, rules.bragiSystemPrompt);
  const sourceSlice = buildAssociateSourceSlice(targetResult, parsedData);
  const userPrompt = buildDeepDivePrompt(targetResult, bundle, sourceSlice);

  return callClaude(
    apiKey,
    SONNET_MODEL,
    DEEP_DIVE_MAX_TOKENS,
    systemBlocks,
    userPrompt,
  );
}

/**
 * Estimate input tokens for a Deep Dive call by actually building the real
 * prompt (source slice, cross-check bundle, everything) and counting
 * characters. Needed because the source slice can now be much larger than
 * the old flaggedRows-only estimate — Allan must see the real cost before
 * clicking, not the pre-T-669 20-row estimate.
 */
export function estimateDeepDiveTokens(
  result: CheckResult,
  allResults: CheckResult[],
  parsedData: ParsedData | CiParsedData | null,
  program: 'fsm' | 'ses' | 'ci' | undefined,
): number {
  const rules = getAuditRules(program);
  const bundle = buildContextBundle(result, allResults, rules.bragiSystemPrompt);
  const sourceSlice = buildAssociateSourceSlice(result, parsedData);
  const prompt = buildDeepDivePrompt(result, bundle, sourceSlice);
  const charCount = prompt.length + rules.bragiSystemPrompt.length;
  return Math.ceil(charCount / 4) + DEEP_DIVE_MAX_TOKENS;
}

export function estimateDeepDiveCost(
  result: CheckResult,
  allResults: CheckResult[],
  parsedData: ParsedData | CiParsedData | null,
  program: 'fsm' | 'ses' | 'ci' | undefined,
): string {
  const tokens = estimateDeepDiveTokens(result, allResults, parsedData, program);
  const inputTokens = tokens - DEEP_DIVE_MAX_TOKENS;
  const cost = (inputTokens * SONNET_INPUT_PER_M + DEEP_DIVE_MAX_TOKENS * SONNET_OUTPUT_PER_M) / 1_000_000;
  return formatCost(cost);
}

function formatCost(cost: number): string {
  return cost < 0.001 ? '<$0.001' : `~$${cost.toFixed(3)}`;
}

// Claude Haiku 4.5 list pricing ($/thousand tokens, matching the original
// formula's units) — used by estimateTokens/estimateCost (a single check's
// Tier-1 Haiku call) and estimateAnalyzeAllCost (the batch total below).
const HAIKU_INPUT_PER_K = 0.00025;
const HAIKU_OUTPUT_PER_K = 0.00125;

// ── Per-check Tier-1 Haiku cost math ──────────────────────────────────────
// T-671: no longer used by CheckCard's per-check button (that button now
// calls runDeepDive — see estimateDeepDiveCost above). Still live: feeds
// estimateAnalyzeAllCost's per-check total, since Tier 1 of the "Analyze
// All" report stays on Haiku (see the file-header comment on why).

export function estimateTokens(result: CheckResult): number {
  const charCount = JSON.stringify(result.flaggedRows.slice(0, 20)).length;
  return Math.ceil((charCount + 500) / 4) + HAIKU_MAX_TOKENS;
}

function haikuCallCostUsd(inputTokens: number): number {
  return (inputTokens * HAIKU_INPUT_PER_K + HAIKU_MAX_TOKENS * HAIKU_OUTPUT_PER_K) / 1000;
}

export function estimateCost(result: CheckResult): string {
  const tokens = estimateTokens(result);
  const inputTokens = tokens - HAIKU_MAX_TOKENS;
  return formatCost(haikuCallCostUsd(inputTokens));
}

/**
 * Total estimated cost for "Analyze All" — sums a Tier-1 Haiku call per
 * AI-eligible (FAIL) check, plus a rough Tier-2 synthesis call estimate.
 * T-671: Allan must see the total before clicking, same principle as
 * estimateDeepDiveCost for the per-check button. This does NOT rebuild the
 * real synthesis prompt (unlike estimateDeepDiveCost, which builds the real
 * Deep Dive prompt) — the Haiku-per-check total already dominates the
 * estimate, and building N real Haiku prompts just to size a cost preview
 * isn't worth the extra work for a number that's already an approximation
 * (actual Haiku/Sonnet output length varies at request time regardless).
 */
export function estimateAnalyzeAllCost(results: CheckResult[]): string {
  const eligible = results.filter((r) => isAiEligible(r.status));
  if (eligible.length === 0) return '<$0.001';

  const haikuTotal = eligible.reduce((sum, r) => {
    const tokens = estimateTokens(r);
    return sum + haikuCallCostUsd(tokens - HAIKU_MAX_TOKENS);
  }, 0);

  // Synthesis input scales with the Haiku outputs being assembled (capped at
  // HAIKU_MAX_TOKENS each) plus one stat line per check for the
  // passing/na/warning section — a rough upper bound, not the real prompt.
  const approxSynthesisInputTokens = eligible.length * HAIKU_MAX_TOKENS + results.length * 60;
  const synthesisCost = (approxSynthesisInputTokens * SONNET_INPUT_PER_M + SYNTHESIS_MAX_TOKENS * SONNET_OUTPUT_PER_M) / 1_000_000;

  return formatCost(haikuTotal + synthesisCost);
}

export async function analyzeAllFailures(
  apiKey: string,
  results: CheckResult[],
  _emails?: EmailEntry[],
): Promise<CallResult> {
  // Redirects to the new tiered flow — synthesis output only
  const tiered = await runTieredAnalysis(
    apiKey,
    results,
    null,
    undefined,
    () => { /* no-op progress for legacy callers */ },
  );
  return {
    text: tiered.reportMarkdown,
    inputTokens: tiered.totalInputTokens,
    outputTokens: tiered.totalOutputTokens,
  };
}
