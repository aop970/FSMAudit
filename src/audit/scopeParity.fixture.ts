// scopeParity.fixture.ts — Check 3 scope-drift guard (Vera, T-672 review)
//
// WHY THIS FILE EXISTS
//
// Check 3 reconciles WORK HOURS ONLY. That rule has now been aggregated in
// three different places over three tasks:
//
//   T-668  the check's total-level figure applied the Work-only punch filter;
//          the per-person pivot did not. The pivot "explained" a variance the
//          check did not actually have. Fixed by making both paths agree.
//
//   T-672  a THIRD aggregation appeared — sourceSlice.ts's per-date variance
//          pivot — which re-declared the rule locally (its own WORK_CATEGORY
//          constant) instead of importing it. It was written correctly and
//          tied out exactly, so nothing was wrong in production. But a correct
//          copy is still a copy: nothing structurally stopped it drifting, and
//          T-673's reviewer reasonably suspected it HAD drifted, because from
//          the outside a local re-declaration is indistinguishable from one.
//
// So the point of this fixture is not "does the date pivot filter Travel" —
// it is "can a fourth aggregation reintroduce T-668 a third time." It fails
// on BOTH failure modes:
//
//   1. SOURCE-LEVEL: a module re-declares the Work rule instead of importing
//      the canonical predicates from check03.
//   2. BEHAVIOURAL: the check's totals and the date pivot's per-date sums stop
//      agreeing, across a matrix of every category and casing that appears in
//      real SES data.
//
// A point fix on the date pivot alone would not have caught either.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  check03SesThreeWayRecon,
  isWorkPunch,
  isWorkInvoiceRow,
} from './checks/check03_ses_threeWayRecon.js';
import { buildAssociateSourceSlice } from '../ai/sourceSlice.js';
import type { LaborRow, SesPunchRow, ShiftRow, ParsedData } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..');

let passCount = 0;
let failCount = 0;

function assert(label: string, cond: boolean, detail?: string): void {
  if (cond) { passCount++; console.log(`  PASS  ${label}`); }
  else { failCount++; console.log(`  FAIL  ${label}`); if (detail) console.log(`        ${detail}`); }
}

// ── Part 1: source-level — nobody re-declares the Work rule ─────────────────

console.log('\nCheck 3 scope parity — the Work-only rule has ONE definition (Vera, T-672 review)');

const CHECK03_PATH = join(SRC, 'audit/checks/check03_ses_threeWayRecon.ts');
const check03Src = readFileSync(CHECK03_PATH, 'utf8');

assert(
  'check03 EXPORTS isWorkPunch (so other aggregations can import rather than copy)',
  /export function isWorkPunch/.test(check03Src),
);
assert(
  'check03 EXPORTS isWorkInvoiceRow',
  /export function isWorkInvoiceRow/.test(check03Src),
);

