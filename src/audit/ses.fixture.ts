// ses.fixture.ts — standalone Node.js fixture test harness for SES audit checks
// Run with: npx tsx src/audit/ses.fixture.ts
//
// All fixtures are in-memory only — no real invoice files, no Neon writes, no postRun().
// Exit code: 0 = all assertions passed; 1 = one or more assertions failed.
//
// Added T-668 (Vera review gate) as the regression guard for the Check 3 punch
// time-type filter drift: the per-person punchMap used to sum ALL punch rows
// (Overtime, PTO, Holiday, …) while the total-level punchHrs filtered to Work
// only, falsely flagging ~103 associates with large negative invoiceVsPunch
// while the — TOTAL — row reconciled to 0.00.

import { check03SesThreeWayRecon } from './checks/check03_ses_threeWayRecon.js';
import type { LaborRow, SesPunchRow, ShiftRow } from './types.js';

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

function assertEq(label: string, actual: unknown, expected: unknown): void {
  assert(label, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);
}

// ── Row builders ──────────────────────────────────────────────────────────────

let rowNum = 0;

function invoiceRow(associateId: string, employeeName: string, timeHours: number, comments: string): LaborRow {
  return {
    sheet: 'FSM I',
    rowNum: ++rowNum,
    employeeName,
    associateId,
    associateType: 'SES',
    timeHours,
    basePayRate: 0,
    muValue: 0,
    billValue: 0,
    loadedRate: 0,
    associateState: '',
    comments,
    visitDate: null,
    week: null,
    clientStoreId: '',
  };
}

function punchRow(associateId: string, employeeName: string, timeHours: number, timeType?: string): SesPunchRow {
  return { rowNum: ++rowNum, employeeName, associateId, timeHours, timeType };
}

function shiftRow(associateId: string, employeeName: string, hours: number): ShiftRow {
  return { rowNum: ++rowNum, employeeName, associateId, actualMinutes: hours * 60 };
}

function pivotRow(res: ReturnType<typeof check03SesThreeWayRecon>, associate: string) {
  return res.flaggedRows.find((r) => r.associate === associate);
}

// ── Fixture cast ──────────────────────────────────────────────────────────────
//
// A1 Alice  — clean Work associate whose punch file also carries Overtime + PTO
//             rows. Pre-fix these polluted her per-person punch total (53.00 vs
//             an invoiced 40.00) and produced a false invoiceVsPunch of -13.00.
// B1 Bob    — punch rows with NO time type at all. parseSesPunchXlsx leaves
//             timeType undefined when the export has no "Time Type" column, so
//             blank MUST still count as Work or every legacy file breaks.
// C1 Cara   — Work label with mixed casing / surrounding whitespace.
// D1 Dan    — appears in the punch file with non-Work rows ONLY. Must not exist
//             in the pivot at all post-fix (pre-fix he flagged at -16.00).
// E1 Flora  — the genuine finding: invoice and punch agree, shift is 7.48h short.
//             The fix must NOT silence this.

const detailRows: LaborRow[] = [
  invoiceRow('A1', 'Alice Anderson',      40.00, 'Work'),
  invoiceRow('B1', 'Bob Blankfield',      20.00, 'Work'),
  invoiceRow('C1', 'Cara Casewell',       10.00, 'work'),
  invoiceRow('E1', 'Flora Fabbricatore',  30.00, 'Work'),
  // Invoice-side non-Work rows are excluded by PUNCH_SUPPORTED — Alice's
  // Training hours must not leak into invoiceHrs.
  invoiceRow('A1', 'Alice Anderson',       6.00, 'Training'),
];

const punchRows: SesPunchRow[] = [
  punchRow('A1', 'Alice Anderson',      40.00, 'Work'),
  punchRow('A1', 'Alice Anderson',       5.00, 'Overtime'),
  punchRow('A1', 'Alice Anderson',       8.00, 'PTO'),
  punchRow('B1', 'Bob Blankfield',      20.00, undefined),
  punchRow('C1', 'Cara Casewell',        5.00, '  WORK  '),
  punchRow('C1', 'Cara Casewell',        5.00, 'work'),
  punchRow('D1', 'Dan Dayoff',          12.00, 'Overtime'),
  punchRow('D1', 'Dan Dayoff',           4.00, 'Holiday'),
  punchRow('E1', 'Flora Fabbricatore',  30.00, 'Work'),
];

const shiftRows: ShiftRow[] = [
  shiftRow('A1', 'Alice Anderson',      40.00),
  shiftRow('B1', 'Bob Blankfield',      20.00),
  shiftRow('C1', 'Cara Casewell',       10.00),
  shiftRow('E1', 'Flora Fabbricatore',  22.52),
];

