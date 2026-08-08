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
  MAX_DATES_PER_ASSOCIATE_PIVOT,
} from './sourceSlice.js';
import { buildDeepDivePrompt } from './promptTemplates.js';
import { estimateTokens, estimateAnalyzeAllCost } from './bragiClient.js';
import type { CheckResult, ParsedData, LaborRow, SesPunchRow, ShiftRow } from '../audit/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function invoiceRow(associateId: string, employeeName: string, timeHours: number, comments: string, visitDate: Date | null = null): LaborRow {
  return {
    sheet: 'FSM I', rowNum: ++rowNum, employeeName, associateId, associateType: 'SES',
    timeHours, basePayRate: 0, muValue: 0, billValue: 0, loadedRate: 0, associateState: '',
    comments, visitDate, week: null, clientStoreId: '',
  };
}

function punchRow(associateId: string, employeeName: string, timeHours: number, timeType?: string, visitDate: Date | null = null): SesPunchRow {
  return { rowNum: ++rowNum, employeeName, associateId, timeHours, timeType, visitDate };
}

function shiftRow(associateId: string, employeeName: string, hours: number, visitDate: Date | null = null): ShiftRow {
  return { rowNum: ++rowNum, employeeName, associateId, actualMinutes: hours * 60, visitDate };
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
// output shape as of T-672 — 'associate' is a NAME, PLUS an 'associateId'
// field the check now also emits so downstream matching can go by ID) ──────
//
// Alice, Bob, Cara: flagged with modest variance. Dan: large variance (the
// worst offender — should rank first under severity, even though he appears
// later in flaggedRows / has a "smaller" name alphabetically). Nine more
// synthetic associates are added purely to exceed MAX_ASSOCIATES_PER_DEEP_DIVE
// so the omission-disclosure path fires.

function check3ShapedFlaggedRow(associateId: string, associate: string, invoiceHrs: number, punchHrs: number): Record<string, unknown> {
  const row: Record<string, unknown> = {
    associate,
    invoiceHrs: invoiceHrs.toFixed(2),
    punchHrs: punchHrs.toFixed(2),
    invoiceVsPunch: (invoiceHrs - punchHrs).toFixed(2),
  };
  if (associateId) row.associateId = associateId; // real check03 omits the key entirely when blank — see check03_ses_threeWayRecon.ts
  return row;
}

const check3Result: CheckResult = {
  checkId: 3,
  checkName: 'Three-Way Punch Recon',
  status: 'fail',
  stats: 'Variance exceeds tolerance',
  flaggedCount: 12,
  flaggedRows: [
    { associate: '— TOTAL —', invoiceHrs: '400.00', punchHrs: '350.00', invoiceVsPunch: '50.00' },
    check3ShapedFlaggedRow('A1', 'Alice Anderson', 40.00, 39.00),   // variance 1.00
    check3ShapedFlaggedRow('B1', 'Bob Blankfield', 20.00, 18.50),   // variance 1.50
    check3ShapedFlaggedRow('D1', 'Dan Dayoff', 30.00, 5.00),        // variance 25.00 — worst offender
    // 9 filler associates, each with a SMALLER variance (0.1–0.9) than both
    // Alice (1.00) and Bob (1.50) — pushes total candidates past the cap
    // while proving severity ranking (not flaggedRows order) decides who's
    // included: Dan, Bob, and Alice must all outrank most fillers.
    ...Array.from({ length: 9 }, (_, i) =>
      check3ShapedFlaggedRow(`F${i}`, `Filler Associate ${i}`, 10.00, 10.00 - 0.1 * (i + 1))),
  ],
};

// ── Test 1: identity extraction — ID-keyed rows now resolve, '— TOTAL —' excluded ──

console.log('\nAssociate identity extraction (T-669 fix, updated T-672 for ID propagation)');

const identities = extractAssociateIdentities(check3Result.flaggedRows);
assert(
  '12 flagged rows -> 12 distinct associate identities (TOTAL row excluded)',
  identities.length === 12,
  `got ${identities.length}`,
);
// T-672: check03SesThreeWayRecon now emits associateId on every per-person
// row (Bragi/Allan: real punch Associate ID and shift Vendor EMP ID use the
// identical format, 355/366 overlap measured on production data) — so
// extractRowIdentity (id-preferred) resolves these as kind:'id' now, not
// kind:'name' as before T-672. The '— TOTAL —' summary row still has no ID
// (and is excluded entirely, tested below) — this assertion is intentionally
// updated, not silently deleted, per Bragi's T-672 instruction.
assert('all extracted identities are ID-keyed (Check 3 rows now carry associateId — T-672)', identities.every((i) => i.kind === 'id'));
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

// ── Test 2: cross-check bundle — matches a name-only sibling even though Check 3 now carries an ID too ──

console.log('\nContext bundle — dual-key cross-check matching (T-669 fix, T-672 dual-key update)');

// Another check (Check 18, holiday validation) flags Dan Dayoff by name only —
// exactly like check17/check18 do in the real app (employeeName field, no ID).
// Check 3's OWN row for Dan now ALSO carries associateId (T-672) — this test
// proves that addition did not regress matching against siblings that still
// only have a name: contextBundle.ts collects BOTH an id-key and a name-key
// per target row (extractRowMatchKeys, not the exclusive-preferred
// extractRowIdentity), so Check 18's name-only row still finds Dan.
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
  'bundle is NOT empty even though Check 3\'s own rows are now ID-keyed — dual-key extraction keeps name matching alive for siblings without an ID',
  bundle.crossCheckRows.length > 0,
);
assert('Dan Dayoff cross-check entry found via name matching against Check 18\'s ID-less row', danCrossCheck !== undefined);
assert(
  'Dan\'s cross-check entry has no associateId — it reflects CHECK 18\'s row (which has none), not Check 3\'s',
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

// ═══════════════════════════════════════════════════════════════════════════
// T-671 — the "Analyze with Bragi" button is now wired to the source-data
// path, not the Haiku-only flaggedRows summary
// ═══════════════════════════════════════════════════════════════════════════
//
// Allan's exact complaint: he clicked "Analyze with Bragi" right below
// Check 3 and got a Haiku-grade summary paragraph with no sourcing, while a
// separate "Deep Dive" button underneath (unclicked) had the real fix from
// T-669. This section proves the CONSOLIDATION actually happened in the
// shipped component — not just that the underlying prompt machinery works
// (that's what the rest of this file already proves) — by reading
// CheckCard.tsx's actual source and checking its wiring, then re-rendering
// the exact prompt that button now sends and printing it for a human to read.

console.log('\nCheckCard.tsx wiring — one button, source-data path (T-671)');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const checkCardSource = fs.readFileSync(path.join(__dirname, '../components/CheckCard.tsx'), 'utf8');

assert(
  "CheckCard imports runDeepDive from bragiClient (the source-data path)",
  /import\s*\{[^}]*\brunDeepDive\b[^}]*\}\s*from\s*'\.\.\/ai\/bragiClient'/.test(checkCardSource),
);
assert(
  'CheckCard no longer references analyzeCheck (the dead Haiku-only, flaggedRows-only function)',
  !/\banalyzeCheck\b/.test(checkCardSource),
);
assert(
  "handleAnalyze() — the function bound to the 'Analyze with Bragi' button — calls runDeepDive",
  /async function handleAnalyze\(\)[\s\S]*?runDeepDive\(/.test(checkCardSource),
);
assert(
  "no separate 'Deep Dive' button label remains — one button, not two",
  !/>\s*Deep Dive\s*</.test(checkCardSource),
);
// Isolate the bragiClient import line specifically — the file's own
// explanatory comments legitimately mention the retired estimateCost() by
// name (documenting what NOT to use), so check the import, not whole-file text.
const bragiClientImportLine = checkCardSource.split('\n').find((l) => l.includes("from '../ai/bragiClient'")) ?? '';
assert(
  'CheckCard imports the real source-data cost estimator (estimateDeepDiveCost)',
  bragiClientImportLine.includes('estimateDeepDiveCost'),
);
assert(
  'CheckCard no longer imports the old flaggedRows-only estimators (estimateCost/estimateTokens)',
  !/\bestimateCost\b/.test(bragiClientImportLine) && !/\bestimateTokens\b/.test(bragiClientImportLine),
);
assert(
  "the button label read by Allan is 'Analyze with Bragi' (not renamed to 'Deep Dive' or similar)",
  checkCardSource.includes('Analyze with Bragi'),
);

// Re-render the exact prompt CheckCard's (single, now source-data-backed)
// "Analyze with Bragi" button sends for a Check-3-shaped case, using the
// SAME check3Result/slice/bundle already built above in this file — this is
// not a new prompt, it's proof that the one button now sends what used to
// be Deep Dive-only. Read it, don't just assert on it.
console.log('\n--- T-671: the prompt "Analyze with Bragi" now sends for Check 3 (excerpt) ---');
const t671PromptExcerptStart = renderedPrompt.indexOf('SOURCE DATA:');
console.log(renderedPrompt.slice(t671PromptExcerptStart, t671PromptExcerptStart + 600));
console.log('--- end excerpt ---\n');

assert(
  'the prompt the consolidated button sends contains real punch rows with timeType — the exact claim Allan disproved by using the app',
  renderedPrompt.includes('"timeType"') && renderedPrompt.includes('"Overtime"'),
);
assert(
  'the prompt is NOT the old Haiku flaggedRows-only shape (no source data, no timeType) — it is the full Deep Dive prompt',
  renderedPrompt.includes('FULL FLAGGED ROWS') && renderedPrompt.includes('SOURCE DATA:') && renderedPrompt.includes('RELEVANT AUDIT RULE TEXT:'),
);

// ═══════════════════════════════════════════════════════════════════════════
// T-671 — Vera review additions
// ═══════════════════════════════════════════════════════════════════════════

console.log('\nHaiku cost constants match published Haiku 4.5 rates (Vera, T-671)');

// The "Analyze All" badge is the first user-facing surface to show a Haiku
// cost figure. The constants behind it read 0.00025/0.00125 "per thousand
// tokens" — i.e. $0.25/$1.25 per MTok, which is Haiku 3 pricing carried
// forward when HAIKU_MODEL moved to haiku-4-5. Haiku 4.5 lists at $1.00 in /
// $5.00 out per MTok, so the badge understated by 4x. This pins the
// arithmetic to the published rates so the drift can't silently return.
const HAIKU_4_5_INPUT_PER_M = 1.0;
const HAIKU_4_5_OUTPUT_PER_M = 5.0;
const HAIKU_MAX_TOKENS_FOR_TEST = 800; // mirrors bragiClient's HAIKU_MAX_TOKENS

const costProbeCheck: CheckResult = {
  checkId: 3,
  checkName: 'Three-Way Punch Recon',
  status: 'fail',
  stats: 'Variance exceeds tolerance',
  flaggedCount: 3,
  flaggedRows: [
    check3ShapedFlaggedRow('A1', 'Alice Anderson', 40.0, 39.0),
    check3ShapedFlaggedRow('B1', 'Bob Blankfield', 20.0, 18.5),
    check3ShapedFlaggedRow('D1', 'Dan Dayoff', 30.0, 5.0),
  ],
};

const probeInputTokens = estimateTokens(costProbeCheck) - HAIKU_MAX_TOKENS_FOR_TEST;
const expectedHaikuUsd =
  (probeInputTokens * HAIKU_4_5_INPUT_PER_M + HAIKU_MAX_TOKENS_FOR_TEST * HAIKU_4_5_OUTPUT_PER_M) / 1_000_000;
// estimateAnalyzeAllCost = (Haiku per eligible check) + (one Sonnet synthesis).
// Isolate the Haiku half by subtracting the synthesis term, computed the same
// way bragiClient does (Sonnet 4.6 list: $3 in / $15 out per MTok).
const synthesisUsd = ((1 * HAIKU_MAX_TOKENS_FOR_TEST + 1 * 60) * 3.0 + 4000 * 15.0) / 1_000_000;
const reportedTotal = Number(estimateAnalyzeAllCost([costProbeCheck]).replace(/[^0-9.]/g, ''));
const reportedHaikuHalf = reportedTotal - synthesisUsd;

assert(
  `Haiku half of estimateAnalyzeAllCost matches $1/$5 per MTok (expected ~$${expectedHaikuUsd.toFixed(4)}, got ~$${reportedHaikuHalf.toFixed(4)})`,
  Math.abs(reportedHaikuHalf - expectedHaikuUsd) < 0.0015,
  `pre-fix Haiku-3 rates would have produced ~$${(expectedHaikuUsd / 4).toFixed(4)}`,
);
assert(
  'the reported Analyze All total is NOT the 4x-understated pre-fix figure',
  reportedHaikuHalf > expectedHaikuUsd / 2,
);

console.log('\nName-matching gap: FIXED for Check 3 via associateId (T-672); disclosure remains for still-name-only checks');

// Real production measurement (Bragi, T-672): punch Associate ID and shift
// Vendor EMP ID use the identical format (EE014596, TC1104I, ...), 355 of
// 366 punch IDs found in the shift file. So matching by ID, not name, is
// what actually resolves Vera's T-671 fabrication-risk finding: an associate
// whose punch/shift file spells the name differently (middle initial,
// trailing space) used to get a silently PARTIAL source block. Check 3 now
// emits associateId (T-672) specifically so this scenario is fixed, not just
// disclosed, for Check 3. The disclosure text stays in the prompt as a
// defensive instruction — it's still load-bearing for OTHER checks
// (check17/18/7/...) that only ever emit a name, never an ID.

const nameMismatchParsed = emptyParsedData();
nameMismatchParsed.fsmIRows = [invoiceRow('A2', 'Nia Okonkwo', 40.0, 'Work')];
// Same associateId, name spelled with a middle initial + trailing space:
nameMismatchParsed.sesPunchRows = [punchRow('A2', 'Nia A. Okonkwo ', 30.0, 'Work')];
nameMismatchParsed.shiftRows = [shiftRow('A2', 'Nia A. Okonkwo ', 30.0)];

// FIXED scenario: a Check-3-shaped row, which now carries associateId.
const nameMismatchCheckFixed: CheckResult = {
  checkId: 3,
  checkName: 'Three-Way Punch Recon',
  status: 'fail',
  stats: 'Variance exceeds 2h tolerance',
  flaggedCount: 1,
  flaggedRows: [check3ShapedFlaggedRow('A2', 'Nia Okonkwo', 40.0, 30.0)],
};

const nameMismatchSliceFixed = buildAssociateSourceSlice(nameMismatchCheckFixed, nameMismatchParsed);
const niaEntryFixed = nameMismatchSliceFixed.associates.find((a) => a.identity.displayName === 'Nia Okonkwo');

assert(
  'FIXED: an associate matched by ID gets punch source rows DESPITE the name mismatch (middle initial + trailing space)',
  !!niaEntryFixed && niaEntryFixed.groups.some((g) => g.label.startsWith('SES Punch Detail')),
  `groups present: ${niaEntryFixed?.groups.map((g) => g.label.split(' (')[0]).join(', ') ?? 'none'}`,
);
assert(
  'FIXED: shift source rows are ALSO found, same reason',
  !!niaEntryFixed && niaEntryFixed.groups.some((g) => g.label.startsWith('Shift Detail')),
);
assert(
  'the identity resolved as ID-kind, not name-kind — that IS the fix',
  niaEntryFixed?.identity.kind === 'id' && niaEntryFixed?.identity.key === 'a2',
);

// STILL-A-GAP scenario: a name-only check (mirrors check17/check18's real
// shape — 'employeeName' field, no associateId anywhere) hits the exact same
// mismatched-name source data. This is the companion proof that the
// disclosure text removed above was NOT deleted for no reason — it is still
// exactly as necessary for any check T-672 didn't touch.
const nameOnlyCheck: CheckResult = {
  checkId: 18,
  checkName: 'Holiday Pay Validation',
  status: 'fail',
  stats: '1 associate flagged',
  flaggedCount: 1,
  flaggedRows: [{ employeeName: 'Nia Okonkwo', issue: 'Wrong hours' }], // no associateId field — matches check18_holidays.ts's real shape
};

const nameOnlySlice = buildAssociateSourceSlice(nameOnlyCheck, nameMismatchParsed);
const niaEntryNameOnly = nameOnlySlice.associates.find((a) => a.identity.displayName === 'Nia Okonkwo');

assert(
  'STILL A GAP (by design, not an oversight): a name-only check with the SAME mismatched source data gets NO punch source rows',
  !!niaEntryNameOnly && !niaEntryNameOnly.groups.some((g) => g.label.startsWith('SES Punch Detail')),
  `groups present: ${niaEntryNameOnly?.groups.map((g) => g.label.split(' (')[0]).join(', ') ?? 'none'}`,
);
assert(
  'the invoice rows DO still match for the name-only case too (partial block, not empty — the more misleading shape)',
  !!niaEntryNameOnly && niaEntryNameOnly.groups.some((g) => g.label.startsWith('Invoice Labor Rows')),
);

const nameMismatchPromptFixed = buildDeepDivePrompt(
  nameMismatchCheckFixed,
  buildContextBundle(nameMismatchCheckFixed, [nameMismatchCheckFixed], 'rule text'),
  nameMismatchSliceFixed,
);
const nameOnlyPrompt = buildDeepDivePrompt(
  nameOnlyCheck,
  buildContextBundle(nameOnlyCheck, [nameOnlyCheck], 'rule text'),
  nameOnlySlice,
);

assert(
  'the disclosure text is still present for the name-only check (still load-bearing there)',
  /absence of a source file's rows under an associate does NOT mean that associate is missing from that file/i.test(nameOnlyPrompt)
  && /never conclude the associate is absent from that file/i.test(nameOnlyPrompt),
);
assert(
  'the prompt tells the model an ID-matched heading (shown in parentheses) is EXEMPT from the name-matching-gap risk',
  /does NOT apply when the associate's heading above shows an ID in parentheses/i.test(nameMismatchPromptFixed),
);
assert(
  'the ID-matched Nia\'s heading actually shows the ID in parentheses (what the exemption sentence refers to)',
  nameMismatchPromptFixed.includes('Nia Okonkwo (A2)'),
);

// ═══════════════════════════════════════════════════════════════════════════
// T-672 — date-level variance sourcing
// ═══════════════════════════════════════════════════════════════════════════
//
// Allan: "I am wondering however if it can go deep enough to actually source
// the date(s) that caused the variance. for example, Tom Johnson had 8 hours
// on invoice on Jan 1 but only 6.5 hours on punch report for Jan 1."
//
// This section proves: (a) the per-date pivot names the actual date and
// hours for a Tom-Johnson-shaped case; (b) worst-variance dates rank first
// and truncation is capped + disclosed; (c) when shift data has NO per-date
// column, the pivot degrades to period-level and the prompt says so
// explicitly rather than fabricating a per-date shift figure; (d) when shift
// DOES have dates (the real production case per Bragi's file analysis), the
// genuine three-way pivot renders with all three legs.

function d(y: number, m: number, day: number): Date {
  return new Date(y, m - 1, day);
}

// ── Scenario A: Tom Johnson — shift IS date-attributable (the real case) ────

console.log('\nDate-level pivot — Tom Johnson, three-way with dates (T-672)');

const tomParsed = emptyParsedData();
tomParsed.fsmIRows = [
  invoiceRow('T1', 'Tom Johnson', 8.00, 'Work', d(2026, 1, 1)),
  invoiceRow('T1', 'Tom Johnson', 8.00, 'Work', d(2026, 1, 2)),
];
tomParsed.sesPunchRows = [
  punchRow('T1', 'Tom Johnson', 6.50, 'Work', d(2026, 1, 1)),   // Allan's exact example: 8.00 invoice vs 6.50 punch on Jan 1
  punchRow('T1', 'Tom Johnson', 8.00, 'Work', d(2026, 1, 2)),   // Jan 2 reconciles cleanly
  punchRow('T1', 'Tom Johnson', 1.00, 'Travel', d(2026, 1, 2)), // non-Work category same date — context, not counted in Punch hours
];
tomParsed.shiftRows = [
  shiftRow('T1', 'Tom Johnson', 8.00, d(2026, 1, 1)),
  shiftRow('T1', 'Tom Johnson', 8.00, d(2026, 1, 2)),
];

const tomCheck: CheckResult = {
  checkId: 3,
  checkName: 'Three-Way Punch Recon',
  status: 'fail',
  stats: 'Variance exceeds 2h tolerance',
  flaggedCount: 1,
  flaggedRows: [check3ShapedFlaggedRow('T1', 'Tom Johnson', 16.00, 14.50)],
};

const tomSlice = buildAssociateSourceSlice(tomCheck, tomParsed);
const tomEntry = tomSlice.associates.find((a) => a.identity.displayName === 'Tom Johnson');

assert('Tom Johnson has a date pivot', tomEntry?.datePivot !== null && tomEntry?.datePivot !== undefined);
assert('this run\'s shift data IS date-attributable (both shift rows carry visitDate)', tomEntry?.datePivot?.shiftDateAttributable === true);
assert('2 dates found (Jan 1, Jan 2)', tomEntry?.datePivot?.totalDatesFound === 2);

const jan1 = tomEntry?.datePivot?.dates.find((e) => e.date === '2026-01-01');
const jan2 = tomEntry?.datePivot?.dates.find((e) => e.date === '2026-01-02');
assert('Jan 1 entry present with Allan\'s exact numbers: invoice 8.00, punch 6.50', jan1?.invoiceHours === 8 && jan1?.punchHours === 6.5, JSON.stringify(jan1));
assert('Jan 1 shift hours present (8.00) since shift is date-attributable this run', jan1?.shiftHours === 8);
assert('Jan 1 ranks FIRST — it has the larger variance (1.5h vs Jan 2\'s ~1h from the Travel-adjacent punch)', tomEntry?.datePivot?.dates[0]?.date === '2026-01-01');
assert('Jan 2 shows the Travel hour as otherPunchCategories, NOT folded into punchHours', jan2?.punchHours === 8 && (jan2?.otherPunchCategories ?? '').includes('Travel 1.00h'));

const tomPrompt = buildDeepDivePrompt(tomCheck, buildContextBundle(tomCheck, [tomCheck], 'rule text'), tomSlice);
assert('rendered prompt contains the DATE-LEVEL VARIANCE header', tomPrompt.includes('DATE-LEVEL VARIANCE'));
assert('rendered prompt names 2026-01-01 with the exact invoice/punch numbers Allan asked for', /2026-01-01: Invoice 8\.00h \| Punch 6\.50h/.test(tomPrompt));
assert('rendered prompt instructs the model to name specific dates from the pivot', /name the SPECIFIC DATE\(S\)/.test(tomPrompt));

console.log('\n--- T-672: DATE-LEVEL VARIANCE section for Tom Johnson (excerpt) ---');
const dateVarianceIdx = tomPrompt.indexOf('DATE-LEVEL VARIANCE');
console.log(tomPrompt.slice(dateVarianceIdx, dateVarianceIdx + 400));
console.log('--- end excerpt ---\n');

// ── Scenario B: shift NOT date-attributable — must degrade, never fabricate ──

console.log('\nDate-level pivot — shift has no date column, degrades to period-level (T-672)');

const noShiftDateParsed = emptyParsedData();
noShiftDateParsed.fsmIRows = [invoiceRow('T2', 'Tara Jenkins', 8.00, 'Work', d(2026, 1, 1))];
noShiftDateParsed.sesPunchRows = [punchRow('T2', 'Tara Jenkins', 6.00, 'Work', d(2026, 1, 1))];
// Shift rows exist but carry NO date (older export shape) — actualMinutes
// only, visitDate stays null (the default param), same as a real legacy file.
noShiftDateParsed.shiftRows = [shiftRow('T2', 'Tara Jenkins', 40.00)]; // one period-total row, no date

const taraCheck: CheckResult = {
  checkId: 3,
  checkName: 'Three-Way Punch Recon',
  status: 'fail',
  stats: 'Variance exceeds 2h tolerance',
  flaggedCount: 1,
  flaggedRows: [check3ShapedFlaggedRow('T2', 'Tara Jenkins', 8.00, 6.00)],
};

const taraSlice = buildAssociateSourceSlice(taraCheck, noShiftDateParsed);
const taraEntry = taraSlice.associates.find((a) => a.identity.displayName === 'Tara Jenkins');

assert('this run\'s shift data is NOT date-attributable (the one shift row has no visitDate)', taraEntry?.datePivot?.shiftDateAttributable === false);
assert('Jan 1 entry still has invoice/punch (those DO have dates)', taraEntry?.datePivot?.dates[0]?.invoiceHours === 8 && taraEntry?.datePivot?.dates[0]?.punchHours === 6);
assert('Jan 1 entry\'s shiftHours is null — never fabricated from the period total', taraEntry?.datePivot?.dates[0]?.shiftHours === null);

const taraPrompt = buildDeepDivePrompt(taraCheck, buildContextBundle(taraCheck, [taraCheck], 'rule text'), taraSlice);
assert(
  'the prompt explicitly states shift is period-level only for this associate — never implies a per-date figure',
  /Shift is NOT broken out by date here/.test(taraPrompt) && /Do not state or infer a per-date figure/.test(taraPrompt),
);
// Vera, T-672 review: the note must ALSO forbid reading the suppressed leg's
// absence from the per-date lines as "that source has no rows" — the exact
// fabricated missing-source finding the suppression exists to prevent.
assert(
  'the period-level note forbids reading the suppressed leg\'s absence as missing rows (Vera, T-672 review)',
  /do NOT treat its absence from these lines as missing rows/.test(taraPrompt),
);
assert(
  'the per-date lines do NOT print a fabricated shift number (no "| Shift" suffix when shiftDateAttributable is false)',
  !/2026-01-01:.*\| Shift/.test(taraPrompt),
);
// The period-level Shift Detail SourceGroup (T-669's existing mechanism)
// still carries the real period total, just not date-bucketed — confirms
// the leg isn't silently dropped, only its date-attribution is withheld.
assert(
  'the period-level Shift Detail source rows are still present elsewhere in the prompt (leg not dropped, just not dated)',
  taraEntry?.groups.some((g) => g.label.startsWith('Shift Detail')) ?? false,
);

// ── Scenario C: truncation — worst-variance dates survive the cap ───────────

console.log('\nDate-level pivot — truncation ranked by variance, not earliest-first (T-672)');

const manyDatesParsed = emptyParsedData();
const MANY_DATES_COUNT = MAX_DATES_PER_ASSOCIATE_PIVOT + 5;
manyDatesParsed.fsmIRows = Array.from({ length: MANY_DATES_COUNT }, (_, i) =>
  invoiceRow('T3', 'Uma Patterson', 8.00, 'Work', d(2026, 1, i + 1)));
manyDatesParsed.sesPunchRows = Array.from({ length: MANY_DATES_COUNT }, (_, i) =>
  // Variance grows with i, so the LAST (latest-dated) days have the biggest
  // gaps — proves ranking is by variance, not by earliest date surviving.
  punchRow('T3', 'Uma Patterson', 8.00 - (i + 1) * 0.1, 'Work', d(2026, 1, i + 1)));

const umaCheck: CheckResult = {
  checkId: 3,
  checkName: 'Three-Way Punch Recon',
  status: 'fail',
  stats: 'Variance exceeds 2h tolerance',
  flaggedCount: 1,
  flaggedRows: [check3ShapedFlaggedRow('T3', 'Uma Patterson', 8.00 * MANY_DATES_COUNT, 8.00 * MANY_DATES_COUNT - 0.1 * MANY_DATES_COUNT * (MANY_DATES_COUNT + 1) / 2)],
};

const umaSlice = buildAssociateSourceSlice(umaCheck, manyDatesParsed);
const umaEntry = umaSlice.associates.find((a) => a.identity.displayName === 'Uma Patterson');

assert(`${MANY_DATES_COUNT} total dates found (pre-cap)`, umaEntry?.datePivot?.totalDatesFound === MANY_DATES_COUNT);
assert(`dates capped at MAX_DATES_PER_ASSOCIATE_PIVOT (${MAX_DATES_PER_ASSOCIATE_PIVOT})`, umaEntry?.datePivot?.dates.length === MAX_DATES_PER_ASSOCIATE_PIVOT);
assert(`omittedDateCount reflects the cut (${MANY_DATES_COUNT - MAX_DATES_PER_ASSOCIATE_PIVOT})`, umaEntry?.datePivot?.omittedDateCount === MANY_DATES_COUNT - MAX_DATES_PER_ASSOCIATE_PIVOT);
assert(
  'the LAST (latest, worst-variance) date survives — not the earliest — proving variance ranking, not chronological truncation',
  umaEntry?.datePivot?.dates[0]?.date === `2026-01-${String(MANY_DATES_COUNT).padStart(2, '0')}`,
  `top date: ${umaEntry?.datePivot?.dates[0]?.date}`,
);
assert(
  'the earliest (smallest-variance) date did NOT survive the cap',
  !umaEntry?.datePivot?.dates.some((e) => e.date === '2026-01-01'),
);

const umaPrompt = buildDeepDivePrompt(umaCheck, buildContextBundle(umaCheck, [umaCheck], 'rule text'), umaSlice);
assert(
  'the rendered prompt discloses the omitted-dates count for this associate',
  umaPrompt.includes(`${MANY_DATES_COUNT - MAX_DATES_PER_ASSOCIATE_PIVOT} additional date(s) omitted`),
);

// ── Scenario E (Vera, T-672 review): symmetric date-attributability ──────────
//
// T-672 guarded the SHIFT leg only. On an older punch export with no "Date In"
// column, every pivot line rendered `Punch —`, which the legend defines as
// "no rows found for that leg on that date" — so a model told to name the
// dates driving a variance reads a parsing artifact as "punch rows missing on
// every date" and reports a fabricated missing-punch finding to Allan, who
// may take it to the client. Reproduced before the fix on both the punch and
// invoice legs. Guard is now symmetric across all three legs.

console.log('\nDate-level pivot — punch/invoice date-attributability is symmetric with shift (Vera, T-672 review)');

const datelessPunchParsed = emptyParsedData();
datelessPunchParsed.fsmIRows = [
  invoiceRow('V1', 'Vera Case', 8.00, 'Work', d(2026, 1, 1)),
  invoiceRow('V1', 'Vera Case', 8.00, 'Work', d(2026, 1, 2)),
];
// Older punch export shape: real hours, but no Date In column → visitDate null.
datelessPunchParsed.sesPunchRows = [
  punchRow('V1', 'Vera Case', 6.00, 'Work'),
  punchRow('V1', 'Vera Case', 6.00, 'Work'),
];
datelessPunchParsed.shiftRows = [
  shiftRow('V1', 'Vera Case', 7.00, d(2026, 1, 1)),
  shiftRow('V1', 'Vera Case', 7.00, d(2026, 1, 2)),
];

const datelessPunchCheck: CheckResult = {
  checkId: 3,
  checkName: 'Three-Way Punch Recon',
  status: 'fail',
  stats: 'Variance exceeds 2h tolerance',
  flaggedCount: 1,
  flaggedRows: [check3ShapedFlaggedRow('V1', 'Vera Case', 16.00, 12.00)],
};

const datelessPunchSlice = buildAssociateSourceSlice(datelessPunchCheck, datelessPunchParsed);
const veraEntry = datelessPunchSlice.associates.find((a) => a.identity.displayName === 'Vera Case');
const datelessPunchPrompt = buildDeepDivePrompt(
  datelessPunchCheck, buildContextBundle(datelessPunchCheck, [datelessPunchCheck], 'rule text'), datelessPunchSlice);

assert('punch leg is correctly marked NOT date-attributable (no Date In column)', veraEntry?.datePivot?.attributable.punch === false);
assert('invoice and shift legs ARE date-attributable in the same run', veraEntry?.datePivot?.attributable.invoice === true && veraEntry?.datePivot?.attributable.shift === true);
assert(
  'BUG FIXED: the per-date lines no longer render "Punch —" on every date (that read as "punch missing on every date")',
  !/Punch —/.test(datelessPunchPrompt),
  datelessPunchPrompt.slice(datelessPunchPrompt.indexOf('DATE-LEVEL VARIANCE'), datelessPunchPrompt.indexOf('DATE-LEVEL VARIANCE') + 400),
);
assert('the dateless punch leg is disclosed as period-level in the note', /Punch is NOT broken out by date here/.test(datelessPunchPrompt));
assert('the remaining dated legs still render their real per-date numbers', /2026-01-01: Invoice 8\.00h \| Shift 7\.00h/.test(datelessPunchPrompt));
assert(
  'the period-level punch rows are still present elsewhere in the prompt (leg suppressed from the pivot, not dropped from the prompt)',
  datelessPunchPrompt.includes('SES Punch Detail'),
);

// Fewer than two dated legs = no per-date variance is expressible. Fall back to
// period-level source groups rather than rendering one column beside em-dashes.
const oneLegParsed = emptyParsedData();
oneLegParsed.fsmIRows = [invoiceRow('V2', 'Solo Leg', 8.00, 'Work', d(2026, 1, 1))];
oneLegParsed.sesPunchRows = [punchRow('V2', 'Solo Leg', 6.00, 'Work')];
oneLegParsed.shiftRows = [shiftRow('V2', 'Solo Leg', 40.00)];
const oneLegCheck: CheckResult = {
  checkId: 3, checkName: 'Three-Way Punch Recon', status: 'fail', stats: 'x', flaggedCount: 1,
  flaggedRows: [check3ShapedFlaggedRow('V2', 'Solo Leg', 8.00, 6.00)],
};
const oneLegSlice = buildAssociateSourceSlice(oneLegCheck, oneLegParsed);
assert(
  'only ONE dated leg → no date pivot at all (a one-column pivot cannot show a variance)',
  oneLegSlice.associates.find((a) => a.identity.displayName === 'Solo Leg')?.datePivot === null,
);

// ── Scenario F (Vera, T-672 review): zero-signal dates are not variance drivers ──
//
// Found on Allan's real SES files. Flora Fabbricatore's real variance is driven
// by 2026-07-01 ALONE (invoice 7.47 / punch 7.47 / shift absent = 7.47 of her
// 7.48h total). 2026-07-02 has NO Work hours on any leg — it exists in the
// pivot only because an overnight Travel punch created the date bucket. T-672
// rendered it as `Invoice — | Punch — | Shift —`, and that row of em-dashes was
// misread during this very review as a second missing-shift day. It now says so
// in words. The Travel context is preserved, since that is what explains the day.

console.log('\nDate-level pivot — a date with no Work hours on any leg is not presented as a variance driver (Vera, T-672 review)');

const travelOnlyParsed = emptyParsedData();
travelOnlyParsed.fsmIRows = [
  invoiceRow('F1', 'Flo Case', 7.47, 'Work', d(2026, 7, 1)),
  invoiceRow('F1', 'Flo Case', 8.40, 'Travel', d(2026, 7, 1)),
  invoiceRow('F1', 'Flo Case', 1.30, 'Travel', d(2026, 7, 2)),   // overnight travel spills to the next day
];
travelOnlyParsed.sesPunchRows = [
  punchRow('F1', 'Flo Case', 7.47, 'Work', d(2026, 7, 1)),
  punchRow('F1', 'Flo Case', 8.40, 'Travel', d(2026, 7, 1)),
  punchRow('F1', 'Flo Case', 1.30, 'Travel', d(2026, 7, 2)),
];
travelOnlyParsed.shiftRows = [shiftRow('F1', 'Flo Case', 0, d(2026, 7, 3))]; // keeps shift date-attributable; none on 7/1 or 7/2

const travelOnlyCheck: CheckResult = {
  checkId: 3, checkName: 'Three-Way Punch Recon', status: 'fail', stats: 'x', flaggedCount: 1,
  flaggedRows: [check3ShapedFlaggedRow('F1', 'Flo Case', 7.47, 7.47)],
};
const travelOnlySlice = buildAssociateSourceSlice(travelOnlyCheck, travelOnlyParsed);
const floEntry = travelOnlySlice.associates.find((a) => a.identity.displayName === 'Flo Case');
const jul1 = floEntry?.datePivot?.dates.find((e) => e.date === '2026-07-01');
const jul2 = floEntry?.datePivot?.dates.find((e) => e.date === '2026-07-02');
const travelOnlyPrompt = buildDeepDivePrompt(
  travelOnlyCheck, buildContextBundle(travelOnlyCheck, [travelOnlyCheck], 'rule text'), travelOnlySlice);

assert('7/1 is the real variance driver — invoice 7.47 / punch 7.47 / shift absent', jul1?.invoiceHours === 7.47 && jul1?.punchHours === 7.47 && jul1?.shiftHours === null);
assert('7/1 is NOT flagged as zero-signal — it has real Work hours', jul1?.noReconcilableHours === false);
assert('7/1 ranks FIRST (largest variance)', floEntry?.datePivot?.dates[0]?.date === '2026-07-01');
assert('7/2 has NO Work hours on any leg — flagged zero-signal', jul2?.noReconcilableHours === true);
assert('7/2 carries zero variance — it can never outrank a real driver', jul2?.variance === 0);
assert('7/2 still preserves the Travel context that explains the day', (jul2?.otherPunchCategories ?? '').includes('Travel 1.30h'));
assert(
  'BUG FIXED: 7/2 no longer renders as a row of em-dashes that reads as a missing-source day',
  !/2026-07-02: Invoice — \| Punch — \| Shift —/.test(travelOnlyPrompt),
);
assert(
  '7/2 states in words that it is not a variance driver',
  /2026-07-02: no Work hours on any source this date \(NOT a variance driver/.test(travelOnlyPrompt),
  travelOnlyPrompt.slice(travelOnlyPrompt.indexOf('DATE-LEVEL VARIANCE'), travelOnlyPrompt.indexOf('DATE-LEVEL VARIANCE') + 500),
);
assert(
  '7/1 still renders its real numbers unchanged',
  /2026-07-01: Invoice 7\.47h \| Punch 7\.47h \| Shift —/.test(travelOnlyPrompt),
);

console.log('\n--- Vera T-672 review: DATE-LEVEL VARIANCE with a zero-signal date (excerpt) ---');
const floIdx = travelOnlyPrompt.indexOf('DATE-LEVEL VARIANCE');
console.log(travelOnlyPrompt.slice(floIdx, floIdx + 500));
console.log('--- end excerpt ---\n');

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passCount} passed, ${failCount} failed`);
process.exit(failCount === 0 ? 0 : 1);
