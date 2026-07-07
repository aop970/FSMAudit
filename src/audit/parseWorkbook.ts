// parseWorkbook.ts — SheetJS invoice parse + PapaParse punch CSV
// Tab selection is by NAME only, never by index, never hidden.
// Tabs to load and always-exclude lists come from stored audit rules.

import * as XLSX from 'xlsx';
import Papa from 'papaparse';

// xlsx's ESM bundle (xlsx.mjs) does not re-export SSF as a named namespace member
// in all bundler/tsx contexts. Resolve it defensively so both Vite (browser) and
// tsx (Node fixture) work correctly.
const _XLSX = XLSX as unknown as Record<string, unknown>;
const XlsxSSF = (
  XLSX.SSF ??
  (_XLSX['default'] as Record<string, unknown> | undefined)?.SSF ??
  (_XLSX['module.exports'] as Record<string, unknown> | undefined)?.SSF
) as typeof XLSX.SSF;
import type {
  CiActivityRow, CiCoverMeta, CiDetailRow, CiParsedData, CiRosterRow,
  CloudRow, LaborRow, MgmtRow, OtApprovalRow,
  ParsedData, PunchRow, RosterEntry, SesPunchRow, ShiftRow, TermedPtoRow, TieOutData, TimeOffRow,
} from './types';
import { toNum, toStr, toPct } from '../lib/num';

// ── helpers ───────────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = XlsxSSF.parse_date_code(v);
    if (!d) return null;
    return new Date(d.y, d.m - 1, d.d);
  }
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function readAoA(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(ws, {
    header: 1, raw: true, defval: null, blankrows: false,
  }) as unknown[][];
}

function getCellFormula(ws: XLSX.WorkSheet, r: number, c: number): string | undefined {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = ws[addr] as XLSX.CellObject | undefined;
  return cell?.f ? String(cell.f) : undefined;
}

// Find a sheet by exact name (case-insensitive trim) from allowed list only.
function findSheet(
  wb: XLSX.WorkBook,
  candidates: string[],
): { name: string; ws: XLSX.WorkSheet } | null {
  for (const cand of candidates) {
    const hit = wb.SheetNames.find(
      (n) => n.trim().toLowerCase() === cand.trim().toLowerCase(),
    );
    if (hit) return { name: hit, ws: wb.Sheets[hit] };
  }
  // Fallback: prefix match
  for (const cand of candidates) {
    const hit = wb.SheetNames.find(
      (n) => n.trim().toLowerCase().startsWith(cand.trim().toLowerCase()),
    );
    if (hit) return { name: hit, ws: wb.Sheets[hit] };
  }
  return null;
}

// Resolve allowed tab names against actual workbook sheet names using
// the same fuzzy logic as findSheet: exact → prefix → substring → word-set.
export function resolveTabNames(actualNames: string[], allowed: string[]): string[] {
  const resolved = new Set<string>();
  for (const cand of allowed) {
    const lower = cand.trim().toLowerCase();
    // 1. Exact match
    const exact = actualNames.find((n) => n.trim().toLowerCase() === lower);
    if (exact) { resolved.add(exact); continue; }
    // 2. Prefix match
    const prefix = actualNames.find((n) => n.trim().toLowerCase().startsWith(lower));
    if (prefix) { resolved.add(prefix); continue; }
    // 3. Substring match (candidate is contained in actual name)
    const sub = actualNames.find((n) => n.trim().toLowerCase().includes(lower));
    if (sub) { resolved.add(sub); continue; }
    // 4. Word-set match (every word in candidate appears somewhere in actual name)
    const candWords = lower.split(/\s+/);
    const wordSet = actualNames.find((n) => {
      const actualLower = n.trim().toLowerCase();
      return candWords.every((w) => actualLower.includes(w));
    });
    if (wordSet) resolved.add(wordSet);
  }
  return Array.from(resolved);
}

// ── labor (FSM I / FSM II) ────────────────────────────────────────────────────

function parseLaborSheet(label: string, ws: XLSX.WorkSheet): LaborRow[] {
  const aoa = readAoA(ws);
  let hIdx = -1;
  for (let i = 0; i < Math.min(6, aoa.length); i++) {
    const row = aoa[i] || [];
    const has = (s: string) => row.some((c) => toStr(c).toLowerCase() === s.toLowerCase());
    if (has('week') && has('employee name')) { hIdx = i; break; }
  }
  if (hIdx < 0) return [];

  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  const col = (label: string) => headers.indexOf(label.toLowerCase());

  const cWeek  = col('week');
  const cName  = col('employee name');
  const cId    = col('associate id');
  const cType  = col('associate type');
  const cDate  = col('visit date');
  const cHrs   = col('time hours');
  const cBase  = col('base pay rate');
  const cMu    = col('mu');
  const cLoaded = col('pay rate total');
  const cBill  = col('bill');
  const cState = col('associate state');
  const cCmt   = col('comments');
  const cStoreId = col('client store id');

  const out: LaborRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;
    const name = toStr(row[cName]);
    const id   = toStr(row[cId]);
    const hrs  = toNum(row[cHrs]);
    if (!name && !id && !hrs) continue;

    const muFormula   = cMu   >= 0 ? getCellFormula(ws, i, cMu)   : undefined;
    const billFormula = cBill >= 0 ? getCellFormula(ws, i, cBill)  : undefined;

    const rawComments = toStr(row[cCmt]);
    // Normalize legacy two-word "Over Time" → "Overtime" at parse time.
    // All downstream logic uses the single label "Overtime".
    const normalizedComments = /^over\s+time$/i.test(rawComments.trim())
      ? 'Overtime'
      : rawComments;

    out.push({
      sheet: label,
      rowNum: i + 1,
      employeeName: name,
      associateId: id,
      associateType: toStr(row[cType]),
      timeHours: hrs,
      basePayRate: toNum(row[cBase]),
      muValue:    toNum(row[cMu]),
      muFormula,
      billValue:  toNum(row[cBill]),
      billFormula,
      loadedRate:     toNum(row[cLoaded]),
      associateState: cState >= 0 ? toStr(row[cState]) : '',
      comments:       normalizedComments,
      visitDate:      toDate(row[cDate]),
      week: cWeek >= 0 && row[cWeek] != null ? (toNum(row[cWeek]) || null) : null,
      clientStoreId: cStoreId >= 0 ? toStr(row[cStoreId]) : '',
    });
  }
  return out;
}

// ── management detail hours ───────────────────────────────────────────────────

function parseMgmtSheet(ws: XLSX.WorkSheet): MgmtRow[] {
  const aoa = readAoA(ws);
  let hIdx = -1;
  for (let i = 0; i < Math.min(6, aoa.length); i++) {
    const row = aoa[i] || [];
    if (row.some((c) => toStr(c).toLowerCase() === 'week') &&
        row.some((c) => toStr(c).toLowerCase().includes('name'))) {
      hIdx = i; break;
    }
  }
  if (hIdx < 0) return [];
  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  const col = (s: string) => headers.indexOf(s.toLowerCase());

  const out: MgmtRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;
    const nameIdx = col('associate name') >= 0 ? col('associate name') : col('name');
    const name = toStr(row[nameIdx]);
    if (!name) continue;
    out.push({
      rowNum: i + 1,
      week: toNum(row[col('week')]),
      name,
      associateId: toStr(row[col('associate id')]),
      title: toStr(row[col('title')]),
      hours: toNum(row[col('hours')]),
      hourlyRate: toNum(row[col('hourly rate')]),
      total: toNum(row[col('total')]),
      allocation: toPct(row[col('% allocation')]),
      totalBill: toNum(row[col('total bill')]),
    });
  }
  return out;
}

// ── cloud services ────────────────────────────────────────────────────────────

