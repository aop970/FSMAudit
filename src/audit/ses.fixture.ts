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

// T-670 — Browser API shim (mirrors fsm.fixture.ts). check17_otMath.ts and
// check18_holidays.ts call getAuditRules(), which touches localStorage; its
// try/catch already falls back to defaults if localStorage is undefined, but
// shim it anyway to match the repo's established fixture convention and keep
// behavior identical to the real browser environment.
const localStorageStore: Record<string, string> = {};
(global as Record<string, unknown>).localStorage = {
  getItem: (k: string) => localStorageStore[k] ?? null,
  setItem: (k: string, v: string) => { localStorageStore[k] = v; },
  removeItem: (k: string) => { delete localStorageStore[k]; },
  clear: () => { Object.keys(localStorageStore).forEach((k) => delete localStorageStore[k]); },
  get length() { return Object.keys(localStorageStore).length; },
  key: (i: number) => Object.keys(localStorageStore)[i] ?? null,
} as Storage;

import { check03SesThreeWayRecon } from './checks/check03_ses_threeWayRecon.js';
import { checkSes2020co } from './checks/checkSes_2020co.js';
import { checkSesStoreIdFormat } from './checks/checkSes_storeIdFormat.js';
import { checkSesPayrollTag } from './checks/checkSes_payrollTag.js';
import { check18Holidays } from './checks/check18_holidays.js';
import { runSesAudit } from './runSesAudit.js';
import { applyNeverFailPolicy } from './neverFailPolicy.js';
import { isAiEligible, countAiEligible, shouldShowAnalyzeAll, MIN_AI_ELIGIBLE_FOR_ANALYZE_ALL } from '../ai/aiGate.js';
import { unionFlaggedRowColumns } from '../lib/tableColumns.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { LaborRow, SesPunchRow, ShiftRow, ParsedData, ControlTableEntry, CheckResult } from './types.js';

/** Repo `src/` root — this file lives at src/audit/, so one level up. */
const FIXTURE_SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
    // muFormula/billFormula set so check02Formulas (Formula Compliance)
    // doesn't incidentally fail these rows as "hardcoded" — T-671's
    // full-run fixture needs its ONLY fail to be the one it's testing for.
    muFormula: '=A1*0.3',
    billValue: 0,
    billFormula: '=A1*1.3',
    loadedRate: 0,
    associateState: '',
    comments,
    visitDate: null,
    week: null,
    clientStoreId: '',
  };
}

function punchRow(associateId: string, employeeName: string, timeHours: number, timeType?: string, visitDate: Date | null = null): SesPunchRow {
  return { rowNum: ++rowNum, employeeName, associateId, timeHours, timeType, visitDate };
}

function shiftRow(associateId: string, employeeName: string, hours: number, visitDate: Date | null = null): ShiftRow {
  return { rowNum: ++rowNum, employeeName, associateId, actualMinutes: hours * 60, visitDate };
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
  invoiceRow('E1', 'Fiona Farnsworth',  30.00, 'Work'),
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
  punchRow('E1', 'Fiona Farnsworth',  30.00, 'Work'),
];

const shiftRows: ShiftRow[] = [
  shiftRow('A1', 'Alice Anderson',      40.00),
  shiftRow('B1', 'Bob Blankfield',      20.00),
  shiftRow('C1', 'Cara Casewell',       10.00),
  shiftRow('E1', 'Fiona Farnsworth',  22.52),
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
const flora = pivotRow(res, 'Fiona Farnsworth');
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
  punchRow('E1', 'Fiona Farnsworth', 30.00, undefined),
];

const legacy = check03SesThreeWayRecon(
  detailRows,
  legacyPunch,
  shiftRows.map((r) => ({ ...r, actualMinutes: (r.associateId === 'E1' ? 30.00 : r.actualMinutes / 60) * 60 })),
);
assertEq('legacy punch file reconciles — status pass', legacy.status, 'pass');
assertEq('legacy punch file flags nobody', legacy.flaggedCount, 0);

// ═══════════════════════════════════════════════════════════════════════════
// T-670 — fail-only AI gate, never-fail policy, and SES checkId renumbering
// ═══════════════════════════════════════════════════════════════════════════
//
// Allan: "in the interest of token budget lets make sure the analysis is
// only done on FAIL checks and not Pass or Warning or N/A" + "let the
// following SES checks always either be Pass or Warning" + "the numbers
// corresponding to the checks is wrong. There are 2 17's and 2 18's."

