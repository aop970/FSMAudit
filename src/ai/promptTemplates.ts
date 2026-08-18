// promptTemplates.ts — All prompt builder functions for the tiered AI analysis

import type { CheckResult, ParsedData } from '../audit/types';
import type { ContextBundle } from './contextBundle';
import type { SourceSlice, DatePivot } from './sourceSlice';

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
  // T-670: AI analysis (Haiku) now runs on FAIL checks only — WARNING no
  // longer gets a Haiku pass, but it still needs to show up in the report,
  // so it's folded into this stats-only section rather than disappearing.
  const passingLines = allResults
    .filter((r) => r.status === 'pass' || r.status === 'na' || r.status === 'warning')
    .map((r) => `${r.status === 'warning' ? '⚠️' : '✅'} Check ${r.checkId} — ${r.checkName}: ${r.status.toUpperCase()} — ${r.stats}`)
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
- Add a "Summary of Findings" table at the top with columns: Check # | Check Name | Status | Key Finding — include EVERY check (pass/na/warning/fail), not just the ones with a Haiku analysis below
- If any checks failed, add a "Recommended Actions" block at the end. Warnings are listed for reference (stats only, no deep analysis — token-budget policy) — mention them only if directly relevant to a failure's root cause
- Produce clean GitHub-Flavored Markdown
- Do NOT add commentary about the assembly process — just produce the report

INVOICE METADATA:
${meta}

PASSING / N/A / WARNING CHECKS (no AI analysis — stats only):
${passingLines}

FAILED CHECK ANALYSIS (from Haiku — reproduce verbatim):
${analysisBlocks}`;
}

// ── Tier 2 — Sonnet Deep Dive prompt ───────────────────────────────────────

/**
 * Render one associate's DATE-LEVEL VARIANCE pivot (T-672) — Allan asked for
 * this specifically: "Tom Johnson had 8 hours on invoice on Jan 1 but only
 * 6.5 hours on punch report for Jan 1." Dates are pre-ranked by variance
 * (worst first) and pre-capped by sourceSlice.ts; this only formats them.
 */
function renderDatePivot(pivot: DatePivot): string {
  const fmtHours = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}h`);

  const header = pivot.omittedDateCount > 0
    ? `DATE-LEVEL VARIANCE (${pivot.dates.length} of ${pivot.totalDatesFound} dates with data shown, ranked by largest variance — ${pivot.omittedDateCount} additional date(s) omitted, treat those as unverified at the date level):`
    : `DATE-LEVEL VARIANCE (all ${pivot.dates.length} date${pivot.dates.length === 1 ? '' : 's'} with data):`;

  // "—" means no rows were found for that leg on that date — distinct from
  // rows totaling zero hours. The model must not read "—" as "0 hours."
  const legend = '  ("—" = no rows found for that leg on that date, not zero hours)';

  // A leg whose source file carries no usable date column is SUPPRESSED from
  // the per-date lines and disclosed here instead. Rendering it as "—" would
  // be read as "no rows found on this date" for every date in the period —
  // a fabricated missing-source finding built out of a parsing artifact.
  // (Vera, T-672 review — T-672 shipped this for shift only.)
  const periodOnly: string[] = [];
  if (!pivot.attributable.invoice) periodOnly.push('Invoice');
  if (!pivot.attributable.punch) periodOnly.push('Punch');
  if (!pivot.attributable.shift) periodOnly.push('Shift');
  const shiftNote = periodOnly.length === 0
    ? ''
    : `\n  ${periodOnly.join(' and ')} ${periodOnly.length === 1 ? 'is' : 'are'} NOT broken out by date here — that source file in this run has no usable per-date column, so its hours are only available as a PERIOD TOTAL (see the detail rows below, if any). Do not state or infer a per-date figure for ${periodOnly.length === 1 ? 'it' : 'them'}, and do NOT treat its absence from these lines as missing rows.`;

  const lines = pivot.dates.map((e) => {
    const otherPart = e.otherPunchCategories ? ` | also this date (excluded from Punch above): ${e.otherPunchCategories}` : '';
    // Zero-signal date: no rows on ANY date-attributable leg. Say so in words
    // rather than printing a row of em-dashes that reads as a variance driver.
    if (e.noReconcilableHours) {
      return `  ${e.date}: no Work hours on any source this date (NOT a variance driver — nothing to reconcile)${otherPart}`;
    }
    const invPart = pivot.attributable.invoice ? `Invoice ${fmtHours(e.invoiceHours)}` : null;
    const pchPart = pivot.attributable.punch ? `Punch ${fmtHours(e.punchHours)}` : null;
    const sftPart = pivot.attributable.shift ? `Shift ${fmtHours(e.shiftHours)}` : null;
    const legs = [invPart, pchPart, sftPart].filter((p): p is string => p !== null).join(' | ');
    return `  ${e.date}: ${legs}${otherPart}`;
  }).join('\n');

  return `${header}\n${legend}${shiftNote}\n${lines}`;
}