function parseCloudSheet(ws: XLSX.WorkSheet): CloudRow[] {
  const aoa = readAoA(ws);
  let hIdx = -1;
  for (let i = 0; i < Math.min(6, aoa.length); i++) {
    const row = aoa[i] || [];
    if (row.some((c) => toStr(c).toLowerCase().includes('associate name'))) {
      hIdx = i; break;
    }
  }
  if (hIdx < 0) return [];
  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  const col = (a: string, b?: string) => {
    const i = headers.indexOf(a.toLowerCase());
    if (i >= 0) return i;
    return b ? headers.indexOf(b.toLowerCase()) : -1;
  };

  const cLicenseType = col('type of license');
  // "Quantity" (FSM) vs "Qty" / "# Licenses" / "License Count" (SES and other formats)
  const cQty = (() => {
    const exact = col('quantity', 'qty');
    if (exact >= 0) return exact;
    return headers.findIndex((h) => h.includes('qty') || h.includes('# license') || h.includes('license count'));
  })();

  const out: CloudRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;
    const name = toStr(row[col('associate name')]);
    if (!name) continue;
    const qtyRaw = cQty >= 0 ? row[cQty] : null;
    out.push({
      rowNum: i + 1,
      associateName: name,
      associateId: toStr(row[col('associate id')]),
      licenseType: cLicenseType >= 0 ? toStr(row[cLicenseType]) : '',
      quantity: qtyRaw == null || qtyRaw === '' ? null : toNum(qtyRaw),
      rate: toNum(row[col('rate')]),
      // Allocation is a percentage cell — Excel already stores it as a decimal (0.37 = 37%).
      // Use toNum (not toPct) so values > 1 (e.g. 137% stored as 1.37) are preserved as-is.
      allocation: toNum(row[col('allocation')]),
      amount: toNum(row[col('sum of amount', 'amount')]),
    });
  }
  return out;
}

// ── roster sheets ─────────────────────────────────────────────────────────────

function parseRosterSheet(ws: XLSX.WorkSheet): RosterEntry[] {
  const aoa = readAoA(ws);
  if (aoa.length < 2) return [];
  const headers = (aoa[0] as unknown[]).map((c) => toStr(c).toLowerCase());
  const cName = headers.findIndex((h) => h.includes('employee') && h.includes('name'));
  const cId   = headers.indexOf('associate id');
  if (cName < 0 || cId < 0) return [];
  // Col D "Type" = employment type (FT/PT). "type" matches the D header before "type 3".
  const cTypeIdx = headers.findIndex((h) => h.includes('type'));
  const cType = cTypeIdx >= 0 ? cTypeIdx : 3;
  // Col E "Type 3" = program/tab assignment (FSM I / FSM I-Merit / FSM II / FSM II-Merit).
  const cProgIdx = headers.findIndex((h) => h.replace(/\s+/g, '') === 'type3' || h.includes('type 3'));
  const cProgram = cProgIdx >= 0 ? cProgIdx : 4;
  const out: RosterEntry[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const name = toStr(row[cName]);
    const id   = toStr(row[cId]);
    if (!name && !id) continue;
    out.push({ name, associateId: id, type: toStr(row[cType]), program: toStr(row[cProgram]) });
  }
  return out;
}

// ── OT approval ───────────────────────────────────────────────────────────────
// Standardized OT Approval tab column layout (confirmed 2026-06-23):
//   A: Form name  B: Associate  C: Status  D: Comments  E: Start Date/Time
//   F: End Date/Time  G: Samsung Leadership Name  H: Samsung Leadership Email
//   I: Samsung Leadership Comment  J: Approval Type
// Columns are detected by header name first (case-insensitive, trimmed),
// then fall back to fixed indices B=1, C=2, J=9 if headers are absent or differ.

function parseOtApprovalSheet(ws: XLSX.WorkSheet): OtApprovalRow[] {
  const aoa = readAoA(ws);
  if (aoa.length < 2) return [];

  // Row 0 is the header row.
  const rawHeaders = (aoa[0] as unknown[]).map((c) => toStr(c).trim().toLowerCase());

  // Column B — "Associate": exact match first, then any header containing "associate" (not "id")
  let cName = rawHeaders.findIndex((h) => h === 'associate');
  if (cName < 0) cName = rawHeaders.findIndex((h) => h.includes('associate') && !h.includes('id'));
  // Legacy fallback: "employee name" / "associate name"
  if (cName < 0) cName = rawHeaders.findIndex((h) => h.includes('employee name') || h.includes('associate name'));
  // Hard fallback to column index 1 (B)
  if (cName < 0) cName = 1;

  // Column C — "Status"
  let cStatus = rawHeaders.findIndex((h) => h === 'status');
  if (cStatus < 0) cStatus = 2;

  // Column J — "Approval Type"
  let cApprovalType = rawHeaders.findIndex((h) => h === 'approval type' || h.includes('approval type'));
  if (cApprovalType < 0) cApprovalType = 9;

  // Legacy SEA DL column — kept for backward compat; no longer primary approval logic
  const cSea = rawHeaders.findIndex((h) => h.includes('sea dl'));

  const out: OtApprovalRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const name = toStr(row[cName]).trim();
    if (!name) continue;
    out.push({
      rowNum: i + 1,
      associateName: name,
      status: toStr(row[cStatus]).trim(),
      approvalType: toStr(row[cApprovalType]).trim(),
      seaDlStatus: cSea >= 0 ? toStr(row[cSea]).trim() : '',
    });
  }
  return out;
}

// ── first-tab metadata (E13 = invoice number, E14 = period range, E17 = PO#, E21 = invoice total) ──

function readFirstTabMeta(wb: XLSX.WorkBook): {
  invoiceNumber: string | null;
  periodRange: string | null;
  e17Value: string | null;
  invoiceTotalRaw: number | null;
} {
  const firstName = wb.SheetNames[0];
  if (!firstName) return { invoiceNumber: null, periodRange: null, e17Value: null, invoiceTotalRaw: null };
  const ws = wb.Sheets[firstName];
  if (!ws) return { invoiceNumber: null, periodRange: null, e17Value: null, invoiceTotalRaw: null };
  const e13 = ws['E13'] as XLSX.CellObject | undefined;
  const e14 = ws['E14'] as XLSX.CellObject | undefined;
  const e17 = ws['E17'] as XLSX.CellObject | undefined;
  const e21 = ws['E21'] as XLSX.CellObject | undefined;
  const invoiceNumber   = e13?.v != null ? String(e13.v).trim() : null;
  const periodRange     = e14?.v != null ? String(e14.v).trim() : null;
  const e17Value        = e17?.v != null ? String(e17.v).trim() : null;
  const invoiceTotalRaw = (e21?.t === 'n' && e21?.v != null) ? Number(e21.v) : null;
  return { invoiceNumber, periodRange, e17Value, invoiceTotalRaw };
}

// ── Invoice Summary / Tie-Out ─────────────────────────────────────────────────

function parseInvoiceSummary(
  ws: XLSX.WorkSheet,
  fsmITotal: number, fsmIITotal: number,
  fsmIMeritTotal: number, fsmIIMeritTotal: number,
  mgmtTotal: number, cloudTotal: number,
): TieOutData {
  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1, raw: true, defval: null, blankrows: false,
  }) as unknown[][];
  const extras: { label: string; amount: number }[] = [];
  let invoiceTotal: number | null = null;

  for (const rawRow of aoa) {
    if (!rawRow || rawRow.length < 2) continue;
    let label = '';
    let amount: number | null = null;
    for (let j = 0; j < rawRow.length; j++) {
      const v = rawRow[j];
      if (label === '' && typeof v === 'string' && v.trim() &&
          isNaN(parseFloat(String(v).replace(/[$,\s]/g, '')))) {
        label = v.trim();
      } else if (label && amount === null) {
        const n = toNum(v);
        if (n !== 0 || (typeof v === 'string' && String(v).includes('$'))) amount = n;
      }
    }
    if (!label) continue;
    const lower = label.toLowerCase();
    if (lower.includes('total') || lower.includes('invoice') || lower.includes('amount due')) {
      if (amount != null && Math.abs(amount) > 100) invoiceTotal = amount;
      continue;
    }
    const skip = ['fsm i', 'fsm ii', 'mgt', 'mgmt', 'system', 'cloud', 'remote management'];
    if (skip.some((k) => lower.includes(k))) continue;
    if (amount != null && amount !== 0) extras.push({ label, amount });
  }

  return {
    fsmITotal, fsmIITotal, fsmIMeritTotal, fsmIIMeritTotal,
    mgmtTotal, cloudTotal,
    invoiceTotal,
    extraLineItems: extras,
  };
}