// ── Test 4: isAiEligible — single choke point, fail-only ─────────────────────

console.log('\nisAiEligible — the single AI-gate choke point (T-670)');

assert('fail is AI-eligible', isAiEligible('fail') === true);
assert('warning is NOT AI-eligible (was, pre-T-670)', isAiEligible('warning') === false);
assert('pass is NOT AI-eligible', isAiEligible('pass') === false);
assert('na is NOT AI-eligible', isAiEligible('na') === false);

// ── Test 5: never-fail policy — downgrade behavior + FSM untouched ───────────

console.log('\nNever-fail policy — SES downgrades, FSM untouched (T-670)');

// 2020CO Internal Rows — trigger a genuine fail
const twentyTwentyCoRow = invoiceRow('Z1', 'Zoe Zeeman', 5.00, 'Work');
twentyTwentyCoRow.clientStoreId = '2020CO';
const rawTwentyTwentyCo = checkSes2020co([twentyTwentyCoRow]);
assertEq('2020CO check fails on its own (pre-policy)', rawTwentyTwentyCo.status, 'fail');
assertEq('2020CO checkId is the new SES-only number', rawTwentyTwentyCo.checkId, 20);

const [downgradedTwentyTwentyCo] = applyNeverFailPolicy([rawTwentyTwentyCo], 'ses');
assertEq('2020CO downgraded to warning under SES never-fail policy', downgradedTwentyTwentyCo.status, 'warning');
assertEq('2020CO flaggedCount preserved through downgrade', downgradedTwentyTwentyCo.flaggedCount, rawTwentyTwentyCo.flaggedCount);
assertEq('2020CO stats text preserved through downgrade', downgradedTwentyTwentyCo.stats, rawTwentyTwentyCo.stats);
assert('2020CO flaggedRows preserved through downgrade (full detail, not silenced)',
  downgradedTwentyTwentyCo.flaggedRows.length === rawTwentyTwentyCo.flaggedRows.length && rawTwentyTwentyCo.flaggedRows.length > 0);

// Payroll Tag Exceptions — trigger a genuine fail: an EXC row whose tag date
// isn't one of the valid (non-EXC) period dates.
const payrollTagPunchRows: SesPunchRow[] = [
  { ...punchRow('P1', 'Pat Payton', 8.00, 'Work'), payrollTag: '2020_PAYROLL_20260601' },
  // EXC row's tag date (20260615) does NOT match the only valid non-EXC
  // period date (20260601) — this is what should flag.
  { ...punchRow('P1', 'Pat Payton', 2.00, 'Work'), payrollTag: '2020_PAYROLL_20260615_EXC_LATE' },
];
const rawPayrollTag = checkSesPayrollTag(payrollTagPunchRows, null);
assertEq('Payroll Tag check fails on its own (pre-policy)', rawPayrollTag.status, 'fail');
assertEq('Payroll Tag checkId is the new SES-only number', rawPayrollTag.checkId, 22);

const [downgradedPayrollTag] = applyNeverFailPolicy([rawPayrollTag], 'ses');
assertEq('Payroll Tag downgraded to warning under SES never-fail policy', downgradedPayrollTag.status, 'warning');
assertEq('Payroll Tag flaggedCount preserved through downgrade', downgradedPayrollTag.flaggedCount, rawPayrollTag.flaggedCount);
assert('Payroll Tag flaggedRows preserved through downgrade', downgradedPayrollTag.flaggedRows.length > 0);

// Holiday Pay Validation — trigger a genuine fail: a Paid Holiday row on a
// scheduled date (2026-05-25, Memorial Day, both FSM and SES default rules)
// with the WRONG hours (4 instead of the configured 8).
const wrongHoursHolidayRow = invoiceRow('H1', 'Holly Hayes', 4.00, 'Paid Holiday');
wrongHoursHolidayRow.visitDate = new Date(2026, 4, 25); // May 25, 2026

const rawSesHoliday = check18Holidays([wrongHoursHolidayRow], [], 'ses');
assertEq('Holiday Pay (SES) fails on its own (pre-policy)', rawSesHoliday.status, 'fail');
assertEq('Holiday Pay checkId is the canonical shared FSM/SES number (unchanged)', rawSesHoliday.checkId, 18);

