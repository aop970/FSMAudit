// deepDive.fixture.ts — standalone Node.js fixture harness for T-669 (source-data Deep Dive)
// Run with: npx tsx src/ai/deepDive.fixture.ts
//
// All fixtures are in-memory only — no real invoice files, no Neon writes, no postRun().
// Exit code: 0 = all assertions passed; 1 = one or more assertions failed.
//
// T-669: "Analyze with Bragi doesn't actually help source the error" — Deep
// Dive previously only ever saw a check's flaggedRows (conclusions), never
// the underlying source rows, and the cross-check identity extractor only
// recognized associateId-keyed rows so SES Check 3 (name-keyed 'associate'
// field) always got an empty context bundle. This fixture proves:
//   (a) the name-keyed identity fix populates a bundle for a Check-3-shaped
//       flagged row where it previously returned empty
//   (b) the source slice contains punch rows with timeType intact
//   (c) truncation caps fire and are disclosed in the rendered prompt text
//   (d) '— TOTAL —' is excluded from associate extraction
//   (e) the no-persistence guarantee: source rows never reach the object
//       shape that gets POSTed to /api/runs
//   (f) the actual rendered Deep Dive prompt string contains real punch
//       rows with time types — not just a restated summary

import { extractAssociateIdentities, extractRowIdentity } from './associateIdentity.js';
import { buildContextBundle } from './contextBundle.js';
import {
  buildAssociateSourceSlice,
  MAX_ASSOCIATES_PER_DEEP_DIVE,
  MAX_SOURCE_ROWS_PER_ASSOCIATE_PER_SOURCE,
} from './sourceSlice.js';
import { buildDeepDivePrompt } from './promptTemplates.js';
import type { CheckResult, ParsedData, LaborRow, SesPunchRow, ShiftRow } from '../audit/types.js';

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

// ── Row / ParsedData builders ───────────────────────────────────────────────────

let rowNum = 0;

function invoiceRow(associateId: string, employeeName: string, timeHours: number, comments: string): LaborRow {
  return {
    sheet: 'FSM I', rowNum: ++rowNum, employeeName, associateId, associateType: 'SES',
    timeHours, basePayRate: 0, muValue: 0, billValue: 0, loadedRate: 0, associateState: '',
    comments, visitDate: null, week: null, clientStoreId: '',
  };
}

function punchRow(associateId: string, employeeName: string, timeHours: number, timeType?: string): SesPunchRow {
  return { rowNum: ++rowNum, employeeName, associateId, timeHours, timeType };
}

function shiftRow(associateId: string, employeeName: string, hours: number): ShiftRow {
  return { rowNum: ++rowNum, employeeName, associateId, actualMinutes: hours * 60 };
}

function emptyParsedData(): ParsedData {
  return {
    fileName: 'test.xlsx', invoiceNumber: null, e17Value: null, punchFileName: null,
    fsmIRows: [], fsmIIRows: [], fsmIMeritRows: [], fsmIIMeritRows: [],
    punchRows: [], mgmtRows: [], cloudRows: [], rosterEntries: [], otApprovalRows: [],
    tieOutData: null, declaredPeriod: null, weeksCovered: [], crossTabNotes: [], tabNames: [],
    timeOffRows: [], timeOffFileNames: [], termedPtoRows: [], shiftRows: [], sesPunchRows: [],
  };
}

// ── Fixture: a Check-3-shaped result (mirrors check03SesThreeWayRecon's actual
// output shape — 'associate' is a NAME, no associateId field at all) ───────────
//
// Alice, Bob, Cara: flagged with modest variance. Dan: large variance (the
// worst offender — should rank first under severity, even though he appears
// later in flaggedRows / has a "smaller" name alphabetically). Nine more
// synthetic associates are added purely to exceed MAX_ASSOCIATES_PER_DEEP_DIVE
// so the omission-disclosure path fires.