// ── declared period ───────────────────────────────────────────────────────────

function parseDeclaredPeriod(wb: XLSX.WorkBook): { start: Date; end: Date } | null {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const aoa = readAoA(ws);
    for (const row of aoa) {
      if (!row) continue;
      for (const cell of row) {
        const s = toStr(cell);
        const m = s.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if (m) {
          const start = new Date(m[1]);
          const end   = new Date(m[2]);
          if (!isNaN(start.getTime()) && !isNaN(end.getTime())) return { start, end };
        }
      }
    }
  }
  return null;
}

// ── punch CSV via PapaParse ───────────────────────────────────────────────────

async function parsePunchCSV(file: File): Promise<PunchRow[]> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows: PunchRow[] = [];
        for (let i = 0; i < results.data.length; i++) {
          const r = results.data[i] as Record<string, string>;
          // Column names referenced by name, never by position.
          // FSM punch exports use the column header "Associate" (not "Associate Name").
          const name = toStr(
            r['Associate Name'] ?? r['Employee Name'] ??
            r['associate name'] ?? r['employee name'] ??
            r['Associate'] ?? r['associate'] ?? ''
          );
          if (!name) continue;

          // Time in/out may be decimal fraction of day (Excel) or HH:MM string
          const timeInRaw  = r['Time In']  ?? r['time in']  ?? '';
          const timeOutRaw = r['Time Out'] ?? r['time out'] ?? '';
          const timeIn  = parseTimeValue(timeInRaw);
          const timeOut = parseTimeValue(timeOutRaw);

          const visitDateRaw = r['Visit Date'] ?? r['visit date'] ?? r['Date'] ?? r['Date In'] ?? r['date in'] ?? '';

          rows.push({
            rowNum: i + 2, // 1-indexed, accounting for header
            employeeName: name,
            associateId: toStr(r['Associate ID'] ?? r['associate id'] ?? ''),
            timeIn,
            timeOut,
            timeHours: toNum(r['Time Hours'] ?? r['time hours'] ?? '0'),
            comments: toStr(r['Comments'] ?? r['comments'] ?? r['Time Type'] ?? r['time type'] ?? ''),
            visitDate: visitDateRaw ? parseDate(visitDateRaw) : null,
            week: (() => {
              const w = r['Week'] ?? r['week'] ?? r['Invoice Week #'] ?? r['invoice week #'] ?? '';
              return w ? (toNum(w) || null) : null;
            })(),
          });
        }
        resolve(rows);
      },
      error: () => resolve([]),
    });
  });
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const n = Number(s);
  if (!isNaN(n) && n > 40000) {
    // Excel serial
    const d = XlsxSSF.parse_date_code(n);
    if (d) return new Date(d.y, d.m - 1, d.d);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseTimeValue(v: string): number {
  if (!v || v.trim() === '') return 0;
  const n = parseFloat(v);
  if (!isNaN(n)) {
    // Excel fractional day (e.g. 0.375 = 9:00 AM)
    if (n > 0 && n < 1) return n * 24;
    // Already in hours
    if (n >= 1 && n < 24) return n;
    // Might be an Excel datetime serial — extract time portion
    return (n - Math.floor(n)) * 24;
  }
  // Try HH:MM or HH:MM:SS
  const m = v.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10) / 60;
    const ampm = (m[4] || '').toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h + min;
  }
  return 0;
}

// ── reference CSV (management control table override) ────────────────────────

export async function parseReferenceCSV(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data as Record<string, string>[]),
      error: () => resolve([]),
    });
  });
}

// ── Termed PTO XLSX parser ────────────────────────────────────────────────────
// Columns: Employee ID (A), Worker (B), Term Date (C), Program (D), Name (E), Hours (F)

export async function parseTermedPtoFile(file: File): Promise<TermedPtoRow[]> {
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false });
  } catch {
    return [];
  }

  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1, raw: true, defval: null, blankrows: false,
  }) as unknown[][];

  if (aoa.length < 2) return [];

  // Find header row
  let hIdx = -1;
  for (let i = 0; i < Math.min(5, aoa.length); i++) {
    const row = aoa[i] || [];
    if (row.some((c) => toStr(c).toLowerCase() === 'employee id') ||
        row.some((c) => toStr(c).toLowerCase() === 'program')) {
      hIdx = i; break;
    }
  }
  if (hIdx < 0) return [];

  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  const col = (name: string) => headers.indexOf(name.toLowerCase());

  const cId      = col('employee id');
  const cWorker  = col('worker');
  const cDate    = col('term date');
  const cProgram = col('program');
  const cName    = col('name');
  const cHours   = col('hours');

  const out: TermedPtoRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;

    const id = toStr(row[cId]);
    if (!id) continue;

    const rawDate = cDate >= 0 ? row[cDate] : null;
    let termDate: Date | null = null;
    if (typeof rawDate === 'number' && rawDate > 0) {
      const d = XlsxSSF.parse_date_code(rawDate);
      if (d) termDate = new Date(d.y, d.m - 1, d.d);
    } else if (rawDate instanceof Date) {
      termDate = isNaN(rawDate.getTime()) ? null : rawDate;
    } else if (rawDate) {
      const d = new Date(toStr(rawDate));
      termDate = isNaN(d.getTime()) ? null : d;
    }

    out.push({
      rowNum: i + 1,
      employeeId: id,
      worker: toStr(row[cWorker]),
      termDate,
      program: cProgram >= 0 ? toStr(row[cProgram]) : '',
      name: cName >= 0 ? toStr(row[cName]) : '',
      hours: cHours >= 0 ? toNum(row[cHours]) : 0,
    });
  }
  return out;
}

// ── main export ───────────────────────────────────────────────────────────────

async function readBuf(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

// ── time off XLSX parser ──────────────────────────────────────────────────────

export async function parseTimeOffFile(file: File): Promise<TimeOffRow[]> {
  const buf = await readBuf(file);
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false });
  } catch {
    return [];
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1, raw: true, defval: null, blankrows: false,
  }) as unknown[][];

  if (aoa.length < 2) return [];

  // Find header row — look for "Associate ID"
  let hIdx = -1;
  for (let i = 0; i < Math.min(5, aoa.length); i++) {
    if ((aoa[i] || []).some((c) => toStr(c).toLowerCase() === 'associate id')) {
      hIdx = i; break;
    }
  }
  if (hIdx < 0) return [];

  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  const col = (name: string) => headers.indexOf(name.toLowerCase());

  const cId      = col('associate id');
  const cWorker  = col('worker');
  const cDate    = col('time off date');
  const cHours   = col('total hours (after adjustment)');
  const cType    = col('time off type');
  const cStatus  = col('status');

  const out: TimeOffRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];

    // Column A (index 0) holds the program code ("FSM", "FSM II", "FSM II Street", etc.).
    // Rows for employees outside this program return #N/A from the lookup formula — skip them.
    if (!toStr(row[0]).toUpperCase().startsWith('FSM')) continue;

    const status = toStr(row[cStatus]);
    if (status.toLowerCase() !== 'approved') continue;

    const id = toStr(row[cId]);
    if (!id) continue;

    // Convert Excel serial date
    const rawDate = row[cDate];
    let timeOffDate: Date | null = null;
    if (typeof rawDate === 'number' && rawDate > 0) {
      const d = XlsxSSF.parse_date_code(rawDate);
      if (d) timeOffDate = new Date(d.y, d.m - 1, d.d);
    } else if (rawDate) {
      const d = new Date(toStr(rawDate));
      timeOffDate = isNaN(d.getTime()) ? null : d;
    }
    if (!timeOffDate) continue;

    out.push({
      rowNum: i + 1,
      associateId: id,
      workerName: toStr(row[cWorker]),
      timeOffDate,
      totalHours: toNum(row[cHours]),
      timeOffType: toStr(row[cType]),
      status,
    });
  }
  return out;
}