const [downgradedSesHoliday] = applyNeverFailPolicy([rawSesHoliday], 'ses');
assertEq('Holiday Pay (SES) downgraded to warning', downgradedSesHoliday.status, 'warning');
assertEq('Holiday Pay flaggedCount preserved through downgrade', downgradedSesHoliday.flaggedCount, rawSesHoliday.flaggedCount);
assert('Holiday Pay flaggedRows preserved through downgrade', downgradedSesHoliday.flaggedRows.length > 0);

// T-677: Allan has now given the FSM never-fail list ("all with exception
// of" Punch Reconciliation, Management Billing Validation, Cloud Services
// Validation, Invoice Tie-Out, Formula Compliance). Holiday Pay Validation
// (checkId 18) is not one of the five fail-capable checkIds, so FSM Holiday
// is now DOWNGRADED too — same outcome as SES, but independently expressed:
// SES's copy is an explicit name-inclusion entry above, FSM's is implicit
// (absence from FSM_FAIL_CAPABLE_CHECK_IDS), not a shared/merged entry.
// The exhaustive per-check FSM proof (all 14 downgrade, all 5 still fail)
// lives in fsm.fixture.ts; this is a targeted sanity check that SES and FSM
// stay independently correct on the one check both programs share.
const rawFsmHoliday = check18Holidays([wrongHoursHolidayRow], [], 'fsm');
assertEq('Holiday Pay (FSM) also fails on the same data (sanity check)', rawFsmHoliday.status, 'fail');

const [downgradedFsmHoliday] = applyNeverFailPolicy([rawFsmHoliday], 'fsm');
assertEq('Holiday Pay (FSM) downgraded to warning under FSM never-fail policy (T-677)', downgradedFsmHoliday.status, 'warning');
assertEq('Holiday Pay (FSM) flaggedCount preserved through downgrade', downgradedFsmHoliday.flaggedCount, rawFsmHoliday.flaggedCount);
assert('Holiday Pay (FSM) flaggedRows preserved through downgrade', downgradedFsmHoliday.flaggedRows.length > 0);

// And the inverse sanity check: a FAIL-CAPABLE FSM checkId (9, Invoice
// Tie-Out) must NOT be downgraded — same object reference back, no copy.
const rawFsmTieOut: CheckResult = {
  checkId: 9,
  checkName: 'Invoice Tie-Out',
  status: 'fail',
  stats: 'Variance exceeds tolerance',
  flaggedCount: 1,
  flaggedRows: [{ issue: 'variance' }],
};
const [notDowngradedFsmTieOut] = applyNeverFailPolicy([rawFsmTieOut], 'fsm');
assertEq('Invoice Tie-Out (FSM) status UNCHANGED — fail-capable checkId', notDowngradedFsmTieOut.status, 'fail');
assert('Invoice Tie-Out (FSM) is the exact same object reference when not downgraded (no unnecessary copy)',
  notDowngradedFsmTieOut === rawFsmTieOut);

// ── Test 6: checkId renumbering — Store ID Format keeps its own fail behavior ──

console.log('\nStore ID Format — renumbered but NOT on the never-fail list (T-670)');

const badStoreIdRow = invoiceRow('S1', 'Sam Storey', 3.00, 'Work');
badStoreIdRow.clientStoreId = 'BB-7'; // single-digit suffix — should flag
const rawStoreIdFormat = checkSesStoreIdFormat([badStoreIdRow]);
assertEq('Store ID Format fails on bad data', rawStoreIdFormat.status, 'fail');
assertEq('Store ID Format checkId is the new SES-only number', rawStoreIdFormat.checkId, 21);
const [notDowngradedStoreId] = applyNeverFailPolicy([rawStoreIdFormat], 'ses');
assertEq('Store ID Format is NOT downgraded — Allan did not list it as never-fail', notDowngradedStoreId.status, 'fail');

// ── Test 7: full runSesAudit() — checkId uniqueness across the whole array ────
//
// This is the assertion that stops the "two 17s, two 18s" bug from
// recurring: it runs the REAL orchestrator and checks every id in the
// output, not a hand-picked subset.

console.log('\nFull runSesAudit() — checkId uniqueness (T-670 core regression test)');