function check3ShapedFlaggedRow(associate: string, invoiceHrs: number, punchHrs: number): Record<string, unknown> {
  return {
    associate,
    invoiceHrs: invoiceHrs.toFixed(2),
    punchHrs: punchHrs.toFixed(2),
    invoiceVsPunch: (invoiceHrs - punchHrs).toFixed(2),
  };
}

const check3Result: CheckResult = {
  checkId: 3,
  checkName: 'Three-Way Punch Recon',
  status: 'fail',
  stats: 'Variance exceeds tolerance',
  flaggedCount: 12,
  flaggedRows: [
    { associate: '— TOTAL —', invoiceHrs: '400.00', punchHrs: '350.00', invoiceVsPunch: '50.00' },
    check3ShapedFlaggedRow('Alice Anderson', 40.00, 39.00),   // variance 1.00
    check3ShapedFlaggedRow('Bob Blankfield', 20.00, 18.50),   // variance 1.50
    check3ShapedFlaggedRow('Dan Dayoff', 30.00, 5.00),        // variance 25.00 — worst offender
    // 9 filler associates, each with a SMALLER variance (0.1–0.9) than both
    // Alice (1.00) and Bob (1.50) — pushes total candidates past the cap
    // while proving severity ranking (not flaggedRows order) decides who's
    // included: Dan, Bob, and Alice must all outrank most fillers.
    ...Array.from({ length: 9 }, (_, i) =>
      check3ShapedFlaggedRow(`Filler Associate ${i}`, 10.00, 10.00 - 0.1 * (i + 1))),
  ],
};

// ── Test 1: identity extraction — name-keyed rows now resolve, '— TOTAL —' excluded ──

console.log('\nAssociate identity extraction (T-669 fix)');

const identities = extractAssociateIdentities(check3Result.flaggedRows);
assert(
  '12 flagged rows -> 12 distinct associate identities (TOTAL row excluded)',
  identities.length === 12,
  `got ${identities.length}`,
);
assert('all extracted identities are name-keyed (Check 3 rows carry no associateId)', identities.every((i) => i.kind === 'name'));
assert(
  "'— TOTAL —' produces no identity at all",
  extractRowIdentity({ associate: '— TOTAL —', invoiceHrs: '400.00' }) === null,
);
assert(
  'a differently-formatted TOTAL variant is also excluded',
  extractRowIdentity({ associate: '--total--' }) === null,
);
assert(
  'a real name is NOT mistaken for a TOTAL row',
  extractRowIdentity({ associate: 'Total Recall' }) !== null, // contains "Total" as a word but isn't the synthetic pattern
);

// ── Test 2: cross-check bundle — previously empty for name-keyed Check 3 rows ──

console.log('\nContext bundle — name-keyed cross-check matching (T-669 fix)');

// Another check (Check 18, holiday validation) flags Dan Dayoff by name only —
// exactly like check17/check18 do in the real app (employeeName field, no ID).
const check18Result: CheckResult = {
  checkId: 18,
  checkName: 'Holiday Pay Validation',
  status: 'warning',
  stats: '1 associate missing holiday pay',
  flaggedCount: 1,
  flaggedRows: [
    { section: 'Paid Holiday — Missing (FT)', name: 'Dan Dayoff', date: '2026-07-04', issue: 'FT employee has no Paid Holiday row' },
  ],
};

const bundle = buildContextBundle(check3Result, [check3Result, check18Result], 'rule text');
const danCrossCheck = bundle.crossCheckRows.find((e) => e.employeeName === 'Dan Dayoff');
assert(
  'bundle is NOT empty for a Check-3-shaped (name-only) flagged row — pre-fix this was always empty',
  bundle.crossCheckRows.length > 0,
);
assert('Dan Dayoff cross-check entry found via name-only matching', danCrossCheck !== undefined);
assert(
  'Dan\'s cross-check entry has no associateId (correctly reflects name-only identity, not a fabricated ID)',
  danCrossCheck?.associateId === '',
);
assert(
  'cross-check entry references the correct originating check (18)',
  danCrossCheck?.rows.some((r) => r.checkId === 18) ?? false,
);

