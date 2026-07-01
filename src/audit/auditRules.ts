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
  otThreshold: number;         // default 3.99 (hours > this value) — legacy; kept for other checks
  /** Check 7 tiered OT approval thresholds.
   *  otApprovalDlMin: hours > this value (exclusive) triggers DL Approval tier (Orange).
   *  otApprovalExecMin: hours >= this value triggers Exec Approval tier (Red).
   *  Default: 2.0 / 4.0 per Allan's spec 2026-06-23.
   */
  otApprovalDlMin: number;     // default 2.0 (>2.00 hrs needs DL approval)
  otApprovalExecMin: number;   // default 4.0 (>=4.00 hrs needs Exec approval)
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
  otApprovalDlMin: 2.0,
  otApprovalExecMin: 4.0,
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
    { date: '2026-05-25', hours: 8,  name: 'Memorial Day' },    // added T-496 (was missing, caused 419 false flags in run #4)
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
  otApprovalDlMin: 2.0,
  otApprovalExecMin: 4.0,
  tolerances: { dollar: 0.01, hours: 0.01 },
  invoiceTabs: {
    toLoad: ['Detail', 'Management Detail Hours', 'Cloud Services', 'Invoice Summary'],
    alwaysExclude: ['SOW'],
  },
  poNumber: 'T26C31H000163',
  customRules: [],
  otExceptions: [],
  holidays: [
    { date: '2026-05-25', hours: 8,  name: 'Memorial Day' },    // added T-496 (was missing, caused false flags matching FSM)
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
  otApprovalDlMin: 2.0,
  otApprovalExecMin: 4.0,
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

// ── Server-backed rules cache (T-496 Workstream C) ────────────────────────────
// Module-level cache populated by initAuditRulesFromServer() (async, called from App.tsx).
// getAuditRules() reads this cache first; falls back to localStorage if not populated.
// Allows getAuditRules() to stay synchronous while still reading server rules after init.

const _serverCache = new Map<string, AuditRules>();

/**
 * Sync status for a program: 'server' | 'local' | 'unknown'.
 * 'server' = rules loaded from / last saved to Neon.
 * 'local'  = rules only in localStorage (API offline or not configured).
 */
const _syncStatus = new Map<string, 'server' | 'local'>();

export type RulesSyncStatus = 'server' | 'local' | 'unknown';

export function getRulesSyncStatus(program?: 'fsm' | 'ses' | 'ci'): RulesSyncStatus {
  return _syncStatus.get(program ?? 'fsm') ?? 'unknown';
}

/**
 * Async init — call from App.tsx useEffect on mount.
 * When the server HAS rules for a program: load them into cache + mirror to localStorage.
 * When the server has NONE: leave the browser on its local rules and mark 'local' — never
 * auto-seed defaults to the server (that would clobber Allan's local rules; T-496/Vera).
 * Neon is populated only by the explicit uploadLocalRulesToServer action.
 * Never throws — API failure falls back silently to localStorage.
 */
export async function initAuditRulesFromServer(): Promise<void> {
  // Lazy import to avoid circular dep — auditApi imports nothing from auditRules
  const { getRulesFromServer, isApiConfigured } = await import('../lib/auditApi');
  if (!isApiConfigured()) return;

  const programs: ('fsm' | 'ses' | 'ci')[] = ['fsm', 'ses', 'ci'];
  for (const prog of programs) {
    try {
      const serverRules = await getRulesFromServer(prog);

      if (!serverRules) {
        // Server has NO rules for this program yet. Do NOT auto-seed with hardcoded
        // defaults and do NOT overwrite localStorage — that would let the first browser
        // to load after deploy establish a zeroed/default ruleset as the GLOBAL shared
        // set, clobbering Allan's real configured rates/custom rules that live only in
        // his browser's localStorage (nondeterministic first-loader-wins). (T-496, Vera)
        //
        // Instead: leave the browser operating on its effective local rules
        // (getAuditRules already merges localStorage over defaults) and mark 'local' so
        // the "Upload to server" prompt surfaces. Neon is populated ONLY by the explicit
        // uploadLocalRulesToServer action from a deliberately-configured machine.
        _syncStatus.set(prog, 'local');
        continue;
      }

      // Server HAS rules — load them into cache and let them win.
      // Merge with defaults only to fill schema gaps (new fields on older stored data).
      const defs = defaultRules(prog);
      const merged = deepMerge(defs, serverRules as Partial<AuditRules>);

      _serverCache.set(prog, merged);
      _syncStatus.set(prog, 'server');
      // Safe to mirror to localStorage: this is a REAL server ruleset, not defaults.
      try { localStorage.setItem(storageKey(prog), JSON.stringify(merged)); } catch { /* ok */ }
    } catch (err) {
      // API error — log and fall back to localStorage; don't crash audit
      console.warn(`[auditRules] initAuditRulesFromServer(${prog}) failed, using localStorage:`, err);
      _syncStatus.set(prog, 'local');
    }
  }
}

/**
 * Push current localStorage rules (for a program) to the server.
 * Called from AuditRulesPanel "Upload local rules to server" action.
 */
export async function uploadLocalRulesToServer(program?: 'fsm' | 'ses' | 'ci'): Promise<boolean> {
  const { saveRulesToServer, isApiConfigured } = await import('../lib/auditApi');
  if (!isApiConfigured()) return false;
  try {
    const current = getAuditRules(program);
    await saveRulesToServer(program ?? 'fsm', current as unknown as Record<string, unknown>, 'manual-upload');
    _serverCache.set(program ?? 'fsm', current);
    _syncStatus.set(program ?? 'fsm', 'server');
    return true;
  } catch (err) {
    console.warn('[auditRules] uploadLocalRulesToServer failed:', err);
    return false;
  }
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
    otApprovalDlMin: stored.otApprovalDlMin ?? defaults.otApprovalDlMin,
    otApprovalExecMin: stored.otApprovalExecMin ?? defaults.otApprovalExecMin,
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

/** Read rules: server cache (populated by initAuditRulesFromServer) → localStorage → defaults. */
export function getAuditRules(program?: 'fsm' | 'ses' | 'ci'): AuditRules {
  const prog = program ?? 'fsm';
  const defs = defaultRules(prog);

  // Prefer server cache (populated async after init)
  const cached = _serverCache.get(prog);
  if (cached) return cached;

  // Fall back to localStorage
  const key = storageKey(prog);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      writeAuditRules(defs, prog);
      return defs;
    }
    const parsed = JSON.parse(raw) as Partial<AuditRules>;
    return deepMerge(defs, parsed);
  } catch {
    return defs;
  }
}

/** Persist a full rules object to localStorage (sync) + Neon (async, fire-and-forget). */
export function writeAuditRules(rules: AuditRules, program?: 'fsm' | 'ses' | 'ci'): boolean {
  const prog = program ?? 'fsm';
  try {
    localStorage.setItem(storageKey(prog), JSON.stringify(rules));
    // Update module cache so getAuditRules() reflects the new value immediately
    _serverCache.set(prog, rules);
    // Fire-and-forget push to server (non-blocking — never blocks the audit)
    import('../lib/auditApi').then(({ saveRulesToServer, isApiConfigured }) => {
      if (!isApiConfigured()) {
        _syncStatus.set(prog, 'local');
        return;
      }
      saveRulesToServer(prog, rules as unknown as Record<string, unknown>, 'browser')
        .then(() => { _syncStatus.set(prog, 'server'); })
        .catch((err) => {
          console.warn('[auditRules] writeAuditRules: server push failed:', err);
          _syncStatus.set(prog, 'local');
        });
    }).catch(() => { _syncStatus.set(prog, 'local'); });
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