function emptyParsedDataForSesRun(): ParsedData {
  return {
    // invoiceNumber: null (not 'INV-TEST') deliberately — a real string here
    // that doesn't match tabNames[0]/fileName trips check10InvoiceIdentity
    // into an UNRELATED fail (identity mismatch), which isn't what this
    // fixture is testing. null routes it to Invoice Identity's 'warning'
    // branch ("number not found") instead, keeping this run's only real
    // fail the one under test (Store ID Format).
    fileName: 'ses-test.xlsx', invoiceNumber: null, e17Value: null, punchFileName: null,
    fsmIRows: [wrongHoursHolidayRow, twentyTwentyCoRow, badStoreIdRow], fsmIIRows: [], fsmIMeritRows: [], fsmIIMeritRows: [],
    punchRows: [], mgmtRows: [], cloudRows: [], rosterEntries: [], otApprovalRows: [],
    tieOutData: null, declaredPeriod: null, weeksCovered: [1], crossTabNotes: [], tabNames: ['Detail'],
    timeOffRows: [], timeOffFileNames: [], termedPtoRows: [], shiftRows: [], sesPunchRows: payrollTagPunchRows,
  };
}

const controlTable: ControlTableEntry[] = [];
const fullSesRun = runSesAudit(emptyParsedDataForSesRun(), controlTable);

const allCheckIds = fullSesRun.results.map((r) => r.checkId);
const uniqueCheckIds = new Set(allCheckIds);
assertEq(
  `every checkId in a full SES run is unique (${allCheckIds.length} results)`,
  uniqueCheckIds.size,
  allCheckIds.length,
);
assert(
  'results array is in ascending checkId order',
  allCheckIds.every((id, i) => i === 0 || id >= allCheckIds[i - 1]),
  `order: ${allCheckIds.join(', ')}`,
);

const otMathInRun = fullSesRun.results.find((r) => r.checkName === 'OT Math Validation');
const storeIdInRun = fullSesRun.results.find((r) => r.checkName === 'Store ID Format');
const holidaysInRun = fullSesRun.results.find((r) => r.checkName === 'Holiday Pay Validation');
const payrollTagInRun = fullSesRun.results.find((r) => r.checkName === 'Payroll Tag Exceptions');
const twentyTwentyCoInRun = fullSesRun.results.find((r) => r.checkName === '2020CO Internal Rows');
const otFlagInRun = fullSesRun.results.find((r) => r.checkName === 'OT Flag');

assertEq('OT Math Validation keeps canonical id 17', otMathInRun?.checkId, 17);
assertEq('Holiday Pay Validation keeps canonical id 18 (no longer shared with Payroll Tag)', holidaysInRun?.checkId, 18);
assertEq('Store ID Format moved off 17 to 21 (no longer collides with OT Math)', storeIdInRun?.checkId, 21);
assertEq('Payroll Tag Exceptions moved off 18 to 22 (no longer collides with Holidays)', payrollTagInRun?.checkId, 22);
assertEq('2020CO Internal Rows moved to 20', twentyTwentyCoInRun?.checkId, 20);

// End-to-end proof the never-fail policy actually applied inside the real orchestrator:
assertEq('Holiday Pay Validation reads as warning in the full SES run (downgraded)', holidaysInRun?.status, 'warning');
assertEq('2020CO Internal Rows reads as warning in the full SES run (downgraded)', twentyTwentyCoInRun?.status, 'warning');
assertEq('Payroll Tag Exceptions reads as warning in the full SES run (downgraded)', payrollTagInRun?.status, 'warning');
assert('Store ID Format still reads as fail in the full SES run (not on the never-fail list)', storeIdInRun?.status === 'fail');
assert(
  'OT Flag is pass or warning, never fail, in the full SES run (Bragi verified: no code change needed here)',
  otFlagInRun?.status === 'pass' || otFlagInRun?.status === 'warning',
);

// ═══════════════════════════════════════════════════════════════════════════
// T-671 — "Analyze All" must render on a single-FAIL run
// ═══════════════════════════════════════════════════════════════════════════
//
// Allan's exact repro: a real SES run with the never-fail downgrades applied
// has exactly ONE fail (Store ID Format — see above), and the old
// ">= 2 eligible checks" threshold (written when eligibility meant
// fail-or-warning, pre-T-670) made "Analyze All" vanish on that run. Fixed
// by deriving both call sites (AnalyzeAllButton.tsx, App.tsx's sidebar
// trigger) from one shared shouldShowAnalyzeAll() — tested directly here,
// since both call sites now share the identical predicate and cannot diverge.

