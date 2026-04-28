// Check 3 — Punch Reconciliation
// Aggregate FSM I+II hours by category vs Punch CSV hours by category.
// For any mismatching category, also build a per-person per-day breakdown
// so the AI can identify exactly who and on what day the variance originates.

import type { CheckResult, LaborRow, PunchRow } from '../types';
import { toStr } from '../../lib/num';
import { getAuditRules } from '../auditRules';

function normalizeCategory(s: string): string {
  return toStr(s).toLowerCase();
}

function aggregate(
  rows: { comments: string; timeHours: number }[],
  supportedSet: Set<string>,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const cat = normalizeCategory(r.comments);
    if (!supportedSet.has(cat)) continue;
    m.set(cat, (m.get(cat) ?? 0) + r.timeHours);
  }
  return m;
}

function buildPerPersonBreakdown(
  laborRows: LaborRow[],
  punchRows: PunchRow[],
  category: string,
  hoursTol: number,
): Record<string, unknown>[] {
  // Group invoice hours: (associateId|dateStr) → { name, hrs }
  const invMap = new Map<string, { name: string; hrs: number }>();
  for (const r of laborRows) {
    if (normalizeCategory(r.comments) !== category) continue;
    if (!r.visitDate) continue;
    const key = `${r.associateId.toUpperCase()}|${r.visitDate.toLocaleDateString()}`;
    const cur = invMap.get(key);
    if (cur) { cur.hrs += r.timeHours; }
    else { invMap.set(key, { name: r.employeeName, hrs: r.timeHours }); }
  }

  // Group punch hours: (associateId|dateStr) → hrs
  const punchMap = new Map<string, number>();
  for (const r of punchRows) {
    if (normalizeCategory(r.comments) !== category) continue;
    if (!r.visitDate) continue;
    const key = `${r.associateId.toUpperCase()}|${r.visitDate.toLocaleDateString()}`;
    punchMap.set(key, (punchMap.get(key) ?? 0) + r.timeHours);
  }

  // Collect all keys and find deltas outside tolerance
  const allKeys = new Set([...invMap.keys(), ...punchMap.keys()]);
  const rows: Record<string, unknown>[] = [];

  for (const key of allKeys) {
    const [id, date] = key.split('|');
    const invoiceHrs = invMap.get(key)?.hrs ?? 0;
    const punchHrs   = punchMap.get(key) ?? 0;
    const delta      = punchHrs - invoiceHrs;
    if (Math.abs(delta) <= hoursTol) continue;
    rows.push({
      associateId: id,
      name: invMap.get(key)?.name ?? id,
      date,
      invoiceHrs: invoiceHrs.toFixed(2),
      punchHrs:   punchHrs.toFixed(2),
      delta: (delta >= 0 ? '+' : '') + delta.toFixed(2),
    });
  }

  // Sort largest absolute delta first, cap at 100 rows for AI payload
  return rows
    .sort((a, b) => Math.abs(parseFloat(String(b.delta))) - Math.abs(parseFloat(String(a.delta))))
    .slice(0, 100);
}

export function check03PunchRecon(
  fsmI: LaborRow[],
  fsmII: LaborRow[],
  punch: PunchRow[],
): CheckResult {
  if (punch.length === 0) {
    return {
      checkId: 3,
      checkName: 'Punch Reconciliation',
      status: 'na',
      stats: 'No punch CSV uploaded — skipped',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const rules = getAuditRules();
  const hoursTol = rules.tolerances.hours;
  const supportedSet  = new Set(rules.punchCategories.supported.map((s) => s.toLowerCase()));
  const exceptionsSet = new Set(rules.punchCategories.exceptions.map((s) => s.toLowerCase()));

  const allLabor = [...fsmI, ...fsmII];
  const laborMap = aggregate(allLabor, supportedSet);
  const punchMap = aggregate(punch, supportedSet);

  const allCats = new Set([...laborMap.keys(), ...punchMap.keys()]);
  const failures: Record<string, unknown>[] = [];
  const detail: Record<string, unknown>[] = [];

  // Per-category summaries + per-person breakdowns for mismatches
  const perPersonByCategory: Record<string, Record<string, unknown>[]> = {};

  for (const cat of Array.from(allCats).sort()) {
    if (exceptionsSet.has(cat)) continue;
    const laborHrs = laborMap.get(cat) ?? 0;
    const punchHrs = punchMap.get(cat) ?? 0;
    const delta    = punchHrs - laborHrs;
    const ok       = Math.abs(delta) <= hoursTol;

    const row = {
      category: cat.charAt(0).toUpperCase() + cat.slice(1),
      laborHrs: laborHrs.toFixed(2),
      punchHrs: punchHrs.toFixed(2),
      delta: (delta >= 0 ? '+' : '') + delta.toFixed(2),
      status: ok ? 'OK' : 'MISMATCH',
    };
    detail.push(row);
    if (!ok) {
      failures.push(row);
      perPersonByCategory[cat] = buildPerPersonBreakdown(allLabor, punch, cat, hoursTol);
    }
  }

  const pass = failures.length === 0;
  return {
    checkId: 3,
    checkName: 'Punch Reconciliation',
    status: pass ? 'pass' : 'fail',
    stats: `${allCats.size} categories reconciled, ${failures.length} mismatch${failures.length === 1 ? '' : 'es'}`,
    flaggedCount: failures.length,
    flaggedRows: pass ? detail : failures,
    details: {
      categoryBreakdown: detail,
      // Per-person per-day deltas for each mismatching category — consumed by AI analysis
      perPersonBreakdown: perPersonByCategory,
    },
  };
}
