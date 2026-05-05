import React, { useState } from 'react';
import { ChevronDown, CheckCircle2, AlertTriangle, XCircle, MinusCircle, Sparkles, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CheckResult, CheckStatus } from '../audit/types';
import { estimateCost, estimateTokens, analyzeCheck } from '../ai/bragiClient';

interface CheckCardProps {
  result: CheckResult;
  defaultOpen?: boolean;
  apiKey: string;
  onTokensUsed?: (inputTokens: number, outputTokens: number) => void;
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

export function CheckCard({ result, defaultOpen = false, apiKey, onTokensUsed }: CheckCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiOutput, setAiOutput] = useState('');
  const [aiError, setAiError] = useState('');
  const s = STATUS_STYLES[result.status];

  const showBragiButton = (result.status === 'fail' || result.status === 'warning') && apiKey.trim();
  const costEst = showBragiButton ? estimateCost(result) : '';
  const tokenEst = showBragiButton ? estimateTokens(result) : 0;

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
          {result.flaggedRows.length === 0 ? (
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
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-3 py-1.5 font-mono text-mc-text">
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

          {/* Bragi Analysis button */}
          {showBragiButton && (
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
