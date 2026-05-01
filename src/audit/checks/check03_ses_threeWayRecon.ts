// Check 3 (SES) — Three-Way Punch Reconciliation
// Invoice side: Work hours only (shift report only captures store visits, not training/travel/admin).
// Punch side:   Work hours only (same scope as invoice and shift).
// Shift side:   sum of actualMinutes ÷ 60 across both weekly shift reports.
// Total tolerance: ≤ 2 hours across any pairwise comparison.
// Per-person tolerance: ≤ 0.3 hours. Pivot fires only when total variance fails.

import type { CheckResult, LaborRow, SesPunchRow, ShiftRow } from '../types';

const PUNCH_SUPPORTED = new Set(['work']);
const TOTAL_TOL = 2.0;
const PER_PERSON_TOL = 0.3;

function normKey(id: string, name: string): string {
  const trimId = id.trim();
  if (trimId) return trimId.toLowerCase();
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function check03SesThreeWayRecon(
  detailRows: LaborRow[],
  punchRows: SesPunchRow[],
  shiftRows: ShiftRow[],
): CheckResult {
  const noPunch = punchRows.length === 0;
  const noShift = shiftRows.length === 0;

  if (noPunch && noShift) {
    return {
      checkId: 3,
      checkName: 'Three-Way Punch Recon',
      status: 'na',
      stats: 'No punch or shift files uploaded',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // Invoice: punch-supported categories only (Work, Admin, Travel, Training)
  const invoiceHrs = detailRows.reduce((s, r) => {
    const cat = r.comments.toLowerCase().trim();
    return PUNCH_SUPPORTED.has(cat) ? s + r.timeHours : s;
  }, 0);

  // Punch: Work only — shift report only captures store visits
  const punchHrs = punchRows.reduce((s, r) => {
    const t = (r.timeType ?? '').toLowerCase().trim();
    return (!t || t === 'work') ? s + r.timeHours : s;
  }, 0);

  // Shift: actualMinutes ÷ 60 (column Y "Actual Time Entered In Call Report" is in minutes)
  const shiftHrs = shiftRows.reduce((s, r) => s + r.actualMinutes / 60, 0);

  // ── total-level check ────────────────────────────────────────────────────────

  const variances: { label: string; value: number; delta: number }[] = [];
  if (!noPunch) variances.push({ label: 'Invoice vs Punch', value: Math.abs(invoiceHrs - punchHrs),   delta: invoiceHrs - punchHrs });
  if (!noShift) variances.push({ label: 'Invoice vs Shift', value: Math.abs(invoiceHrs - shiftHrs),   delta: invoiceHrs - shiftHrs });
  if (!noPunch && !noShift) variances.push({ label: 'Punch vs Shift', value: Math.abs(punchHrs - shiftHrs), delta: punchHrs - shiftHrs });

  const anyTotalFail = variances.some((v) => v.value > TOTAL_TOL);
  const failLabels = variances.filter((v) => v.value > TOTAL_TOL).map((v) => v.label);

  if (!anyTotalFail) {
    const parts = [`Invoice ${invoiceHrs.toFixed(2)}h`];
    if (!noPunch) parts.push(`Punch ${punchHrs.toFixed(2)}h`);
    if (!noShift) parts.push(`Shift ${shiftHrs.toFixed(2)}h`);
    return {
      checkId: 3,
      checkName: 'Three-Way Punch Recon',
      status: 'pass',
      stats: `${parts.join(' | ')} — all within ${TOTAL_TOL}h tolerance`,
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  // ── per-person pivot (fires only on total fail) ──────────────────────────────

  // Build maps: key → hours per source
  const invoiceMap = new Map<string, { name: string; hrs: number }>();
  for (const r of detailRows) {
    const cat = r.comments.toLowerCase().trim();
    if (!PUNCH_SUPPORTED.has(cat)) continue;
    const k = normKey(r.associateId, r.employeeName);
    const existing = invoiceMap.get(k);
    if (existing) existing.hrs += r.timeHours;
    else invoiceMap.set(k, { name: r.employeeName || r.associateId, hrs: r.timeHours });
  }

  const punchMap = new Map<string, { name: string; hrs: number }>();
  for (const r of punchRows) {
    const k = normKey(r.associateId, r.employeeName);
    const existing = punchMap.get(k);
    if (existing) existing.hrs += r.timeHours;
    else punchMap.set(k, { name: r.employeeName || r.associateId, hrs: r.timeHours });
  }

  const shiftMap = new Map<string, { name: string; hrs: number }>();
  for (const r of shiftRows) {
    const k = normKey(r.associateId, r.employeeName);
    const hrs = r.actualMinutes / 60;
    const existing = shiftMap.get(k);
    if (existing) existing.hrs += hrs;
    else shiftMap.set(k, { name: r.employeeName || r.associateId, hrs });
  }

  // Union of all keys
  const allKeys = new Set([...invoiceMap.keys(), ...punchMap.keys(), ...shiftMap.keys()]);
  const personRows: Record<string, unknown>[] = [];

  for (const k of allKeys) {
    const inv  = invoiceMap.get(k)?.hrs ?? 0;
    const pch  = punchMap.get(k)?.hrs  ?? 0;
    const sft  = shiftMap.get(k)?.hrs  ?? 0;
    const name = invoiceMap.get(k)?.name ?? punchMap.get(k)?.name ?? shiftMap.get(k)?.name ?? k;

    const ivp = !noPunch ? Math.abs(inv - pch) : null;
    const ivs = !noShift ? Math.abs(inv - sft) : null;
    const pvs = !noPunch && !noShift ? Math.abs(pch - sft) : null;

    const personFail = (ivp != null && ivp > PER_PERSON_TOL)
      || (ivs != null && ivs > PER_PERSON_TOL)
      || (pvs != null && pvs > PER_PERSON_TOL);

    if (!personFail) continue;

    const entry: Record<string, unknown> = {
      associate: name,
      invoiceHrs: inv.toFixed(2),
    };
    if (!noPunch) {
      entry.punchHrs = pch.toFixed(2);
      entry.invoiceVsPunch = (inv - pch).toFixed(2);
    }
    if (!noShift) {
      entry.shiftHrs = sft.toFixed(2);
      entry.invoiceVsShift = (inv - sft).toFixed(2);
    }
    if (!noPunch && !noShift) {
      entry.punchVsShift = (pch - sft).toFixed(2);
    }
    personRows.push(entry);
  }

  // Summary row always first
  const summaryRow: Record<string, unknown> = {
    associate: '— TOTAL —',
    invoiceHrs: invoiceHrs.toFixed(2),
  };
  if (!noPunch) {
    summaryRow.punchHrs = punchHrs.toFixed(2);
    summaryRow.invoiceVsPunch = (invoiceHrs - punchHrs).toFixed(2);
  }
  if (!noShift) {
    summaryRow.shiftHrs = shiftHrs.toFixed(2);
    summaryRow.invoiceVsShift = (invoiceHrs - shiftHrs).toFixed(2);
  }
  if (!noPunch && !noShift) {
    summaryRow.punchVsShift = (punchHrs - shiftHrs).toFixed(2);
  }

  const flaggedRows = [summaryRow, ...personRows];

  return {
    checkId: 3,
    checkName: 'Three-Way Punch Recon',
    status: 'fail',
    stats: `Variance exceeds ${TOTAL_TOL}h tolerance: ${failLabels.join(', ')} — ${personRows.length} associate${personRows.length === 1 ? '' : 's'} flagged (>${PER_PERSON_TOL}h individual variance)`,
    flaggedCount: personRows.length,
    flaggedRows,
  };
}
