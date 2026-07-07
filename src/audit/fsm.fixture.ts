// fsm.fixture.ts — standalone Node.js fixture test harness for FSM audit Checks 16 & 17
// Run with: npx tsx src/audit/fsm.fixture.ts
//
// All fixtures are in-memory only — no real invoice files, no Neon writes, no postRun().
// Exit code: 0 = all assertions passed; 1 = one or more assertions failed.

// ── Browser API shim ──────────────────────────────────────────────────────────

const store: Record<string, string> = {};
(global as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
} as Storage;

// ── Now safe to import audit modules ──────────────────────────────────────────

import { check01Labor } from './checks/check01_labor.js';
import { check16RiSundayPremium } from './checks/check16_riSundayPremium.js';
import { check17OtMath } from './checks/check17_otMath.js';
import { check19RosterTab } from './checks/check19_rosterTab.js';
import type { LaborRow, RosterEntry } from './types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<LaborRow> & { comments: string; timeHours: number }): LaborRow {
  const defaults: LaborRow = {
    sheet: 'FSM II Merit',
    rowNum: 1,
    employeeName: 'Test Associate',
    associateId: 'TA001',
    associateType: 'FSM II',
    timeHours: 0,
    basePayRate: 36.57,
    muValue: 10.945,
    billValue: 0,
    loadedRate: 0,
    associateState: 'TX',
    comments: '',
    visitDate: null,
    week: 25,
    clientStoreId: 'S001',
  };
  return { ...defaults, ...overrides };
}

let totalPass = 0;
let totalFail = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    totalPass++;
  } else {
    const msg = detail ? `${label} — ${detail}` : label;
    console.log(`  FAIL  ${msg}  <<< ASSERTION FAILURE`);
    totalFail++;
    failures.push(msg);
  }
}

// ── REAL_LABELED_CASE: Robert Selema — FSM26-W25-26, RS1202C, June 28 2026 ──
// Source: decision log DL-2026-0706b-ri-sunday-retail-exclusion (pka.db note 41)
// Ground truth: 42.97 total eligible hours, 10.79 Sunday RI hours, 0h OT, 10.79h premium.
// associateState='RI' (real invoice value — isRhodeIsland() must handle 'ri').
// REAL invoice values (RS1202C, 6/28/2026): the premium row is built from the
// CENT-ROUNDED half-rate (36.57/2 = 18.285 → 18.29) with markup applied to that
// rounded rate, so premium muValue = 18.29 × 0.2993 = 5.474197 — NOT exactly
// base.muValue/2 (5.4727005). This exercises the half-cent×markup rounding drift
// that the MU_TOLERANCE buffer absorbs (would have false-flagged at the old ±0.001).

console.log('\n=== REAL_LABELED_CASE: Robert Selema (RS1202C, FSM26-W25-26, 2026-06-28) ===');

const sundayDate = new Date(2026, 5, 28); // June 28 2026 — Sunday (getDay()===0)
const mondayDate = new Date(2026, 5, 22); // June 22 2026 — Monday

// Base rows: 4 Sunday eligible rows (0.52 + 7.87 + 2.00 + 0.40 = 10.79h Sunday)
// Plus Mon–Sat rows to reach 42.97 total (42.97 − 10.79 = 32.18h non-Sunday)
const robertBase: LaborRow[] = [
  makeRow({ associateId: 'RS1202C', employeeName: 'Robert Selema', associateState: 'RI', visitDate: sundayDate, comments: 'Work',    timeHours: 0.52, basePayRate: 36.57, muValue: 10.945401, rowNum: 10 }),
  makeRow({ associateId: 'RS1202C', employeeName: 'Robert Selema', associateState: 'RI', visitDate: sundayDate, comments: 'Travel',  timeHours: 7.87, basePayRate: 36.57, muValue: 10.945401, rowNum: 11 }),
  makeRow({ associateId: 'RS1202C', employeeName: 'Robert Selema', associateState: 'RI', visitDate: sundayDate, comments: 'Meeting', timeHours: 2.00, basePayRate: 36.57, muValue: 10.945401, rowNum: 12 }),
  makeRow({ associateId: 'RS1202C', employeeName: 'Robert Selema', associateState: 'RI', visitDate: sundayDate, comments: 'Travel',  timeHours: 0.40, basePayRate: 36.57, muValue: 10.945401, rowNum: 13 }),
  // Non-Sunday rows (Mon–Sat) totaling 32.18h — does not trigger OT (32.18 < 40)
  makeRow({ associateId: 'RS1202C', employeeName: 'Robert Selema', associateState: 'RI', visitDate: mondayDate, comments: 'Work',    timeHours: 32.18, basePayRate: 36.57, muValue: 10.945401, rowNum: 14 }),
];

