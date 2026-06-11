// auditRules.ts — Persistent audit configuration store.
// Key: fsm-audit-rules in localStorage.
// On load: if key missing, write defaults silently. No user prompt.
// All audit engine reads go through getAuditRules() — never hardcoded constants.

export type RuleType = 'date_granularity' | 'positive_hours' | 'required_field';

export interface CustomRule {
  id: string;           // timestamp string used as unique key
  name: string;
  enabled: boolean;
  entryTypes: string[]; // matches against LaborRow.comments (case-insensitive), e.g. ["Over Time", "Time Off"]
  ruleType: RuleType;
  stateFilter?: string; // optional — matches against LaborRow.comments (case-insensitive substring)
  fieldName?: string;   // for required_field rule type — LaborRow field name to check
}

export interface HolidayEntry {
  date: string;   // "YYYY-MM-DD"
  hours: number;  // expected hours (default 8, allow 4 etc.)
  name: string;   // e.g. "Thanksgiving"
}

export interface AuditRules {
  markupRates: {
    ft: number;   // default 0.2993
    pt: number;   // default 0.2770
  };
  hourlyRates: {
    fsmI: number;       // $/hr base rate for FSM I rows; 0 = not configured (skip check)
    fsmII: number;      // $/hr base rate for FSM II rows; 0 = not configured (skip check)
    fsmIMerit: number;  // $/hr base rate for FSM I Merit rows; 0 = skip check
    fsmIIMerit: number; // $/hr base rate for FSM II Merit rows; 0 = skip check
  };
  otHourlyRates: {
    fsmI: number;       // $/hr OT rate for FSM I rows (typically half of fsmI); 0 = skip check
    fsmII: number;      // $/hr OT rate for FSM II rows; 0 = skip check
    fsmIMerit: number;  // $/hr OT rate for FSM I Merit rows; 0 = skip check
    fsmIIMerit: number; // $/hr OT rate for FSM II Merit rows; 0 = skip check
  };
  punchCategories: {
    supported: string[];  // default: Work, Travel, Admin, Training, Meeting, Break
    exceptions: string[]; // default: Time Off, Paid Holiday, Termed PTO, Overtime
  };
  otThreshold: number;         // default 3.99 (hours > this value)
  tolerances: {
    dollar: number;  // default 0.01
    hours: number;   // default 0.01
  };
  invoiceTabs: {
    toLoad: string[];         // default: FSM I, FSM II, Management Detail Hours, Cloud Services, FSM Roster, Invoice Summary, OT Approval
    alwaysExclude: string[];  // default: SOW
  };
  poNumber: string;            // default: T26C31H000162 — verified against E17 of first tab
  bragiSystemPrompt: string;
  customRules: CustomRule[];   // user-defined audit constraints, run as Check 15
  otExceptions: { week: number; maxHours: number; note: string }[]; // blanket OT approvals by week
  holidays: HolidayEntry[];    // per-program holiday schedule for Paid Holiday validation (Check 18)
  poByInvoice?: Record<string, string>;
}

export const DEFAULT_RULES: AuditRules = {
  markupRates: {
    ft: 0.2993,
    pt: 0.2770,
  },
  hourlyRates: {
    fsmI: 0,
    fsmII: 0,
    fsmIMerit: 0,
    fsmIIMerit: 0,
  },
  otHourlyRates: {
    fsmI: 0,
    fsmII: 0,
    fsmIMerit: 0,
    fsmIIMerit: 0,
  },
  punchCategories: {
    supported: ['Work', 'Travel', 'Admin', 'Training', 'Meeting', 'Break'],
    exceptions: ['Time Off', 'Paid Holiday', 'Termed PTO', 'Overtime'],
  },
  otThreshold: 3.99,
  tolerances: {
    dollar: 0.01,
    hours: 0.01,
  },
  invoiceTabs: {
    toLoad: [
      'FSM I',
      'FSM II',
      'Management Detail Hours',
      'Cloud Services',
      'FSM Roster',
      'Invoice Summary',
      'OT Approval',
    ],
    alwaysExclude: ['SOW'],
  },
  poNumber: 'T26C31H000162',
  customRules: [],
  otExceptions: [],
  holidays: [
    { date: '2026-06-19', hours: 4,  name: 'Juneteenth' },
    { date: '2026-07-04', hours: 8,  name: 'Independence Day' },
    { date: '2026-09-07', hours: 8,  name: 'Labor Day Fed' },
    { date: '2026-11-11', hours: 4,  name: 'Veterans Day' },
    { date: '2026-11-26', hours: 8,  name: 'Thanksgiving Day' },
    { date: '2026-12-24', hours: 8,  name: 'Christmas Eve' },
    { date: '2026-12-25', hours: 8,  name: 'Christmas Day' },
    { date: '2026-12-31', hours: 4,  name: "New Year's Eve" },
  ],
  bragiSystemPrompt:
    'You are an expert invoice auditor for a field services management program. ' +
    'You will receive a structured JSON summary of audit failures for a specific check. ' +
    'Identify the root cause, flag the specific rows or values of concern by name and ID, ' +
    'and provide a clear recommended action. Be concise. Return findings in three sections: ' +
    'Root Cause, Rows of Concern, Recommended Action.',
};

