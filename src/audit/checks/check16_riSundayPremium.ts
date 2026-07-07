// Check 16 — Rhode Island Sunday Premium Pay Validator
//
// Rhode Island retail law (§ 28-12-4.1(b)) requires premium pay for Sunday work.
// The invoice represents this as two rows per base Sunday entry:
//   Base row:    any eligible time type, Sunday, RI associate
//   Premium row: comments = 'RI Sunday Premium Pay', same associate/date/hours,
//                basePayRate = base.basePayRate / 2, muValue = base.muValue / 2
//
// This check validates the two-row split. It does NOT flag correctly-formed pairs.
//
// Flag types:
//   FLAG_MISSING_PREMIUM  — base row has no matching premium row
//   FLAG_WRONG_RATE       — premium row exists but rate math is wrong
//   FLAG_ORPHAN_PREMIUM   — premium row exists with no corresponding base row
//   HOUR_MISMATCH         — premium hours differ from base hours (tolerance 0.01)

import type { CheckResult, LaborRow } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

export function isRhodeIsland(state: string): boolean {
  const s = state.trim().toLowerCase();
  return s === 'rhode island' || s === 'ri';
}

function isSunday(date: Date): boolean {
  return date.getDay() === 0;
}

function normalizeType(comments: string): string {
  return comments.trim().toLowerCase();
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HOURS_TOLERANCE = 0.01;  // hours match tolerance
// MU tolerance — buffered for invoice-side cent rounding of the premium base rate.
// The invoice derives the premium row's MU from the CENT-ROUNDED half-rate
// (basePayRate/2 rounded to the cent, e.g. 36.57/2 = 18.285 → 18.29), then applies
// the markup — NOT from the exact half of base.muValue. So the premium MU inherits up
// to (0.005 half-cent × markup) of rounding drift: 0.005 × 0.2993 (FT) ≈ 0.0015, which
// exceeded the old ±0.001. 0.005 absorbs the worst-case half-cent×markup drift with
// headroom while staying far tighter than any genuine wrong-rate error (off by dollars).
const MU_TOLERANCE = 0.005;
const RATE_TOLERANCE = 0.01;   // cent tolerance for basePayRate (half-rate rounds to the cent)

// ── Main export ───────────────────────────────────────────────────────────────

export function check16RiSundayPremium(fsmI: LaborRow[], fsmII: LaborRow[]): CheckResult {
  const allRows = [
    ...fsmI.map((r) => ({ ...r, _tab: 'FSM I' as const })),
    ...fsmII.map((r) => ({ ...r, _tab: 'FSM II' as const })),
  ];

  // Separate base rows and premium rows.
  // Base: RI + Sunday + NOT premium comment
  // Premium: 'ri sunday premium pay' comment (any date/state — orphan detection catches bad ones)
  const baseRows = allRows.filter(
    (r) =>
      isRhodeIsland(r.associateState) &&
      r.visitDate !== null &&
      isSunday(r.visitDate!) &&
      normalizeType(r.comments) !== 'ri sunday premium pay',
  );

  const premiumRows = allRows.filter(
    (r) => normalizeType(r.comments) === 'ri sunday premium pay',
  );

  // Group premium rows by (associateId, dateKey) into mutable pools.
  // Each pool entry is consumed as base rows are matched.
  type PremiumPool = (typeof premiumRows[number])[];
  const premiumPool = new Map<string, PremiumPool>();
  for (const pr of premiumRows) {
    if (!pr.visitDate) continue; // orphan with no date — handled below
    const poolKey = `${pr.associateId.toLowerCase()}|${toDateKey(pr.visitDate)}`;
    if (!premiumPool.has(poolKey)) premiumPool.set(poolKey, []);
    premiumPool.get(poolKey)!.push(pr);
  }

  // Track which premium rows got matched (to find true orphans later).
  const matchedPremiumRows = new Set<number>(); // by rowNum

  const flagged: Record<string, unknown>[] = [];

  // ── Match base rows to premium rows ──────────────────────────────────────────

  for (const base of baseRows) {
    const poolKey = `${base.associateId.toLowerCase()}|${toDateKey(base.visitDate!)}`;
    const pool = premiumPool.get(poolKey) ?? [];

    // Find nearest-hours match (spec: nearest timeHours, tie-break by category).
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const diff = Math.abs(pool[i].timeHours - base.timeHours);
      if (diff > HOURS_TOLERANCE) continue;
      if (diff < bestDiff || (diff === bestDiff && pool[i].comments < pool[bestIdx]?.comments)) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) {
      // No matching premium row found.
      flagged.push({
        section: 'FLAG_MISSING_PREMIUM',
        sheet: base.sheet,
        row: base.rowNum,
        name: base.employeeName,
        associateId: base.associateId,
        visitDate: base.visitDate!.toLocaleDateString(),
        hours: base.timeHours.toFixed(2),
        category: base.comments,
        tab: base._tab,
        issue: `RI Sunday base row has no matching premium row (expected 'RI Sunday Premium Pay' row with ${base.timeHours.toFixed(2)}h)`,
      });
      continue;
    }

    // Consume the matched premium row.
    const matched = pool[bestIdx];
    pool.splice(bestIdx, 1);
    matchedPremiumRows.add(matched.rowNum);

    // Validate rate math.
    // basePayRate: expected = base.basePayRate / 2, tolerance ±0.01 (cent)
    // muValue: expected = base.muValue / 2 (raw — do NOT cent-round), tolerance ±0.001
    const expectedBasePayRate = base.basePayRate / 2;
    const expectedMuValue = base.muValue / 2;

    const rateOk = Math.abs(matched.basePayRate - expectedBasePayRate) <= RATE_TOLERANCE;
    const muOk = Math.abs(matched.muValue - expectedMuValue) <= MU_TOLERANCE;
    const hoursOk = Math.abs(matched.timeHours - base.timeHours) <= HOURS_TOLERANCE;

    if (!rateOk || !muOk || !hoursOk) {
      const issues: string[] = [];
      if (!rateOk) issues.push(`basePayRate: expected ${expectedBasePayRate.toFixed(4)} (±0.01), got ${matched.basePayRate.toFixed(4)}`);
      if (!muOk) issues.push(`muValue: expected ${expectedMuValue} (±0.001), got ${matched.muValue}`);
      if (!hoursOk) issues.push(`hours: expected ${base.timeHours.toFixed(4)}, got ${matched.timeHours.toFixed(4)}`);
      flagged.push({
        section: !hoursOk ? 'HOUR_MISMATCH' : 'FLAG_WRONG_RATE',
        sheet: base.sheet,
        row: base.rowNum,
        premiumRow: matched.rowNum,
        name: base.employeeName,
        associateId: base.associateId,
        visitDate: base.visitDate!.toLocaleDateString(),
        baseHours: base.timeHours.toFixed(4),
        premiumHours: matched.timeHours.toFixed(4),
        basePayRate: base.basePayRate,
        expectedPremiumBasePayRate: expectedBasePayRate,
        actualPremiumBasePayRate: matched.basePayRate,
        expectedPremiumMu: expectedMuValue,
        actualPremiumMu: matched.muValue,
        issue: issues.join('; '),
      });
    }
    // If all OK — correctly-formed pair → no flag (pass).
  }

  // ── Orphan premium rows (unmatched after all base rows consumed) ──────────────

  for (const pr of premiumRows) {
    if (matchedPremiumRows.has(pr.rowNum)) continue;
    flagged.push({
      section: 'FLAG_ORPHAN_PREMIUM',
      sheet: pr.sheet,
      row: pr.rowNum,
      name: pr.employeeName,
      associateId: pr.associateId,
      visitDate: pr.visitDate?.toLocaleDateString() ?? '(no date)',
      hours: pr.timeHours.toFixed(2),
      issue: `RI Sunday premium row has no matching base row — possible overbilling`,
    });
  }

  const totalFlagged = flagged.length;
  const status = totalFlagged > 0 ? 'fail' : (baseRows.length > 0 ? 'pass' : 'pass');

  const stats = totalFlagged > 0
    ? `${totalFlagged} issue${totalFlagged === 1 ? '' : 's'} — ${[
        flagged.filter((f) => f.section === 'FLAG_MISSING_PREMIUM').length > 0
          ? `${flagged.filter((f) => f.section === 'FLAG_MISSING_PREMIUM').length} missing premium`
          : '',
        flagged.filter((f) => f.section === 'FLAG_WRONG_RATE').length > 0
          ? `${flagged.filter((f) => f.section === 'FLAG_WRONG_RATE').length} wrong rate`
          : '',
        flagged.filter((f) => f.section === 'FLAG_ORPHAN_PREMIUM').length > 0
          ? `${flagged.filter((f) => f.section === 'FLAG_ORPHAN_PREMIUM').length} orphan premium`
          : '',
        flagged.filter((f) => f.section === 'HOUR_MISMATCH').length > 0
          ? `${flagged.filter((f) => f.section === 'HOUR_MISMATCH').length} hour mismatch`
          : '',
      ].filter(Boolean).join(', ')}`
    : baseRows.length > 0
    ? `${baseRows.length} RI Sunday base row${baseRows.length === 1 ? '' : 's'} validated — all premium pairs correct`
    : 'No RI Sunday entries found';

  return {
    checkId: 16,
    checkName: 'RI Sunday Premium Pay',
    status,
    stats,
    flaggedCount: totalFlagged,
    flaggedRows: flagged,
  };
}
