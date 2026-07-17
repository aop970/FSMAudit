import React, { useState } from 'react';
import { ChevronDown, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Sparkles, Loader2, ZoomIn } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CheckResult, CheckStatus } from '../audit/types';
import { estimateCost, estimateTokens, analyzeCheck, runDeepDive } from '../ai/bragiClient';

interface CheckCardProps {
  result: CheckResult;
  allResults?: CheckResult[];
  defaultOpen?: boolean;
  apiKey: string;
  program?: 'fsm' | 'ses' | 'ci';
  onTokensUsed?: (inputTokens: number, outputTokens: number) => void;
  // External AI output can be injected from the synthesis pass
  externalAiOutput?: string;
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

export function CheckCard({ result, allResults, defaultOpen = false, apiKey, program, onTokensUsed, externalAiOutput }: CheckCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiOutput, setAiOutput] = useState('');
  const [aiError, setAiError] = useState('');
  // Deep Dive state
  const [ddState, setDdState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [ddOutput, setDdOutput] = useState('');
  const [ddError, setDdError] = useState('');
  // Check 19: session-scoped per-row dismiss (resets automatically when component remounts on new upload)
  const [dismissedCheck19, setDismissedCheck19] = useState<Set<string>>(new Set());
  const s = STATUS_STYLES[result.status];

  const showBragiButton = (result.status === 'fail' || result.status === 'warning') && apiKey.trim();
  const costEst = showBragiButton ? estimateCost(result) : '';
  const tokenEst = showBragiButton ? estimateTokens(result) : 0;

  // Only checks 3, 5, and 7 warrant the full Sonnet Deep Dive treatment.
  // All other failed/warned checks receive Haiku analysis only.
  const DEEP_DIVE_CHECKS = new Set([3, 5, 7]);
  const showDeepDive = showBragiButton && DEEP_DIVE_CHECKS.has(result.checkId) && allResults && allResults.length > 0;

  async function handleAnalyze() {
    setAiState('loading');
    setAiError('');
    try {
      const { text, inputTokens, outputTokens } = await analyzeCheck(apiKey, result);
      setAiOutput(text);
      setAiState('done');
      onTokensUsed?.(inputTokens, outputTokens);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
      setAiState('error');
    }
  }

  async function handleDeepDive() {
    if (!allResults) return;
    setDdState('loading');
    setDdError('');
    try {
      const { text, inputTokens, outputTokens } = await runDeepDive(
        apiKey,
        result,
        allResults,
        program,
        () => { /* progress handled inline */ },
      );
      setDdOutput(text);
      setDdState('done');
      onTokensUsed?.(inputTokens, outputTokens);
    } catch (err) {
      setDdError(err instanceof Error ? err.message : String(err));
      setDdState('error');
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
            // Check 7 — split blanket-approved entries from actionable unapproved OT
            (() => {
              const blanketRows = result.flaggedRows.filter((r) => r['section'] === 'blanketApproved');
              const unapprovedRows = result.flaggedRows.filter((r) => r['section'] !== 'blanketApproved');
              const totalBlanketHrs = blanketRows.reduce(
                (sum, r) => sum + parseFloat(String(r['hours'] ?? '0')),
                0,
              );
              const blanketNote = blanketRows.length > 0 ? String(blanketRows[0]['issue'] ?? '') : '';
              return (
                <div className="space-y-3">
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
                  {/* Individual rows for unapproved OT entries (actionable) */}
                  {unapprovedRows.length > 0 ? (
                    <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--mc-card-border)' }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b" style={{ borderColor: 'var(--mc-card-border)', backgroundColor: 'rgba(13, 17, 32, 0.9)' }}>
                            {Object.keys(unapprovedRows[0])
                              .filter((k) => k !== 'severity')
                              .map((k) => (
                                <th key={k} className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-mc-dim">
                                  {k}
                                </th>
                              ))}
                          </tr>
                        </thead>
                        <tbody>
                          {unapprovedRows.slice(0, 200).map((row, i) => {
                            const severity = row['severity'] as string | undefined;
                            const rowStyle: React.CSSProperties = {
                              borderColor: 'var(--mc-card-border)',
                              ...(severity === 'red'
                                ? { backgroundColor: 'rgba(239, 68, 68, 0.12)', borderLeft: '3px solid rgba(239, 68, 68, 0.7)' }
                                : severity === 'orange'
                                ? { backgroundColor: 'rgba(251, 146, 60, 0.12)', borderLeft: '3px solid rgba(251, 146, 60, 0.7)' }
                                : {}),
                            };
                            return (
                              <tr key={i} className="border-b last:border-0 hover:bg-mc-blue/5" style={rowStyle}>
                                {Object.entries(row)
                                  .filter(([k]) => k !== 'severity')
                                  .map(([k, v]) => (
                                    <td key={k} className="px-3 py-1.5 font-mono text-mc-text">
                                      {String(v ?? '—')}
                                    </td>
                                  ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {unapprovedRows.length > 200 && (
                        <p className="px-3 py-2 text-[10px] text-mc-dim">
                          Showing 200 of {unapprovedRows.length} rows
                        </p>
                      )}
                    </div>
                  ) : blanketRows.length === 0 ? (
                    <p className="text-xs text-mc-dim">No flagged rows for this check.</p>
                  ) : null}
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
                            {Object.keys(result.flaggedRows[0]).map((k) => (
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
                                {Object.entries(row).map(([k, v]) => (
                                  <td key={k} className="px-3 py-1.5 font-mono text-mc-text">
                                    {String(v ?? '—')}
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
          ) : (
            <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--mc-card-border)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--mc-card-border)', backgroundColor: 'rgba(13, 17, 32, 0.9)' }}>
                    {Object.keys(result.flaggedRows[0]).map((k) => (
                      <th key={k} className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-mc-dim">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.flaggedRows.slice(0, 200).map((row, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-mc-blue/5" style={{ borderColor: 'var(--mc-card-border)' }}>
                      {Object.entries(row).map(([k, v]) => (
                        <td key={k} className="px-3 py-1.5 font-mono text-mc-text">
                          {String(v ?? '—')}
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
          )}

          {/* Bragi Analysis — quick Haiku analyze button (shown when no external AI output) */}
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
                    ~{tokenEst} tokens · {costEst}
                  </span>
                </button>
              )}

              {aiState === 'loading' && (
                <div className="flex items-center gap-2 text-xs text-mc-blue">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Asking Bragi…
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

          {/* Deep Dive button — Sonnet full context bundle */}
          {showDeepDive && (
            <div className="space-y-3">
              {ddState === 'idle' && (
                <button
                  type="button"
                  onClick={handleDeepDive}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition"
                  style={{
                    border: '1px solid rgba(255,186,8,0.4)',
                    backgroundColor: 'rgba(255,186,8,0.06)',
                    color: '#ffba08',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,186,8,0.12)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,186,8,0.06)')}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                  Deep Dive
                  <span className="ml-1 text-[10px] opacity-70">Sonnet · full context</span>
                </button>
              )}

              {ddState === 'loading' && (
                <div className="flex items-center gap-2 text-xs text-mc-amber">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Running deep dive on {result.checkName}…
                </div>
              )}

              {ddState === 'error' && (
                <div className="space-y-2">
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                    {ddError}
                  </div>
                  <button
                    type="button"
                    onClick={handleDeepDive}
                    className="text-xs text-mc-blue hover:underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {ddState === 'done' && ddOutput && (
                <div className="rounded-lg border p-4" style={{ borderColor: 'rgba(255,186,8,0.3)', backgroundColor: 'rgba(255,186,8,0.05)' }}>
                  <div className="mb-2 flex items-center gap-1.5">
                    <ZoomIn className="h-3.5 w-3.5 text-mc-amber" />
                    <span className="text-xs font-semibold text-mc-text">Deep Dive — Sonnet Analysis</span>
                    <span className="ml-auto text-[10px] text-mc-dim">advisory — rule-based checks are authoritative</span>
                  </div>
                  <div className="prose">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{ddOutput}</ReactMarkdown>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setDdState('idle'); setDdOutput(''); }}
                    className="mt-2 text-[10px] text-mc-dim hover:text-mc-amber"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          )}

          {(result.status === 'fail' || result.status === 'warning') && !apiKey.trim() && (
            <p className="text-[10px] text-mc-dim">
              Enter a Claude API key in the left panel to enable Bragi Analysis.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