export const DEFAULT_SES_RULES: AuditRules = {
  markupRates: { ft: 0.2993, pt: 0.2770 },
  hourlyRates: { fsmI: 0, fsmII: 0, fsmIMerit: 0, fsmIIMerit: 0 },
  otHourlyRates: { fsmI: 0, fsmII: 0, fsmIMerit: 0, fsmIIMerit: 0 },
  punchCategories: {
    supported: ['Work', 'Travel', 'Admin', 'Training', 'Meeting', 'Break'],
    exceptions: ['Time Off', 'Paid Holiday', 'Termed PTO', 'Overtime'],
  },
  otThreshold: 3.99,
  tolerances: { dollar: 0.01, hours: 0.01 },
  invoiceTabs: {
    toLoad: ['Detail', 'Management Detail Hours', 'Cloud Services', 'Invoice Summary'],
    alwaysExclude: ['SOW'],
  },
  poNumber: 'T26C31H000163',
  customRules: [],
  otExceptions: [],
  holidays: [
    { date: '2026-06-19', hours: 4,  name: 'Juneteenth' },
    { date: '2026-07-04', hours: 8,  name: 'Independence Day' },
    { date: '2026-09-07', hours: 8,  name: 'Labor Day Fed' },
    { date: '2026-11-11', hours: 4,  name: 'Veterans Day' },
    { date: '2026-11-26', hours: 8,  name: 'Thanksgiving Day' },
    { date: '2026-12-24', hours: 8,  name: 'Christmas Eve' },
    { date: '2026-12-25', hours: 8,  name: 'Christmas Day' },
    { date: '2026-12-31', hours: 4,  name: "New Year's Eve" },
  ],
  bragiSystemPrompt: DEFAULT_RULES.bragiSystemPrompt,
};

export const CI_STORAGE_KEY = 'ci-audit-rules';

export const DEFAULT_CI_RULES: AuditRules = {
  markupRates: { ft: 0.30, pt: 0.30 },
  hourlyRates: { fsmI: 0, fsmII: 0, fsmIMerit: 0, fsmIIMerit: 0 },
  otHourlyRates: { fsmI: 0, fsmII: 0, fsmIMerit: 0, fsmIIMerit: 0 },
  punchCategories: {
    supported:  ['Work'],
    exceptions: ['Time Off', 'Holiday', 'Overtime'],
  },
  otThreshold: 3.99,
  tolerances: { dollar: 0.01, hours: 0.01 },
  invoiceTabs: {
    toLoad: ['Detail', 'Cloud Services', 'New Hire Fees', 'Tie-Out', 'Invoice Schedule'],
    alwaysExclude: ['SOW', 'BQMS PO'],
  },
  poByInvoice: {
    'CI26-W19-22A':   'SEA2601198850',
    'CI26-W19-22J':   'SEA2508155410',
    'VOCB26-W19-22':  'SEA2502031015',
    'VOCDA26-W19-22': 'SEA2501310984',
    'VOCE26-W19-22':  'SEA2510146674',
    'VOCF26-W19-22':  'SEA2601198847',
  },
  poNumber: '',
  holidays: [
    { date: '2026-01-01', hours: 8, name: "New Year's Day" },
    { date: '2026-01-19', hours: 8, name: 'MLK Day' },
    { date: '2026-02-16', hours: 8, name: "Presidents' Day" },
    { date: '2026-05-25', hours: 8, name: 'Memorial Day' },
    { date: '2026-07-04', hours: 8, name: 'Independence Day' },
    { date: '2026-09-07', hours: 8, name: 'Labor Day' },
    { date: '2026-11-11', hours: 4, name: 'Veterans Day' },
    { date: '2026-11-26', hours: 8, name: 'Thanksgiving Day' },
    { date: '2026-12-25', hours: 8, name: 'Christmas Day' },
  ],
  customRules: [],
  otExceptions: [],
  bragiSystemPrompt: DEFAULT_RULES.bragiSystemPrompt,
};