/** Render the associate-scoped SOURCE DATA section — the fix for T-669. */
function renderSourceSlice(slice: SourceSlice): string {
  if (slice.degradedReason) {
    return `SOURCE DATA: ${slice.degradedReason}`;
  }
  if (slice.associates.length === 0) {
    return 'SOURCE DATA: No associate identity could be extracted from the flagged rows for this check — root-cause from the flagged rows and rule text only.';
  }

  const header = slice.omittedCount > 0
    ? `Source rows below for the ${slice.associates.length} highest-severity associates of ${slice.totalCandidates} flagged (ranked by the largest variance/amount on their own flagged row). ${slice.omittedCount} additional associate(s) omitted — treat any statement about them as based on the check's summary output only, not source data.`
    : `Source rows below for all ${slice.associates.length} flagged associate(s).`;

  const blocks = slice.associates.map((a) => {
    const idSuffix = a.identity.kind === 'id' ? ` (${a.identity.key.toUpperCase()})` : '';
    const datePivotText = a.datePivot ? `\n${renderDatePivot(a.datePivot)}\n` : '';
    if (a.groups.length === 0) {
      return `### ${a.identity.displayName}${idSuffix}\n  (no matching source rows found in any uploaded source file for this associate)`;
    }
    const groupText = a.groups.map((g) => {
      const rowsText = JSON.stringify(g.rows, null, 2);
      const shownOf = g.trimmed > 0 ? ` (showing ${g.rows.length} of ${g.rows.length + g.trimmed})` : '';
      const trimmedNote = g.trimmed > 0 ? `\n  ... ${g.trimmed} additional ${g.label} rows omitted` : '';
      return `  ${g.label}${shownOf}:\n${rowsText}${trimmedNote}`;
    }).join('\n\n');
    return `### ${a.identity.displayName}${idSuffix}${datePivotText}\n${groupText}`;
  }).join('\n\n');

  return `SOURCE DATA:\n${header}\n\n${blocks}`;
}

/**
 * Render the check's OWN per-person per-day breakdown (T-729 review, Vera).
 *
 * check03PunchRecon computes, for every mismatching category, the exact
 * (associate, date) rows whose invoice-vs-punch delta exceeds tolerance —
 * already tolerance-filtered and sorted by |delta| desc. T-729 wired that dict
 * into buildAssociateSourceSlice for IDENTITY RECOVERY, which fixed "who", but
 * the table itself was still never rendered, so "when" had to be re-derived by
 * the model joining raw punch rows to raw invoice rows and subtracting.
 *
 * That re-derivation is not always possible. filterAndCap trims each source to
 * MAX_SOURCE_ROWS_PER_ASSOCIATE_PER_SOURCE (15) rows per associate, so on a
 * real multi-week run the very row driving a variance can be trimmed away,
 * leaving the model to compute a delta from an incomplete set. This breakdown
 * is capped separately (100 rows per category, largest |delta| first) and so
 * still carries the driver.
 *
 * It also matters more on FSM than it looks: buildDatePivot requires >= 2
 * date-attributable legs, and the FSM parse path returns sesPunchRows: [] and
 * shiftRows: [] (parseWorkbook.ts), leaving invoice as the only one — so the
 * DATE-LEVEL VARIANCE pivot never renders on an FSM run and this section is
 * the only per-date evidence an FSM Check 3 Deep Dive receives.
 */
function renderPerPersonBreakdown(result: CheckResult): string | null {
  const ppb = result.details?.['perPersonBreakdown'];
  if (!ppb || typeof ppb !== 'object' || Array.isArray(ppb)) return null;

  const blocks: string[] = [];
  for (const [category, rows] of Object.entries(ppb as Record<string, unknown>)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const label = category.charAt(0).toUpperCase() + category.slice(1);
    blocks.push(
      `  ${label} — ${rows.length} (associate, date) pair(s) outside tolerance:\n${JSON.stringify(rows, null, 2)}`,
    );
  }
  if (blocks.length === 0) return null;

  return `PER-PERSON PER-DAY BREAKDOWN (computed by the check itself — already filtered to deltas outside tolerance and sorted by largest |delta| first):
  Use these rows to name the SPECIFIC associate(s) and DATE(S) driving each flagged category. "delta" is punch hours minus invoice hours for that associate on that date. These figures are the check's own and are authoritative — do not recompute them from the raw source rows below (which may be trimmed), and do not average across dates.

${blocks.join('\n\n')}`;
}

