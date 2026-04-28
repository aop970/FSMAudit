import type { ControlTableEntry } from './types';

export const STORAGE_KEY = 'fsm-control-table';
export const STORAGE_TS_KEY = 'fsm-control-table-updated';

export const DEFAULT_CONTROL_TABLE: ControlTableEntry[] = [
  { name: 'Mike King',               associateId: 'MK1002A',   title: 'Account Director',              hourlyRate: 92.32, allocationPct: 0.3682 },
  { name: 'Corey Purdin',            associateId: 'CP1010A',   title: 'National Manager',              hourlyRate: 91.97, allocationPct: 0.3682 },
  { name: 'Elizabeth Hobson',        associateId: 'EW1002I',   title: 'National Manager, SEC',         hourlyRate: 85.46, allocationPct: 0.0000 },
  { name: 'Shawn Scialo',            associateId: 'SS1183I',   title: 'National Manager, FSM',         hourlyRate: 85.46, allocationPct: 1.0000 },
  { name: 'Mike Coronado',           associateId: 'EE016130',  title: 'Operations Manager',            hourlyRate: 71.24, allocationPct: 0.4000 },
  { name: 'Kristen Eberline',        associateId: 'KE1021I',   title: 'Project Manager',               hourlyRate: 63.39, allocationPct: 0.4000 },
  { name: 'Lisa Ghattas',            associateId: 'LJ1011I',   title: 'Operations Coordinator 1',      hourlyRate: 38.75, allocationPct: 0.5700 },
  { name: 'Mason Vanmeter',          associateId: 'MV1046I',   title: 'Operations Coordinator 2',      hourlyRate: 38.75, allocationPct: 0.4700 },
  { name: 'George Macias',           associateId: 'JM1347I',   title: 'Data Analyst',                  hourlyRate: 63.39, allocationPct: 0.5000 },
  { name: 'William Gobar',           associateId: 'WG1011I',   title: 'Insights Analyst, SEC',         hourlyRate: 47.54, allocationPct: 0.0000 },
  { name: 'Amanda Bradshaw',         associateId: 'EE004278',  title: 'Onboarding Specialist, FSM',    hourlyRate: 47.54, allocationPct: 1.0000 },
  { name: 'Patrick Mendez',          associateId: 'PM1024I',   title: 'Onboarding Specialist, SEC',    hourlyRate: 47.54, allocationPct: 0.0000 },
  { name: 'Mary Beth French',        associateId: 'MF1010I',   title: 'Training Manager',              hourlyRate: 54.92, allocationPct: 0.3700 },
  { name: 'Hunter West',             associateId: 'HW1020I',   title: 'Field Operations Manager I',    hourlyRate: 53.88, allocationPct: 0.4300 },
  { name: 'Yamil Saade',             associateId: 'YS1013I',   title: 'Field Operations Manager I',    hourlyRate: 53.88, allocationPct: 0.4300 },
  { name: 'David Exum',              associateId: 'DE1016I',   title: 'Field Operations Manager I',    hourlyRate: 54.93, allocationPct: 1.0000 },
  { name: 'Eric Lopez',              associateId: 'EL1011I',   title: 'Field Operations Manager I',    hourlyRate: 53.88, allocationPct: 0.4300 },
  { name: 'Matthew Wickham',         associateId: 'MW1112I',   title: 'Field Operations Manager I',    hourlyRate: 53.88, allocationPct: 0.4300 },
  { name: 'Miguel Aguilar',          associateId: 'MA1183C',   title: 'Field Operations Manager I',    hourlyRate: 53.88, allocationPct: 0.4300 },
  { name: 'Sara Wali',               associateId: 'SW1147C',   title: 'Field Operations Manager I',    hourlyRate: 53.88, allocationPct: 0.4300 },
  { name: 'Steffanie Molina-Frybarger', associateId: 'EE003697', title: 'Field Operations Manager I', hourlyRate: 53.88, allocationPct: 0.4300 },
  { name: 'Donald Scarfo',           associateId: 'EE010525',  title: 'Field Operations Manager I',    hourlyRate: 53.88, allocationPct: 0.4300 },
  { name: 'David Akom',              associateId: 'EE003625',  title: 'Field Operations Manager I',    hourlyRate: 52.31, allocationPct: 0.4300 },
  { name: 'Rebecca Tejeda',          associateId: 'EE010554',  title: 'Field Operations Manager I',    hourlyRate: 52.31, allocationPct: 0.4300 },
  { name: 'Kenneth Hitt',            associateId: 'EE010650',  title: 'Field Operations Manager I',    hourlyRate: 53.88, allocationPct: 0.4300 },
  { name: 'Belinda Chi',             associateId: 'EE010255',  title: 'Field Operations Manager I',    hourlyRate: 52.31, allocationPct: 0.4300 },
  { name: 'Brian Conner',            associateId: 'EE002390',  title: 'Inventory Specialist',          hourlyRate: 37.63, allocationPct: 0.5000 },
  { name: 'Billy MacDonald',         associateId: 'WM1054A',   title: 'Inventory/IT Specialist',       hourlyRate: 37.48, allocationPct: 1.0000 },
];

export function loadControlTable(): ControlTableEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveControlTable(DEFAULT_CONTROL_TABLE);
      return DEFAULT_CONTROL_TABLE;
    }
    const parsed = JSON.parse(raw) as ControlTableEntry[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      saveControlTable(DEFAULT_CONTROL_TABLE);
      return DEFAULT_CONTROL_TABLE;
    }
    return parsed;
  } catch {
    return DEFAULT_CONTROL_TABLE;
  }
}

export function saveControlTable(table: ControlTableEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
    localStorage.setItem(STORAGE_TS_KEY, new Date().toISOString());
  } catch {
    // storage quota or private mode — silently continue
  }
}

export function getControlTableTimestamp(): string | null {
  try {
    return localStorage.getItem(STORAGE_TS_KEY);
  } catch {
    return null;
  }
}

export function buildControlMap(table: ControlTableEntry[]): Map<string, ControlTableEntry> {
  const m = new Map<string, ControlTableEntry>();
  for (const e of table) {
    m.set(e.associateId.toUpperCase(), e);
  }
  return m;
}