console.log('\n"Analyze All" renders on a single-FAIL run (T-671)');

const eligibleInFullRun = countAiEligible(fullSesRun.results);
assertEq(
  'the full SES run (post-never-fail-policy) has EXACTLY ONE AI-eligible (fail) check — this is Allan\'s exact repro',
  eligibleInFullRun,
  1,
);
assert(
  'BUG (pre-T-671): the old ">= 2" threshold would have hidden Analyze All on this exact run',
  eligibleInFullRun < 2,
);
assert(
  'FIXED: shouldShowAnalyzeAll() renders true on the real single-FAIL orchestrator output',
  shouldShowAnalyzeAll(fullSesRun.results) === true,
);
assertEq('MIN_AI_ELIGIBLE_FOR_ANALYZE_ALL is 1 (not 2)', MIN_AI_ELIGIBLE_FOR_ANALYZE_ALL, 1);

// Synthetic case, spelled out explicitly per the task ask: exactly one fail
// plus several pass/warning/na, asserted against the same shared predicate
// both AnalyzeAllButton.tsx and App.tsx's sidebar trigger call.
const singleFailMixedResults: CheckResult[] = [
  { checkId: 1, checkName: 'A', status: 'pass', stats: '', flaggedCount: 0, flaggedRows: [] },
  { checkId: 2, checkName: 'B', status: 'warning', stats: '', flaggedCount: 1, flaggedRows: [{}] },
  { checkId: 3, checkName: 'C', status: 'na', stats: '', flaggedCount: 0, flaggedRows: [] },
  { checkId: 4, checkName: 'D', status: 'fail', stats: '', flaggedCount: 1, flaggedRows: [{}] },
  { checkId: 5, checkName: 'E', status: 'warning', stats: '', flaggedCount: 1, flaggedRows: [{}] },
];
assertEq('synthetic mix has exactly one AI-eligible check', countAiEligible(singleFailMixedResults), 1);
assert(
  'shouldShowAnalyzeAll(...) is true for "one fail + several pass/warning/na" — both AnalyzeAllButton.tsx and App.tsx\'s sidebar gate derive from this exact call',
  shouldShowAnalyzeAll(singleFailMixedResults) === true,
);
assert(
  'a run with ZERO eligible checks still correctly does NOT show Analyze All',
  shouldShowAnalyzeAll(singleFailMixedResults.filter((r) => r.status !== 'fail')) === false,
);

// ═══════════════════════════════════════════════════════════════════════════
// T-675 — header/row-width parity (the Allan-visible column-shift bug)
// ═══════════════════════════════════════════════════════════════════════════
//
// Allan's screenshot: Check 3's table rendered employee IDs under the
// PUNCHHRS header, every value shifted one column right, plus an extra
// unlabeled trailing column. Root cause: the summary ('— TOTAL —') row never
// carried associateId while per-person rows did (T-672 added it only to the
// latter) — 7 header keys (from row 0, the summary) against 8 values per
// person row. Two independent fixes, both tested here: (1)
// check03SesThreeWayRecon now gives every row — summary included — the exact
// same key set in the exact same order; (2) unionFlaggedRowColumns (the
// shared helper all four render sites now use) derives headers from every
// row, not just row 0, so even a genuinely shape-divergent check (see part B)
// renders correctly.

// ── Test 8a: check03's real output has uniform row shape (summary === detail) ──

console.log('\nCheck 3 (SES) — row-shape parity across summary and detail rows (T-675)');

const parityDetailRows: LaborRow[] = [
  // Gwen: no associateId anywhere — normKey falls back to name matching,
  // same as before T-672. Her row must still carry a real (blank) associateId
  // key, not have it omitted.
  invoiceRow('', 'Gwen Galloway', 20.00, 'Work'),
  // Henry: real associateId on every source, like check03 emits for a normal
  // ID-matched associate.
  invoiceRow('H1', 'Henry Holt', 10.00, 'Work'),
];
const parityPunchRows: SesPunchRow[] = [
  punchRow('', 'Gwen Galloway', 15.00, 'Work'),
  punchRow('H1', 'Henry Holt', 10.00, 'Work'),
];
const parityShiftRows: ShiftRow[] = [
  shiftRow('', 'Gwen Galloway', 15.00),
  shiftRow('H1', 'Henry Holt', 5.00),
];

