// contextBundle.ts — Builds Tier 2 cross-check context bundles for Deep Dive calls

import type { CheckResult } from '../audit/types';
import { extractRowMatchKeys, matchRowAgainstIdentitySets } from './associateIdentity';

const MAX_CROSS_ROWS_PER_EMPLOYEE = 20;

export interface CrossCheckEmployee {
  employeeName: string;
  /** Empty string when the identity was resolved by name only (no ID on any matching row). */
  associateId: string;
  rows: { checkId: number; checkName: string; row: Record<string, unknown> }[];
  trimmed: number; // how many rows were cut
}

export interface ContextBundle {
  checkId: number;
  checkName: string;
  ruleText: string;
  crossCheckRows: CrossCheckEmployee[];
}

/**
 * Build a Tier 2 context bundle for a specific check.
 * Collects associate identities from the check's flagged rows (both
 * ID-keyed and name-keyed — see associateIdentity.ts), then scans all OTHER
 * check results for rows featuring those same associates.
 *
 * T-669: previously this only recognized associateId-keyed rows, so SES
 * Check 3 (which emits a bare 'associate' NAME field, per
 * check03_ses_threeWayRecon.ts) always produced associateIds.size === 0 and
 * an empty bundle — Deep Dive on Check 3 always rendered "No cross-check
 * data available" regardless of what other checks knew about the same
 * associates.
 */
export function buildContextBundle(
  targetResult: CheckResult,
  allResults: CheckResult[],
  ruleText: string,
): ContextBundle {
  // T-672: collect BOTH an id-key and a name-key per target row (not the
  // single exclusive-preferred identity extractAssociateIdentities would
  // give). Check 3 now emits associateId alongside its display name, so a
  // row-by-row exclusive-preferred extraction would resolve it as id-only
  // and silently drop the name as a match key — breaking correlation
  // against sibling checks (17, 18, ...) that still only ever emit a name
  // for the same associate. Using both keeps both paths open.
  const idKeys = new Set<string>();
  const nameKeys = new Set<string>();
  for (const row of targetResult.flaggedRows) {
    const { idKey, nameKey } = extractRowMatchKeys(row);
    if (idKey) idKeys.add(idKey);
    if (nameKey) nameKeys.add(nameKey);
  }

  if (idKeys.size === 0 && nameKeys.size === 0) {
    return {
      checkId: targetResult.checkId,
      checkName: targetResult.checkName,
      ruleText,
      crossCheckRows: [],
    };
  }

  // Scan all other checks for rows matching any of the target identities.
  //
  // Known limitation (T-672, accepted — not fixed): a sibling row's dedupe
  // key is `${matched.kind}:${matched.key}` — the KIND it happened to match
  // on, not a canonical per-person key. If two different sibling checks
  // reference the same associate, one via an id-bearing row and another via
  // a name-only row, that associate gets TWO entries in crossCheckRows (one
  // per kind) instead of one merged entry. This never merges data across
  // different people (the keys are still exact-match), it just occasionally
  // splits one person's cross-check data into two list entries under the
  // same display name — a display quirk, not a fabrication risk.
  const otherResults = allResults.filter((r) => r.checkId !== targetResult.checkId);

  const crossCheckMap = new Map<string, CrossCheckEmployee>();

  for (const result of otherResults) {
    for (const row of result.flaggedRows) {
      const matched = matchRowAgainstIdentitySets(row, idKeys, nameKeys);
      if (!matched) continue;

      const dedupeKey = `${matched.kind}:${matched.key}`;
      if (!crossCheckMap.has(dedupeKey)) {
        crossCheckMap.set(dedupeKey, {
          employeeName: matched.displayName,
          associateId: matched.kind === 'id' ? matched.key : '',
          rows: [],
          trimmed: 0,
        });
      }

      const entry = crossCheckMap.get(dedupeKey)!;
      if (entry.rows.length < MAX_CROSS_ROWS_PER_EMPLOYEE) {
        entry.rows.push({
          checkId: result.checkId,
          checkName: result.checkName,
          row,
        });
      } else {
        entry.trimmed++;
      }
    }
  }

  return {
    checkId: targetResult.checkId,
    checkName: targetResult.checkName,
    ruleText,
    crossCheckRows: Array.from(crossCheckMap.values()),
  };
}
