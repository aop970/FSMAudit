import React, { useState, useCallback, useMemo } from 'react';
import { ChevronDown, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Sparkles, Loader2, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CheckResult, CheckStatus, ParsedData, CiParsedData } from '../audit/types';
import { estimateDeepDiveCost, runDeepDive } from '../ai/bragiClient';
import { isAiEligible } from '../ai/aiGate';
import { loadVerdict, saveVerdict } from '../audit/check07Verdicts';
import type { UserVerdict } from '../audit/check07Verdicts';
import { exportCheck7 } from '../audit/check07Export';
import { unionFlaggedRowColumns } from '../lib/tableColumns';

interface CheckCardProps {
  result: CheckResult;
  allResults?: CheckResult[];
  defaultOpen?: boolean;
  apiKey: string;
  program?: 'fsm' | 'ses' | 'ci';
  onTokensUsed?: (inputTokens: number, outputTokens: number) => void;
  // External AI output can be injected from the synthesis pass
  externalAiOutput?: string;
  // Invoice file name — used for Check 7 export filename
  invoiceFileName?: string;
  // Session-scoped source data (punch/labor/shift/roster/...) — held in App
  // state, never persisted to /api/runs. Passed through only so Deep Dive
  // can build an associate-scoped source-row slice (T-669). Session-only:
  // this must never be forwarded into anything that gets POSTed as the
  // audit payload.
  parsedData?: ParsedData | CiParsedData | null;
}

const STATUS_STYLES: Record<CheckStatus, { barColor: string; chip: string; label: string; icon: React.ReactNode }> = {
  pass: {
    barColor: '#22d06b',
    chip: 'bg-mc-green/10 text-mc-green border border-mc-green/30',
    label: 'PASS',
    icon: <CheckCircle2 className="h-4 w-4 text-mc-green" />,
  },
  warning: {
    barColor: '#ffba08',
    chip: 'bg-mc-amber/10 text-mc-amber border border-mc-amber/30',
    label: 'WARNING',
    icon: <AlertTriangle className="h-4 w-4 text-mc-amber" />,
  },
  fail: {
    barColor: '#f87171',
    chip: 'bg-rose-500/10 text-rose-400 border border-rose-500/30',
    label: 'FAIL',
    icon: <XCircle className="h-4 w-4 text-rose-400" />,
  },
  na: {
    barColor: '#5a6a88',
    chip: 'bg-mc-dim/10 text-mc-dim border border-mc-dim/30',
    label: 'N/A',
    icon: <MinusCircle className="h-4 w-4 text-mc-dim" />,
  },
};

