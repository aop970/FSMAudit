// promptTemplates.ts — All prompt builder functions for the tiered AI analysis

import type { CheckResult, ParsedData } from '../audit/types';
import type { ContextBundle } from './contextBundle';

// ── Shared system prompt ────────────────────────────────────────────────────

export function buildSystemPrompt(bragiSystemPrompt: string): object[] {
  return [
    {
      type: 'text',
      text:
        'You are an expert auditor reviewing a field services management (FSM) invoice. ' +
        'Analyze the data provided and produce a structured finding. Be specific: name the employees ' +
        'responsible for discrepancies, quantify their contribution to the total variance, ' +
        'cross-reference evidence from other checks where provided, and propose a plausible root cause. ' +
        'Do not hedge. If the data supports a clear explanation, state it directly.',
    },
    {
      type: 'text',
      text: `\n\nAUDIT RULES AND CONTEXT:\n${bragiSystemPrompt}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

// ── Tier 1 — Haiku per-check prompt ────────────────────────────────────────

export function buildHaikuPrompt(result: CheckResult): string {
  const sampleRows = result.flaggedRows.slice(0, 20).map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
    }
    return out;
  });

  return `Audit check requiring analysis:

Check Name: ${result.checkName}
Status: ${result.status.toUpperCase()}
Stats: ${result.stats}
Flagged Count: ${result.flaggedCount}
Sample Flagged Rows (up to 20):
${JSON.stringify(sampleRows, null, 2)}

Provide a concise finding in this format:
1. A 2–3 sentence finding describing the pattern you see, the key numbers, and the obvious next step.
2. Output format:
   [emoji] ${result.checkName}
   [PASS/FAIL/WARN] [one-sentence status line]
   [finding paragraph]`;
}

// ── Synthesis — Sonnet prompt ───────────────────────────────────────────────

export function buildSynthesisPrompt(
  haikuOutputs: { checkId: number; checkName: string; status: string; stats: string; text: string }[],
  allResults: CheckResult[],
  parsedData: ParsedData | null,
): string {
  // Build passing check stat lines
  const passingLines = allResults
    .filter((r) => r.status === 'pass' || r.status === 'na')
    .map((r) => `✅ Check ${r.checkId} — ${r.checkName}: ${r.status.toUpperCase()} — ${r.stats}`)
    .join('\n');

  // Invoice metadata
  const meta = parsedData
    ? `Invoice File: ${parsedData.fileName}
Invoice Number: ${parsedData.invoiceNumber ?? 'N/A'}
Period: ${parsedData.declaredPeriod ? `${parsedData.declaredPeriod.start.toISOString().slice(0, 10)} to ${parsedData.declaredPeriod.end.toISOString().slice(0, 10)}` : 'N/A'}
Weeks Covered: ${parsedData.weeksCovered.join(', ')}`
    : '';

  const analysisBlocks = haikuOutputs
    .map((h) => `### Check ${h.checkId} — ${h.checkName} (${h.status.toUpperCase()})\nStats: ${h.stats}\n\n${h.text}`)
    .join('\n\n---\n\n');

  return `Assemble a full audit report from the analysis below. Instructions:
- Assemble sections in check number order
- Pass through the Haiku analysis text VERBATIM — do not rephrase or summarize
- Add a "Summary of Findings" table at the top with columns: Check # | Check Name | Status | Key Finding
- If any checks failed or warned, add a "Recommended Actions" block at the end
- Produce clean GitHub-Flavored Markdown
- Do NOT add commentary about the assembly process — just produce the report

INVOICE METADATA:
${meta}

PASSING / N/A CHECKS:
${passingLines}

FAILED / WARNING ANALYSIS (from Haiku — reproduce verbatim):
${analysisBlocks}`;
}

// ── Tier 2 — Sonnet Deep Dive prompt ───────────────────────────────────────

export function buildDeepDivePrompt(result: CheckResult, bundle: ContextBundle): string {
  const crossCheckSection = bundle.crossCheckRows.length > 0
    ? `CROSS-CHECK DATA (other checks where these employees appear):
${bundle.crossCheckRows.map((e) => `Employee: ${e.employeeName} (${e.associateId})
${e.rows.map((r) => `  - Check ${r.checkId} "${r.checkName}": ${JSON.stringify(r.row)}`).join('\n')}${e.trimmed ? `\n  ... (${e.trimmed} additional rows trimmed)` : ''}`).join('\n\n')}`
    : 'No cross-check data available for these employees.';

  return `Deep dive analysis requested for:

Check Name: ${result.checkName}
Status: ${result.status.toUpperCase()}
Stats: ${result.stats}
Flagged Count: ${result.flaggedCount}

FULL FLAGGED ROWS:
${JSON.stringify(result.flaggedRows, null, 2)}

RELEVANT AUDIT RULE TEXT:
${bundle.ruleText}

${crossCheckSection}

Provide a deep dive analysis in this format:
1. [emoji] ${result.checkName} — [one-line summary with key numbers]
2. Named employee attribution: for each employee involved, name them, quantify their specific contribution (hours, dollars, row count)
3. Optional breakdown table (employee | issue | amount/hours | % of total) if 3+ employees are involved
4. Cross-check correlation: call out any patterns visible across other checks for these same employees
5. Root Cause Identified: a specific, confident root cause hypothesis based on all available evidence

Be direct. Name names. Give numbers. Do not hedge.`;
}
