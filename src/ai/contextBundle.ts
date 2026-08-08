// contextBundle.ts — Builds Tier 2 cross-check context bundles for Deep Dive calls

import type { CheckResult } from '../audit/types';
import { extractAssociateIdentities, matchRowAgainstIdentitySets } from './associateIdentity';

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
  const identities = extractAssociateIdentities(targetResult.flaggedRows);

  if (identities.length === 0) {
    return {
      checkId: targetResult.checkId,
      checkName: targetResult.checkName,
      ruleText,
      crossCheckRows: [],
    };
  }

  const idKeys = new Set(identities.filter((i) => i.kind === 'id').map((i) => i.key));
  const nameKeys = new Set(identities.filter((i) => i.kind === 'name').map((i) => i.key));

  // Scan all other checks for rows matching any of the target identities
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