export async function parseInvoice(
  invoiceFile: File,
  punchFile: File | null,
): Promise<ParsedData> {
  const buf = await readBuf(invoiceFile);

  // Pass 1 (metadata): already done above — metaWb reads E13/E14

  // Pass 2 (data): full workbook parse — no sheets filter so all tabs (including
  // Tie-Out / Invoice Summary) are always available regardless of name variations.
  let wb: XLSX.WorkBook;
  let formulasParsed = true;
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: true,  cellDates: false });
  } catch {
    // XLSB files with unsupported array formula types (e.g. SerAr type 19)
    // crash SheetJS formula parsing — fall back without formula extraction.
    formulasParsed = false;
    try {
      wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false });
    } catch {
      // Last resort: read all sheets, no formula, no sheet filter.
      // This handles edge cases where the sheets filter itself triggers the crash.
      wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false });
    }
  }

  // Pass 1 — lightweight read of just the first 25 rows to get cover tab metadata (E13/E14/E17/E21).
  let invoiceNumber: string | null = null;
  let periodRange: string | null = null;
  let e17Value: string | null = null;
  let invoiceTotalRaw: number | null = null;
  try {
    const metaWb = XLSX.read(buf, {
      type: 'array',
      cellFormula: false,
      cellDates: false,
      sheetRows: 25,   // only parse first 25 rows — fast
    });
    const meta = readFirstTabMeta(metaWb);
    invoiceNumber   = meta.invoiceNumber;
    periodRange     = meta.periodRange;
    e17Value        = meta.e17Value;
    invoiceTotalRaw = meta.invoiceTotalRaw;
  } catch {
    // Non-fatal — checks 10/11/13 will report missing data
  }

  const fsmI       = findSheet(wb, ['FSM I']);
  const fsmII      = findSheet(wb, ['FSM II']);
  const fsmIMerit  = findSheet(wb, ['FSM I Merit']);
  const fsmIIMerit = findSheet(wb, ['FSM II Merit']);
  const mgmt   = findSheet(wb, ['Management Detail Hours', 'Management']);
  const cloud  = findSheet(wb, ['Cloud Services', 'Cloud']);
  const roster1 = findSheet(wb, ['FSM Roster', 'Roster']);
  const ot     = findSheet(wb, ['OT Approval']);
  const invSum = findSheet(wb, ['Invoice Summary', 'Tie-Out', 'Invoice Schedule']);

  const fsmIRows       = fsmI       ? parseLaborSheet('FSM I',        fsmI.ws)       : [];
  const fsmIIRows      = fsmII      ? parseLaborSheet('FSM II',       fsmII.ws)      : [];
  const fsmIMeritRows  = fsmIMerit  ? parseLaborSheet('FSM I Merit',  fsmIMerit.ws)  : [];
  const fsmIIMeritRows = fsmIIMerit ? parseLaborSheet('FSM II Merit', fsmIIMerit.ws) : [];
  const mgmtRows   = mgmt   ? parseMgmtSheet(mgmt.ws)   : [];
  const cloudRows  = cloud  ? parseCloudSheet(cloud.ws) : [];

  const rosterEntries: RosterEntry[] = roster1 ? parseRosterSheet(roster1.ws) : [];
  const otApprovalRows = ot ? parseOtApprovalSheet(ot.ws) : [];

  // Punch Detail — ALWAYS from standalone CSV, never from invoice tabs.
  let punchRows: PunchRow[] = [];
  let punchFileName: string | null = null;
  if (punchFile) {
    punchRows = await parsePunchCSV(punchFile);
    punchFileName = punchFile.name;
  }

  const fsmITotal       = Math.round(fsmIRows.reduce((s, r)       => s + r.billValue, 0) * 100) / 100;
  const fsmIITotal      = Math.round(fsmIIRows.reduce((s, r)      => s + r.billValue, 0) * 100) / 100;
  const fsmIMeritTotal  = Math.round(fsmIMeritRows.reduce((s, r)  => s + r.billValue, 0) * 100) / 100;
  const fsmIIMeritTotal = Math.round(fsmIIMeritRows.reduce((s, r) => s + r.billValue, 0) * 100) / 100;
  const mgmtTotal       = Math.round(mgmtRows.reduce((s, r)       => s + r.totalBill, 0) * 100) / 100;
  const cloudTotal      = Math.round(cloudRows.reduce((s, r)       => s + r.amount,   0) * 100) / 100;

  const tieOutData = invSum
    ? parseInvoiceSummary(invSum.ws, fsmITotal, fsmIITotal, fsmIMeritTotal, fsmIIMeritTotal, mgmtTotal, cloudTotal)
    : { fsmITotal, fsmIITotal, fsmIMeritTotal, fsmIIMeritTotal, mgmtTotal, cloudTotal, invoiceTotal: null, extraLineItems: [] };

  // E21 is more authoritative than Tie-Out tab parsing — override if present
  if (invoiceTotalRaw !== null) {
    tieOutData.invoiceTotal = Math.round(invoiceTotalRaw * 100) / 100;
  }

  // E14 of cover tab is authoritative — try it first
  let declaredPeriod: { start: Date; end: Date } | null = null;
  if (periodRange) {
    const m = periodRange.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (m) {
      const s = new Date(m[1]);
      const e = new Date(m[2]);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) declaredPeriod = { start: s, end: e };
    }
  }
  // Fall back to scanning sheet content if E14 not found
  if (!declaredPeriod) declaredPeriod = parseDeclaredPeriod(wb);

  const weekSet = new Set<number>();
  for (const r of [...fsmIRows, ...fsmIIRows, ...fsmIMeritRows, ...fsmIIMeritRows]) {
    if (r.week != null && r.week > 0) weekSet.add(r.week);
  }
  const weeksCovered = Array.from(weekSet).sort((a, b) => a - b);

  const crossTabNotes: string[] = [];
  if (!formulasParsed) crossTabNotes.push('Formula extraction skipped (workbook contains unsupported array formula types) — Check 2 MU/Bill formula verification will use values only.');
  if (!fsmI) crossTabNotes.push('FSM I tab not found in workbook.');
  if (!fsmII) crossTabNotes.push('FSM II tab not found in workbook.');
  if (!fsmIMerit) crossTabNotes.push('FSM I Merit tab not found — Merit rows will not be audited (optional tab).');
  if (!fsmIIMerit) crossTabNotes.push('FSM II Merit tab not found — Merit rows will not be audited (optional tab).');
  if (!invSum) crossTabNotes.push('Invoice Summary tab not found — tie-out check will use reconstructed totals only.');
  if (!otApprovalRows.length) crossTabNotes.push('OT Approval tab is empty or not found.');
  if (!punchFileName) crossTabNotes.push('No punch CSV uploaded — punch checks will be skipped.');
  const totalLaborRows = fsmIRows.length + fsmIIRows.length + fsmIMeritRows.length + fsmIIMeritRows.length;
  crossTabNotes.push(
    `Roster entries: ${rosterEntries.length}. Labor rows: ${totalLaborRows} (FSM I: ${fsmIRows.length}, FSM II: ${fsmIIRows.length}, FSM I Merit: ${fsmIMeritRows.length}, FSM II Merit: ${fsmIIMeritRows.length}). Punch rows: ${punchRows.length}.`,
  );

  return {
    fileName: invoiceFile.name,
    invoiceNumber,
    e17Value,
    punchFileName,
    fsmIRows,
    fsmIIRows,
    fsmIMeritRows,
    fsmIIMeritRows,
    punchRows,
    mgmtRows,
    cloudRows,
    rosterEntries,
    otApprovalRows,
    tieOutData,
    declaredPeriod,
    weeksCovered,
    crossTabNotes,
    tabNames: wb.SheetNames,
    timeOffRows: [],
    timeOffFileNames: [],
    termedPtoRows: [],
    shiftRows: [],
    sesPunchRows: [],
  };
}

// ── SES punch XLSX parser ─────────────────────────────────────────────────────

