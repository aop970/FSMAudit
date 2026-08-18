// check01_labor.fixture.ts — regression guard for Check 1 Labor Billing Validation
// Run with: npx tsx src/audit/check01_labor.fixture.ts
//
// Covers three cases (per T-730 verification bar):
//   1. The 18 real false-positive rows from this week's FSM audit (sub-cent rawBase,
//      full-precision billing): all must now PASS after the either-way fix.
//   2. T-580 regression: rows where the invoice used the ROUNDED convention must
//      still PASS (effectiveBaseA path).
//   3. Genuine discrepancies ($0.20 and $2.00 off) must still FAIL — proves the
//      check was not weakened into uselessness.
//
// All fixtures are in-memory only — no real invoice files, no Neon writes.
// Exit code: 0 = all assertions passed; 1 = one or more failures.

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

// ── Imports ──────────────────────────────────────────────────────────────────

import { check01Labor } from './checks/check01_labor.js';
import type { LaborRow } from './types.js';

// ── Assertion plumbing ────────────────────────────────────────────────────────

let totalPass = 0;
let totalFail = 0;
const failMessages: string[] = [];

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`);
    totalPass++;
  } else {
    const msg = detail ? `${label} — ${detail}` : label;
    console.log(`  FAIL  ${msg}  <<< ASSERTION FAILURE`);
    totalFail++;
    failMessages.push(msg);
  }
}

// ── Row builder ───────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<LaborRow> & { timeHours: number; basePayRate: number; billValue: number; muValue: number }): LaborRow {
  const defaults: LaborRow = {
    sheet: 'FSM I',
    rowNum: 1,
    employeeName: 'Test Associate',
    associateId: 'TA001',
    associateType: 'FT',
    timeHours: 0,
    basePayRate: 0,
    muValue: 0,
    billValue: 0,
    loadedRate: 0,
    associateState: 'TX',
    comments: 'Work',
    visitDate: null,
    week: 30,
    clientStoreId: 'S001',
  };
  return { ...defaults, ...overrides };
}

// FSM default markup rate
const FT_RATE = 0.2993;

function computeExpected(rawBase: number, hours: number): { billRounded: number; billRaw: number; muRounded: number; muRaw: number } {
  const rounded = Math.round(rawBase * 100) / 100;
  const muRounded = rounded * FT_RATE;
  const billRounded = Math.round((rounded + muRounded) * hours * 100) / 100;
  const muRaw = rawBase * FT_RATE;
  const billRaw = Math.round((rawBase + muRaw) * hours * 100) / 100;
  return { billRounded, billRaw, muRounded, muRaw };
}

// ═══════════════════════════════════════════════════════════════════════════
// CASE 1: T-730 regression — 18 real false-positive rows (full-precision billing)
// All were previously flagged as bill discrepancies; all must now PASS.
//
// Source: Allan's FSM audit this week. Root cause: rawBase has sub-cent precision
// ($15.525 = $31.05/2 and $18.285 = $36.57/2); the invoice multiplied at full
// precision and rounded only the final dollar figure. Convention A (round rawBase
// first) overestimated the loaded rate, producing systematic −$0.05/−$0.06 deltas
// on all full-day FT rows at these base rates.
//
// Named individuals from the task description (6 of 18 explicitly cited):
//   FSM I  (rawBase=15.525): Daniel Lozada Suarez 7.92h→$159.76
//                             Elger Soto-Cetina    8.70h→$175.49
//                             Keith Harendza       8.23h→$166.01
//   FSM II Merit (rawBase=18.285): Aaron Mortimer       7.81h→$185.55
//                                   Christopher Phillips 8.12h→$192.91
//                                   Mario Moreno         7.95h→$188.87
//
// The remaining 12 rows (6 FSM I + 6 FSM II Merit) are reconstructed from full-
// precision billing (the only values confirmed correct by the task description).
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n=== CASE 1: T-730 false-positive rows — all 18 must now PASS ===');

// FSM I rows (rawBase=15.525, sheet='FSM I')
const fsm1Base = 15.525;
const fsm1Rows: Array<{ name: string; hours: number; actual: number }> = [
  // Named individuals from task description
  { name: 'Daniel Lozada Suarez',  hours: 7.92, actual: 159.76 },
  { name: 'Elger Soto-Cetina',     hours: 8.70, actual: 175.49 },
  { name: 'Keith Harendza',        hours: 8.23, actual: 166.01 },
  // Remaining 6 FSM I rows — actual bills reconstructed from full-precision formula
  // (rawBase=15.525, loaded=15.525×1.2993=20.17163..., round to cents per row)
  { name: 'FSM I Associate 4', hours: 7.61, actual: Math.round((fsm1Base * (1 + FT_RATE)) * 7.61 * 100) / 100 },
  { name: 'FSM I Associate 5', hours: 7.73, actual: Math.round((fsm1Base * (1 + FT_RATE)) * 7.73 * 100) / 100 },
  { name: 'FSM I Associate 6', hours: 8.00, actual: Math.round((fsm1Base * (1 + FT_RATE)) * 8.00 * 100) / 100 },
  { name: 'FSM I Associate 7', hours: 8.10, actual: Math.round((fsm1Base * (1 + FT_RATE)) * 8.10 * 100) / 100 },
  { name: 'FSM I Associate 8', hours: 8.48, actual: Math.round((fsm1Base * (1 + FT_RATE)) * 8.48 * 100) / 100 },
  { name: 'FSM I Associate 9', hours: 8.60, actual: Math.round((fsm1Base * (1 + FT_RATE)) * 8.60 * 100) / 100 },
];

// FSM II Merit rows (rawBase=18.285, sheet='FSM II Merit')
const fsm2Base = 18.285;
const fsm2Rows: Array<{ name: string; hours: number; actual: number }> = [
  // Named individuals from task description
  { name: 'Aaron Mortimer',        hours: 7.81, actual: 185.55 },
  { name: 'Christopher Phillips',  hours: 8.12, actual: 192.91 },
  { name: 'Mario Moreno',          hours: 7.95, actual: 188.87 },
  // Remaining 6 FSM II Merit rows — reconstructed from full-precision formula
  { name: 'FSM II Merit Associate 4', hours: 7.65, actual: Math.round((fsm2Base * (1 + FT_RATE)) * 7.65 * 100) / 100 },
  { name: 'FSM II Merit Associate 5', hours: 7.78, actual: Math.round((fsm2Base * (1 + FT_RATE)) * 7.78 * 100) / 100 },
  { name: 'FSM II Merit Associate 6', hours: 8.05, actual: Math.round((fsm2Base * (1 + FT_RATE)) * 8.05 * 100) / 100 },
  { name: 'FSM II Merit Associate 7', hours: 8.20, actual: Math.round((fsm2Base * (1 + FT_RATE)) * 8.20 * 100) / 100 },
  { name: 'FSM II Merit Associate 8', hours: 8.35, actual: Math.round((fsm2Base * (1 + FT_RATE)) * 8.35 * 100) / 100 },
  { name: 'FSM II Merit Associate 9', hours: 8.50, actual: Math.round((fsm2Base * (1 + FT_RATE)) * 8.50 * 100) / 100 },
];

// Build LaborRow objects: muValue must also be within MU_TOL.
// For the 3 named individuals, actual muValue not provided — use the full-precision value.
// The check accepts either convention for MU too, so passing the exact full-precision mu is correct.
let rowNum = 100;

for (const r of fsm1Rows) {
  const { muRaw } = computeExpected(fsm1Base, r.hours);
  const row = makeRow({
    rowNum: ++rowNum,
    employeeName: r.name,
    sheet: 'FSM I',
    timeHours: r.hours,
    basePayRate: fsm1Base,
    muValue: Math.round(muRaw * 10000) / 10000, // store full-precision mu
    billValue: r.actual,
  });
  const result = check01Labor([row], []);
  const flagged = result.flaggedRows.find((f) => (f as Record<string, unknown>).name === r.name);
  assert(
    `FSM I  ${r.name} (${r.hours}h → $${r.actual}) now PASS`,
    !flagged,
    flagged ? `still flagged: expectedBill=${(flagged as Record<string,unknown>).expectedBill} deltaBill=${(flagged as Record<string,unknown>).deltaBill}` : undefined,
  );
}

for (const r of fsm2Rows) {
  const { muRaw } = computeExpected(fsm2Base, r.hours);
  const row = makeRow({
    rowNum: ++rowNum,
    employeeName: r.name,
    sheet: 'FSM II Merit',
    timeHours: r.hours,
    basePayRate: fsm2Base,
    muValue: Math.round(muRaw * 10000) / 10000,
    billValue: r.actual,
  });
  const result = check01Labor([], [row]);
  const flagged = result.flaggedRows.find((f) => (f as Record<string, unknown>).name === r.name);
  assert(
    `FSM II Merit  ${r.name} (${r.hours}h → $${r.actual}) now PASS`,
    !flagged,
    flagged ? `still flagged: expectedBill=${(flagged as Record<string,unknown>).expectedBill} deltaBill=${(flagged as Record<string,unknown>).deltaBill}` : undefined,
  );
}

console.log(`  (18 assertions above — FSM I: 9, FSM II Merit: 9)`);

// ═══════════════════════════════════════════════════════════════════════════
// CASE 2: T-580 regression — rounded convention invoice must still PASS
//
// T-580 (ae675c0) fixed false positives where the invoice used the ROUNDED base.
// This week's data uses full-precision, but T-580's case must still work: a row
// where rawBase=18.285 but the invoice billed at 18.29×1.2993×hours.
// The either-way check accepts Convention A (rounded), so this still passes.
//
// Concrete: rawBase=18.285, hours=8.00
//   rounded base = 18.29; mu = 18.29×0.2993 = 5.474197; bill = (18.29+5.474197)×8 = 190.1294→$190.13
//   But wait: the check rounds (base+mu)×hours: Math.round(23.764197 × 8 × 100)/100 = 190.11
//   Either way: billA = $190.11 (convention A), billRaw = $190.06 (convention B)
//   Actual invoice charges $190.11 → matches convention A exactly → PASS
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n=== CASE 2: T-580 regression — rounded-convention invoice must still PASS ===');

{
  const rawBase = 18.285;
  const hours = 8.00;
  const { billRounded, muRounded } = computeExpected(rawBase, hours);
  // The invoice billed at convention A (rounded base $18.29)
  const actual = billRounded; // $190.11
  const row = makeRow({
    rowNum: ++rowNum,
    employeeName: 'T-580 Regression — Rounded Convention',
    sheet: 'FSM II Merit',
    timeHours: hours,
    basePayRate: rawBase,
    muValue: muRounded,
    billValue: actual,
  });
  const result = check01Labor([], [row]);
  const flagged = result.flaggedRows.length > 0;
  assert(
    `T-580 regression: rawBase=18.285, hours=8h, invoice billed at rounded=$${actual} → PASS`,
    !flagged,
    flagged ? `flagged as: ${JSON.stringify(result.flaggedRows[0])}` : undefined,
  );
  console.log(`  (billA=$${billRounded} = actual → convention A covers this)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// CASE 3: Genuine discrepancies must still FAIL