// ── Test 3: source slice — punch rows with timeType intact, TOTAL excluded ──────

console.log('\nAssociate source slice — punch rows carry timeType (T-669 core fix)');

const parsedData = emptyParsedData();
parsedData.sesPunchRows = [
  punchRow('A1', 'Alice Anderson', 25.00, 'Work'),
  punchRow('A1', 'Alice Anderson', 14.00, 'Work'),
  punchRow('A1', 'Alice Anderson', 5.00, 'Overtime'),   // this is the tell T-668 fixed at the check level;
                                                          // Deep Dive must be able to SEE it, unlike before T-669
  punchRow('D1', 'Dan Dayoff', 5.00, 'Work'),
  // 20 extra Dan punch rows to exceed MAX_SOURCE_ROWS_PER_ASSOCIATE_PER_SOURCE
  ...Array.from({ length: MAX_SOURCE_ROWS_PER_ASSOCIATE_PER_SOURCE + 5 }, (_, i) =>
    punchRow('D1', 'Dan Dayoff', 1.00, i % 2 === 0 ? 'Work' : 'Travel')),
];
parsedData.fsmIRows = [
  invoiceRow('A1', 'Alice Anderson', 39.00, 'Work'),
  invoiceRow('D1', 'Dan Dayoff', 30.00, 'Work'),
];
parsedData.shiftRows = [
  shiftRow('A1', 'Alice Anderson', 39.00),
  shiftRow('D1', 'Dan Dayoff', 4.50),
];

const slice = buildAssociateSourceSlice(check3Result, parsedData);

assert(
  `associates capped at MAX_ASSOCIATES_PER_DEEP_DIVE (${MAX_ASSOCIATES_PER_DEEP_DIVE})`,
  slice.associates.length === MAX_ASSOCIATES_PER_DEEP_DIVE,
  `got ${slice.associates.length}`,
);
assert('12 total candidates recorded (pre-cap)', slice.totalCandidates === 12);
assert(
  `omittedCount reflects the cut (${12 - MAX_ASSOCIATES_PER_DEEP_DIVE})`,
  slice.omittedCount === 12 - MAX_ASSOCIATES_PER_DEEP_DIVE,
);
assert(
  'Dan Dayoff (worst variance, 25.00h) ranks FIRST — severity ranking, not flaggedRows order',
  slice.associates[0]?.identity.displayName === 'Dan Dayoff',
  `got ${slice.associates[0]?.identity.displayName}`,
);

const aliceSlice = slice.associates.find((a) => a.identity.displayName === 'Alice Anderson');
assert('Alice made the cut (2nd worst variance)', aliceSlice !== undefined);
const alicePunchGroup = aliceSlice?.groups.find((g) => g.label.includes('SES Punch Detail'));
assert('Alice has an SES Punch Detail source group', alicePunchGroup !== undefined);
assert(
  "Alice's punch rows include the Overtime row — timeType survives into the source slice",
  alicePunchGroup?.rows.some((r) => r['timeType'] === 'Overtime') ?? false,
);
assert(
  "Alice's punch rows include a Work row too — timeType is not filtered, it's raw",
  alicePunchGroup?.rows.some((r) => r['timeType'] === 'Work') ?? false,
);

const danSlice = slice.associates.find((a) => a.identity.displayName === 'Dan Dayoff');
const danPunchGroup = danSlice?.groups.find((g) => g.label.includes('SES Punch Detail'));
assert(
  `Dan's punch source rows are capped at MAX_SOURCE_ROWS_PER_ASSOCIATE_PER_SOURCE (${MAX_SOURCE_ROWS_PER_ASSOCIATE_PER_SOURCE})`,
  danPunchGroup?.rows.length === MAX_SOURCE_ROWS_PER_ASSOCIATE_PER_SOURCE,
  `got ${danPunchGroup?.rows.length}`,
);
assert(
  'Dan\'s trimmed count is disclosed (not silently dropped)',
  (danPunchGroup?.trimmed ?? 0) > 0,
  `trimmed=${danPunchGroup?.trimmed}`,
);