export async function parseSesPunchXlsx(file: File): Promise<SesPunchRow[]> {
  const buf = await readBuf(file);
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false });
  } catch {
    return [];
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const aoa = readAoA(ws);
  if (aoa.length < 2) return [];

  // Find header row — search first 10 rows, any row with a name/id/hours/tag header word
  let hIdx = 0; // fall back to row 0 if nothing better found
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    const row = aoa[i] || [];
    const vals = row.map((c) => toStr(c).toLowerCase());
    if (vals.some((v) => v.includes('name') || v.includes('associate') || v.includes('employee') || v.includes('hours') || v.includes('payroll'))) {
      hIdx = i; break;
    }
  }

  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  // Flexible column finder — first exact then partial match against a list of aliases
  function findCol(...aliases: string[]): number {
    for (const a of aliases) {
      const exact = headers.indexOf(a);
      if (exact >= 0) return exact;
    }
    for (const a of aliases) {
      const partial = headers.findIndex((h) => h.includes(a));
      if (partial >= 0) return partial;
    }
    return -1;
  }

  const cName = findCol('employee name', 'associate name', 'worker name', 'associate', 'name');
  const cId   = findCol('associate id', 'employee id', 'worker id', 'id');
  const cHrs  = findCol('time hours', 'total hours', 'hours', 'duration');
  const cTag  = findCol('payroll tag', 'tag');
  const cType = findCol('time type', 'type');

  const out: SesPunchRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;
    const name = cName >= 0 ? toStr(row[cName]) : '';
    const id   = cId   >= 0 ? toStr(row[cId])   : '';
    if (!name && !id) continue;
    const rawTimeType = cType >= 0 ? toStr(row[cType]) : '';
    // Normalize legacy two-word "Over Time" → "Overtime" at parse time.
    const normalizedTimeType = rawTimeType && /^over\s+time$/i.test(rawTimeType.trim())
      ? 'Overtime'
      : rawTimeType || undefined;

    out.push({
      rowNum: i + 1,
      employeeName: name,
      associateId: id,
      timeHours: cHrs >= 0 ? toNum(row[cHrs]) : 0,
      payrollTag: cTag >= 0 ? toStr(row[cTag]) || undefined : undefined,
      timeType:   normalizedTimeType,
    });
  }
  return out;
}

// ── Shift report XLSX parser ──────────────────────────────────────────────────
// Reads the "Actual" tab. Known headers include:
//   Vendor EMP ID | SEC Full Name | Actual Time Entered In Call Report
// "Actual Time Entered In Call Report" is stored as an Excel time fraction
// (fraction of 24h, e.g. 0.3333 = 8 hours). Values > 1 are treated as hours.

export async function parseShiftReport(file: File): Promise<ShiftRow[]> {
  const buf = await readBuf(file);
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false });
  } catch {
    return [];
  }

  // Prefer the "Actual" tab; fall back to first sheet
  const sheetName =
    wb.SheetNames.find((n) => n.trim().toLowerCase() === 'actual') ??
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];

  const aoa = readAoA(ws);
  if (aoa.length < 2) return [];

  // Find header row — search first 10 rows for any row with identifier keywords
  let hIdx = 0;
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    const row = aoa[i] || [];
    const vals = row.map((c) => toStr(c).toLowerCase());
    if (vals.some((v) =>
      v.includes('emp id') || v.includes('associate') || v.includes('employee') ||
      v.includes('vendor') || v.includes('actual') || v.includes('name')
    )) {
      hIdx = i; break;
    }
  }

  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase().trim());

  function findCol(...aliases: string[]): number {
    for (const a of aliases) {
      const exact = headers.indexOf(a.toLowerCase());
      if (exact >= 0) return exact;
    }
    for (const a of aliases) {
      const partial = headers.findIndex((h) => h.includes(a.toLowerCase()));
      if (partial >= 0) return partial;
    }
    return -1;
  }

  // Known column names from SES shift report
  const cId     = findCol('vendor emp id', 'associate id', 'employee id', 'emp id', 'vendor id', 'id');
  const cName   = findCol('sec full name', 'employee name', 'associate name', 'worker name', 'full name', 'name');
  // "Actual Time Entered In Call Report" — Excel time fraction (0–1 = fraction of 24h)
  const cActual = findCol(
    'actual time entered in call report',
    'actual time entered',
    'actual time',
    'actual minutes',
    'actual',
  );

  const out: ShiftRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;
    const id   = cId   >= 0 ? toStr(row[cId]).trim()   : '';
    const name = cName >= 0 ? toStr(row[cName]).trim()  : '';
    if (!id && !name) continue;

    let actualMinutes = 0;
    if (cActual >= 0 && row[cActual] != null) {
      const raw = row[cActual];
      if (typeof raw === 'number') {
        // Column is always in minutes — use value directly
        actualMinutes = raw > 0 ? raw : 0;
      } else {
        const s = toStr(raw).trim();
        const hmMatch = s.match(/^(\d+):(\d{2})(?::\d{2})?$/);
        if (hmMatch) {
          actualMinutes = parseInt(hmMatch[1], 10) * 60 + parseInt(hmMatch[2], 10);
        } else {
          const n = parseFloat(s);
          if (!isNaN(n) && n > 0) actualMinutes = n;
        }
      }
    }

    out.push({ rowNum: i + 1, associateId: id, employeeName: name, actualMinutes });
  }
  return out;
}

// ── SES invoice parser ────────────────────────────────────────────────────────

