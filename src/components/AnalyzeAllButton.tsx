import { useMemo } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CheckResult } from '../audit/types';
import { countAiEligible, shouldShowAnalyzeAll } from '../ai/aiGate';
import { estimateAnalyzeAllCost } from '../ai/bragiClient';

export type AnalyzeAllState = 'idle' | 'loading' | 'done' | 'error';

interface AnalyzeAllButtonProps {
  results: CheckResult[];
  apiKey: string;
  state: AnalyzeAllState;
  output: string;
  errMsg: string;
  progress?: string;
  onRun: () => void;
  onClear: () => void;
}

export function AnalyzeAllButton({ results, apiKey, state, output, errMsg, progress, onRun, onClear }: AnalyzeAllButtonProps) {
  // T-670: token-budget cut — Analyze All only ever sends FAIL checks.
  // T-671: the >= 2 threshold vanished the button on a real SES run with a
  // single FAIL — shouldShowAnalyzeAll() is the one place that decision
  // lives now, shared with App.tsx's sidebar trigger so they can't drift.
  const eligibleCount = countAiEligible(results);
  // Memoized: estimateAnalyzeAllCost sums a Haiku estimate per eligible
  // check — cheap, but no reason to recompute on every keystroke in the
  // apiKey field either (same rationale as CheckCard's analysisCostEst).
  const totalCostEst = useMemo(() => estimateAnalyzeAllCost(results), [results]);
  if (!shouldShowAnalyzeAll(results) || !apiKey.trim()) return null;

  return (
    <div className="rounded-xl p-5" style={{ border: '1px solid rgba(59,158,255,0.25)', backgroundColor: 'rgba(59,158,255,0.06)' }}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-mc-text">Analyze All Failures</h3>
          <p className="text-xs text-mc-dim">
            {eligibleCount} check{eligibleCount === 1 ? '' : 's'} failed — send all to Bragi for a combined assessment
          </p>
          {/* Vera (T-671 review): the depth difference between this button and
              the per-check "Analyze with Bragi" button MUST be visible. This
              one is Haiku-per-check + a Sonnet synthesis over flagged rows
              only; the per-check button is Sonnet over the actual source rows.
              Unlabelled, a user clicking here on a single-FAIL run gets a
              summary for the very same check the card button would root-cause,
              and reasonably concludes the source-data fix didn't work — which
              is exactly the confusion that produced T-671. */}
          <p className="mt-0.5 text-[10px] text-mc-dim/80">
            Quick combined overview — Haiku summary per check, no source data. For root-cause on a
            single check, use <span className="text-mc-blue">Analyze with Bragi</span> on that check&apos;s card.
          </p>
        </div>
        {state === 'idle' && (
          <button
            type="button"
            onClick={onRun}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition"
            style={{ backgroundColor: '#3b9eff', border: '1px solid rgba(59,158,255,0.4)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2a8aee')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3b9eff')}
          >
            <Sparkles className="h-4 w-4" />
            Analyze All Failures
            <span className="ml-1 rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
              {totalCostEst}
            </span>
          </button>
        )}
        {state === 'loading' && (
          <div className="space-y-1 text-right">
            <div className="flex items-center gap-2 text-sm text-mc-blue">
              <Loader2 className="h-4 w-4 animate-spin" />
              Asking Bragi…
            </div>
            {progress && (
              <p className="text-xs text-mc-dim">{progress}</p>
            )}
          </div>
        )}
        {state === 'error' && (
          <button type="button" onClick={onRun} className="text-sm text-rose-400 underline">
            Retry
          </button>
        )}
        {state === 'done' && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-mc-dim hover:text-mc-blue"
          >
            Clear
          </button>
        )}
      </div>

      {state === 'error' && (
        <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
          {errMsg}
        </div>
      )}

      {state === 'done' && output && (
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(59,158,255,0.2)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="h-3.5 w-3.5 text-mc-blue" />
            <span className="text-xs font-semibold text-mc-text">Bragi Combined Analysis</span>
            <span className="ml-auto text-[10px] text-mc-dim">advisory — rule-based checks are authoritative</span>
          </div>
          <div className="prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
