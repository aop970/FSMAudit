// check07Export.ts — Two-tab XLSX export for Check 7 OT review (T-590).
//
// Structure:
//   Tab 1 "Pending"  — rows in 'none' state only (Allan's live worklist).
//   Tab 2 "Resolved" — rows with disposition: blanket | tab_approved | approved | not_approved.
//
// Both tabs use the identical column set:
//   Associate ID | Name | Sheet | Week | OT Type | Hours | Tier | Status | Approval Detail | Row Key
//
// Rows MOVE between tabs as Allan works: mark a 'none' row approved and re-export
// → it leaves Pending and appears in Resolved.
//
// If Pending is empty, write the sheet with headers and zero data rows (no omission).
// The export is NEVER silently truncated — no row caps applied here.

import * as XLSX from 'xlsx';
import type { UserVerdict } from './check07Verdicts';
import { loadVerdict } from './check07Verdicts';

// ── Column layout ─────────────────────────────────────────────────────────────

const COLUMNS = [
  'Associate ID',
  'Name',
  'Sheet',
  'Week',
  'OT Type',
  'Hours',
  'Tier',
  'Status',
  'Approval Detail',
  'Row Key',
];

// System states that are always "resolved" regardless of user verdict
const RESOLVED_SYSTEM_STATES = new Set(['blanket', 'tab_approved', 'approved']);

// Human-readable status label for the export
function statusLabel(systemStatus: string, userVerdict: UserVerdict): string {
  if (systemStatus === 'blanket') return 'blanket';
  if (systemStatus === 'tab_approved') return 'tab_approved';
  if (userVerdict === 'approved') return 'approved';
  if (userVerdict === 'not_approved') return 'not_approved';
  return 'none';
}

// ── Row builder ───────────────────────────────────────────────────────────────

interface ExportRow {
  'Associate ID': string;
  'Name': string;
  'Sheet': string;
  'Week': string;
  'OT Type': string;
  'Hours': string;
  'Tier': string;
  'Status': string;
  'Approval Detail': string;
  'Row Key': string;
}

function buildExportRow(
  r: Record<string, unknown>,
  userVerdict: UserVerdict,
  systemStatus: string,
): ExportRow {
  return {
    'Associate ID':   String(r['associateId']    ?? ''),
    'Name':           String(r['name']           ?? ''),
    'Sheet':          String(r['sheet']          ?? ''),
    'Week':           String(r['week']           ?? ''),
    'OT Type':        String(r['otType']         ?? ''),
    'Hours':          String(r['hours']          ?? ''),
    'Tier':           String(r['tier']           ?? ''),
    'Status':         statusLabel(systemStatus, userVerdict),
    'Approval Detail': String(r['approvalDetail'] ?? r['issue'] ?? ''),
    'Row Key':        String(r['rowKey']         ?? ''),
  };
}

// ── Main export function ──────────────────────────────────────────────────────

/**
 * Build a two-tab XLSX workbook for Check 7 OT review and trigger a browser download.
 *
 * @param flaggedRows - the full `result.flaggedRows` array from the Check 7 CheckResult
 * @param invoiceFileName - used to name the downloaded file
 */
export function exportCheck7(
  flaggedRows: Record<string, unknown>[],
  invoiceFileName: string,
): void {
  const pending: ExportRow[] = [];
  const resolved: ExportRow[] = [];

  for (const r of flaggedRows) {
    const systemStatus = String(r['status'] ?? r['section'] ?? 'none');
    const rowKey = String(r['rowKey'] ?? '');

    // System-resolved states never need a user verdict lookup
    if (RESOLVED_SYSTEM_STATES.has(systemStatus)) {
      resolved.push(buildExportRow(r, 'approved', systemStatus));
      continue;
    }

    // For 'none' (flagged) rows, check user verdict from localStorage adapter
    const snapshot = {
      name:   String(r['name']   ?? ''),
      otType: String(r['otType'] ?? ''),
      hours:  String(r['hours']  ?? ''),
    };
    const { verdict } = rowKey
      ? loadVerdict(rowKey, snapshot)
      : { verdict: 'none' as UserVerdict };

    if (verdict === 'none') {
      pending.push(buildExportRow(r, 'none', systemStatus));
    } else {
      resolved.push(buildExportRow(r, verdict, systemStatus));
    }
  }

  // Build worksheets
  const wsPending  = XLSX.utils.json_to_sheet(pending,  { header: COLUMNS });
  const wsResolved = XLSX.utils.json_to_sheet(resolved, { header: COLUMNS });

  // Set column widths (approximate character widths)
  const colWidths = [14, 28, 12, 8, 18, 8, 22, 14, 50, 18];
  const wscols = colWidths.map((wch) => ({ wch }));
  wsPending['!cols']  = wscols;
  wsResolved['!cols'] = wscols;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsPending,  'Pending');
  XLSX.utils.book_append_sheet(wb, wsResolved, 'Resolved');

  // Generate filename from invoice file name
  const base = invoiceFileName.replace(/\.[^.]+$/, '');
  const dateStr = new Date().toISOString().slice(0, 10);
  const outName = `${base}_OT-Review_${dateStr}.xlsx`;

  XLSX.writeFile(wb, outName);
}
