import type { AuditPayload } from '../audit/types';
import { fmtMoney } from '../lib/num';

interface SummaryStripProps {
  payload: AuditPayload;
}

export function SummaryStrip({ payload }: SummaryStripProps) {
  const s = payload.summary;
  const tieRow = payload.results.find((r) => r.checkId === 9);

  return (
    <div className="rounded-xl overflow-hidden shadow-sm" style={{ border: '1px solid var(--mc-card-border)', backgroundColor: 'var(--mc-card-bg)' }}>
      {/* Top row — financial */}
      <div className="grid grid-cols-2 sm:grid-cols-4" style={{ borderBottom: '1px solid var(--mc-card-border)' }}>
        <StatCell label="Field Labor" value={fmtMoney(s.fieldLaborTotal)} />
        <StatCell label="Management" value={fmtMoney(s.managementTotal)} />
        <StatCell label="Cloud Services" value={fmtMoney(s.cloudTotal)} />
        <StatCell
          label="Variance"
          value={s.variance !== null ? fmtMoney(s.variance) : '—'}
          highlight={s.variance !== null && Math.abs(s.variance) > 0.01 ? 'red' : s.variance !== null ? 'green' : undefined}
        />
      </div>
      {/* Bottom row — counts */}
      <div className="px-5 py-2.5 flex flex-wrap gap-4 text-xs text-mc-dim" style={{ backgroundColor: 'rgba(7, 9, 15, 0.4)' }}>
        <span><strong className="text-mc-text">{s.totalLaborRows.toLocaleString()}</strong> labor rows</span>
        <span><strong className="text-mc-text">{s.totalFieldAssociates}</strong> field associates</span>
        {payload.punchFile && <span>Punch: <strong className="text-mc-text">{payload.punchFile}</strong></span>}
        {payload.declaredPeriod && (
          <span>Period: <strong className="text-mc-text">{payload.declaredPeriod.start} – {payload.declaredPeriod.end}</strong></span>
        )}
        {payload.weeksCovered.length > 0 && (
          <span>Weeks: <strong className="text-mc-text">{payload.weeksCovered.join(', ')}</strong></span>
        )}
        {tieRow && (
          <span>Invoice total: <strong className="text-mc-text">{s.invoiceTotal !== null ? fmtMoney(s.invoiceTotal) : '—'}</strong></span>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, value, highlight }: { label: string; value: string; highlight?: 'red' | 'green' }) {
  return (
    <div className="px-4 py-3" style={{ borderRight: '1px solid var(--mc-card-border)' }}>
      <p className="text-[10px] uppercase tracking-wide text-mc-dim">{label}</p>
      <p className={`mt-0.5 text-sm font-bold ${
        highlight === 'red' ? 'text-rose-400' :
        highlight === 'green' ? 'text-mc-green' :
        'text-mc-text'
      }`}>
        {value}
      </p>
    </div>
  );
}
