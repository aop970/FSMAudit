import { FileSpreadsheet, Settings } from 'lucide-react';

interface HeaderProps {
  program?: 'fsm' | 'ses';
  fileName?: string;
  overallStatus?: 'pass' | 'fail' | 'warning' | 'pending' | null;
  rulesOpen?: boolean;
  onToggleRules?: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  pass:    'bg-mc-green/10 text-mc-green border border-mc-green/30',
  fail:    'bg-rose-500/10 text-rose-400 border border-rose-500/30',
  warning: 'bg-mc-amber/10 text-mc-amber border border-mc-amber/30',
  pending: 'bg-mc-dim/20 text-mc-dim border border-mc-dim/30',
};

export function Header({ program = 'fsm', fileName, overallStatus, rulesOpen, onToggleRules }: HeaderProps) {
  return (
    <header className="border-b border-mc-card-border bg-mc-bg2 shadow-sm" style={{ borderColor: 'var(--mc-card-border)' }}>
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-mc-blue/20 border border-mc-blue/30">
            <FileSpreadsheet className="h-4 w-4 text-mc-blue" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-mc-text">
              {program === 'ses' ? 'SES Invoice Audit' : 'FSM Invoice Audit'}
            </h1>
            <p className="text-xs text-mc-dim">Tier 1 Engine + Bragi Analysis</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {fileName && (
            <span className="hidden truncate text-xs text-mc-dim sm:block max-w-xs">
              {fileName}
            </span>
          )}
          {overallStatus && (
            <span className={`rounded-full px-3 py-0.5 text-xs font-bold tracking-wide ${STATUS_BADGE[overallStatus] ?? STATUS_BADGE.pending}`}>
              {overallStatus.toUpperCase()}
            </span>
          )}
          {onToggleRules && (
            <button
              type="button"
              onClick={onToggleRules}
              title="Audit Rules"
              className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
                rulesOpen
                  ? 'border-mc-blue/50 bg-mc-blue/15 text-mc-blue'
                  : 'border-mc-card-border bg-transparent text-mc-dim hover:text-mc-text hover:border-mc-dim/50'
              }`}
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
