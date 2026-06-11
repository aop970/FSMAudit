// bragiClient.ts — Tiered AI orchestrator
// Tier 1: Haiku per-check (fast, cheap, 20-row cap)
// Synthesis: Sonnet (assembles full report from all Haiku outputs)
// Tier 2: Sonnet Deep Dive on demand (full context bundle per check)

import type { CheckResult, ParsedData } from '../audit/types';
import { getAuditRules } from '../audit/auditRules';
import { buildContextBundle } from './contextBundle';
import { buildSystemPrompt, buildHaikuPrompt, buildSynthesisPrompt, buildDeepDivePrompt } from './promptTemplates';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6';

const HAIKU_MAX_TOKENS = 800;
const SYNTHESIS_MAX_TOKENS = 4000;
const DEEP_DIVE_MAX_TOKENS = 2000;

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

  const failedOrWarned = allResults.filter(
    (r) => r.status === 'fail' || r.status === 'warning',
  );

  if (failedOrWarned.length === 0) {
    return {
      reportMarkdown: '## All Checks Passed\n\nNo failures or warnings detected.',
      haikuOutputs: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };
  }

  let totalInput = 0;
  let totalOutput = 0;
  const haikuOutputs: HaikuOutput[] = [];

  // ── Tier 1: Haiku pass over all failed/warned checks ──────────────────
  for (let i = 0; i < failedOrWarned.length; i++) {
    const result = failedOrWarned[i];
    onProgress(`Analyzing ${result.checkName}… ${i + 1} of ${failedOrWarned.length}`);

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
  program: 'fsm' | 'ses' | 'ci' | undefined,
  onProgress: ProgressCallback,
): Promise<CallResult> {
  const rules = getAuditRules(program);
  const systemBlocks = buildSystemPrompt(rules.bragiSystemPrompt);

  onProgress(`Running deep dive on ${targetResult.checkName}…`);

  const bundle = buildContextBundle(targetResult, allResults, rules.bragiSystemPrompt);
  const userPrompt = buildDeepDivePrompt(targetResult, bundle);

  return callClaude(
    apiKey,
    SONNET_MODEL,
    DEEP_DIVE_MAX_TOKENS,
    systemBlocks,
    userPrompt,
  );
}

// ── Legacy single-check analyze (kept for CheckCard backward compat) ─────
// CheckCard will be updated to use the new flow, but keep this as fallback

export function estimateTokens(result: CheckResult): number {
  const charCount = JSON.stringify(result.flaggedRows.slice(0, 20)).length;
  return Math.ceil((charCount + 500) / 4) + HAIKU_MAX_TOKENS;
}

export function estimateCost(result: CheckResult): string {
  const tokens = estimateTokens(result);
  const inputTokens = tokens - HAIKU_MAX_TOKENS;
  const cost = (inputTokens * 0.00025 + HAIKU_MAX_TOKENS * 0.00125) / 1000;
  return cost < 0.001 ? '<$0.001' : `~$${cost.toFixed(3)}`;
}

export async function analyzeCheck(
  apiKey: string,
  result: CheckResult,
): Promise<CallResult> {
  const rules = getAuditRules();
  const systemBlocks = buildSystemPrompt(rules.bragiSystemPrompt);
  const userPrompt = buildHaikuPrompt(result);
  return callClaude(apiKey, HAIKU_MODEL, HAIKU_MAX_TOKENS, systemBlocks, userPrompt);
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
