// bragiClient.ts — Tier 2 on-demand Bragi Analysis
// Model: claude-haiku-3-5 (do not upgrade)
// Max tokens: 1000
// Sends only failure summaries — never raw datasets

import type { CheckResult } from '../audit/types';
import { getAuditRules } from '../audit/auditRules';

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 2000;

// Rough token estimate: ~1 token per 4 chars for English text
export function estimateTokens(result: CheckResult): number {
  const payload = buildSinglePayload(result);
  const charCount = JSON.stringify(payload).length;
  // input tokens (prompt + system) + output max
  const inputEst = Math.ceil((charCount + 500) / 4);
  return inputEst + MAX_TOKENS;
}

// Haiku pricing estimate (as of 2026): $0.00025/1k input, $0.00125/1k output
export function estimateCost(result: CheckResult): string {
  const tokens = estimateTokens(result);
  const inputTokens = tokens - MAX_TOKENS;
  const cost = (inputTokens * 0.00025 + MAX_TOKENS * 0.00125) / 1000;
  return cost < 0.001 ? '<$0.001' : `~$${cost.toFixed(3)}`;
}

interface FailureSummary {
  check_id: number;
  check_name: string;
  status: string;
  stats: string;
  flagged_count: number;
  sample_failures: Record<string, unknown>[];
  details?: Record<string, unknown>;
}

function buildSinglePayload(result: CheckResult): FailureSummary {
  const payload: FailureSummary = {
    check_id: result.checkId,
    check_name: result.checkName,
    status: result.status,
    stats: result.stats,
    flagged_count: result.flaggedCount,
    // Cap sample at 20 rows, truncate long strings
    sample_failures: result.flaggedRows.slice(0, 20).map((row) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        out[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
      }
      return out;
    }),
  };
  // Include details (e.g. per-person breakdown for Check 3) so the AI has
  // the full picture needed to attribute variances to specific people and days.
  if (result.details && Object.keys(result.details).length > 0) {
    payload.details = result.details;
  }
  return payload;
}

export async function analyzeCheck(
  apiKey: string,
  result: CheckResult,
): Promise<CallResult> {
  const payload = buildSinglePayload(result);
  return callClaude(apiKey, [payload]);
}

export interface EmailEntry {
  subject: string;
  body: string;
  date?: string;
}

export async function analyzeAllFailures(
  apiKey: string,
  results: CheckResult[],
  emails?: EmailEntry[],
): Promise<CallResult> {
  const payloads = results
    .filter((r) => r.status === 'fail' || r.status === 'warning')
    .map(buildSinglePayload);
  return callClaude(apiKey, payloads, emails);
}

function buildEmailContext(emails: EmailEntry[]): string {
  // Sort by date desc if available, cap at 20 most recent
  const sorted = [...emails].sort((a, b) => {
    if (a.date && b.date) return new Date(b.date).getTime() - new Date(a.date).getTime();
    return 0;
  }).slice(0, 20);

  return `---
ONE-OFF EMAIL CONTEXT (${sorted.length} emails from audit folder):

${sorted.map((e, i) => `Email ${i + 1}:
Subject: ${e.subject}
Date: ${e.date || 'unknown'}
Body: ${e.body.slice(0, 800)}`).join('\n\n')}

Based on these emails, identify any one-off instructions, exceptions, rate changes, employee-specific notes, or billing holds that are relevant to this invoice audit. List them as "One-Off Reminders" — not hard failures, but things to be aware of and verify manually. Format them as a bulleted list under a heading "📬 One-Off Reminders from Email Context".`;
}

export interface CallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callClaude(
  apiKey: string,
  findings: FailureSummary[],
  emails?: EmailEntry[],
): Promise<CallResult> {
  const rules = getAuditRules();
  const systemPrompt = rules.bragiSystemPrompt;

  const emailSection = emails && emails.length > 0
    ? `\n\n${buildEmailContext(emails)}`
    : '';

  const userMessage = `Audit findings requiring analysis:\n\n${JSON.stringify(findings, null, 2)}${emailSection}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
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
    text: data.content?.[0]?.text ?? '(No response from Bragi)',
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}