const parityRes = check03SesThreeWayRecon(parityDetailRows, parityPunchRows, parityShiftRows);
assertEq('parity fixture status is fail (total variance exceeds tolerance)', parityRes.status, 'fail');
assertEq('parity fixture flags both associates', parityRes.flaggedCount, 2);
assertEq('parity fixture has 3 flagged rows (TOTAL + Gwen + Henry)', parityRes.flaggedRows.length, 3);

const parityColumns = unionFlaggedRowColumns(parityRes.flaggedRows);
assert(
  'associateId is a real column, positioned immediately after associate (Allan/Bragi decision)',
  parityColumns[0] === 'associate' && parityColumns[1] === 'associateId',
  `got [${parityColumns.slice(0, 2).join(', ')}]`,
);

// The actual regression: every row — including the summary — has EXACTLY the
// same key count as the union column list. Pre-fix, the summary row had 7
// keys against detail rows' 8, so this would fail with 7 !== 8.
for (const row of parityRes.flaggedRows) {
  assertEq(
    `row "${row.associate}" has exactly ${parityColumns.length} keys (== column count, no misalignment)`,
    Object.keys(row).length,
    parityColumns.length,
  );
}

const HOURS_RE = /^-?\d+\.\d{2}$/;
const gwenParityRow = parityRes.flaggedRows.find((r) => r.associate === 'Gwen Galloway');
const henryParityRow = parityRes.flaggedRows.find((r) => r.associate === 'Henry Holt');
const totalParityRow = parityRes.flaggedRows.find((r) => r.associate === '— TOTAL —');

assertEq('Gwen (no ID anywhere) has a blank associateId — never omitted, never guessed', gwenParityRow?.associateId, '');
assertEq('Henry has his real associateId', henryParityRow?.associateId, 'H1');
assertEq('summary row also has a blank associateId (same key, same position as detail rows)', totalParityRow?.associateId, '');

// The literal bug Allan saw: an ID rendered where PUNCHHRS should be. Prove
// the column at the associateId position is never an hours-shaped value for
// Henry, and the column at the punchHrs position is never his ID.
assert(
  "Henry's associateId column holds his ID, not an hours value",
  henryParityRow?.associateId === 'H1' && !HOURS_RE.test(String(henryParityRow?.associateId)),
);
assert(
  "Henry's punchHrs column holds real hours, not his associateId",
  HOURS_RE.test(String(henryParityRow?.punchHrs)) && henryParityRow?.punchHrs !== 'H1',
);

// ── Test 8b: unionFlaggedRowColumns handles a genuinely shape-divergent check ──
//
// Not a check03 fixture — a synthetic stand-in for the OTHER real instance
// found in the T-675 blast-radius sweep: check07_otApproval.ts's `allDetails`
// concatenates blanketApproved/tabApproved/flagged rows that differ in
// exactly this way (blanketApproved has no `severity`, tabApproved has no
// `approved`/`issue`, only `flagged` has all three). Proves the render-layer
// fix covers that class of bug generically, without needing a per-check fix.

console.log('\nunionFlaggedRowColumns — genuinely shape-divergent rows (T-675, generic defect class)');

const heterogeneousRows: Record<string, unknown>[] = [
  { section: 'blanket', rowKey: 'A', associateId: 'X1', name: 'Foo Fillerson', hours: '5.00', tier: 'Blanket', status: 'blanket', issue: 'blanket-approved' },
  { section: 'tabApproved', rowKey: 'B', associateId: 'X2', name: 'Bar Blankerson', hours: '6.00', tier: 'Needs DL Approval', status: 'tab_approved', severity: 'orange' },
  { section: 'flagged', rowKey: 'C', associateId: 'X3', name: 'Baz Bazerson', hours: '7.00', tier: 'Needs Exec Approval', status: 'none', severity: 'red', approved: false, issue: 'no match' },
];

const heteroColumns = unionFlaggedRowColumns(heterogeneousRows);
assertEq(
  'union columns = first-seen union across ALL rows (8 from row 0 + severity from row 1 + approved from row 2 = 10)',
  heteroColumns.length,
  10,
);
assert('row-0-only derivation (the pre-fix bug) would have UNDER-counted the columns', Object.keys(heterogeneousRows[0]).length < heteroColumns.length);