export function buildDeepDivePrompt(result: CheckResult, bundle: ContextBundle, sourceSlice: SourceSlice): string {
  const crossCheckSection = bundle.crossCheckRows.length > 0
    ? `CROSS-CHECK DATA (other checks where these employees appear):
${bundle.crossCheckRows.map((e) => `Employee: ${e.employeeName}${e.associateId ? ` (${e.associateId})` : ''}
${e.rows.map((r) => `  - Check ${r.checkId} "${r.checkName}": ${JSON.stringify(r.row)}`).join('\n')}${e.trimmed ? `\n  ... (${e.trimmed} additional rows trimmed)` : ''}`).join('\n\n')}`
    : 'No cross-check data available for these employees.';

  const sourceDataSection = renderSourceSlice(sourceSlice);
  const perPersonSection = renderPerPersonBreakdown(result);

  return `Deep dive analysis requested for:

Check Name: ${result.checkName}
Status: ${result.status.toUpperCase()}
Stats: ${result.stats}
Flagged Count: ${result.flaggedCount}

FULL FLAGGED ROWS (the check's conclusions — NOT the underlying source data):
${JSON.stringify(result.flaggedRows, null, 2)}
${perPersonSection ? `\n${perPersonSection}\n` : ''}
${sourceDataSection}

RELEVANT AUDIT RULE TEXT:
${bundle.ruleText}

${crossCheckSection}

Your job is to root-cause the discrepancy from the SOURCE DATA above, not just restate the flagged rows. For each associate with source data:
- Compare what the source rows actually contain (categories/time types present, e.g. Work vs Overtime vs Travel vs Admin) against what the check counted or excluded.
- Identify whether the discrepancy looks like (a) a DATA problem (e.g. the source file has rows in a category the check's logic doesn't handle, a missing/duplicate row), (b) a RULE problem (the check's own filter or tolerance is wrong for this case), or (c) a GENUINE finding (the source data itself shows a real timekeeping/billing discrepancy).
- If associates were omitted from the source data (see the SOURCE DATA header), say so explicitly rather than treating them as unverified — do not invent numbers for them.
- If SOURCE DATA says no data is available (degraded/empty), say so plainly and root-cause from the flagged rows and rule text only — do not claim to have compared source rows you were not given.
- IMPORTANT — absence of a source file's rows under an associate does NOT mean that associate is missing from that file. Source rows are matched to the associate by NAME, while the check itself may have reconciled them by associate ID, so a name spelled differently between files (middle initial, suffix, married/maiden name, extra spacing) yields no rows here even though the file does contain them. If an associate's flagged row reports non-zero hours from a source you were given no rows for, treat that as an UNVERIFIED name-matching gap and say so — never conclude the associate is absent from that file, and never report a missing-punch/missing-shift root cause on that basis alone. This risk does NOT apply when the associate's heading above shows an ID in parentheses — that source data was matched by associate ID, which does not depend on name spelling, so an absent source group there is a genuine absence, not a matching gap.
- PER-PERSON PER-DAY BREAKDOWN: when that section is present, it is the check's own per-(associate, date) delta table and is the PRIMARY evidence for naming who and on what date. Quote its associate names, dates and deltas directly. It is authoritative over any figure you would derive yourself from the raw source rows, because those rows may have been trimmed. Its absence from a category simply means that category had no per-person rows outside tolerance.
- DATE-LEVEL VARIANCE: when an associate's block includes a "DATE-LEVEL VARIANCE" section, use it to name the SPECIFIC DATE(S) that drive their variance — not just the period total. Quote the date and the invoice/punch(/shift) hours on that date directly from the pivot; do not average or estimate across dates. A "—" in the pivot means no rows were found for that leg on that date (never read it as zero hours). If the pivot's shift note says shift is period-level only, do not state or imply a per-date shift figure — say the shift comparison is period-level for that associate.

Provide a deep dive analysis in this format:
1. [emoji] ${result.checkName} — [one-line summary with key numbers]
2. Named employee attribution: for each employee involved, name them, quantify their specific contribution (hours, dollars, row count), state whether their source rows support a data problem, a rule problem, or a genuine finding, and name the specific date(s) driving it when a DATE-LEVEL VARIANCE section is available
3. Optional breakdown table (employee | issue | amount/hours | % of total) if 3+ employees are involved
4. Cross-check correlation: call out any patterns visible across other checks for these same employees
5. Root Cause Identified: a specific, confident root cause hypothesis grounded in the source data comparison above — not a restatement of the check's own stats line

Be direct. Name names. Give numbers. Do not hedge. Never claim to have examined data that was not provided to you.`;
}