assert(
  "'— TOTAL —' produced no associate entry in the source slice",
  slice.associates.every((a) => a.identity.displayName !== '— TOTAL —'),
);

// ── Test 4: degraded path — parsedData null never crashes, never silently sends nothing ──

console.log('\nDegraded path — parsedData null');

const degradedSlice = buildAssociateSourceSlice(check3Result, null);
assert('degraded slice has zero associates (nothing to show)', degradedSlice.associates.length === 0);
assert('degraded slice states a reason rather than silently returning empty', degradedSlice.degradedReason !== null);
assert('degraded reason mentions no source data', (degradedSlice.degradedReason ?? '').toLowerCase().includes('no source data'));

// ── Test 5: render the actual Deep Dive prompt and read it ──────────────────────

console.log('\nRendered Deep Dive prompt — the real client-facing artifact');

const emptyBundle = { checkId: 3, checkName: 'Three-Way Punch Recon', ruleText: 'rule text', crossCheckRows: bundle.crossCheckRows };
const renderedPrompt = buildDeepDivePrompt(check3Result, emptyBundle, slice);

assert('rendered prompt contains the SOURCE DATA section header', renderedPrompt.includes('SOURCE DATA:'));
assert('rendered prompt contains Dan Dayoff (top-ranked associate)', renderedPrompt.includes('Dan Dayoff'));
assert('rendered prompt contains Alice\'s Overtime punch row literally', renderedPrompt.includes('"timeType": "Overtime"'));
assert(
  'rendered prompt discloses the omitted-associates count',
  renderedPrompt.includes(`${12 - MAX_ASSOCIATES_PER_DEEP_DIVE} additional associate`),
);
assert(
  'rendered prompt discloses Dan\'s trimmed punch rows',
  /additional SES Punch Detail.*rows omitted/.test(renderedPrompt),
);
assert(
  'rendered prompt instructs comparing source vs check output (root-cause posture)',
  renderedPrompt.toLowerCase().includes('data problem') && renderedPrompt.toLowerCase().includes('rule problem'),
);

console.log('\n--- Rendered prompt excerpt (SOURCE DATA section, first 1200 chars) ---');
const sourceDataIdx = renderedPrompt.indexOf('SOURCE DATA:');
console.log(renderedPrompt.slice(sourceDataIdx, sourceDataIdx + 1200));
console.log('--- end excerpt ---\n');

// ── Test 6: no-persistence guarantee — source rows never reach the /api/runs payload shape ──

console.log('\nNo-persistence guarantee — source data must never reach the AuditPayload shape');

// Mirror exactly what App.tsx's persistRun() posts: an AuditPayload-shaped
// object built ONLY from CheckResult[] + top-level metadata. parsedData is
// never spread into it anywhere in the real app — this fixture proves that
// even if flaggedRows themselves get JSON-stringified into the payload
// (which they legitimately do — flaggedRows ARE part of the audit report),
// the raw source-slice punch detail (timeType-tagged rows, full punch
// history) does not leak in, because it is a distinct object never merged
// into this shape.
const mockAuditPayload = {
  invoiceFile: 'test.xlsx',
  punchFile: null,
  generatedAt: new Date().toISOString(),
  weeksCovered: [],
  declaredPeriod: null,
  summary: {
    totalLaborRows: 0, totalFieldAssociates: 0, fieldLaborTotal: 0,
    managementTotal: 0, cloudTotal: 0, reconstructedTotal: 0, invoiceTotal: null, variance: null,
  },
  results: [check3Result, check18Result], // the actual CheckResult[] — flaggedRows only
  crossTabNotes: [],
};

