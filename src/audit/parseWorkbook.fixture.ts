// parseWorkbook.fixture.ts — standalone Node.js fixture harness for T-672
// (date-level variance sourcing: punch "Date In" + shift "Visit Date" parsing)
// Run with: npx tsx src/audit/parseWorkbook.fixture.ts
//
// All fixtures are in-memory only — no real invoice files, no Neon writes.
// Exit code: 0 = all assertions passed; 1 = one or more assertions failed.
//
// PRIVACY: this file contains ONLY hand-authored synthetic data. Allan sent
// real production punch/shift files during this task (report1777339016625.csv,
// Day-SES-643-644_PunchDetail.csv, two "Weekly Shift Information 2020.xlsx"
// workbooks) for LIVE verification only — those files are gitignored (*.csv,
// *.xlsx) and are NEVER read by this committed fixture, never copied into
// it, and no row from them appears here. The shift workbooks specifically
// carry real PII (address, phone, email, birthday) per Allan's instruction
// (T-669 standing decision: this class of data is never persisted, which
// extends to the git repo). This fixture instead hand-authors the same
// COLUMN SHAPES (verified against the real files by inspection) with fake
// names/IDs, per the "hand-author synthetic rows in the real shape" guidance.
//
// Real-file findings this fixture pins:
//   - Punch "Date In" is a STRING in MM-DD-YYYY (e.g. "06-30-2026"), not an
//     Excel serial — confirmed against report1777339016625.csv and
//     Day-SES-643-644_PunchDetail.csv.
//   - Shift "Visit Date" IS a real Excel date (datetime), one row per
//     associate per visit date, zero blanks across 1,554 real rows.
//   - The real shift header for the hours column is truncated with a
//     trailing space: 'Actual Time Entered In Call ' (not "...Call Report")
//     — it only resolves via the partial-match fallback on 'actual time
//     entered', and the sheet also carries 'Actual Shift Start Time' /
//     'Actual Shift End Time' decoy columns a bare 'actual' alias would
//     wrongly grab if alias ordering ever changed.

// ── Browser API shims (Node has no FileReader) ──────────────────────────────
class NodeFileReader {
  result: ArrayBuffer | null = null;
  error: unknown = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsArrayBuffer(file: File) {
    file.arrayBuffer()
      .then((buf) => { this.result = buf; this.onload?.(); })
      .catch((err) => { this.error = err; this.onerror?.(); });
  }
}
(globalThis as unknown as Record<string, unknown>).FileReader = NodeFileReader;

import * as XLSX from 'xlsx';
import { parseSesPunchXlsx, parseShiftReport } from './parseWorkbook.js';

// ── Assertion plumbing ────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;