// Any module that aggregates Check-3-scoped hours must import the predicates.
// A local re-declaration of the rule is the T-668 seed.
const CONSUMERS = ['ai/sourceSlice.ts'];
const WORK_RULE_RESTATEMENT = /(['"`])work\1\s*(?:===|!==|\)|,|\])|===\s*(['"`])work\2|new Set\(\[\s*(['"`])work\3/;

for (const rel of CONSUMERS) {
  const src = readFileSync(join(SRC, rel), 'utf8');
  assert(
    `${rel} imports the canonical scope predicates from check03`,
    /import\s*\{[^}]*isWorkPunch[^}]*\}\s*from\s*['"][^'"]*check03_ses_threeWayRecon['"]/.test(src),
  );
  assert(
    `${rel} does NOT restate the Work-only rule with its own literal (the T-668 seed)`,
    !WORK_RULE_RESTATEMENT.test(src),
    'Found a local \'work\' comparison. Import isWorkPunch/isWorkInvoiceRow instead of re-declaring the rule.',
  );
}

// ── Part 2: behavioural — the predicates agree with the aggregations ────────

console.log('\nCheck 3 scope parity — predicates behave identically across every real category');

let rowNum = 0;
const inv = (id: string, name: string, hrs: number, comments: string, d: Date | null): LaborRow => ({
  rowNum: ++rowNum, week: null, employeeName: name, associateId: id, associateType: 'FT',
  associateState: 'FL', clientStoreId: '', storeZip: '', visitDate: d, timeHours: hrs,
  basePayRate: 20, mu: 0, rateTotal: 0, billValue: 0, comments,
} as unknown as LaborRow);
const pun = (id: string, name: string, hrs: number, timeType: string | undefined, d: Date | null): SesPunchRow =>
  ({ rowNum: ++rowNum, employeeName: name, associateId: id, timeHours: hrs, timeType, visitDate: d });
const shf = (id: string, name: string, hrs: number, d: Date | null): ShiftRow =>
  ({ rowNum: ++rowNum, employeeName: name, associateId: id, actualMinutes: hrs * 60, visitDate: d });

// Every category observed in Allan's real SES export, plus casing/whitespace
// variants, plus the blank-timeType legacy case.
const PUNCH_WORK_CASES: (string | undefined)[] = ['Work', 'work', 'WORK', '  Work  ', '', undefined];
const PUNCH_NONWORK_CASES = ['Travel', 'Training', 'Meeting', 'Admin', 'Overtime'];
const INVOICE_WORK_CASES = ['Work', 'work', 'WORK', ' Work '];
const INVOICE_NONWORK_CASES = ['Travel', 'Training', 'Meeting', 'Admin', 'Overtime',
  'Paid Holiday', 'Time Off', 'CA Daily Overtime', 'CA Weekly Overtime', 'PR Daily Overtime', 'Termed PTO', ''];

for (const t of PUNCH_WORK_CASES) {
  assert(`punch timeType ${JSON.stringify(t)} counts as Work`, isWorkPunch(pun('X', 'X', 1, t, null)));
}
for (const t of PUNCH_NONWORK_CASES) {
  assert(`punch timeType ${JSON.stringify(t)} is EXCLUDED`, !isWorkPunch(pun('X', 'X', 1, t, null)));
}
for (const c of INVOICE_WORK_CASES) {
  assert(`invoice comments ${JSON.stringify(c)} counts as Work`, isWorkInvoiceRow(inv('X', 'X', 1, c, null)));
}
for (const c of INVOICE_NONWORK_CASES) {
  assert(`invoice comments ${JSON.stringify(c)} is EXCLUDED`, !isWorkInvoiceRow(inv('X', 'X', 1, c, null)));
}

// ── Part 3: the real invariant — pivot sums tie out to the check's totals ───
//
// This is the assertion that would have caught T-668, and that would catch a
// future drift in ANY direction: if the check and the date pivot ever apply
// different scopes, their totals diverge. Built on a deliberately hostile mix
// of categories on the SAME dates as the Work hours.

console.log('\nCheck 3 scope parity — date-pivot sums tie out to the check totals');

function emptyParsed(): ParsedData {
  return {
    fsmIRows: [], fsmIIRows: [], fsmIMeritRows: [], fsmIIMeritRows: [], punchRows: [],
    mgmtRows: [], cloudRows: [], rosterEntries: [], otApprovalRows: [], tieOutData: null,
    declaredPeriod: null, weeksCovered: [], crossTabNotes: [], tabNames: [], timeOffRows: [],
    timeOffFileNames: [], termedPtoRows: [], shiftRows: [], sesPunchRows: [],
    fileName: 'x', invoiceNumber: null, e17Value: null, punchFileName: null,
  } as unknown as ParsedData;
}

const D = (day: number) => new Date(2026, 6, day);
const pd = emptyParsed();

// Mirrors Flora's real shape: Work + an overnight Travel leg spilling into a
// day that has NO Work hours at all, plus assorted non-Work noise.
pd.fsmIRows = [
  inv('EE1', 'Parity Case', 7.47, 'Work', D(1)),
  inv('EE1', 'Parity Case', 8.40, 'Travel', D(1)),
  inv('EE1', 'Parity Case', 1.30, 'Travel', D(2)),
  inv('EE1', 'Parity Case', 8.00, 'Paid Holiday', D(3)),
  inv('EE1', 'Parity Case', 4.99, 'Overtime', null),
  inv('EE1', 'Parity Case', 4.00, 'Work', D(4)),
];
pd.sesPunchRows = [
  pun('EE1', 'Parity Case', 7.47, 'Work', D(1)),
  pun('EE1', 'Parity Case', 8.40, 'Travel', D(1)),
  pun('EE1', 'Parity Case', 1.30, 'Travel', D(2)),
  pun('EE1', 'Parity Case', 2.00, 'Training', D(3)),
  pun('EE1', 'Parity Case', 4.00, 'Work', D(4)),
];
pd.shiftRows = [shf('EE1', 'Parity Case', 4.00, D(4))];

const parityResult = check03SesThreeWayRecon(pd.fsmIRows, pd.sesPunchRows, pd.shiftRows);
const parityRow = parityResult.flaggedRows.find((r) => r.associate === 'Parity Case');
assert('the parity associate is flagged by the check (setup sanity)', parityRow !== undefined);

const paritySlice = buildAssociateSourceSlice(parityResult, pd);
const parityEntry = paritySlice.associates.find((a) => a.identity.displayName === 'Parity Case');
const pivot = parityEntry?.datePivot;
assert('the parity associate has a date pivot (setup sanity)', pivot != null);

const pivotInvoice = (pivot?.dates ?? []).reduce((s, e) => s + (e.invoiceHours ?? 0), 0);
const pivotPunch = (pivot?.dates ?? []).reduce((s, e) => s + (e.punchHours ?? 0), 0);

assert(
  'INVARIANT: date-pivot invoice sum equals the check\'s per-person invoice total (drift here IS T-668)',
  pivotInvoice.toFixed(2) === parityRow?.invoiceHrs,
  `pivot ${pivotInvoice.toFixed(2)} vs check ${parityRow?.invoiceHrs}`,
);
assert(
  'INVARIANT: date-pivot punch sum equals the check\'s per-person punch total (drift here IS T-668)',
  pivotPunch.toFixed(2) === parityRow?.punchHrs,
  `pivot ${pivotPunch.toFixed(2)} vs check ${parityRow?.punchHrs}`,
);

// The specific over-attribution T-673 suspected: a non-Work category leaking
// into a per-date figure and creating a phantom driving date.
const jul1 = pivot?.dates.find((e) => e.date === '2026-07-01');
const jul2 = pivot?.dates.find((e) => e.date === '2026-07-02');
assert('07-01 shows ONLY the Work hours — Travel did not leak into the figure', jul1?.invoiceHours === 7.47 && jul1?.punchHours === 7.47);
assert('07-01 quarantines Travel as context, never as reconciled hours', (jul1?.otherPunchCategories ?? '').includes('Travel 8.40h'));
assert('07-02 (Travel-only spillover) contributes NO Work hours on either leg', jul2?.invoiceHours === null && jul2?.punchHours === null);
assert('07-02 carries zero variance — it can never outrank a real driving date', jul2?.variance === 0);
assert('07-01 outranks 07-02 — the real driver sorts first', pivot?.dates[0]?.date === '2026-07-01');
assert('the dateless Overtime row never became a phantom date bucket', !(pivot?.dates ?? []).some((e) => e.date === 'Invalid Date' || e.date.includes('NaN')));

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