export async function parseSesInvoice(
  invoiceFile: File,
  punchFile: File | null,
  shiftFile1: File | null,
  shiftFile2: File | null,
): Promise<ParsedData> {
  const buf = await readBuf(invoiceFile);

  let wb: XLSX.WorkBook;
  let formulasParsed = true;
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: true, cellDates: false });
  } catch {
    formulasParsed = false;
    wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false });
  }

  // Cover tab metadata — SES PO# is in E19 (not E17)
  let invoiceNumber: string | null = null;
  let periodRange: string | null = null;
  let e17Value: string | null = null;
  let invoiceTotalRaw: number | null = null;
  try {
    const metaWb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false, sheetRows: 25 });
    const meta = readFirstTabMeta(metaWb);
    invoiceNumber   = meta.invoiceNumber;
    periodRange     = meta.periodRange;
    invoiceTotalRaw = meta.invoiceTotalRaw;
    // SES PO# lives in E19, not E17
    const firstName = metaWb.SheetNames[0];
    const firstWs = firstName ? metaWb.Sheets[firstName] : null;
    const e19 = firstWs?.['E19'] as XLSX.CellObject | undefined;
    e17Value = e19?.v != null ? String(e19.v).trim() : null;
  } catch {
    // non-fatal
  }

  // SES Detail tab is the labor data — try common name variants
  const detail  = findSheet(wb, ['Detail', 'SES Detail', 'FSM I', 'Labor Detail']);
  const mgmt    = findSheet(wb, ['Management Detail Hours', 'Management']);
  const cloud   = findSheet(wb, ['Cloud Services', 'Cloud']);
  const invSum  = findSheet(wb, ['Invoice Summary', 'Tie-Out', 'Invoice Schedule']);

  // Use the actual resolved tab name so Check 11 reports it correctly
  const detailLabel = detail?.name ?? 'Detail';
  const fsmIRows  = detail ? parseLaborSheet(detailLabel, detail.ws) : [];
  const fsmIIRows: LaborRow[] = [];
  const mgmtRows  = mgmt  ? parseMgmtSheet(mgmt.ws)   : [];
  const cloudRows = cloud ? parseCloudSheet(cloud.ws)  : [];

  // SES punch — XLSX file (not CSV)
  let sesPunchRows: SesPunchRow[] = [];
  let punchFileName: string | null = null;
  if (punchFile) {
    sesPunchRows = await parseSesPunchXlsx(punchFile);
    punchFileName = punchFile.name;
  }

  // Shift reports (up to 2 weeks)
  let shiftRows: ShiftRow[] = [];
  for (const f of [shiftFile1, shiftFile2].filter(Boolean) as File[]) {
    const rows = await parseShiftReport(f);
    shiftRows = [...shiftRows, ...rows];
  }

  const fsmITotal       = Math.round(fsmIRows.reduce((s, r) => s + r.billValue, 0) * 100) / 100;
  const fsmIITotal      = 0;
  const fsmIMeritTotal  = 0;
  const fsmIIMeritTotal = 0;
  const mgmtTotal       = Math.round(mgmtRows.reduce((s, r) => s + r.totalBill, 0) * 100) / 100;
  const cloudTotal      = Math.round(cloudRows.reduce((s, r) => s + r.amount,   0) * 100) / 100;

  const tieOutData = invSum
    ? parseInvoiceSummary(invSum.ws, fsmITotal, fsmIITotal, fsmIMeritTotal, fsmIIMeritTotal, mgmtTotal, cloudTotal)
    : { fsmITotal, fsmIITotal, fsmIMeritTotal, fsmIIMeritTotal, mgmtTotal, cloudTotal, invoiceTotal: null, extraLineItems: [] };

  if (invoiceTotalRaw !== null) {
    tieOutData.invoiceTotal = Math.round(invoiceTotalRaw * 100) / 100;
  }

  let declaredPeriod: { start: Date; end: Date } | null = null;
  if (periodRange) {
    const m = periodRange.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (m) {
      const s = new Date(m[1]);
      const e = new Date(m[2]);
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) declaredPeriod = { start: s, end: e };
    }
  }
  if (!declaredPeriod) declaredPeriod = parseDeclaredPeriod(wb);

  const weekSet = new Set<number>();
  for (const r of fsmIRows) {
    if (r.week != null && r.week > 0) weekSet.add(r.week);
  }
  const weeksCovered = Array.from(weekSet).sort((a, b) => a - b);

  const crossTabNotes: string[] = [];
  if (!formulasParsed) crossTabNotes.push('Formula extraction skipped — Check 2 MU/Bill formula verification will use values only.');
  if (!detail) crossTabNotes.push('Detail tab not found in workbook.');
  if (!invSum) crossTabNotes.push('Invoice Summary tab not found — tie-out check will use reconstructed totals only.');
  if (!punchFileName) crossTabNotes.push('No SES punch file uploaded — punch checks will be skipped.');
  if (!shiftFile1) crossTabNotes.push('No shift report uploaded — three-way recon will compare invoice vs punch only.');
  crossTabNotes.push(
    `Labor rows: ${fsmIRows.length}. Punch rows: ${sesPunchRows.length}. Shift rows: ${shiftRows.length}.`,
  );

  return {
    fileName: invoiceFile.name,
    invoiceNumber,
    e17Value,
    punchFileName,
    fsmIRows,
    fsmIIRows,
    fsmIMeritRows: [],
    fsmIIMeritRows: [],
    punchRows: [],
    mgmtRows,
    cloudRows,
    rosterEntries: [],
    otApprovalRows: [],
    tieOutData,
    declaredPeriod,
    weeksCovered,
    crossTabNotes,
    tabNames: wb.SheetNames,
    timeOffRows: [],
    timeOffFileNames: [],
    termedPtoRows: [],
    shiftRows,
    sesPunchRows,
  };
}

// ── CI (Cloud Identity) invoice parsers ───────────────────────────────────────

// Tab names to skip when probing for per-role detail tabs
// Tabs that must never be treated as billable Detail tabs during per-role probing.
// Matched exact OR prefix (see isCiExcludedTab). Back-office/reference tabs plus the
// known E-variant noise tabs (Log/PM List/Hours Detail/Invoice Detail/Sheet*).
const CI_EXCLUDE_TABS = [
  'cloud services', 'new hire fees', 'tie-out', 'invoice schedule',
  'sow', 'bqms po', 'log', 'invoice summary',
  'pm list', 'hours detail', 'invoice detail', 'sheet', 'expenses',
];

// Substring markers: a tab containing any of these is reference/YTD/log noise, never
// a billable per-role Detail tab. Catches "2026 Detail YTD", "2025 Detail YTD",
// "Log Summary", "Log Detail" (which end with, not start with, the marker).
const CI_EXCLUDE_TAB_SUBSTRINGS = ['ytd', 'log'];

// True if a tab name should be skipped by the per-role Detail probe.
function isCiExcludedTab(lower: string): boolean {
  if (CI_EXCLUDE_TABS.some((ex) => lower === ex || lower.startsWith(ex))) return true;
  if (CI_EXCLUDE_TAB_SUBSTRINGS.some((ex) => lower.includes(ex))) return true;
  return false;
}

/**
 * Label-anchored cover reader. Scans the first ~25 rows of the first tab,
 * looking for label strings and reading the value one cell to the right (or
 * one cell below if right is empty).
 */
export function parseCiCoverTab(wb: XLSX.WorkBook): CiCoverMeta {
  const coverName = wb.SheetNames[0];
  const result: CiCoverMeta = {
    invoiceNumber: null,
    tabName: coverName ?? null,
    activityDateStart: null,
    activityDateEnd: null,
    poNumber: null,
    invoiceDate: null,
    dueDate: null,
    totalDue: null,
    attn: null,
    billTo: null,
    remitTo: null,
  };
  if (!coverName) return result;

  const ws = wb.Sheets[coverName];
  if (!ws) return result;

  // Use blankrows: true so that the AoA row index matches the worksheet row index,
  // which is required for XLSX.utils.encode_cell to address the correct cells.
  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1, raw: true, defval: null, blankrows: true,
  }) as unknown[][];

  // Helper: read cell value right of (r,c), or below if right is empty.
  // Does NOT fall through to "below" if the below cell looks like another label
  // (a string ending in ":" is typically a field name, not a value).
  function readAdjacentValue(r: number, c: number): unknown {
    const right = XLSX.utils.encode_cell({ r, c: c + 1 });
    const rightCell = ws[right] as XLSX.CellObject | undefined;
    if (rightCell?.v != null && rightCell.v !== '') return rightCell.v;
    const below = XLSX.utils.encode_cell({ r: r + 1, c });
    const belowCell = ws[below] as XLSX.CellObject | undefined;
    if (belowCell?.v == null) return null;
    // Reject if the below cell is itself a label (string ending in ":")
    const belowStr = String(belowCell.v).trim();
    if (belowStr.endsWith(':') || /^[A-Za-z\s]+#?:/.test(belowStr)) return null;
    return belowCell.v;
  }

  const scanRows = Math.min(25, aoa.length);
  for (let rowIdx = 0; rowIdx < scanRows; rowIdx++) {
    const row = aoa[rowIdx] || [];
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cell = toStr(row[colIdx]).toLowerCase();
      if (!cell) continue;

      if (cell.startsWith('invoice #:') || cell === 'invoice #') {
        result.invoiceNumber = result.invoiceNumber ?? (toStr(readAdjacentValue(rowIdx, colIdx)) || null);
      } else if (cell.startsWith('activity dates:') || cell === 'activity dates') {
        const raw = toStr(readAdjacentValue(rowIdx, colIdx));
        const m = raw.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if (m) {
          const s = new Date(m[1]);
          const e = new Date(m[2]);
          if (!isNaN(s.getTime())) result.activityDateStart = s;
          if (!isNaN(e.getTime())) result.activityDateEnd = e;
        }
      } else if (cell.startsWith('po#:') || cell === 'po#') {
        result.poNumber = result.poNumber ?? (toStr(readAdjacentValue(rowIdx, colIdx)) || null);
      } else if (cell.startsWith('invoice date:') || cell === 'invoice date') {
        result.invoiceDate = result.invoiceDate ?? toDate(readAdjacentValue(rowIdx, colIdx));
      } else if (cell.startsWith('due date:') || cell === 'due date') {
        result.dueDate = result.dueDate ?? toDate(readAdjacentValue(rowIdx, colIdx));
      } else if (cell.startsWith('total due:') || cell === 'total due') {
        if (result.totalDue == null) {
          const n = toNum(readAdjacentValue(rowIdx, colIdx));
          result.totalDue = n !== 0 ? n : null;
        }
      } else if (cell.startsWith('attn:') || cell === 'attn') {
        result.attn = result.attn ?? (toStr(readAdjacentValue(rowIdx, colIdx)) || null);
      } else if (cell.startsWith('bill to:') || cell.startsWith('bill-to:') ||
                 cell === 'bill to' || cell === 'bill-to') {
        result.billTo = result.billTo ?? (toStr(readAdjacentValue(rowIdx, colIdx)) || null);
      } else if (cell.startsWith('remit to:') || cell.startsWith('remit-to:') ||
                 cell === 'remit to' || cell === 'remit-to') {
        result.remitTo = result.remitTo ?? (toStr(readAdjacentValue(rowIdx, colIdx)) || null);
      }
    }
  }
  return result;
}