// Simulate the actual render (header = heteroColumns, each cell = row[col] ?? placeholder)
// and confirm every cell lands under its own header — the fix that replaced
// Object.entries(row) (row's OWN key order) at all four render sites.
const severityIdx = heteroColumns.indexOf('severity');
const approvedIdx = heteroColumns.indexOf('approved');
const issueIdx = heteroColumns.indexOf('issue');
assert('blanket row (no severity key) renders blank at the severity column, not a shifted value', heterogeneousRows[0][heteroColumns[severityIdx]] === undefined);
assert('tabApproved row (no approved/issue keys) renders blank at both, not shifted values', heterogeneousRows[1][heteroColumns[approvedIdx]] === undefined && heterogeneousRows[1][heteroColumns[issueIdx]] === undefined);
assert('flagged row (has every key) renders its real severity/approved/issue values under the right headers', heterogeneousRows[2][heteroColumns[severityIdx]] === 'red' && heterogeneousRows[2][heteroColumns[approvedIdx]] === false && heterogeneousRows[2][heteroColumns[issueIdx]] === 'no match');

// ── Test 8c: no render site may derive headers from row 0 (T-675, Vera gate) ──
//
// Test 8b proves the HELPER is correct. It does not prove every render site
// USES it — and at the T-675 gate one did not: CheckCard.tsx's Check-7 verdict
// table was still on `Object.keys(actionableRows[0])` + `Object.entries(row)`,
// the exact pattern the rest of T-675 removed. It was safe only incidentally
// (its filter narrows check07's flaggedRows to the single homogeneous
// `flagged[]` array, and HIDDEN_COLS hides the keys that diverge), so nothing
// structural would have caught it drifting back.
//
// This is the same "a correct copy is still a copy" guard scopeParity.fixture
// applies to the Check-3 scope predicates: assert against the SOURCE that no
// flaggedRows-rendering module re-derives columns locally. Grepping source is
// deliberate — it fails when someone reintroduces the pattern, not merely when
// a specific check's data happens to expose it.

console.log('\nRender-site drift guard — no local row-0 header derivation (T-675)');

const RENDER_SITES = [
  'components/CheckCard.tsx',
  'components/DownloadReport.tsx',
  'components/DownloadPDF.tsx',
];

// `Object.keys(<anything>[0])` — header derivation from a single row.
const ROW0_HEADER_RE = /Object\.keys\(\s*[A-Za-z_$][\w$.]*\s*\[\s*0\s*\]\s*\)/;
// `Object.entries(row)` / `Object.entries(r)` — cell rendering in the row's
// OWN key order rather than by indexing the shared column list.
const ROW_ENTRIES_RE = /Object\.entries\(\s*(?:row|r)\s*\)/;

/**
 * Strip comments so the guard matches CODE, not prose. Without this, the very
 * comment explaining the banned pattern trips the guard that bans it (caught
 * on this fixture's first run). Removes block comments (incl. JSX `{/* … *\/}`)
 * and whole-line `//` / ` * ` comment lines; deliberately does NOT strip
 * trailing `//` comments, which would risk mangling string literals like
 * "https://…" — a banned pattern hiding in a trailing comment is not a
 * realistic drift mode, whereas a comment block describing it demonstrably is.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

for (const rel of RENDER_SITES) {
  const raw = readFileSync(join(FIXTURE_SRC_ROOT, rel), 'utf8');
  const src = stripComments(raw);
  assert(
    `${rel} imports the shared unionFlaggedRowColumns helper`,
    /import\s*\{[^}]*unionFlaggedRowColumns[^}]*\}\s*from\s*['"][^'"]*tableColumns['"]/.test(src),
  );
  assert(
    `${rel} has NO row-0 header derivation (Object.keys(x[0]))`,
    !ROW0_HEADER_RE.test(src),
    'Derive columns with unionFlaggedRowColumns(rows) instead of Object.keys(rows[0]).',
  );
  assert(
    `${rel} has NO per-row Object.entries() cell rendering`,
    !ROW_ENTRIES_RE.test(src),
    'Render cells by indexing the shared column list (row[col] ?? placeholder), not the row\'s own key order.',
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
