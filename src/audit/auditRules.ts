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

export interface AuditRules {
  markupRates: {
    ft: number;   // default 0.2993
    pt: number;   // default 0.2770
  };
  hourlyRates: {
    fsmI: number;   // $/hr base rate for FSM I rows; 0 = not configured (skip check)
    fsmII: number;  // $/hr base rate for FSM II rows; 0 = not configured (skip check)
  };
  punchCategories: {
    supported: string[];  // default: Work, Travel, Admin, Training, Meeting, Break
    exceptions: string[]; // default: Time Off, Paid Holiday, Termed PTO, Over Time
  };
  otThreshold: number;         // default 3.99 (hours > this value)
  tolerances: {
    dollar: number;  // default 0.01
    hours: number;   // default 0.01
  };
  invoiceTabs: {
    toLoad: string[];         // default: FSM I, FSM II, Management Detail Hours, Cloud Services, Roster, Roster II, Invoice Summary, OT Approval
    alwaysExclude: string[];  // default: SOW
  };
  poNumber: string;            // default: T26C31H000162 — verified against E17 of first tab
  bragiSystemPrompt: string;
  customRules: CustomRule[];   // user-defined audit constraints, run as Check 15
}

export const DEFAULT_RULES: AuditRules = {
  markupRates: {
    ft: 0.2993,
    pt: 0.2770,
  },
  hourlyRates: {
    fsmI: 0,
    fsmII: 0,
  },
  punchCategories: {
    supported: ['Work', 'Travel', 'Admin', 'Training', 'Meeting', 'Break'],
    exceptions: ['Time Off', 'Paid Holiday', 'Termed PTO', 'Over Time'],
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
      'Roster',
      'Roster II',
      'Invoice Summary',
      'OT Approval',
    ],
    alwaysExclude: ['SOW'],
  },
  poNumber: 'T26C31H000162',
  customRules: [],
  bragiSystemPrompt:
    'You are an expert invoice auditor for a field services management program. ' +
    'You will receive a structured JSON summary of audit failures for a specific check. ' +
    'Identify the root cause, flag the specific rows or values of concern by name and ID, ' +
    'and provide a clear recommended action. Be concise. Return findings in three sections: ' +
    'Root Cause, Rows of Concern, Recommended Action.',
};

const STORAGE_KEY = 'fsm-audit-rules';

function deepMerge(defaults: AuditRules, stored: Partial<AuditRules>): AuditRules {
  return {
    markupRates: { ...defaults.markupRates, ...(stored.markupRates ?? {}) },
    hourlyRates: { ...defaults.hourlyRates, ...(stored.hourlyRates ?? {}) },
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
    bragiSystemPrompt: stored.bragiSystemPrompt ?? defaults.bragiSystemPrompt,
    customRules: stored.customRules ?? defaults.customRules,
  };
}

/** Read rules from storage. If not found, seed defaults and return them. */
export function getAuditRules(): AuditRules {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      writeAuditRules(DEFAULT_RULES);
      return DEFAULT_RULES;
    }
    const parsed = JSON.parse(raw) as Partial<AuditRules>;
    return deepMerge(DEFAULT_RULES, parsed);
  } catch {
    return DEFAULT_RULES;
  }
}

/** Persist a full rules object to storage. Returns true on success. */
export function writeAuditRules(rules: AuditRules): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    return true;
  } catch {
    return false;
  }
}

/** Write a single section. Reads current rules, merges, writes back. */
export function saveRulesSection<K extends keyof AuditRules>(
  section: K,
  value: AuditRules[K],
): boolean {
  try {
    const current = getAuditRules();
    const next = { ...current, [section]: value };
    return writeAuditRules(next);
  } catch {
    return false;
  }
}

/** Reset a single section to factory defaults. */
export function resetSection<K extends keyof AuditRules>(section: K): boolean {
  return saveRulesSection(section, DEFAULT_RULES[section]);
}

/** Reset all rules to factory defaults. */
export function resetAllRules(): boolean {
  return writeAuditRules(DEFAULT_RULES);
}
