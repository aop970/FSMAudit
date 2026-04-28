import { Download } from 'lucide-react';
import type { AuditPayload } from '../audit/types';
import { fmtMoney } from '../lib/num';

interface DownloadReportProps {
  payload: AuditPayload;
}

export function DownloadReport({ payload }: DownloadReportProps) {
  function download() {
    const rows: string[] = [];

    // Header metadata
    rows.push(`FSM Invoice Audit Report`);
    rows.push(`Generated,${payload.generatedAt}`);
    rows.push(`Invoice File,${payload.invoiceFile}`);
    rows.push(`Punch File,${payload.punchFile ?? 'N/A'}`);
    if (payload.declaredPeriod) {
      rows.push(`Period,${payload.declaredPeriod.start} to ${payload.declaredPeriod.end}`);
    }
    rows.push(`Weeks Covered,${payload.weeksCovered.join(' / ')}`);
    rows.push('');

    // Summary
    rows.push('SUMMARY');
    rows.push(`Field Labor Total,${fmtMoney(payload.summary.fieldLaborTotal)}`);
    rows.push(`Management Total,${fmtMoney(payload.summary.managementTotal)}`);
    rows.push(`Cloud Services Total,${fmtMoney(payload.summary.cloudTotal)}`);
    rows.push(`Reconstructed Total,${fmtMoney(payload.summary.reconstructedTotal)}`);
    rows.push(`Invoice Total,${payload.summary.invoiceTotal !== null ? fmtMoney(payload.summary.invoiceTotal) : 'N/A'}`);
    rows.push(`Variance,${payload.summary.variance !== null ? fmtMoney(payload.summary.variance) : 'N/A'}`);
    rows.push(`Total Labor Rows,${payload.summary.totalLaborRows}`);
    rows.push(`Total Field Associates,${payload.summary.totalFieldAssociates}`);
    rows.push('');

    // Check results
    rows.push('AUDIT CHECKS');
    rows.push('Check ID,Check Name,Status,Summary,Flagged Count');
    for (const r of payload.results) {
      rows.push([r.checkId, r.checkName, r.status.toUpperCase(), `"${r.stats}"`, r.flaggedCount].join(','));
    }
    rows.push('');

    // Failure details
    for (const r of payload.results) {
      if (r.flaggedRows.length === 0) continue;
      rows.push(`FAILURES: ${r.checkName}`);
      const keys = Object.keys(r.flaggedRows[0]);
      rows.push(keys.join(','));
      for (const row of r.flaggedRows) {
        rows.push(keys.map((k) => `"${String(row[k] ?? '').replace(/"/g, '""')}"`).join(','));
      }
      rows.push('');
    }

    // Cross-tab notes
    if (payload.crossTabNotes.length > 0) {
      rows.push('CROSS-TAB NOTES');
      for (const note of payload.crossTabNotes) {
        rows.push(`"${note}"`);
      }
    }

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `FSM-Audit-Report-${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-mc-text shadow-sm transition hover:bg-mc-blue/10"
      style={{ border: '1px solid var(--mc-card-border)' }}
    >
      <Download className="h-4 w-4 text-mc-blue" />
      Download Audit Report (CSV)
    </button>
  );
}