export function CheckCard({ result, allResults, defaultOpen = false, apiKey, program, onTokensUsed, externalAiOutput, invoiceFileName, parsedData }: CheckCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  // T-671: "Analyze with Bragi" and "Deep Dive" were two buttons doing two
  // different jobs — the prominent one (Analyze with Bragi) ran a
  // flagged-rows-only Haiku summary with no source data, exactly the
  // complaint Allan raised ("does not actually help source the error, it
  // just summarizes it"). Consolidated onto one button, powered by the
  // source-data path (runDeepDive) that used to be Deep Dive-only. State
  // names below keep the ai* prefix since this is now simply "the"
  // per-check analysis — there is no second, cheaper button left to
  // distinguish it from.
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiOutput, setAiOutput] = useState('');
  const [aiError, setAiError] = useState('');
  // Check 19: session-scoped per-row dismiss (resets automatically when component remounts on new upload)
  const [dismissedCheck19, setDismissedCheck19] = useState<Set<string>>(new Set());
  // Check 7: verdict state map (rowKey → UserVerdict). Keyed by rowKey, initialised from localStorage.
  // Re-renders when any verdict changes so the UI reflects the updated state.
  const [check7Verdicts, setCheck7Verdicts] = useState<Map<string, UserVerdict>>(() => {
    if (result.checkId !== 7) return new Map();
    const map = new Map<string, UserVerdict>();
    for (const r of result.flaggedRows) {
      const rowKey = String(r['rowKey'] ?? '');
      if (!rowKey || r['status'] !== 'none') continue;
      const snapshot = {
        name:   String(r['name']   ?? ''),
        otType: String(r['otType'] ?? ''),
        hours:  String(r['hours']  ?? ''),
      };
      const { verdict } = loadVerdict(rowKey, snapshot);
      if (verdict !== 'none') map.set(rowKey, verdict);
    }
    return map;
  });

  const setCheck7Verdict = useCallback((rowKey: string, verdict: UserVerdict, r: Record<string, unknown>) => {
    const snapshot = {
      name:   String(r['name']   ?? ''),
      otType: String(r['otType'] ?? ''),
      hours:  String(r['hours']  ?? ''),
    };
    saveVerdict(rowKey, verdict, snapshot);
    setCheck7Verdicts((prev) => {
      const next = new Map(prev);
      if (verdict === 'none') {
        next.delete(rowKey);
      } else {
        next.set(rowKey, verdict);
      }
      return next;
    });
  }, []);
  const s = STATUS_STYLES[result.status];

  // T-670: token-budget cut — AI analysis only ever fires on FAIL checks.
  // isAiEligible() is the single choke point shared with bragiClient.ts,
  // AnalyzeAllButton.tsx, and App.tsx's Analyze-All gates.
  // T-671: this now also gates the ONLY per-check analysis button — Deep
  // Dive's old requirement (a populated allResults, for cross-check context)
  // is folded in here since there is no longer a separate, cheaper button
  // that could run without it.
  const showBragiButton = isAiEligible(result.status) && !!apiKey.trim() && !!allResults && allResults.length > 0;
  // Memoized (Vera, T-669/T-670 review): estimateDeepDiveCost builds the REAL
  // analysis prompt — context bundle + source slice + JSON.stringify of up to
  // MAX_ASSOCIATES_PER_DEEP_DIVE x MAX_SOURCE_ROWS_PER_ASSOCIATE_PER_SOURCE rows
  // across every source. Unmemoized it re-ran on every render of every failed
  // check, including each keystroke in App's API-key input (apiKey is App state
  // and re-renders all CheckCards). The estimate only depends on these inputs.
  // T-671: do not swap this for the old flaggedRows-only estimateCost() —
  // that would silently understate the real per-click cost again.
  const analysisCostEst = useMemo(
    () => (showBragiButton ? estimateDeepDiveCost(result, allResults, parsedData ?? null, program) : ''),
    [showBragiButton, result, allResults, parsedData, program],
  );

  async function handleAnalyze() {
    if (!allResults) return;
    setAiState('loading');
    setAiError('');
    try {
      const { text, inputTokens, outputTokens } = await runDeepDive(
        apiKey,
        result,
        allResults,
        parsedData ?? null,
        program,
        () => { /* progress handled inline */ },
      );
      setAiOutput(text);
      setAiState('done');
      onTokensUsed?.(inputTokens, outputTokens);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
      setAiState('error');
    }
  }

  return (
    <div
      className="overflow-hidden rounded-lg border-l-4"
      style={{
        borderLeftColor: s.barColor,
        borderTop: '1px solid var(--mc-card-border)',
        borderRight: '1px solid var(--mc-card-border)',
        borderBottom: '1px solid var(--mc-card-border)',
        backgroundColor: 'var(--mc-card-bg)',
      }}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition hover:bg-mc-blue/5"
      >
        <div className="flex min-w-0 items-center gap-3">
          {s.icon}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-mc-dim">#{result.checkId}</span>
              <span className="text-sm font-semibold text-mc-text">{result.checkName}</span>
            </div>
            <p className="mt-0.5 text-xs text-mc-dim truncate">{result.stats}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide ${s.chip}`}>
            {s.label}
          </span>
          {result.flaggedCount > 0 && (
            <span className="rounded-md bg-mc-blue/10 border border-mc-blue/20 px-2 py-0.5 text-xs font-medium text-mc-blue">
              {result.flaggedCount} flagged
            </span>
          )}
          <ChevronDown className={`h-4 w-4 shrink-0 text-mc-dim transition ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded area */}
      {open && (
        <div className="border-t px-5 py-4 space-y-4" style={{ borderColor: 'var(--mc-card-border)', backgroundColor: 'rgba(7, 9, 15, 0.5)' }}>
          {/* Failure table */}
          {result.checkId === 7 ? (
            // Check 7 — OT review with verdict controls and export
            (() => {
              const blanketRows  = result.flaggedRows.filter((r) => r['section'] === 'blanket');
              const tabApprRows  = result.flaggedRows.filter((r) => r['section'] === 'tabApproved');
              // Actionable rows: only those that were flagged (section='flagged')
              // NOT blanket, NOT tab-approved
              const actionableRows = result.flaggedRows.filter(
                (r) => r['section'] !== 'blanket' && r['section'] !== 'tabApproved',
              );

              const totalBlanketHrs = blanketRows.reduce(
                (sum, r) => sum + parseFloat(String(r['hours'] ?? '0')),
                0,
              );
              const blanketNote = blanketRows.length > 0 ? String(blanketRows[0]['approvalDetail'] ?? blanketRows[0]['issue'] ?? '') : '';
              const totalTabApprHrs = tabApprRows.reduce(
                (sum, r) => sum + parseFloat(String(r['hours'] ?? '0')),
                0,
              );

              // Display columns for actionable rows (hide internal fields)
              const HIDDEN_COLS = new Set(['section', 'severity', 'approved', 'issue', 'status']);

              return (
                <div className="space-y-3">
                  {/* Export button */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-mc-dim">
                      {actionableRows.length} pending review · {blanketRows.length + tabApprRows.length} auto-resolved
                    </span>
                    <button
                      type="button"
                      onClick={() => exportCheck7(result.flaggedRows, invoiceFileName ?? result.checkName)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
                      style={{
                        border: '1px solid rgba(59,158,255,0.4)',
                        backgroundColor: 'rgba(59,158,255,0.06)',
                        color: '#3b9eff',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(59,158,255,0.12)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(59,158,255,0.06)')}
                      title="Export Pending and Resolved tabs to XLSX"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Export OT Review
                    </button>
                  </div>

                  {/* Green summary bar for blanket-approved entries */}
                  {blanketRows.length > 0 && (
                    <div
                      className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs"
                      style={{
                        backgroundColor: 'rgba(34, 208, 107, 0.08)',
                        border: '1px solid rgba(34, 208, 107, 0.25)',
                        color: '#22d06b',
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-medium">
                        {blanketRows.length} {blanketRows.length === 1 ? 'entry' : 'entries'} covered by blanket approval
                        {' · '}{totalBlanketHrs.toFixed(2)} hrs
                        {blanketNote ? ` · ${blanketNote}` : ''}
                      </span>
                    </div>
                  )}

                  {/* Blue summary bar for tab-approved entries */}
                  {tabApprRows.length > 0 && (
                    <div
                      className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs"
                      style={{
                        backgroundColor: 'rgba(59, 158, 255, 0.08)',
                        border: '1px solid rgba(59, 158, 255, 0.25)',
                        color: '#3b9eff',
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-medium">
                        {tabApprRows.length} {tabApprRows.length === 1 ? 'entry' : 'entries'} approved via OT Approval tab
                        {' · '}{totalTabApprHrs.toFixed(2)} hrs
                      </span>
                    </div>
                  )}

                  {/* Actionable rows table with verdict controls */}
                  {actionableRows.length > 0 ? (
                    <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--mc-card-border)' }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b" style={{ borderColor: 'var(--mc-card-border)', backgroundColor: 'rgba(13, 17, 32, 0.9)' }}>
                            {Object.keys(actionableRows[0])
                              .filter((k) => !HIDDEN_COLS.has(k))
                              .map((k) => (
                                <th key={k} className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-mc-dim">
                                  {k === 'approvalDetail' ? 'Approval Detail' : k}
                                </th>
                              ))}
                            <th className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-mc-dim">
                              Verdict
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {actionableRows.map((row, i) => {
                            const severity = row['severity'] as string | undefined;
                            const rowKey = String(row['rowKey'] ?? '');
                            const verdict: UserVerdict = rowKey ? (check7Verdicts.get(rowKey) ?? 'none') : 'none';
                            const rowStyle: React.CSSProperties = {
                              borderColor: 'var(--mc-card-border)',
                              ...(verdict === 'approved'
                                ? { backgroundColor: 'rgba(34, 208, 107, 0.08)', borderLeft: '3px solid rgba(34, 208, 107, 0.5)' }
                                : verdict === 'not_approved'
                                ? { backgroundColor: 'rgba(239, 68, 68, 0.08)', borderLeft: '3px solid rgba(239, 68, 68, 0.5)' }
                                : severity === 'red'
                                ? { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderLeft: '3px solid rgba(239, 68, 68, 0.7)' }
                                : severity === 'orange'
                                ? { backgroundColor: 'rgba(251, 146, 60, 0.12)', borderLeft: '3px solid rgba(251, 146, 60, 0.7)' }
                                : {}),
                            };
                            return (
                              <tr key={i} className="border-b last:border-0 hover:bg-mc-blue/5" style={rowStyle}>
                                {Object.entries(row)
                                  .filter(([k]) => !HIDDEN_COLS.has(k))
                                  .map(([k, v]) => (
                                    <td key={k} className="px-3 py-1.5 font-mono text-mc-text">
                                      {String(v ?? '—')}
                                    </td>
                                  ))}
                                {/* Verdict controls */}
                                <td className="px-3 py-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      title="Mark approved"
                                      onClick={() => setCheck7Verdict(rowKey, verdict === 'approved' ? 'none' : 'approved', row)}
                                      className="rounded px-2 py-0.5 text-[10px] font-medium transition"
                                      style={{
                                        border: verdict === 'approved'
                                          ? '1px solid rgba(34,208,107,0.6)'
                                          : '1px solid var(--mc-card-border)',
                                        backgroundColor: verdict === 'approved'
                                          ? 'rgba(34,208,107,0.15)'
                                          : 'transparent',
                                        color: verdict === 'approved' ? '#22d06b' : 'var(--mc-dim)',
                                      }}
                                    >
                                      ✓ OK
                                    </button>
                                    <button
                                      type="button"
                                      title="Mark not approved"
                                      onClick={() => setCheck7Verdict(rowKey, verdict === 'not_approved' ? 'none' : 'not_approved', row)}
                                      className="rounded px-2 py-0.5 text-[10px] font-medium transition"
                                      style={{
                                        border: verdict === 'not_approved'
                                          ? '1px solid rgba(239,68,68,0.6)'
                                          : '1px solid var(--mc-card-border)',
                                        backgroundColor: verdict === 'not_approved'
                                          ? 'rgba(239,68,68,0.15)'
                                          : 'transparent',
                                        color: verdict === 'not_approved' ? '#f87171' : 'var(--mc-dim)',
                                      }}
                                    >
                                      ✗ No
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : blanketRows.length === 0 && tabApprRows.length === 0 ? (
                    <p className="text-xs text-mc-dim">No flagged rows for this check.</p>
                  ) : (
                    <p className="text-xs text-mc-dim italic">All OT entries are covered — no pending review items.</p>
                  )}
                </div>
              );
            })()
          ) : result.checkId === 19 ? (
            // Check 19 — per-row dismiss (OK) buttons, session-scoped
            (() => {
              const allRows = result.flaggedRows.slice(0, 200);
              const visibleRows = allRows.filter(
                (row) => !dismissedCheck19.has(String(row['associateId'] ?? '')),
              );
              const dismissedCount = dismissedCheck19.size;
              // T-675: union of ALL rows' keys, not just row 0 — a header
              // derived from a single row silently misaligns every column
              // once any other row carries a key that one doesn't.
              const columns = unionFlaggedRowColumns(result.flaggedRows);
              return (
                <>
                  {result.flaggedRows.length === 0 || visibleRows.length === 0 ? (
                    <p className="text-xs text-mc-dim">
                      {result.flaggedRows.length === 0
                        ? 'No flagged rows for this check.'
                        : 'All flagged rows acknowledged.'}
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--mc-card-border)' }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b" style={{ borderColor: 'var(--mc-card-border)', backgroundColor: 'rgba(13, 17, 32, 0.9)' }}>
                            {columns.map((k) => (
                              <th key={k} className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-mc-dim">
                                {k}
                              </th>
                            ))}
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {visibleRows.map((row, i) => {
                            const rowKey = String(row['associateId'] ?? i);
                            return (
                              <tr key={rowKey} className="border-b last:border-0 hover:bg-mc-blue/5" style={{ borderColor: 'var(--mc-card-border)' }}>
                                {columns.map((k) => (
                                  <td key={k} className="px-3 py-1.5 font-mono text-mc-text">
                                    {String(row[k] ?? '—')}
                                  </td>
                                ))}
                                <td className="px-3 py-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setDismissedCheck19((prev) => new Set(prev).add(rowKey))}
                                    className="rounded px-2 py-0.5 text-[10px] font-medium transition"
                                    style={{ border: '1px solid var(--mc-card-border)', color: 'var(--mc-dim)' }}
                                    onMouseEnter={(e) => { e.currentTarget.style.color = '#22d06b'; e.currentTarget.style.borderColor = 'rgba(34,208,107,0.4)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--mc-dim)'; e.currentTarget.style.borderColor = 'var(--mc-card-border)'; }}
                                    title="Acknowledge — hides this row for this session"
                                  >
                                    OK
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {result.flaggedRows.length > 200 && (
                        <p className="px-3 py-2 text-[10px] text-mc-dim">
                          Showing 200 of {result.flaggedRows.length} rows
                        </p>
                      )}
                    </div>
                  )}
                  {dismissedCount > 0 && (
                    <p className="mt-1 text-[10px] text-mc-dim">{dismissedCount} acknowledged</p>
                  )}
                </>
              );
            })()
          ) : result.flaggedRows.length === 0 ? (
            <p className="text-xs text-mc-dim">No flagged rows for this check.</p>
          ) : (() => {
            // T-675: union of ALL rows' keys, not just row 0 (see the
            // Check-19 block above for the full explanation — this is the
            // block that rendered Check 3's misaligned table).
            const columns = unionFlaggedRowColumns(result.flaggedRows);
            return (
              <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--mc-card-border)' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--mc-card-border)', backgroundColor: 'rgba(13, 17, 32, 0.9)' }}>
                      {columns.map((k) => (
                        <th key={k} className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-mc-dim">
                          {k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.flaggedRows.slice(0, 200).map((row, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-mc-blue/5" style={{ borderColor: 'var(--mc-card-border)' }}>
                        {columns.map((k) => (
                          <td key={k} className="px-3 py-1.5 font-mono text-mc-text">
                            {String(row[k] ?? '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.flaggedRows.length > 200 && (
                  <p className="px-3 py-2 text-[10px] text-mc-dim">
                    Showing 200 of {result.flaggedRows.length} rows
                  </p>
                )}
              </div>
            );
          })()}

          {/* Analyze with Bragi — T-671: single button, source-data-backed
              (was two buttons: a Haiku flagged-rows-only summary here, plus
              a separate "Deep Dive" button below that actually had the
              source data. Consolidated onto the one mechanism that answers
              Allan's original ask — this button now runs the same
              associate-scoped source-row analysis Deep Dive used to. */}
          {showBragiButton && !externalAiOutput && (
            <div className="space-y-3">
              {aiState === 'idle' && (
                <button
                  type="button"
                  onClick={handleAnalyze}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition"
                  style={{ backgroundColor: '#3b9eff', border: '1px solid rgba(59,158,255,0.4)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a8aee')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3b9eff')}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Analyze with Bragi
                  <span className="ml-1 rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: 'rgba(59,158,255,0.2)' }}>
                    Sonnet · source data · {analysisCostEst}
                  </span>
                </button>
              )}

              {aiState === 'loading' && (
                <div className="flex items-center gap-2 text-xs text-mc-blue">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Asking Bragi — analyzing {result.checkName} with source data…
                </div>
              )}

              {aiState === 'error' && (
                <div className="space-y-2">
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                    {aiError}
                  </div>
                  <button
                    type="button"
                    onClick={handleAnalyze}
                    className="text-xs text-mc-blue hover:underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {aiState === 'done' && aiOutput && (
                <div className="rounded-lg border p-4" style={{ borderColor: 'rgba(59,158,255,0.25)', backgroundColor: 'rgba(59,158,255,0.05)' }}>
                  <div className="mb-2 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-mc-blue" />
                    <span className="text-xs font-semibold text-mc-text">Bragi Analysis</span>
                    <span className="ml-auto text-[10px] text-mc-dim">advisory — rule-based checks above are authoritative</span>
                  </div>
                  <div className="prose">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiOutput}</ReactMarkdown>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setAiState('idle'); setAiOutput(''); }}
                    className="mt-2 text-[10px] text-mc-dim hover:text-mc-blue"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          )}

          {isAiEligible(result.status) && !apiKey.trim() && (
            <p className="text-[10px] text-mc-dim">
              Enter a Claude API key in the left panel to enable Bragi Analysis.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