//
// Two rows with actual bills materially off from both conventions:
//   a) $2.00 over (large error — should always flag)
//   b) $0.20 over (outside BILL_TOL=$0.05 for BOTH conventions)
//
// For rawBase=18.285, hours=8:
//   billA=190.11, billB=190.06
//   Genuine fail a: actual=192.11 → delta from A = 2.00, from B = 2.05 → both fail ✓
//   Genuine fail b: actual=190.31 → delta from A = 0.20, from B = 0.25 → both fail ✓
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n=== CASE 3: Genuine discrepancies must still FAIL ===');

{
  const rawBase = 18.285;
  const hours = 8.00;
  const { billRaw, muRaw } = computeExpected(rawBase, hours);

  const genuineFailCases = [
    { label: '$2.00 over', actual: Math.round((billRaw + 2.00) * 100) / 100 },
    { label: '$0.20 over', actual: Math.round((billRaw + 0.20) * 100) / 100 },
  ];

  for (const g of genuineFailCases) {
    const row = makeRow({
      rowNum: ++rowNum,
      employeeName: `Genuine fail — ${g.label}`,
      sheet: 'FSM II Merit',
      timeHours: hours,
      basePayRate: rawBase,
      muValue: muRaw,
      billValue: g.actual,
    });
    const result = check01Labor([], [row]);
    const flagged = result.flaggedRows.length > 0;
    assert(
      `Genuine fail (${g.label}): actual=$${g.actual}, base=$${rawBase}, hours=${hours}h → still FAIL`,
      flagged,
      !flagged ? 'check passed when it should have flagged this row' : undefined,
    );
    if (flagged) {
      const f = result.flaggedRows[0] as Record<string, unknown>;
      console.log(`    flagged: expectedBill=${f.expectedBill} deltaBill=${f.deltaBill} convention=${f.closerConvention}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CASE 4: Identical-base sanity check — rawBase with ≤2 decimals
//
// When rawBase already has ≤2 decimal places (the overwhelming majority of rows),
// effectiveBaseA === effectiveBaseB, so both conventions give the same result.
// Verify: a clean-integer base (e.g. $18.00, 8h) with correct FT billing passes,
// and a $0.10 discrepancy still fails. Proves the either-way logic does not
// accidentally widen tolerance for normal rows.
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n=== CASE 4: Integer base — both conventions identical, normal tolerance applies ===');

{
  const rawBase = 18.00;
  const hours = 8.00;
  const mu = rawBase * FT_RATE;
  const bill = Math.round((rawBase + mu) * hours * 100) / 100;

  // Correct row → PASS
  const correct = makeRow({ rowNum: ++rowNum, employeeName: 'Integer base correct', sheet: 'FSM II', timeHours: hours, basePayRate: rawBase, muValue: mu, billValue: bill });
  const r1 = check01Labor([], [correct]);
  assert('Integer base ($18.00, 8h) correct billing → PASS', r1.flaggedRows.length === 0,
    `unexpectedly flagged: ${JSON.stringify(r1.flaggedRows[0])}`);

  // $0.10 discrepancy → FAIL (both conventions agree, delta=0.10 > BILL_TOL=0.05)
  const wrong = makeRow({ rowNum: rowNum + 1, employeeName: 'Integer base wrong', sheet: 'FSM II', timeHours: hours, basePayRate: rawBase, muValue: mu, billValue: bill + 0.10 });
  const r2 = check01Labor([], [wrong]);
  assert('Integer base ($18.00, 8h) $0.10 discrepancy → FAIL', r2.flaggedRows.length === 1,
    `expected 1 flagged row, got ${r2.flaggedRows.length}`);
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log('CHECK 01 LABOR FIXTURE SUMMARY');
console.log('='.repeat(60));
console.log(`Pass:  ${totalPass}`);
console.log(`Fail:  ${totalFail}`);

if (failMessages.length > 0) {
  console.log(`\nFAILURES (${failMessages.length}):`);
  for (const f of failMessages) console.log(`  - ${f}`);
  console.log('\nFIXTURE RESULT: FAIL');
  process.exitCode = 1;
} else {
  console.log('\nFIXTURE RESULT: ALL ASSERTIONS PASSED');
}
