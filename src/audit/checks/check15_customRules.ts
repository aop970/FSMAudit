// Check 15 — Custom Rules Engine
// Runs all enabled user-defined rules from settings against FSM I + FSM II labor rows.
// Rule types:
//   date_granularity — visitDate must be non-null (row is billed to a specific date, not a range)
//   positive_hours   — timeHours must be > 0
//   required_field   — a named field on LaborRow must be non-empty/non-null
//
// Entry type matching: rule.entryTypes are matched against LaborRow.comments (case-insensitive trim).
// State filter: matched as a case-insensitive substring of LaborRow.associateState (Column J).

import type { CheckResult, LaborRow } from '../types';
import { getAuditRules, type CustomRule } from '../auditRules';

type LaborRowKey = keyof LaborRow;

function matchesEntryType(row: LaborRow, entryTypes: string[]): boolean {
  if (entryTypes.length === 0) return true;
  const comments = row.comments.trim().toLowerCase();
  return entryTypes.some((et) => {
    const t = et.trim().toLowerCase();
    // Exact match first; fall back to substring so minor naming variations still hit
    return comments === t || comments.includes(t) || t.includes(comments);
  });
}

function matchesStateFilter(row: LaborRow, stateFilter: string | undefined): boolean {
  if (!stateFilter || stateFilter.trim() === '') return true;
  // Match against associateState (Column J — "Associate State") as a case-insensitive substring
  return row.associateState.toLowerCase().includes(stateFilter.trim().toLowerCase());
}

function applyRule(row: LaborRow, rule: CustomRule): string | null {
  switch (rule.ruleType) {
    case 'date_granularity':
      // visitDate must be non-null — a null date implies the row was billed without a
      // specific single date (e.g., a date range was used instead)
      if (row.visitDate === null) {
        return 'Row has no specific visit date — billed as a date range rather than a single day';
      }
      return null;

    case 'positive_hours':
      if (row.timeHours <= 0) {
        return `Hours must be > 0, found ${row.timeHours}`;
      }
      return null;

    case 'required_field': {
      if (!rule.fieldName) return null;
      const key = rule.fieldName as LaborRowKey;
      if (!(key in row)) {
        return `Unknown field "${rule.fieldName}" — check rule configuration`;
      }
      const val = row[key];
      if (val === null || val === undefined || String(val).trim() === '') {
        return `Required field "${rule.fieldName}" is empty`;
      }
      return null;
    }

    default:
      return null;
  }
}

export function check15CustomRules(fsmI: LaborRow[], fsmII: LaborRow[]): CheckResult {
  const rules = getAuditRules();
  const enabledRules = rules.customRules.filter((r) => r.enabled);

  if (enabledRules.length === 0) {
    return {
      checkId: 15,
      checkName: 'Custom Rules',
      status: 'na',
      stats: 'No enabled custom rules configured',
      flaggedCount: 0,
      flaggedRows: [],
    };
  }

  const allRows = [...fsmI.map((r) => ({ ...r, _tab: 'FSM I' })), ...fsmII.map((r) => ({ ...r, _tab: 'FSM II' }))];
  const failures: Record<string, unknown>[] = [];

  for (const rule of enabledRules) {
    const candidates = allRows.filter(
      (row) => matchesEntryType(row, rule.entryTypes) && matchesStateFilter(row, rule.stateFilter),
    );

    for (const row of candidates) {
      const violation = applyRule(row, rule);
      if (violation) {
        failures.push({
          rule: rule.name,
          sheet: row.sheet,
          row: row.rowNum,
          name: row.employeeName,
          id: row.associateId,
          comments: row.comments,
          visitDate: row.visitDate ? row.visitDate.toLocaleDateString() : '(none)',
          hours: row.timeHours.toFixed(2),
          violation,
        });
      }
    }
  }

  const totalCandidates = enabledRules.reduce((sum, rule) => {
    return sum + allRows.filter(
      (row) => matchesEntryType(row, rule.entryTypes) && matchesStateFilter(row, rule.stateFilter),
    ).length;
  }, 0);

  const pass = failures.length === 0;
  return {
    checkId: 15,
    checkName: 'Custom Rules',
    status: pass ? 'pass' : 'fail',
    stats: `${enabledRules.length} rule${enabledRules.length === 1 ? '' : 's'} evaluated, ${totalCandidates} row${totalCandidates === 1 ? '' : 's'} tested, ${failures.length} violation${failures.length === 1 ? '' : 's'}`,
    flaggedCount: failures.length,
    flaggedRows: failures.slice(0, 200),
  };
}