// Matching premium rows — REAL invoice values: 'RI Sunday Premium Pay', basePayRate=18.29
// (36.57/2 = 18.285 cent-rounded up), muValue=5.474197 (18.29 × 0.2993, markup on the
// rounded rate — NOT 10.945401/2 = 5.4727005). Exercises the MU_TOLERANCE rounding buffer.
const robertPremium: LaborRow[] = [
  makeRow({ associateId: 'RS1202C', employeeName: 'Robert Selema', associateState: 'RI', visitDate: sundayDate, comments: 'RI Sunday Premium Pay', timeHours: 0.52, basePayRate: 18.29, muValue: 5.474197, rowNum: 20 }),
  makeRow({ associateId: 'RS1202C', employeeName: 'Robert Selema', associateState: 'RI', visitDate: sundayDate, comments: 'RI Sunday Premium Pay', timeHours: 7.87, basePayRate: 18.29, muValue: 5.474197, rowNum: 21 }),
  makeRow({ associateId: 'RS1202C', employeeName: 'Robert Selema', associateState: 'RI', visitDate: sundayDate, comments: 'RI Sunday Premium Pay', timeHours: 2.00, basePayRate: 18.29, muValue: 5.474197, rowNum: 22 }),
  makeRow({ associateId: 'RS1202C', employeeName: 'Robert Selema', associateState: 'RI', visitDate: sundayDate, comments: 'RI Sunday Premium Pay', timeHours: 0.40, basePayRate: 18.29, muValue: 5.474197, rowNum: 23 }),
];

const robertRows = [...robertBase, ...robertPremium];

const r16robert = check16RiSundayPremium([], robertRows);
const r17robert = check17OtMath([], robertRows);

console.log(`  Check16 status=${r16robert.status} stats="${r16robert.stats}"`);
console.log(`  Check17 status=${r17robert.status} stats="${r17robert.stats}"`);

assert('Robert — Check16 pass', r16robert.status === 'pass', `got status=${r16robert.status}`);
assert('Robert — Check17 pass', r17robert.status === 'pass', `got status=${r17robert.status}`);

// Verify zero unrecognized-type warnings on Robert's data.
const unrecognizedWarnings = (r17robert.flaggedRows ?? []).filter(
  (row) => (row as Record<string, unknown>).section === 'Warning — Unrecognized Time Type',
);
assert('Robert — zero unrecognized-type warnings', unrecognizedWarnings.length === 0,
  `got ${unrecognizedWarnings.length} unrecognized-type warning(s)`);

// Verify OT math: 42.97 total, 10.79 Sunday → expectedOt = max(0, 32.18 − 40) = 0
// Check17 must not have nonCaPr failure for Robert.
const robertOtFailures = (r17robert.flaggedRows ?? []).filter(
  (row) => {
    const r = row as Record<string, unknown>;
    return r.section === 'OT Math Validation — Non-CA/PR' &&
           (r.employeeName as string)?.toLowerCase().includes('robert selema');
  },
);
assert('Robert — expectedOt=0 (Sunday excluded from OT base)', robertOtFailures.length === 0,
  `got ${robertOtFailures.length} OT failure(s) for Robert Selema`);