/**
 * Detects Monthly or Hourly layout from a CI detail worksheet and returns
 * the parsed rows.
 */
export function parseCiDetailTab(ws: XLSX.WorkSheet, sheetName: string): CiDetailRow[] {
  const aoa = readAoA(ws);
  if (aoa.length < 2) return [];

  // Detect header row (first 6 rows)
  let hIdx = -1;
  let isMonthly = false;

  for (let i = 0; i < Math.min(6, aoa.length); i++) {
    const row = aoa[i] || [];
    const vals = row.map((c) => toStr(c).toLowerCase());
    const has = (s: string) => vals.some((v) => v.includes(s));

    const monthlySignal = has('hourly rate') && has('hours') && (has('pre mark up') || has('markup') || has('mu'));
    const hourlySignal  = has('base pay rate') && (has('time hours') || has('base total') || has('mark up'));

    if (monthlySignal || hourlySignal) {
      hIdx = i;
      isMonthly = monthlySignal && !hourlySignal;
      // If both match, prefer hourly (more specific signal)
      if (monthlySignal && hourlySignal) {
        isMonthly = has('salary total') && !has('base pay rate');
      }
      break;
    }
  }

  if (hIdx < 0) return [];

  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  const col = (...aliases: string[]) => {
    for (const a of aliases) {
      const idx = headers.indexOf(a.toLowerCase());
      if (idx >= 0) return idx;
    }
    for (const a of aliases) {
      const idx = headers.findIndex((h) => h.includes(a.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const cName   = col('employee name', 'associate name', 'name');
  const cId     = col('associate id', 'id');
  const cDate   = col('visit date', 'date in', 'date');
  const cWeek   = col('week');

  const out: CiDetailRow[] = [];

  if (isMonthly) {
    // Monthly layout
    const cBase     = col('hourly rate');
    const cHours    = col('hours', 'time hours');
    const cPreMu    = col('pre mark up total', 'pre mark up', 'pre markup total', 'pre markup');
    const cMu       = col('mu', 'markup', 'mark up');
    const cSalTotal = col('salary total', 'total');

    for (let i = hIdx + 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      if (row.every((v) => v == null || v === '')) continue;

      const name     = cName >= 0 ? toStr(row[cName]) : '';
      const id       = cId   >= 0 ? toStr(row[cId])   : '';
      const timeHrs  = cHours >= 0 ? toNum(row[cHours]) : 0;

      // Skip rows with no employee identity — they are subtotal/footer rows.
      if (!name && !id) continue;
      if (!name && !id && !timeHrs) continue;

      const muFormula   = cMu      >= 0 ? getCellFormula(ws, i, cMu)      : undefined;
      const billFormula = cSalTotal >= 0 ? getCellFormula(ws, i, cSalTotal) : undefined;
      const salTotal    = cSalTotal >= 0 ? toNum(row[cSalTotal]) : 0;

      out.push({
        sheet: sheetName,
        rowNum: i + 1,
        employeeName: name,
        associateId: id,
        visitDate:   cDate >= 0 ? toDate(row[cDate]) : null,
        week:        cWeek >= 0 && row[cWeek] != null ? (toNum(row[cWeek]) || null) : null,
        timeHours:   timeHrs,
        otHours:     0,
        basePayRate: cBase  >= 0 ? toNum(row[cBase])  : 0,
        preMarkUpTotal: cPreMu >= 0 ? toNum(row[cPreMu]) : 0,
        muValue:     cMu    >= 0 ? toNum(row[cMu])    : 0,
        muFormula,
        salaryTotal: salTotal,
        billValue:   salTotal,
        billFormula,
        layoutType:  'Monthly',
        comments:    '',
      });
    }
  } else {
    // Hourly layout
    const cBase      = col('base pay rate', 'base rate');
    const cTimeHrs   = col('time hours', 'hours');
    const cOtHrs     = col('overtime hours', 'ot hours');
    const cBaseTotal = col('base total');
    const cMarkUp    = col('mark up', 'markup');
    const cMuTotal   = col('mark up total', 'markup total');
    const cBill      = col('bill');

    for (let i = hIdx + 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      if (row.every((v) => v == null || v === '')) continue;

      const name    = cName    >= 0 ? toStr(row[cName]) : '';
      const id      = cId      >= 0 ? toStr(row[cId])   : '';
      const timeHrs = cTimeHrs >= 0 ? toNum(row[cTimeHrs]) : 0;

      // Skip rows with no employee identity — they are subtotal/footer rows.
      if (!name && !id) continue;
      if (!name && !id && !timeHrs) continue;

      const muFormula   = cMarkUp >= 0 ? getCellFormula(ws, i, cMarkUp)  : undefined;
      const billFormula = cBill   >= 0 ? getCellFormula(ws, i, cBill)    : undefined;

      out.push({
        sheet: sheetName,
        rowNum: i + 1,
        employeeName: name,
        associateId:  id,
        visitDate:    cDate >= 0 ? toDate(row[cDate]) : null,
        week:         cWeek >= 0 && row[cWeek] != null ? (toNum(row[cWeek]) || null) : null,
        timeHours:    timeHrs,
        otHours:      cOtHrs >= 0 ? toNum(row[cOtHrs]) : 0,
        basePayRate:  cBase  >= 0 ? toNum(row[cBase])  : 0,
        preMarkUpTotal: cBaseTotal >= 0 ? toNum(row[cBaseTotal]) : 0,
        muValue:      cMuTotal >= 0 ? toNum(row[cMuTotal]) : (cMarkUp >= 0 ? toNum(row[cMarkUp]) : 0),
        muFormula,
        salaryTotal:  0,
        billValue:    cBill >= 0 ? toNum(row[cBill]) : 0,
        billFormula,
        layoutType:   'Hourly',
        comments:     '',
      });
    }
  }

  return out;
}

/**
 * Parse a BUP Activity XLSX file into CiActivityRow[].
 */
export async function parseCiActivityFile(file: File): Promise<CiActivityRow[]> {
  const buf = await readBuf(file);
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false });
  } catch {
    return [];
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const aoa = readAoA(ws);
  if (aoa.length < 2) return [];

  // Find header row — look for "Associate" or "Associate ID"
  let hIdx = -1;
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    const row = aoa[i] || [];
    if (row.some((c) => {
      const s = toStr(c).toLowerCase();
      return s === 'associate' || s === 'associate id' || s.includes('associate id');
    })) {
      hIdx = i; break;
    }
  }
  if (hIdx < 0) return [];

  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  const col = (...aliases: string[]) => {
    for (const a of aliases) {
      const idx = headers.indexOf(a.toLowerCase());
      if (idx >= 0) return idx;
    }
    for (const a of aliases) {
      const idx = headers.findIndex((h) => h.includes(a.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const cTitle   = col('job title', 'title');
  const cId      = col('associate id', 'id');
  const cName    = col('associate', 'associate name', 'employee name', 'name');
  const cDateIn  = col('date in', 'visit date', 'date');
  const cTimeIn  = col('time in');
  const cTimeOut = col('time out');
  const cHours   = col('time hours', 'hours');

  const out: CiActivityRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;

    const name = cName >= 0 ? toStr(row[cName]) : '';
    const id   = cId   >= 0 ? toStr(row[cId])   : '';
    if (!name && !id) continue;

    out.push({
      rowNum: i + 1,
      employeeName: name,
      associateId:  id,
      jobTitle:     cTitle  >= 0 ? toStr(row[cTitle])  : '',
      visitDate:    cDateIn >= 0 ? toDate(row[cDateIn]) : null,
      timeIn:       cTimeIn  >= 0 ? toStr(row[cTimeIn])  : '',
      timeOut:      cTimeOut >= 0 ? toStr(row[cTimeOut]) : '',
      timeHours:    cHours  >= 0 ? toNum(row[cHours])  : 0,
      isOt:         false,
    });
  }
  return out;
}

/**
 * Parse the BUP Roster XLSX into CiRosterRow[].
 */
export async function parseCiRosterFile(file: File): Promise<CiRosterRow[]> {
  const buf = await readBuf(file);
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false });
  } catch {
    return [];
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const aoa = readAoA(ws);
  if (aoa.length < 2) return [];

  // Find header row by scanning first 10 rows for "Associate ID"
  let hIdx = -1;
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    const row = aoa[i] || [];
    if (row.some((c) => toStr(c).toLowerCase() === 'associate id')) {
      hIdx = i; break;
    }
  }
  if (hIdx < 0) return [];

  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  const col = (...aliases: string[]) => {
    for (const a of aliases) {
      const idx = headers.indexOf(a.toLowerCase());
      if (idx >= 0) return idx;
    }
    for (const a of aliases) {
      const idx = headers.findIndex((h) => h.includes(a.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  const cId      = col('associate id');
  const cName    = col('employee name', 'associate name', 'name');
  const cNotes   = col('notes');
  const cType    = col('type');
  const cMgr     = col('manager name', 'manager');
  const cState   = col('store state', 'state');
  const cRate    = col('hourly pay rate', 'pay rate', 'rate');
  const cStart   = col('start date');
  const cType3   = col('type 3');

  const out: CiRosterRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;

    const id   = cId   >= 0 ? toStr(row[cId])   : '';
    const name = cName >= 0 ? toStr(row[cName]) : '';
    if (!id && !name) continue;

    out.push({
      rowNum:       i + 1,
      associateId:  id,
      employeeName: name,
      notes:        cNotes >= 0 ? toStr(row[cNotes]) : '',
      type:         cType  >= 0 ? toStr(row[cType])  : '',
      managerName:  cMgr   >= 0 ? toStr(row[cMgr])   : '',
      storeState:   cState >= 0 ? toStr(row[cState])  : '',
      hourlyPayRate: cRate  >= 0 ? toNum(row[cRate])   : 0,
      startDate:    cStart >= 0 ? toDate(row[cStart])  : null,
      type3:        cType3 >= 0 ? toStr(row[cType3])   : '',
    });
  }
  return out;
}

/**
 * Main entry point for CI invoice parsing.
 */
export async function parseCiInvoice(
  invoiceFile: File,
  activityFiles: File[],
  rosterFile: File | null,
  timeOffFile: File | null,
): Promise<CiParsedData> {
  const buf = await readBuf(invoiceFile);

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: 'array', cellFormula: true, cellDates: false });
  } catch {
    wb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false });
  }

  // 1. Cover tab metadata
  const coverMeta = parseCiCoverTab(wb);

  // 2. Detail tabs — explicit "Detail" tab first, then per-role probing
  const detailRows: CiDetailRow[] = [];
  const crossTabNotes: string[] = [];

  const coverTabName = wb.SheetNames[0] ?? '';
  const explicitDetail = findSheet(wb, ['Detail', 'SES Detail', 'Labor Detail']);
  if (explicitDetail) {
    const rows = parseCiDetailTab(explicitDetail.ws, explicitDetail.name);
    detailRows.push(...rows);
  }

  // Per-role tab probing: try remaining non-excluded tabs
  for (const tabName of wb.SheetNames) {
    const lower = tabName.trim().toLowerCase();
    // Skip cover tab (index 0), explicit detail tab if already handled, and excluded tabs
    if (lower === coverTabName.trim().toLowerCase()) continue;
    if (explicitDetail && lower === explicitDetail.name.trim().toLowerCase()) continue;
    if (isCiExcludedTab(lower)) continue;

    const ws = wb.Sheets[tabName];
    if (!ws) continue;
    const rows = parseCiDetailTab(ws, tabName);
    if (rows.length > 0) {
      detailRows.push(...rows);
    }
  }

  // 3. Cloud Services tab — sum all amounts
  const cloudSheet = findSheet(wb, ['Cloud Services', 'Cloud']);
  const cloudRows = cloudSheet ? parseCloudSheet(cloudSheet.ws) : [];
  const cloudTotal = Math.round(cloudRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;

  // 4. New Hire Fees tab — sum all amounts
  const newHireSheet = findSheet(wb, ['New Hire Fees', 'New Hire Fee']);
  const newHireRows = newHireSheet ? parseCloudSheet(newHireSheet.ws) : [];
  const newHireFeeTotal = Math.round(newHireRows.reduce((s, r) => s + r.amount, 0) * 100) / 100;

  // 5. Tie-Out / Invoice Summary — find "Total Due" label
  let tieOutInvoiceTotal: number | null = null;
  const tieOutSheet = findSheet(wb, ['Tie-Out', 'Invoice Summary', 'Invoice Schedule']);
  if (tieOutSheet) {
    const aoa = readAoA(tieOutSheet.ws);
    for (const rawRow of aoa) {
      if (!rawRow) continue;
      for (let j = 0; j < rawRow.length; j++) {
        const cellStr = toStr(rawRow[j]).toLowerCase();
        if (cellStr.includes('total due') || cellStr.includes('amount due') ||
            (cellStr.includes('total') && cellStr.includes('invoice')) ||
            cellStr.trim() === 'invoice') {
          // Look for numeric value in remaining cells of this row
          for (let k = j + 1; k < rawRow.length; k++) {
            const n = toNum(rawRow[k]);
            if (n !== 0 && Math.abs(n) > 100) {
              tieOutInvoiceTotal = Math.round(n * 100) / 100;
              break;
            }
          }
          if (tieOutInvoiceTotal != null) break;
        }
      }
      if (tieOutInvoiceTotal != null) break;
    }
  }
  // Fall back to coverMeta.totalDue if Tie-Out tab not found / no match
  if (tieOutInvoiceTotal == null && coverMeta.totalDue != null) {
    tieOutInvoiceTotal = coverMeta.totalDue;
  }

  // 6. weeksCovered from detail rows
  const weekSet = new Set<number>();
  for (const r of detailRows) {
    if (r.week != null && r.week > 0) weekSet.add(r.week);
  }
  const weeksCovered = Array.from(weekSet).sort((a, b) => a - b);

  // 7. Activity files
  const activityRows: CiActivityRow[] = [];
  for (const f of activityFiles) {
    const rows = await parseCiActivityFile(f);
    activityRows.push(...rows);
  }

  // 8. Roster file
  const ciRosterRows: CiRosterRow[] = rosterFile
    ? await parseCiRosterFile(rosterFile)
    : [];

  // 9. Time off file
  const timeOffRows: TimeOffRow[] = timeOffFile
    ? await parseTimeOffFile(timeOffFile)
    : [];

  // Cross-tab notes
  if (detailRows.length === 0) crossTabNotes.push('No CI detail rows found in any tab.');
  if (!cloudSheet) crossTabNotes.push('Cloud Services tab not found — cloud total will be 0.');
  if (!newHireSheet) crossTabNotes.push('New Hire Fees tab not found — new hire fee total will be 0.');
  if (!tieOutSheet) crossTabNotes.push('Tie-Out / Invoice Summary tab not found — invoice total taken from cover tab.');
  if (activityFiles.length === 0) crossTabNotes.push('No BUP Activity files uploaded — activity checks will be skipped.');
  if (!rosterFile) crossTabNotes.push('No BUP Roster file uploaded — roster checks will be skipped.');
  crossTabNotes.push(
    `Detail rows: ${detailRows.length}. Activity rows: ${activityRows.length}. Roster rows: ${ciRosterRows.length}.`,
  );

  return {
    fileName: invoiceFile.name,
    coverMeta,
    detailRows,
    cloudTotal,
    newHireFeeTotal,
    tieOutInvoiceTotal,
    weeksCovered,
    tabNames: wb.SheetNames,
    crossTabNotes,
    activityRows,
    ciRosterRows,
    timeOffRows,
  };
}