function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    passCount++;
    console.log(`  PASS  ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── Builders ─────────────────────────────────────────────────────────────────

function csvFile(rows: string[][], name = 'punch.csv'): File {
  const text = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  return new File([text], name, { type: 'text/csv' });
}

function xlsxFile(headers: string[], dataRows: unknown[][], sheetName: string, name = 'shift.xlsx'): File {
  const aoa = [headers, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ═══════════════════════════════════════════════════════════════════════════
// Punch "Date In" parsing (T-672)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nparseSesPunchXlsx — Date In parsing (T-672)');

// Real header vocabulary (report1777339016625.csv), synthetic values.
const PUNCH_HEADERS = [
  'Invoice Week #', 'Associate', 'Associate ID', 'Employee Type', 'Employee State',
  'Time Sheet: Time Sheet Name', 'Time Sheet: ID', 'Time Entry: Time Entry Name',
  'Payroll Tag', 'Time Entry: ID', 'Time Entry: Record Type', 'Store', 'Notes',
  'Time Type', 'Date In', 'Time In', 'Time Out', 'Time Hours',
];

async function run(): Promise<void> {
  const realShapePunch = csvFile([
    PUNCH_HEADERS,
    ['11', 'Test Associate', 'EE999001', 'FT', 'FL', 'TimeSheet.X', 'a0X', 'TimeEntry.X', '2020_PAYROLL_20260630', 'a0Y', 'SAMFSM', 'SAMFSM STORE', '', 'Work', '06-30-2026', '07:30', '08:51', '1.35'],
    ['11', 'Test Associate', 'EE999001', 'FT', 'FL', 'TimeSheet.X', 'a0X', 'TimeEntry.X', '2020_PAYROLL_20260701', 'a0Y', 'SAMFSM', 'SAMFSM STORE', '', 'Work', '07-01-2026', '09:00', '17:00', '8.00'],
  ]);

  const punchRows = await parseSesPunchXlsx(realShapePunch);
  assert('2 punch rows parsed', punchRows.length === 2, `got ${punchRows.length}`);
  assert(
    'Date In "06-30-2026" parses to 2026-06-30',
    punchRows[0]?.visitDate?.getFullYear() === 2026 && punchRows[0]?.visitDate?.getMonth() === 5 && punchRows[0]?.visitDate?.getDate() === 30,
    `got ${punchRows[0]?.visitDate?.toISOString()}`,
  );
  assert(
    'Date In "07-01-2026" parses to 2026-07-01',
    punchRows[1]?.visitDate?.getFullYear() === 2026 && punchRows[1]?.visitDate?.getMonth() === 6 && punchRows[1]?.visitDate?.getDate() === 1,
    `got ${punchRows[1]?.visitDate?.toISOString()}`,
  );
  assert('Time In captured (near-free capture alongside visitDate)', punchRows[0]?.timeIn === '07:30');
  assert('Time Out captured', punchRows[0]?.timeOut === '08:51');
  assert('Time Hours still parses correctly (unaffected by the date addition)', punchRows[0]?.timeHours === 1.35);

  // Older export shape — no "Date In" column at all. Must not crash, must
  // not guess: visitDate stays null for every row.
  const OLD_PUNCH_HEADERS = ['Associate', 'Associate ID', 'Time Type', 'Time Hours'];
  const olderPunch = csvFile([
    OLD_PUNCH_HEADERS,
    ['Legacy Associate', 'EE999002', 'Work', '4.00'],
  ]);
  const olderPunchRows = await parseSesPunchXlsx(olderPunch);
  assert('older punch export (no Date In column) still parses without crashing', olderPunchRows.length === 1);
  assert('visitDate is null when there is no date column — never guessed', olderPunchRows[0]?.visitDate === null);
  assert('timeHours still parses correctly on the dateless export', olderPunchRows[0]?.timeHours === 4.00);

  // Decoy trap: an "Approval Date" column present, positioned BEFORE "Date
  // In". Deliberately no bare 'date' alias in parseSesPunchXlsx, so this
  // must NOT be picked over the real "Date In" column.
  const DECOY_PUNCH_HEADERS = ['Associate', 'Associate ID', 'Approval Date', 'Time Type', 'Date In', 'Time Hours'];
  const decoyPunch = csvFile([
    DECOY_PUNCH_HEADERS,
    ['Decoy Associate', 'EE999003', '01-01-2020', 'Work', '06-30-2026', '5.00'],
  ]);
  const decoyPunchRows = await parseSesPunchXlsx(decoyPunch);
  assert(
    'a decoy "Approval Date" column is NOT picked over "Date In" (exact match wins, and no bare "date" alias exists to be fooled)',
    decoyPunchRows[0]?.visitDate?.getFullYear() === 2026 && decoyPunchRows[0]?.visitDate?.getMonth() === 5 && decoyPunchRows[0]?.visitDate?.getDate() === 30,
    `got ${decoyPunchRows[0]?.visitDate?.toISOString()}`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Shift "Visit Date" + the real truncated-header quirk (T-672)
  // ═══════════════════════════════════════════════════════════════════════

  console.log('\nparseShiftReport — Visit Date parsing + real header quirks (T-672)');

  // Real column shape (Bragi's file analysis): the hours header is
  // TRUNCATED with a trailing space ('...Call ' not '...Call Report'), and
  // decoy 'Actual Shift Start/End Time' columns exist. 'Visit Date' is col
  // 21 in the real file; exact position doesn't matter to findCol, but the
  // decoys sitting near the target column is what makes this a real trap.
  const realShapeShift = xlsxFile(
    ['Vendor EMP ID', 'SEC Full Name', 'Actual Shift Start Time', 'Actual Shift End Time', 'Actual Time Entered In Call ', 'Visit Date', 'Mailing Address', 'Birthday', 'Program Start Date'],
    [
      ['EE999001', 'Test Associate', '08:00', '16:00', 480, new Date(2026, 0, 1), '123 Fake St', new Date(1990, 0, 1), new Date(2020, 0, 1)],
      ['EE999001', 'Test Associate', '08:00', '16:00', 480, new Date(2026, 0, 2), '123 Fake St', new Date(1990, 0, 1), new Date(2020, 0, 1)],
    ],
    'Actual',
  );

  const shiftRows = await parseShiftReport(realShapeShift);
  assert('2 shift rows parsed', shiftRows.length === 2, `got ${shiftRows.length}`);
  assert(
    'the truncated header "Actual Time Entered In Call " (trailing space) still resolves to actualMinutes=480, NOT the decoy Start/End Time columns',
    shiftRows[0]?.actualMinutes === 480,
    `got ${shiftRows[0]?.actualMinutes}`,
  );
  assert(
    'Visit Date parses to 2026-01-01 from the real Excel-serial cell (not a string, not cellDates:true — the actual production code path)',
    shiftRows[0]?.visitDate?.getFullYear() === 2026 && shiftRows[0]?.visitDate?.getMonth() === 0 && shiftRows[0]?.visitDate?.getDate() === 1,
    `got ${shiftRows[0]?.visitDate?.toISOString()}`,
  );
  assert(
    'second row Visit Date parses to 2026-01-02',
    shiftRows[1]?.visitDate?.getFullYear() === 2026 && shiftRows[1]?.visitDate?.getMonth() === 0 && shiftRows[1]?.visitDate?.getDate() === 2,
    `got ${shiftRows[1]?.visitDate?.toISOString()}`,
  );
  assert(
    'Visit Date was NOT confused with the "Birthday" or "Program Start Date" PII columns in the same sheet (both also real datetimes)',
    shiftRows[0]?.visitDate?.getFullYear() === 2026, // would be 1990 or 2020 if the wrong column were picked
  );

  // Older shift export — no "Visit Date" column at all. Must not crash;
  // visitDate stays null for every row (the whole run then correctly
  // reports shiftDateAttributable === false in sourceSlice.ts).
  const olderShift = xlsxFile(
    ['Vendor EMP ID', 'SEC Full Name', 'Actual Time Entered In Call Report'],
    [['EE999004', 'Legacy Associate', 480]],
    'Actual',
    'old-shift.xlsx',
  );
  const olderShiftRows = await parseShiftReport(olderShift);
  assert('older shift export (no Visit Date column) still parses without crashing', olderShiftRows.length === 1);
  assert('visitDate is null when there is no date column — never guessed', olderShiftRows[0]?.visitDate === null);
  assert('actualMinutes still parses correctly on the dateless export', olderShiftRows[0]?.actualMinutes === 480);

  console.log(`\n${passCount} passed, ${failCount} failed`);
  process.exit(failCount === 0 ? 0 : 1);
}

run();