// Verify RI Sunday premium assertion: invoicedRiPremHrs ≈ 10.79
const robertPremFailures = (r17robert.flaggedRows ?? []).filter(
  (row) => {
    const r = row as Record<string, unknown>;
    return r.section === 'OT Math Validation — RI Sunday Premium' &&
           (r.employeeName as string)?.toLowerCase().includes('robert selema');
  },
);
assert('Robert — invoicedRiPremHrs ≈ sundayRiEligibleHrs (10.79)', robertPremFailures.length === 0,
  `got ${robertPremFailures.length} RI premium assertion failure(s) for Robert Selema`);

// Check 1 regression: with FSM II Merit configured to 36.57, the RI Sunday Premium Pay
// rows carry the half-rate (18.29) and previously false-flagged Check 1's configured-rate
// check ("Base rate $18.29 does not match configured FSM II Merit rate $36.57"). They are
// now excluded from the rate check (like Paid Holiday / Time Off / Termed PTO rows).
localStorage.setItem('fsm-audit-rules', JSON.stringify({ hourlyRates: { fsmIIMerit: 36.57 } }));
const r1robert = check01Labor([], robertRows);
const robertRateFlags = (r1robert.flaggedRows ?? []).filter(
  (row) => typeof (row as Record<string, unknown>).rateIssue === 'string',
);
localStorage.removeItem('fsm-audit-rules');
assert('Robert — Check1 no RI-premium rate false-positive', robertRateFlags.length === 0,
  `got ${robertRateFlags.length} rate flag(s): ${JSON.stringify(robertRateFlags.map((r) => (r as Record<string, unknown>).rateIssue))}`);


// ── SYNTHETIC: Check 19 Roster Tab Placement ─────────────────────────────────
// Matches labor Associate ID → FSM Roster Col F, compares labor tab to Col E program.
// Roster's hyphenated 'FSM I-Merit' must match the 'FSM I Merit' tab (canonical compare).
// IDs absent from the roster are skipped here (Check 8 owns "not on roster").
console.log('\n=== SYNTHETIC: Check 19 Roster Tab Placement ===');

const tabRoster: RosterEntry[] = [
  { name: 'Correct One',   associateId: 'C0001I', type: 'FT', program: 'FSM I' },
  { name: 'Merit Hyphen',  associateId: 'M0002I', type: 'FT', program: 'FSM I-Merit' },   // hyphen ↔ 'FSM I Merit' tab
  { name: 'Wrong Tab',     associateId: 'W0003I', type: 'FT', program: 'FSM II' },          // roster=II, billed on II Merit
  { name: 'Merit Two',     associateId: 'T0004I', type: 'FT', program: 'FSM II-Merit' },
];
const tabLabor: LaborRow[] = [
  makeRow({ associateId: 'C0001I', employeeName: 'Correct One',   sheet: 'FSM I',        comments: 'Work', timeHours: 8 }),
  makeRow({ associateId: 'M0002I', employeeName: 'Merit Hyphen',  sheet: 'FSM I Merit',  comments: 'Work', timeHours: 8 }),
  makeRow({ associateId: 'W0003I', employeeName: 'Wrong Tab',     sheet: 'FSM II Merit', comments: 'Work', timeHours: 8 }), // WRONG
  makeRow({ associateId: 'T0004I', employeeName: 'Merit Two',     sheet: 'FSM II Merit', comments: 'Work', timeHours: 8 }),
  makeRow({ associateId: 'NOROST', employeeName: 'Not On Roster', sheet: 'FSM II Merit', comments: 'Work', timeHours: 8 }), // skip (Check 8)
];
const r19 = check19RosterTab(tabLabor, [], tabRoster);
console.log(`  Check19 status=${r19.status} stats="${r19.stats}"`);
const r19Ids = (r19.flaggedRows ?? []).map((f) => (f as Record<string, unknown>).associateId);
assert('Check19 — flags exactly the one wrong-tab rep', r19.flaggedCount === 1 && r19Ids[0] === 'W0003I',
  `got flaggedCount=${r19.flaggedCount}, ids=${JSON.stringify(r19Ids)}`);
assert('Check19 — hyphenated FSM I-Merit matches FSM I Merit tab (no false flag)', !r19Ids.includes('M0002I'),
  `M0002I was wrongly flagged`);
assert('Check19 — not-on-roster ID skipped (Check 8 owns it)', !r19Ids.includes('NOROST'),
  `NOROST was wrongly flagged`);
