// DownloadPDF.tsx — Client-side PDF audit report using pdfmake
// No DOM-to-canvas; generates directly from a document definition.

import { FileText } from 'lucide-react';
import type { AuditPayload } from '../audit/types';
import { fmtMoney } from '../lib/num';

interface DownloadPDFProps {
  payload: AuditPayload;
}

// Status label + color for PDF
function statusLabel(status: string): string {
  switch (status) {
    case 'fail': return 'FAIL';
    case 'warning': return 'WARNING';
    case 'pass': return 'PASS';
    case 'na': return 'N/A';
    default: return status.toUpperCase();
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'fail': return '#f87171';
    case 'warning': return '#ffba08';
    case 'pass': return '#22d06b';
    default: return '#8899aa';
  }
}

export function DownloadPDF({ payload }: DownloadPDFProps) {
  async function handleDownload() {
    // Dynamic import to avoid large bundle on initial load
    const pdfMake = (await import('pdfmake/build/pdfmake')).default;
    const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
    // pdfmake needs the vfs on the object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pdfMake as any).vfs = pdfFonts.vfs;

    const today = new Date().toISOString().slice(0, 10);

    // ── Document styles ────────────────────────────────────────────────
    const styles: Record<string, object> = {
      header: { fontSize: 18, bold: true, color: '#1a2236', margin: [0, 0, 0, 4] },
      subheader: { fontSize: 11, color: '#5a6a88', margin: [0, 0, 0, 2] },
      sectionTitle: { fontSize: 11, bold: true, color: '#1a2236', margin: [0, 12, 0, 4] },
      tableHeader: { fontSize: 8, bold: true, color: '#5a6a88', fillColor: '#f0f4fa' },
      tableCell: { fontSize: 7.5, color: '#1a2236' },
      footer: { fontSize: 7, color: '#9aabbf', italics: true },
      passChip: { fontSize: 7.5, bold: true, color: '#22d06b' },
      failChip: { fontSize: 7.5, bold: true, color: '#f87171' },
      warnChip: { fontSize: 7.5, bold: true, color: '#ffba08' },
      naChip: { fontSize: 7.5, bold: true, color: '#8899aa' },
    };

    // ── Content array ─────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [];

    // Header
    content.push({ text: 'FSM Invoice Audit Report', style: 'header' });
    content.push({ text: `Invoice: ${payload.invoiceFile}`, style: 'subheader' });
    content.push({
      text: `Audit Date: ${today}${payload.declaredPeriod ? `   |   Period: ${payload.declaredPeriod.start} to ${payload.declaredPeriod.end}` : ''}`,
      style: 'subheader',
      margin: [0, 0, 0, 8],
    });
    content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#e0e8f0' }] });

    // Summary financials
    content.push({ text: 'Financial Summary', style: 'sectionTitle' });
    content.push({
      table: {
        widths: ['*', 'auto'],
        body: [
          [{ text: 'Field Labor Total', style: 'tableCell' }, { text: fmtMoney(payload.summary.fieldLaborTotal), style: 'tableCell', alignment: 'right' }],
          [{ text: 'Management Total', style: 'tableCell' }, { text: fmtMoney(payload.summary.managementTotal), style: 'tableCell', alignment: 'right' }],
          [{ text: 'Cloud Services Total', style: 'tableCell' }, { text: fmtMoney(payload.summary.cloudTotal), style: 'tableCell', alignment: 'right' }],
          [{ text: 'Reconstructed Total', style: 'tableCell', bold: true }, { text: fmtMoney(payload.summary.reconstructedTotal), style: 'tableCell', alignment: 'right', bold: true }],
          [{ text: 'Invoice Total', style: 'tableCell' }, { text: payload.summary.invoiceTotal !== null ? fmtMoney(payload.summary.invoiceTotal) : 'N/A', style: 'tableCell', alignment: 'right' }],
          [{ text: 'Variance', style: 'tableCell', color: payload.summary.variance !== null && Math.abs(payload.summary.variance) > 0.01 ? '#f87171' : '#22d06b' }, { text: payload.summary.variance !== null ? fmtMoney(payload.summary.variance) : 'N/A', style: 'tableCell', alignment: 'right', color: payload.summary.variance !== null && Math.abs(payload.summary.variance) > 0.01 ? '#f87171' : '#22d06b' }],
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 8],
    });

    // Check summary table
    content.push({ text: 'Audit Check Summary', style: 'sectionTitle' });
    const summaryRows = payload.results.map((r) => [
      { text: String(r.checkId), style: 'tableCell', alignment: 'center' },
      { text: r.checkName, style: 'tableCell' },
      { text: statusLabel(r.status), style: 'tableCell', color: statusColor(r.status), bold: true, alignment: 'center' },
      { text: r.flaggedCount > 0 ? String(r.flaggedCount) : '—', style: 'tableCell', alignment: 'center' },
      { text: r.stats, style: 'tableCell', fontSize: 7 },
    ]);

    content.push({
      table: {
        headerRows: 1,
        widths: [22, '*', 48, 40, '*'],
        body: [
          [
            { text: '#', style: 'tableHeader', alignment: 'center' },
            { text: 'Check Name', style: 'tableHeader' },
            { text: 'Status', style: 'tableHeader', alignment: 'center' },
            { text: 'Flagged', style: 'tableHeader', alignment: 'center' },
            { text: 'Stats', style: 'tableHeader' },
          ],
          ...summaryRows,
        ],
      },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 8],
    });

    // Per-check detail sections (failed/warned only, all rows)
    const failedOrWarned = payload.results.filter(
      (r) => (r.status === 'fail' || r.status === 'warning') && r.flaggedRows.length > 0,
    );

    if (failedOrWarned.length > 0) {
      content.push({ text: 'Flagged Check Details', style: 'sectionTitle' });

      for (const r of failedOrWarned) {
        content.push({
          text: `${statusLabel(r.status)} — Check ${r.checkId}: ${r.checkName}`,
          fontSize: 9,
          bold: true,
          color: statusColor(r.status),
          margin: [0, 8, 0, 2],
        });
        content.push({
          text: r.stats,
          fontSize: 7.5,
          color: '#5a6a88',
          margin: [0, 0, 0, 4],
        });

        if (r.flaggedRows.length > 0) {
          const columns = Object.keys(r.flaggedRows[0]);
          const colWidths = columns.map(() => `${Math.floor(100 / columns.length)}%`);

          const headerRow = columns.map((col) => ({
            text: col,
            style: 'tableHeader',
            fontSize: 6.5,
          }));

          const dataRows = r.flaggedRows.map((row) =>
            columns.map((col) => ({
              text: String(row[col] ?? '—'),
              style: 'tableCell',
              fontSize: 6.5,
            })),
          );

          content.push({
            table: {
              headerRows: 1,
              widths: colWidths,
              body: [headerRow, ...dataRows],
            },
            layout: 'lightHorizontalLines',
            margin: [0, 0, 0, 4],
          });
        }
      }
    }

    // Cross-tab notes
    if (payload.crossTabNotes.length > 0) {
      content.push({ text: 'Notes', style: 'sectionTitle' });
      payload.crossTabNotes.forEach((note) => {
        content.push({ text: `• ${note}`, style: 'tableCell', margin: [4, 1, 0, 1] });
      });
    }

    // ── Document definition ────────────────────────────────────────────
    const docDef = {
      pageSize: 'A4' as const,
      pageOrientation: 'landscape' as const,
      pageMargins: [32, 36, 32, 36] as [number, number, number, number],
      content,
      styles,
      defaultStyle: { font: 'Roboto', fontSize: 8.5 },
      footer: ((_currentPage: number, _pageCount: number) => ({
        text: `Generated by FSM Audit Tool — ${today}`,
        style: 'footer',
        alignment: 'center' as const,
        margin: [0, 8, 0, 0] as [number, number, number, number],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as any,
    };

    // Generate filename
    const baseName = payload.invoiceFile.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '_');
    const filename = `${baseName}-audit-${today}.pdf`;

    pdfMake.createPdf(docDef).download(filename);
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-mc-text shadow-sm transition hover:bg-mc-blue/10"
      style={{ border: '1px solid var(--mc-card-border)' }}
    >
      <FileText className="h-4 w-4 text-mc-amber" />
      Download PDF
    </button>
  );
}
