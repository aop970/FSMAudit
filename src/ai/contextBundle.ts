// contextBundle.ts — Builds Tier 2 cross-check context bundles for Deep Dive calls

import type { CheckResult } from '../audit/types';

const MAX_CROSS_ROWS_PER_EMPLOYEE = 20;

export interface CrossCheckEmployee {
  employeeName: string;
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
 * Collects all associateIds from the check's flagged rows, then
 * scans all OTHER check results for rows featuring those associates.
 */
export function buildContextBundle(
  targetResult: CheckResult,
  allResults: CheckResult[],
  ruleText: string,
): ContextBundle {
  // Collect all associateId values from the target check's flagged rows
  const associateIds = new Set<string>();
  for (const row of targetResult.flaggedRows) {
    // Support common field name variations
    const id =
      (row['associateId'] as string) ??
      (row['Associate ID'] as string) ??
      (row['associate_id'] as string) ??
      (row['AssociateID'] as string) ??
      '';
    if (id && id.trim()) {
      associateIds.add(id.trim());
    }
  }

  if (associateIds.size === 0) {
    return {
      checkId: targetResult.checkId,
      checkName: targetResult.checkName,
      ruleText,
      crossCheckRows: [],
    };
  }

  // Scan all other checks for rows with matching associateIds
  const otherResults = allResults.filter((r) => r.checkId !== targetResult.checkId);

  const crossCheckMap = new Map<string, CrossCheckEmployee>();

  for (const result of otherResults) {
    for (const row of result.flaggedRows) {
      const rowId =
        (row['associateId'] as string) ??
        (row['Associate ID'] as string) ??
        (row['associate_id'] as string) ??
        (row['AssociateID'] as string) ??
        '';

      if (!rowId || !associateIds.has(rowId.trim())) continue;

      const id = rowId.trim();
      if (!crossCheckMap.has(id)) {
        const employeeName =
          (row['employeeName'] as string) ??
          (row['Employee Name'] as string) ??
          (row['employee_name'] as string) ??
          (row['Name'] as string) ??
          id;
        crossCheckMap.set(id, {
          employeeName,
          associateId: id,
          rows: [],
          trimmed: 0,
        });
      }

      const entry = crossCheckMap.get(id)!;
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