assert('Check19 — status fail when a misplacement exists', r19.status === 'fail',
  `got status=${r19.status}`);


// ── SYNTHETIC: Missing premium row ──────────────────────────────────────────
// One RI Sunday base row, zero premium rows → Check16 fail, FLAG_MISSING_PREMIUM

console.log('\n=== SYNTHETIC: Missing premium row ===');

const missingPremRows: LaborRow[] = [
  makeRow({ associateId: 'MP001', employeeName: 'Missing Premium Test', associateState: 'RI',
            visitDate: sundayDate, comments: 'Work', timeHours: 4.0, basePayRate: 30.00, muValue: 9.00, rowNum: 1 }),
];

const r16missing = check16RiSundayPremium([], missingPremRows);
console.log(`  Check16 status=${r16missing.status} flaggedCount=${r16missing.flaggedCount}`);
if (r16missing.flaggedRows.length > 0) {
  console.log(`  First finding: section=${r16missing.flaggedRows[0].section}`);
}

assert('Missing premium — Check16 fail', r16missing.status === 'fail',
  `got status=${r16missing.status}`);
assert('Missing premium — section=FLAG_MISSING_PREMIUM',
  r16missing.flaggedRows.some((row) => row.section === 'FLAG_MISSING_PREMIUM'),
  `flaggedRows sections: ${r16missing.flaggedRows.map((r) => r.section).join(', ')}`);


// ── SYNTHETIC: Retail Sunday exclusion math — 3 variants ──────────────────
// 50h total: 45h Mon–Sat eligible, 5h Sunday RI eligible.
// Correct invoice: 5h OT + 5h RI Sunday Premium → both assertions PASS.
// Wrong variant A: 10h OT + 0h premium (Sunday hours converted to OT) → Check17 FAIL.
// Wrong variant B: OT computed on full 50h (Sunday not excluded), 5h OT + 5h premium → Check17 FAIL.

console.log('\n=== SYNTHETIC: Retail Sunday exclusion math (3 variants) ===');

// All these rows belong to the same employee-week.
// Week starts Mon June 22; Sunday June 28 = sundayDate.
// Mon rows: 45h eligible (non-Sunday)
// Sunday: 5h base + 5h premium

function makeExclusionRows(opts: {
  otHrs: number;       // 'Overtime' row hours (0 if none)
  premHrs: number;     // 'RI Sunday Premium Pay' row hours (0 if none)
  fullOtBase?: boolean; // if true: OT computed on full 50h, give 10h OT row
}): LaborRow[] {
  const rows: LaborRow[] = [
    // Mon–Sat: 45h eligible
    makeRow({ associateId: 'EX001', employeeName: 'Exclusion Test', associateState: 'RI',
              visitDate: mondayDate, comments: 'Work', timeHours: 45, basePayRate: 30.00, muValue: 9.00, rowNum: 1 }),
    // Sunday: 5h base
    makeRow({ associateId: 'EX001', employeeName: 'Exclusion Test', associateState: 'RI',
              visitDate: sundayDate, comments: 'Work', timeHours: 5, basePayRate: 30.00, muValue: 9.00, rowNum: 2 }),
  ];
  if (opts.premHrs > 0) {
    rows.push(
      makeRow({ associateId: 'EX001', employeeName: 'Exclusion Test', associateState: 'RI',
                visitDate: sundayDate, comments: 'RI Sunday Premium Pay', timeHours: opts.premHrs,
                basePayRate: 15.00, muValue: 4.50, rowNum: 3 }),
    );
  }
  if (opts.otHrs > 0) {
    // OT row — date = Monday (week boundary)
    rows.push(
      makeRow({ associateId: 'EX001', employeeName: 'Exclusion Test', associateState: 'RI',
                visitDate: mondayDate, comments: 'Overtime', timeHours: opts.otHrs,
                basePayRate: 15.00, muValue: 4.50, rowNum: 4 }),
    );
  }
  return rows;
}