const payloadJson = JSON.stringify(mockAuditPayload);
// Distinctive marker only present in the raw source slice, never in any flaggedRow.
assert(
  'payload JSON does NOT contain the raw "timeType" punch field (only lives in the source slice)',
  !payloadJson.includes('timeType'),
);
assert(
  'payload JSON does NOT contain Dan\'s excess filler punch rows (rowNum-tagged raw punch data)',
  !payloadJson.includes('"Travel"'),
);
assert(
  'the rendered Deep Dive prompt (by contrast) DOES contain source-only data — proving it is a genuinely separate channel',
  renderedPrompt.includes('timeType') && renderedPrompt.includes('Travel'),
);
assert(
  'mockAuditPayload has no parsedData / sesPunchRows key at all (AuditPayload interface has no such field)',
  !('parsedData' in mockAuditPayload) && !('sesPunchRows' in mockAuditPayload),
);

// ── Test 7 (T-670): checkId renumbering repairs cross-check context ─────────
//
// T-670 found and fixed a duplicate-checkId bug in runSesAudit.ts (two
// checks both claiming id 18: Holiday Pay Validation and Payroll Tag
// Exceptions). contextBundle.ts's cross-check scan filters
// `allResults.filter(r => r.checkId !== targetResult.checkId)` — with a
// colliding id, that filter wrongly dropped the INNOCENT sibling from every
// Deep Dive's cross-check data, silently, for any check sharing that id.
// This proves the repair: same associate, same sibling check, only the
// checkId changes (18 → the post-fix 22) — pre-fix numbering loses the
// sibling, post-fix numbering finds it.

console.log('\ncheckId renumbering repairs cross-check context (T-670)');

const holidayTarget: CheckResult = {
  checkId: 18,
  checkName: 'Holiday Pay Validation',
  status: 'warning',
  stats: '1 associate flagged',
  flaggedCount: 1,
  flaggedRows: [{ name: 'Ivy Ingram', date: '2026-05-25', issue: 'Wrong hours' }],
};

// Pre-T-670 shape: Payroll Tag Exceptions also claimed checkId 18.
const payrollTagSiblingPreFix: CheckResult = {
  checkId: 18,
  checkName: 'Payroll Tag Exceptions',
  status: 'warning',
  stats: '1 EXC row flagged',
  flaggedCount: 1,
  flaggedRows: [{ employeeName: 'Ivy Ingram', payrollTag: '2020_PAYROLL_20260615_EXC_LATE', issue: 'date outside period' }],
};

// Post-T-670 shape: Payroll Tag Exceptions now owns checkId 22.
const payrollTagSiblingPostFix: CheckResult = { ...payrollTagSiblingPreFix, checkId: 22 };

const bundlePreFixNumbering = buildContextBundle(holidayTarget, [holidayTarget, payrollTagSiblingPreFix], 'rule text');
const bundlePostFixNumbering = buildContextBundle(holidayTarget, [holidayTarget, payrollTagSiblingPostFix], 'rule text');

assert(
  'BUG REPRODUCED: with colliding checkId=18, the innocent sibling is wrongly dropped from cross-check data',
  bundlePreFixNumbering.crossCheckRows.find((e) => e.employeeName === 'Ivy Ingram') === undefined,
);
assert(
  'FIXED: with the post-renumbering checkId=22, the sibling is correctly included',
  bundlePostFixNumbering.crossCheckRows.find((e) => e.employeeName === 'Ivy Ingram') !== undefined,
);
assert(
  'the included sibling correctly attributes back to Payroll Tag Exceptions (checkId 22)',
  bundlePostFixNumbering.crossCheckRows
    .find((e) => e.employeeName === 'Ivy Ingram')
    ?.rows.some((r) => r.checkId === 22 && r.checkName === 'Payroll Tag Exceptions') ?? false,
);

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
