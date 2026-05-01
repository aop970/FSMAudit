// parseWorkbook.ts — SheetJS invoice parse + PapaParse punch CSV
// Tab selection is by NAME only, never by index, never hidden.
// Tabs to load and always-exclude lists come from stored audit rules.

import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type {
  CloudRow, LaborRow, MgmtRow, OtApprovalRow,
  ParsedData, PunchRow, RosterEntry, SesPunchRow, ShiftRow, TermedPtoRow, TieOutData, TimeOffRow,
} from './types';
import { toNum, toStr, toPct } from '../lib/num';

// ── helpers ───────────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
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
      comments:       toStr(row[cCmt]),
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

  const out: CloudRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;
    const name = toStr(row[col('associate name')]);
    if (!name) continue;
    const qtyRaw = row[col('quantity')];
    out.push({
      rowNum: i + 1,
      associateName: name,
      associateId: toStr(row[col('associate id')]),
      quantity: qtyRaw == null || qtyRaw === '' ? null : toNum(qtyRaw),
      rate: toNum(row[col('rate')]),
      allocation: toPct(row[col('allocation')]),
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
  const out: RosterEntry[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const name = toStr(row[cName]);
    const id   = toStr(row[cId]);
    if (!name && !id) continue;
    out.push({ name, associateId: id });
  }
  return out;
}

// ── OT approval ───────────────────────────────────────────────────────────────

function parseOtApprovalSheet(ws: XLSX.WorkSheet): OtApprovalRow[] {
  const aoa = readAoA(ws);
  if (aoa.length < 2) return [];
  const headers = (aoa[0] as unknown[]).map((c) => toStr(c).toLowerCase());
  const cName = headers.findIndex(
    (h) => h.includes('employee name') || h.includes('associate name'),
  );
  const cSea  = headers.findIndex((h) => h.includes('sea dl'));
  if (cName < 0) return [];
  const out: OtApprovalRow[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const name = toStr(row[cName]);
    if (!name) continue;
    out.push({ rowNum: i + 1, associateName: name, seaDlStatus: cSea >= 0 ? toStr(row[cSea]) : '' });
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
  fsmITotal: number, fsmIITotal: number, mgmtTotal: number, cloudTotal: number,
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
    fsmITotal, fsmIITotal, mgmtTotal, cloudTotal,
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
          // Column names referenced by name, never by position
          const name = toStr(r['Associate Name'] ?? r['Employee Name'] ?? r['associate name'] ?? r['employee name']);
          if (!name) continue;

          // Time in/out may be decimal fraction of day (Excel) or HH:MM string
          const timeInRaw  = r['Time In']  ?? r['time in']  ?? '';
          const timeOutRaw = r['Time Out'] ?? r['time out'] ?? '';
          const timeIn  = parseTimeValue(timeInRaw);
          const timeOut = parseTimeValue(timeOutRaw);

          const visitDateRaw = r['Visit Date'] ?? r['visit date'] ?? r['Date'] ?? '';

          rows.push({
            rowNum: i + 2, // 1-indexed, accounting for header
            employeeName: name,
            associateId: toStr(r['Associate ID'] ?? r['associate id'] ?? ''),
            timeIn,
            timeOut,
            timeHours: toNum(r['Time Hours'] ?? r['time hours'] ?? '0'),
            comments: toStr(r['Comments'] ?? r['comments'] ?? ''),
            visitDate: visitDateRaw ? parseDate(visitDateRaw) : null,
            week: (() => {
              const w = r['Week'] ?? r['week'] ?? '';
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
    const d = XLSX.SSF.parse_date_code(n);
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
      const d = XLSX.SSF.parse_date_code(rawDate);
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
    const status = toStr(row[cStatus]);
    if (status.toLowerCase() !== 'approved') continue;

    const id = toStr(row[cId]);
    if (!id) continue;

    // Convert Excel serial date
    const rawDate = row[cDate];
    let timeOffDate: Date | null = null;
    if (typeof rawDate === 'number' && rawDate > 0) {
      const d = XLSX.SSF.parse_date_code(rawDate);
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

  const fsmI   = findSheet(wb, ['FSM I']);
  const fsmII  = findSheet(wb, ['FSM II']);
  const mgmt   = findSheet(wb, ['Management Detail Hours', 'Management']);
  const cloud  = findSheet(wb, ['Cloud Services', 'Cloud']);
  const roster1 = findSheet(wb, ['FSM Roster', 'Roster']);
  const roster2 = findSheet(wb, ['FSM II Roster', 'Roster II']);
  const ot     = findSheet(wb, ['OT Approval']);
  const invSum = findSheet(wb, ['Invoice Summary', 'Tie-Out', 'Invoice Schedule']);

  const fsmIRows   = fsmI   ? parseLaborSheet('FSM I',  fsmI.ws)  : [];
  const fsmIIRows  = fsmII  ? parseLaborSheet('FSM II', fsmII.ws) : [];
  const mgmtRows   = mgmt   ? parseMgmtSheet(mgmt.ws)   : [];
  const cloudRows  = cloud  ? parseCloudSheet(cloud.ws) : [];

  const rosterEntries: RosterEntry[] = [
    ...(roster1 ? parseRosterSheet(roster1.ws) : []),
    ...(roster2 ? parseRosterSheet(roster2.ws) : []),
  ];
  const otApprovalRows = ot ? parseOtApprovalSheet(ot.ws) : [];

  // Punch Detail — ALWAYS from standalone CSV, never from invoice tabs.
  let punchRows: PunchRow[] = [];
  let punchFileName: string | null = null;
  if (punchFile) {
    punchRows = await parsePunchCSV(punchFile);
    punchFileName = punchFile.name;
  }

  const fsmITotal   = Math.round(fsmIRows.reduce((s, r)  => s + r.billValue,  0) * 100) / 100;
  const fsmIITotal  = Math.round(fsmIIRows.reduce((s, r) => s + r.billValue,  0) * 100) / 100;
  const mgmtTotal   = Math.round(mgmtRows.reduce((s, r)  => s + r.totalBill,  0) * 100) / 100;
  const cloudTotal  = Math.round(cloudRows.reduce((s, r)  => s + r.amount,    0) * 100) / 100;

  const tieOutData = invSum
    ? parseInvoiceSummary(invSum.ws, fsmITotal, fsmIITotal, mgmtTotal, cloudTotal)
    : { fsmITotal, fsmIITotal, mgmtTotal, cloudTotal, invoiceTotal: null, extraLineItems: [] };

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
  for (const r of [...fsmIRows, ...fsmIIRows]) {
    if (r.week != null && r.week > 0) weekSet.add(r.week);
  }
  const weeksCovered = Array.from(weekSet).sort((a, b) => a - b);

  const crossTabNotes: string[] = [];
  if (!formulasParsed) crossTabNotes.push('Formula extraction skipped (workbook contains unsupported array formula types) — Check 2 MU/Bill formula verification will use values only.');
  if (!fsmI) crossTabNotes.push('FSM I tab not found in workbook.');
  if (!fsmII) crossTabNotes.push('FSM II tab not found in workbook.');
  if (!invSum) crossTabNotes.push('Invoice Summary tab not found — tie-out check will use reconstructed totals only.');
  if (!otApprovalRows.length) crossTabNotes.push('OT Approval tab is empty or not found.');
  if (!punchFileName) crossTabNotes.push('No punch CSV uploaded — punch checks will be skipped.');
  crossTabNotes.push(
    `Roster entries: ${rosterEntries.length}. Labor rows: ${fsmIRows.length + fsmIIRows.length}. Punch rows: ${punchRows.length}.`,
  );

  return {
    fileName: invoiceFile.name,
    invoiceNumber,
    e17Value,
    punchFileName,
    fsmIRows,
    fsmIIRows,
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
// Columns: Employee Name, Associate ID, Time Hours, Payroll Tag

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

  // Find header row
  let hIdx = -1;
  for (let i = 0; i < Math.min(5, aoa.length); i++) {
    const row = aoa[i] || [];
    if (row.some((c) => toStr(c).toLowerCase().includes('employee name') || toStr(c).toLowerCase().includes('associate id'))) {
      hIdx = i; break;
    }
  }
  if (hIdx < 0) return [];

  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  const col = (name: string) => headers.indexOf(name.toLowerCase());

  const cName    = col('employee name') >= 0 ? col('employee name') : col('associate name');
  const cId      = col('associate id');
  const cHrs     = col('time hours');
  const cTag     = col('payroll tag');

  const out: SesPunchRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;
    const name = toStr(row[cName]);
    if (!name) continue;
    out.push({
      rowNum: i + 1,
      employeeName: name,
      associateId: cId >= 0 ? toStr(row[cId]) : '',
      timeHours: cHrs >= 0 ? toNum(row[cHrs]) : 0,
      payrollTag: cTag >= 0 ? toStr(row[cTag]) : undefined,
    });
  }
  return out;
}

// ── Shift report XLSX parser ──────────────────────────────────────────────────
// Columns: Associate ID, Employee Name, Actual Time (minutes or HH:MM)

export async function parseShiftReport(file: File): Promise<ShiftRow[]> {
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

  // Find header row
  let hIdx = -1;
  for (let i = 0; i < Math.min(5, aoa.length); i++) {
    const row = aoa[i] || [];
    if (row.some((c) => toStr(c).toLowerCase().includes('associate id') || toStr(c).toLowerCase().includes('actual'))) {
      hIdx = i; break;
    }
  }
  if (hIdx < 0) return [];

  const headers = (aoa[hIdx] as unknown[]).map((c) => toStr(c).toLowerCase());
  const col = (name: string) => headers.indexOf(name.toLowerCase());

  const cId      = col('associate id');
  const cName    = col('employee name') >= 0 ? col('employee name') : col('associate name');
  // "Actual Time" column — may be in minutes (numeric) or HH:MM string
  const cActual  = headers.findIndex((h) => h.includes('actual'));

  const out: ShiftRow[] = [];
  for (let i = hIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (row.every((v) => v == null || v === '')) continue;
    const id = cId >= 0 ? toStr(row[cId]) : '';
    if (!id) continue;

    let actualMinutes = 0;
    if (cActual >= 0 && row[cActual] != null) {
      const raw = row[cActual];
      if (typeof raw === 'number') {
        // If value looks like minutes (> 24) treat as minutes, else treat as hours * 60
        actualMinutes = raw > 24 ? raw : raw * 60;
      } else {
        const s = toStr(raw);
        // HH:MM format
        const m = s.match(/^(\d+):(\d{2})$/);
        if (m) {
          actualMinutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        } else {
          const n = parseFloat(s);
          if (!isNaN(n)) actualMinutes = n > 24 ? n : n * 60;
        }
      }
    }

    out.push({
      rowNum: i + 1,
      associateId: id,
      employeeName: cName >= 0 ? toStr(row[cName]) : '',
      actualMinutes,
    });
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

  // Cover tab metadata
  let invoiceNumber: string | null = null;
  let periodRange: string | null = null;
  let e17Value: string | null = null;
  let invoiceTotalRaw: number | null = null;
  try {
    const metaWb = XLSX.read(buf, { type: 'array', cellFormula: false, cellDates: false, sheetRows: 25 });
    const meta = readFirstTabMeta(metaWb);
    invoiceNumber   = meta.invoiceNumber;
    periodRange     = meta.periodRange;
    e17Value        = meta.e17Value;
    invoiceTotalRaw = meta.invoiceTotalRaw;
  } catch {
    // non-fatal
  }

  // SES Detail tab is the labor data — try common name variants
  const detail  = findSheet(wb, ['Detail', 'SES Detail', 'FSM I', 'Labor Detail']);
  const mgmt    = findSheet(wb, ['Management Detail Hours', 'Management']);
  const cloud   = findSheet(wb, ['Cloud Services', 'Cloud']);
  const invSum  = findSheet(wb, ['Invoice Summary', 'Tie-Out', 'Invoice Schedule']);

  // SES uses a single Detail sheet mapped as fsmIRows
  const fsmIRows  = detail ? parseLaborSheet('FSM I', detail.ws) : [];
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

  const fsmITotal   = Math.round(fsmIRows.reduce((s, r)  => s + r.billValue, 0) * 100) / 100;
  const fsmIITotal  = 0;
  const mgmtTotal   = Math.round(mgmtRows.reduce((s, r)  => s + r.totalBill, 0) * 100) / 100;
  const cloudTotal  = Math.round(cloudRows.reduce((s, r)  => s + r.amount,   0) * 100) / 100;

  const tieOutData = invSum
    ? parseInvoiceSummary(invSum.ws, fsmITotal, fsmIITotal, mgmtTotal, cloudTotal)
    : { fsmITotal, fsmIITotal, mgmtTotal, cloudTotal, invoiceTotal: null, extraLineItems: [] };

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