// Variant A (correct): 5h OT + 5h premium → PASS
// expectedOt = max(0, (50 − 5) − 40) = 5; invoicedOtHrs = 5 ✓
// invoicedRiPremHrs = 5; sundayRiEligibleHrs = 5 ✓
const variantCorrectRows = makeExclusionRows({ otHrs: 5, premHrs: 5 });
const r17correct = check17OtMath([], variantCorrectRows);
console.log(`  Variant correct (5h OT + 5h prem): Check17 status=${r17correct.status} stats="${r17correct.stats}"`);
assert('Exclusion math — correct variant PASS', r17correct.status === 'pass',
  `got status=${r17correct.status}`);

// Variant B (wrong): 10h OT + 0h premium (Sunday hours converted to OT, not excluded) → FAIL
// expectedOt = max(0, (50 − 5) − 40) = 5; invoicedOtHrs = 10 → |10 − 5| = 5 > 0.05 → FAIL
const variantWrongARows = makeExclusionRows({ otHrs: 10, premHrs: 0 });
const r17wrongA = check17OtMath([], variantWrongARows);
console.log(`  Variant wrong-A (10h OT + 0h prem): Check17 status=${r17wrongA.status} stats="${r17wrongA.stats}"`);
assert('Exclusion math — wrong-A (Sunday→OT) FAIL', r17wrongA.status === 'fail',
  `got status=${r17wrongA.status}`);

// Variant C (wrong): OT computed on full 50h → expectedOt=10, but billed 5h OT + 5h premium → FAIL
// invoicedOtHrs = 5; expectedOt = 5 (correct per exclusion) — wait, we need to test "sunday not excluded"
// To test the "Sunday not excluded" case from the invoice side: invoice has 10h OT + 5h premium
// Check17: expectedOt = max(0, (50-5)-40) = 5; invoicedOtHrs = 10 → FAIL (over-billed OT)
// (This is equivalent to: biller forgot Sunday exclusion, computed OT on 50h = 10h, plus kept 5h premium)
const variantWrongBRows = makeExclusionRows({ otHrs: 10, premHrs: 5 });
const r17wrongB = check17OtMath([], variantWrongBRows);
console.log(`  Variant wrong-B (10h OT + 5h prem, Sunday not excluded): Check17 status=${r17wrongB.status} stats="${r17wrongB.stats}"`);
assert('Exclusion math — wrong-B (Sunday not excluded) FAIL', r17wrongB.status === 'fail',
  `got status=${r17wrongB.status}`);


// ── SYNTHETIC: Orphan premium row ───────────────────────────────────────────
// Premium row with no matching base row → Check16 fail, FLAG_ORPHAN_PREMIUM

console.log('\n=== SYNTHETIC: Orphan premium row ===');

const orphanRows: LaborRow[] = [
  makeRow({ associateId: 'OP001', employeeName: 'Orphan Premium Test', associateState: 'RI',
            visitDate: sundayDate, comments: 'RI Sunday Premium Pay',
            timeHours: 3.0, basePayRate: 15.00, muValue: 4.50, rowNum: 1 }),
];

const r16orphan = check16RiSundayPremium([], orphanRows);
console.log(`  Check16 status=${r16orphan.status} flaggedCount=${r16orphan.flaggedCount}`);
if (r16orphan.flaggedRows.length > 0) {
  console.log(`  First finding: section=${r16orphan.flaggedRows[0].section}`);
}

assert('Orphan premium — Check16 fail', r16orphan.status === 'fail',
  `got status=${r16orphan.status}`);
assert('Orphan premium — section=FLAG_ORPHAN_PREMIUM',
  r16orphan.flaggedRows.some((row) => row.section === 'FLAG_ORPHAN_PREMIUM'),
  `flaggedRows sections: ${r16orphan.flaggedRows.map((r) => r.section).join(', ')}`);


// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log('FIXTURE SUMMARY');
console.log('='.repeat(60));
console.log(`Pass:  ${totalPass}`);
console.log(`Fail:  ${totalFail}`);

if (failures.length > 0) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log('\nFIXTURE RESULT: FAIL');
  process.exitCode = 1;
} else {
  console.log('\nFIXTURE RESULT: ALL ASSERTIONS PASSED');
}
