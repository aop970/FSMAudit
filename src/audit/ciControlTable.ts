// ciControlTable.ts — CI associate roster with bill rates + invoice-letter grouping.
// Sourced from the SAM(CI) pricing tab. Re-upload a CSV to refresh.

import type { CiControlEntry } from './types';

export const CI_CONTROL_STORAGE_KEY = 'ci-control-table';
export const CI_CONTROL_TS_KEY      = 'ci-control-table-updated';

// Seed data — will be overridden by user upload of the SAM(CI) pricing tab CSV.
// BillFormat: Monthly = salaried (standard month); Hourly = hourly (time × rate).
export const DEFAULT_CI_CONTROL_TABLE: CiControlEntry[] = [
  // Letter D — Dana Heintz / Sin Chung territory
  { name: '',  associateId: '', role: 'Technical Trainer',         invoiceLetter: 'D', billFormat: 'Monthly', baseRate: 0, state: '', status: 'active' },
  // Letter G
  { name: '',  associateId: '', role: 'Regional Service Engineer', invoiceLetter: 'G', billFormat: 'Monthly', baseRate: 0, state: '', status: 'active' },
  // Letter H
  { name: '',  associateId: '', role: 'Social Support Manager',    invoiceLetter: 'H', billFormat: 'Hourly',  baseRate: 0, state: '', status: 'active' },
];

export function loadCiControlTable(): CiControlEntry[] {
  try {
    const raw = localStorage.getItem(CI_CONTROL_STORAGE_KEY);
    if (!raw) {
      saveCiControlTable(DEFAULT_CI_CONTROL_TABLE);
      return DEFAULT_CI_CONTROL_TABLE;
    }
    const parsed = JSON.parse(raw) as CiControlEntry[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      saveCiControlTable(DEFAULT_CI_CONTROL_TABLE);
      return DEFAULT_CI_CONTROL_TABLE;
    }
    return parsed;
  } catch {
    return DEFAULT_CI_CONTROL_TABLE;
  }
}

export function saveCiControlTable(table: CiControlEntry[]): void {
  try {
    localStorage.setItem(CI_CONTROL_STORAGE_KEY, JSON.stringify(table));
    localStorage.setItem(CI_CONTROL_TS_KEY, new Date().toISOString());
  } catch {
    // storage quota or private mode — silently continue
  }
}

export function buildCiControlMap(table: CiControlEntry[]): Map<string, CiControlEntry> {
  const m = new Map<string, CiControlEntry>();
  for (const e of table) {
    if (e.associateId) m.set(e.associateId.toUpperCase(), e);
  }
  return m;
}