// ── Test 1: punch time-type filter parity (T-668) ─────────────────────────────

console.log('\nCheck 3 (SES) — punch time-type filter parity [T-668]');

const res = check03SesThreeWayRecon(detailRows, punchRows, shiftRows);

assertEq('status is fail (Flora trips the 2.0h total tolerance)', res.status, 'fail');

const total = pivotRow(res, '— TOTAL —');
assert('summary row present', total !== undefined);
assertEq('total invoiceHrs excludes invoice-side Training', total?.invoiceHrs, '100.00');
assertEq('total punchHrs excludes Overtime/PTO/Holiday', total?.punchHrs, '100.00');
assertEq('total invoiceVsPunch reconciles to 0.00', total?.invoiceVsPunch, '0.00');
assertEq('total invoiceVsShift surfaces the real 7.48h gap', total?.invoiceVsShift, '7.48');

// The core regression: Alice, Bob, Cara and Dan must NOT be flagged.
assert('Alice not flagged (Overtime + PTO no longer pollute her punch total)', pivotRow(res, 'Alice Anderson') === undefined);
assert('Bob not flagged (blank timeType still counts as Work)',                pivotRow(res, 'Bob Blankfield') === undefined);
assert('Cara not flagged (Work label is case/whitespace insensitive)',         pivotRow(res, 'Cara Casewell') === undefined);
assert('Dan not flagged (non-Work-only associate drops out of the pivot)',     pivotRow(res, 'Dan Dayoff') === undefined);

// The genuine finding must survive.
const flora = pivotRow(res, 'Flora Fabbricatore');
assert('Flora still flagged', flora !== undefined);
assertEq('Flora invoiceVsPunch is clean', flora?.invoiceVsPunch, '0.00');
assertEq('Flora invoiceVsShift is the real variance', flora?.invoiceVsShift, '7.48');

assertEq('exactly one associate flagged', res.flaggedCount, 1);

// ── Test 2: invariant — sum(per-person punch) === total-level punchHrs ────────
//
// This is the property that broke. The two totals are produced by separate code
// paths inside the check; if they ever diverge again the summary row will
// reconcile while the pivot lies.

console.log('\nCheck 3 (SES) — sum(per-person punch) === total-level punchHrs');

const totalPunch = Number(total?.punchHrs);
const perPersonPunch = res.flaggedRows
  .filter((r) => r.associate !== '— TOTAL —')
  .reduce((s, r) => s + Number(r.punchHrs), 0);

// Only flagged associates appear in the pivot, so reconstruct the full per-person
// sum from the unflagged ones too by re-running with a tolerance-busting shift set.
const allFlagged = check03SesThreeWayRecon(
  detailRows,
  punchRows,
  shiftRows.map((r) => ({ ...r, actualMinutes: 0 })), // force every associate over tolerance
);
const allPerPerson = allFlagged.flaggedRows
  .filter((r) => r.associate !== '— TOTAL —')
  .reduce((s, r) => s + Number(r.punchHrs), 0);

assert(
  `sum of every per-person punchHrs (${allPerPerson.toFixed(2)}) === total-level punchHrs (${totalPunch.toFixed(2)})`,
  Math.abs(allPerPerson - totalPunch) < 0.005,
);
assert('no flagged pivot row carries more punch than the total', perPersonPunch <= totalPunch + 0.005);

// ── Test 3: blank-timeType-only file (legacy export with no Time Type column) ──
//
// parseSesPunchXlsx sets timeType: undefined for every row when the source file
// has no "Time Type" column. Such a file must reconcile exactly, not zero out.

console.log('\nCheck 3 (SES) — legacy punch export with no Time Type column');

const legacyPunch: SesPunchRow[] = [
  punchRow('A1', 'Alice Anderson',     40.00, undefined),
  punchRow('B1', 'Bob Blankfield',     20.00, undefined),
  punchRow('C1', 'Cara Casewell',      10.00, undefined),
  punchRow('E1', 'Flora Fabbricatore', 30.00, undefined),
];

const legacy = check03SesThreeWayRecon(
  detailRows,
  legacyPunch,
  shiftRows.map((r) => ({ ...r, actualMinutes: (r.associateId === 'E1' ? 30.00 : r.actualMinutes / 60) * 60 })),
);
assertEq('legacy punch file reconciles — status pass', legacy.status, 'pass');
assertEq('legacy punch file flags nobody', legacy.flaggedCount, 0);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