const STORAGE_KEY = 'fsm-audit-rules';
const SES_STORAGE_KEY = 'ses-audit-rules';

function storageKey(program?: 'fsm' | 'ses' | 'ci'): string {
  if (program === 'ses') return SES_STORAGE_KEY;
  if (program === 'ci')  return CI_STORAGE_KEY;
  return STORAGE_KEY;
}

function defaultRules(program?: 'fsm' | 'ses' | 'ci'): AuditRules {
  if (program === 'ses') return DEFAULT_SES_RULES;
  if (program === 'ci')  return DEFAULT_CI_RULES;
  return DEFAULT_RULES;
}

function deepMerge(defaults: AuditRules, stored: Partial<AuditRules>): AuditRules {
  return {
    markupRates: { ...defaults.markupRates, ...(stored.markupRates ?? {}) },
    hourlyRates: {
      ...defaults.hourlyRates,
      ...(stored.hourlyRates ?? {}),
      // Ensure new Merit fields are present even when loaded from older stored data
      fsmIMerit:  (stored.hourlyRates as Record<string, number> | undefined)?.fsmIMerit  ?? defaults.hourlyRates.fsmIMerit,
      fsmIIMerit: (stored.hourlyRates as Record<string, number> | undefined)?.fsmIIMerit ?? defaults.hourlyRates.fsmIIMerit,
    },
    otHourlyRates: {
      ...defaults.otHourlyRates,
      ...(stored.otHourlyRates ?? {}),
      fsmIMerit:  (stored.otHourlyRates as Record<string, number> | undefined)?.fsmIMerit  ?? defaults.otHourlyRates.fsmIMerit,
      fsmIIMerit: (stored.otHourlyRates as Record<string, number> | undefined)?.fsmIIMerit ?? defaults.otHourlyRates.fsmIIMerit,
    },
    punchCategories: {
      supported: stored.punchCategories?.supported ?? defaults.punchCategories.supported,
      exceptions: stored.punchCategories?.exceptions ?? defaults.punchCategories.exceptions,
    },
    otThreshold: stored.otThreshold ?? defaults.otThreshold,
    tolerances: { ...defaults.tolerances, ...(stored.tolerances ?? {}) },
    invoiceTabs: {
      toLoad: stored.invoiceTabs?.toLoad ?? defaults.invoiceTabs.toLoad,
      alwaysExclude: stored.invoiceTabs?.alwaysExclude ?? defaults.invoiceTabs.alwaysExclude,
    },
    poNumber: stored.poNumber ?? defaults.poNumber,
    poByInvoice: stored.poByInvoice ?? defaults.poByInvoice,
    bragiSystemPrompt: stored.bragiSystemPrompt ?? defaults.bragiSystemPrompt,
    customRules: stored.customRules ?? defaults.customRules,
    otExceptions: stored.otExceptions ?? defaults.otExceptions,
    holidays: stored.holidays ?? defaults.holidays ?? [],
  };
}

/** Read rules from storage. If not found, seed defaults and return them. */
export function getAuditRules(program?: 'fsm' | 'ses' | 'ci'): AuditRules {
  const key = storageKey(program);
  const defs = defaultRules(program);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      writeAuditRules(defs, program);
      return defs;
    }
    const parsed = JSON.parse(raw) as Partial<AuditRules>;
    return deepMerge(defs, parsed);
  } catch {
    return defs;
  }
}

/** Persist a full rules object to storage. Returns true on success. */
export function writeAuditRules(rules: AuditRules, program?: 'fsm' | 'ses' | 'ci'): boolean {
  try {
    localStorage.setItem(storageKey(program), JSON.stringify(rules));
    return true;
  } catch {
    return false;
  }
}

/** Write a single section. Reads current rules, merges, writes back. */
export function saveRulesSection<K extends keyof AuditRules>(
  section: K,
  value: AuditRules[K],
  program?: 'fsm' | 'ses' | 'ci',
): boolean {
  try {
    const current = getAuditRules(program);
    const next = { ...current, [section]: value };
    return writeAuditRules(next, program);
  } catch {
    return false;
  }
}

/** Reset a single section to factory defaults. */
export function resetSection<K extends keyof AuditRules>(section: K, program?: 'fsm' | 'ses' | 'ci'): boolean {
  return saveRulesSection(section, defaultRules(program)[section], program);
}

/** Reset all rules to factory defaults. */
export function resetAllRules(): boolean {
  return writeAuditRules(DEFAULT_RULES);
}
