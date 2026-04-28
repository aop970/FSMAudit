import { Sparkles, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CheckResult } from '../audit/types';

export type AnalyzeAllState = 'idle' | 'loading' | 'done' | 'error';

interface AnalyzeAllButtonProps {
  results: CheckResult[];
  apiKey: string;
  state: AnalyzeAllState;
  output: string;
  errMsg: string;
  onRun: () => void;
  onClear: () => void;
}

export function AnalyzeAllButton({ results, apiKey, state, output, errMsg, onRun, onClear }: AnalyzeAllButtonProps) {
  const failures = results.filter((r) => r.status === 'fail' || r.status === 'warning');
  if (failures.length < 2 || !apiKey.trim()) return null;

  return (
    <div className="rounded-xl p-5" style={{ border: '1px solid rgba(59,158,255,0.25)', backgroundColor: 'rgba(59,158,255,0.06)' }}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-mc-text">Analyze All Failures</h3>
          <p className="text-xs text-mc-dim">
            {failures.length} check{failures.length === 1 ? '' : 's'} failed or warned — send all to Bragi for a combined assessment
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
          </button>
        )}
        {state === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-mc-blue">
            <Loader2 className="h-4 w-4 animate-spin" />
            Asking Bragi…
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
