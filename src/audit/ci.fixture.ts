// ci.fixture.ts — standalone Node.js fixture test harness for CI audit checks
// Run with: npx tsx src/audit/ci.fixture.ts

import * as fs from 'fs';
import * as path from 'path';

// ── Browser API shims ──────────────────────────────────────────────────────────

// Shim localStorage with a simple in-memory implementation
const store: Record<string, string> = {};
(global as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
} as Storage;

// NodeFile: minimal File-compatible object backed by disk reads
class NodeFile {
  name: string;
  size: number;
  readonly _path: string;

  constructor(filePath: string) {
    this._path = filePath;
    this.name = path.basename(filePath);
    const stat = fs.statSync(filePath);
    this.size = stat.size;
  }
}

// NodeFileReader: shims FileReader.readAsArrayBuffer using Node fs
class NodeFileReader {
  result: ArrayBuffer | null = null;
  error: Error | null = null;
  onload: ((e: { target: NodeFileReader }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;

  readAsArrayBuffer(file: NodeFile): void {
    try {
      const buf = fs.readFileSync(file._path);
      this.result = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      ) as ArrayBuffer;
      setTimeout(() => this.onload?.({ target: this }), 0);
    } catch (err) {
      this.error = err as Error;
      setTimeout(() => this.onerror?.(err), 0);
    }
  }
}
(global as Record<string, unknown>).FileReader = NodeFileReader as unknown as typeof FileReader;

// ── Now safe to import CI modules (they use localStorage / FileReader) ─────────

import { parseCiInvoice } from './parseWorkbook.js';
import { runCiAudit } from './runCiAudit.js';
import { loadCiControlTable } from './ciControlTable.js';
import { checkCiHolidaySplit } from './checks/checkCi_holidaySplit.js';
import type { CiDetailRow, CiCoverMeta } from './types.js';

// ── Fixture config ─────────────────────────────────────────────────────────────

const GOLDEN_DIR = '/Users/allanpedersen/Downloads/CI26-W19-22/Combined Invoices';

const BUP_W19 = '/Users/allanpedersen/Downloads/CI26-W19-22/CI26-W19/CI26-W19/BUP';
const BUP_W20 = '/Users/allanpedersen/Downloads/CI26-W19-22/CI26-W20/CI26-W20/BUP';
const BUP_W21 = '/Users/allanpedersen/Downloads/CI26-W19-22/CI26-W21/CI26-W21/BUP';
const BUP_W22 = '/Users/allanpedersen/Downloads/CI26-W19-22/CI26-W22/CI26-W22/BUP';

const INVOICES = [
  'CI26-W19-22C.xlsx',
  'CI26-W19-22D.xlsx',
  'CI26-W19-22G.xlsx',
  'CI26-W19-22H.xlsx',
  'CI26-W19-22I.xlsx',
  'CI26-W19-22K.xlsx',
  'CI26-W19-22L.xlsx',
  'CI26-W19-22M.xlsx',
  'CI26-W19-22N.xlsx',
  'CI26-W19-22O.xlsx',
  'VOCF26-W19-22.xlsx',
];

// Checks that should pass (or be na/warning) on all golden invoices.
// Check 4 (Holiday Split) is included: hourly associates on Memorial Day 2026-05-25 that bill
// $0 (correctly zeroed out) now PASS; only invoice O has a genuine 8h billing with no activity.
// Check 9 and Check 11 are expected to pass on most invoices. Invoice-level exceptions for
// genuine findings are tracked in KNOWN_FINDINGS below.
const EXPECTED_PASS_CHECKS = new Set([2, 4, 6, 9, 10, 11, 13]);

// Known genuine audit findings — these checks FAIL on specific invoices due to real data issues.
// They are not fixture bugs; they document confirmed findings for reviewer awareness.
const KNOWN_FINDINGS: Record<string, Set<number>> = {
  // I: "Expenses" tab ($883) not included in reconstruction — partial invoice structure
  'CI26-W19-22I.xlsx': new Set([9]),
  // O: Detail rows sum ($7,275) does not tie to Tie-Out ($1,819) — 4 extra weeks billed vs paid.
  //    Also: EE017812 billed 8h on Memorial Day 2026-05-25 with no Activity backing — genuine finding.
  'CI26-W19-22O.xlsx': new Set([4, 9]),
  // L: Row with wrong year (2025 vs 2026) for Youngmin Son — data entry error in invoice
  'CI26-W19-22L.xlsx': new Set([11]),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getActivityFiles(bupDir: string): NodeFile[] {
  if (!fs.existsSync(bupDir)) return [];
  return fs.readdirSync(bupDir)
    .filter((f) => f.startsWith('Activity') && f.endsWith('.xlsx'))
    .map((f) => new NodeFile(path.join(bupDir, f)));
}

function getRosterFile(bupDir: string): NodeFile | null {
  const p = path.join(bupDir, 'Roster.xlsx');
  return fs.existsSync(p) ? new NodeFile(p) : null;
}

function getTimeOffFile(bupDir: string): NodeFile | null {
  if (!fs.existsSync(bupDir)) return null;
  const f = fs.readdirSync(bupDir).find((n) => n.startsWith('2020 Time Off'));
  return f ? new NodeFile(path.join(bupDir, f)) : null;
}

// ── Main runner ───────────────────────────────────────────────────────────────

async function runFixture(): Promise<void> {
  const controlTable = loadCiControlTable();

  // Collect BUP files from all 4 weeks
  const activityFiles = [
    ...getActivityFiles(BUP_W19),
    ...getActivityFiles(BUP_W20),
    ...getActivityFiles(BUP_W21),
    ...getActivityFiles(BUP_W22),
  ];
  const rosterFile = getRosterFile(BUP_W22) ?? getRosterFile(BUP_W19);
  const timeOffFile = getTimeOffFile(BUP_W22) ?? getTimeOffFile(BUP_W19);

  console.log(`\nBUP files loaded: ${activityFiles.length} activity, roster=${rosterFile?.name ?? 'none'}, timeOff=${timeOffFile?.name ?? 'none'}`);

  let totalPass = 0;
  let totalFail = 0;
  let totalWarn = 0;
  let totalNa = 0;
  const unexpectedFailures: string[] = [];

  for (const invoiceName of INVOICES) {
    const invoicePath = path.join(GOLDEN_DIR, invoiceName);
    if (!fs.existsSync(invoicePath)) {
      console.log(`SKIP ${invoiceName} (not found at ${invoicePath})`);
      continue;
    }

    const invoiceFile = new NodeFile(invoicePath) as unknown as File;
    const activities = activityFiles.map((f) => f as unknown as File);
    const roster = rosterFile ? (rosterFile as unknown as File) : null;
    const timeOff = timeOffFile ? (timeOffFile as unknown as File) : null;

    try {
      const parsed = await parseCiInvoice(invoiceFile, activities, roster, timeOff);
      const payload = runCiAudit(parsed, controlTable);

      console.log(`\n=== ${invoiceName} ===`);
      console.log(
        `Cover: invoiceNumber=${parsed.coverMeta.invoiceNumber} ` +
        `tabName=${parsed.coverMeta.tabName} ` +
        `totalDue=${parsed.coverMeta.totalDue}`,
      );
      console.log(
        `Detail rows: ${parsed.detailRows.length} | ` +
        `Weeks: ${parsed.weeksCovered.join(',')}`,
      );
      console.log(
        `Cloud: $${parsed.cloudTotal.toFixed(2)} | ` +
        `NewHire: $${parsed.newHireFeeTotal.toFixed(2)}`,
      );

      const knownForInvoice = KNOWN_FINDINGS[invoiceName] ?? new Set<number>();
      for (const r of payload.results) {
        const isKnownFinding = knownForInvoice.has(r.checkId);
        const expectedOk = isKnownFinding ||
          !EXPECTED_PASS_CHECKS.has(r.checkId) ||
          r.status === 'pass' || r.status === 'na' || r.status === 'warning';
        const marker =
          r.status === 'pass' ? '✓' :
          r.status === 'na' ? '-' :
          r.status === 'warning' ? '⚠' : '✗';
        const knownTag = isKnownFinding && r.status === 'fail' ? ' [KNOWN FINDING]' : '';
        const tag = expectedOk ? '' : ' <<< UNEXPECTED FAIL';
        console.log(
          `  [${String(r.checkId).padStart(2, ' ')}] ${marker} ${r.checkName}: ` +
          `${r.status} — ${r.stats.slice(0, 100)}${knownTag}${tag}`,
        );

        if (r.status === 'pass') totalPass++;
        else if (r.status === 'fail') { totalFail++; if (!expectedOk) unexpectedFailures.push(`${invoiceName} check${r.checkId}`); }
        else if (r.status === 'warning') totalWarn++;
        else totalNa++;
      }

      if (parsed.crossTabNotes.length > 0) {
        console.log(`  Notes: ${parsed.crossTabNotes.slice(0, 3).join('; ')}`);
      }
    } catch (err) {
      console.error(`ERROR parsing ${invoiceName}:`, err);
      totalFail++;
      unexpectedFailures.push(`${invoiceName} parse-error`);
    }
  }

  // ── Synthetic fixture: hourly unworked holiday failure path ──────────────────
  console.log('\n=== SYNTHETIC: Hourly Unworked Holiday Test ===');
  // Use local-midnight dates (year, month-1, day) to avoid UTC timezone offset issues.
  // new Date('YYYY-MM-DD') creates UTC midnight which reads as the prior day in CDT (UTC-5).
  const mockDetailRows: CiDetailRow[] = [{
    sheet: 'Detail',
    rowNum: 5,
    employeeName: 'Test Associate',
    associateId: 'TA001',
    visitDate: new Date(2026, 4, 25), // Memorial Day — local midnight
    week: 22,
    timeHours: 8,
    otHours: 0,
    basePayRate: 25.00,
    preMarkUpTotal: 200,
    muValue: 60,
    salaryTotal: 260,
    billValue: 260,
    layoutType: 'Hourly',
    comments: 'Work',
  }];
  const mockActivityRows: never[] = []; // intentionally empty → no Activity backing
  const mockControlMap = new Map([
    ['TA001', {
      name: 'Test Associate',
      associateId: 'TA001',
      role: 'RSE',
      invoiceLetter: 'K',
      billFormat: 'Hourly' as const,
      baseRate: 25,
      state: 'TX',
      status: 'active' as const,
    }],
  ]);
  const mockCoverMeta: CiCoverMeta = {
    invoiceNumber: 'CI26-W19-22K',
    tabName: 'CI26-W19-22K',
    activityDateStart: new Date(2026, 4, 4),  // 2026-05-04 local midnight
    activityDateEnd: new Date(2026, 4, 31),   // 2026-05-31 local midnight
    poNumber: null,
    invoiceDate: null,
    dueDate: null,
    totalDue: null,
    attn: null,
    billTo: null,
    remitTo: null,
  };
  const holidayResult = checkCiHolidaySplit(
    mockDetailRows, mockActivityRows, mockControlMap, mockCoverMeta,
  );
  // With empty activityRows, hasActivity=false → conservative warning (not fail)
  // So expected status here is 'warning', not 'fail'
  const syntheticPassed = holidayResult.status === 'warning' || holidayResult.status === 'fail';
  const syntheticMarker = syntheticPassed ? 'PASS' : 'FAIL <<< SYNTHETIC TEST FAILURE';
  console.log(
    `  Holiday split hourly unworked path: status=${holidayResult.status} ` +
    `(expected: warning or fail) — ${syntheticMarker}`,
  );
  console.log(`  Flagged: ${holidayResult.flaggedCount} row(s) — ${holidayResult.stats}`);
  if (syntheticPassed) totalPass++; else { totalFail++; unexpectedFailures.push('synthetic-holiday'); }

  // ── Synthetic fixture 2: hourly with Activity that confirms NO work on holiday ─
  console.log('\n=== SYNTHETIC: Hourly Unworked Holiday WITH Activity File ===');
  // Activity rows that do NOT include Memorial Day → should produce fail
  const mockActivityWithOtherDays = [{
    rowNum: 1,
    employeeName: 'Test Associate',
    associateId: 'TA001',
    jobTitle: 'RSE',
    visitDate: new Date(2026, 4, 26), // day after Memorial Day — local midnight
    timeIn: '08:00',
    timeOut: '17:00',
    timeHours: 9,
    isOt: false,
  }];
  const holidayResult2 = checkCiHolidaySplit(
    mockDetailRows,
    mockActivityWithOtherDays,
    mockControlMap,
    mockCoverMeta,
  );
  const synthetic2Passed = holidayResult2.status === 'fail';
  const synthetic2Marker = synthetic2Passed ? 'PASS' : 'FAIL <<< SYNTHETIC TEST FAILURE';
  console.log(
    `  Holiday split failure path (with Activity): status=${holidayResult2.status} ` +
    `(expected: fail) — ${synthetic2Marker}`,
  );
  console.log(`  Flagged: ${holidayResult2.flaggedCount} row(s) — ${holidayResult2.stats}`);
  if (synthetic2Passed) totalPass++; else { totalFail++; unexpectedFailures.push('synthetic-holiday-2'); }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Pass:    ${totalPass}`);
  console.log(`Fail:    ${totalFail}`);
  console.log(`Warning: ${totalWarn}`);
  console.log(`N/A:     ${totalNa}`);

  if (unexpectedFailures.length > 0) {
    console.log(`\nUNEXPECTED FAILURES (${unexpectedFailures.length}):`);
    for (const u of unexpectedFailures) console.log(`  - ${u}`);
    console.log('\nFIXTURE RESULT: FAIL');
    process.exitCode = 1;
  } else {
    console.log('\nFIXTURE RESULT: ALL GOLDEN CHECKS PASSED (or were na/warning as expected)');
  }
}

runFixture().catch((err) => {
  console.error('Fatal fixture error:', err);
  process.exit(1);
});
