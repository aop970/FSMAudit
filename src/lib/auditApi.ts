/**
 * auditApi.ts — thin fetch wrapper for the FSM Audit persistence API.
 * Base URL from VITE_AUDIT_API_URL env var (baked at build time).
 * Token from VITE_AUDIT_API_TOKEN (optional).
 *
 * All functions are fire-and-forget safe: they throw on non-2xx so callers
 * can catch without crashing the audit flow.
 */

const BASE_URL = (import.meta.env.VITE_AUDIT_API_URL as string | undefined) ?? "";
const TOKEN = (import.meta.env.VITE_AUDIT_API_TOKEN as string | undefined) ?? "";

// ── Slug map (mirrors server/routes/runs.ts — T-494 canonical table) ────────
const SLUG_MAP: Record<string, string> = {
  "Labor Billing Validation": "labor_billing",
  "Formula Compliance": "formula_compliance",
  "Punch Reconciliation": "punch_recon",
  "Three-Way Punch Recon": "punch_recon",
  "Activity Reconciliation": "punch_recon",
  "Punch Integrity": "punch_integrity",
  "Management Billing Validation": "management_billing",
  "Management Billing": "management_billing",
  "Cloud Services Validation": "cloud_services",
  "Cloud & New Hire Fees = $0": "cloud_services",
  "OT Approval (Tiered)": "ot_approval",
  "OT Approval": "ot_approval",
  "OT Flag": "ot_flag",
  "Roster Validation": "roster_mapping",
  "Roster": "roster_mapping",
  "Roster / Letter Mapping": "roster_mapping",
  "Invoice Tie-Out": "tie_out",
  "Invoice Identity": "invoice_identity",
  "Date Range Validation": "date_range",
  "Date Range": "date_range",
  "Time Off Validation": "time_off",
  "Time Off Reconciliation": "time_off",
  "Termed PTO Validation": "termed_pto",
  "Termed PTO": "termed_pto",
  "Custom Rules": "custom_rules",
  "RI Sunday Premium Pay": "ri_sunday_premium",
  "RI Sunday Premium": "ri_sunday_premium",
  "OT Math Validation": "ot_math",
  "OT Math": "ot_math",
  "Holiday Pay Validation": "holiday_billing",
  "Holiday Billing (Format Split)": "holiday_billing",
  "2020CO Internal Rows": "ses_2020co",
  "Store ID Format": "ses_store_id_format",
  "Payroll Tag Exceptions": "ses_payroll_tag",
};

/** Convert a checkName string to its canonical 21-slug. */
export function checkNameToSlug(checkName: string): string {
  if (SLUG_MAP[checkName]) return SLUG_MAP[checkName];
  if (checkName.startsWith("PO Number")) return "po_number";
  return checkName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/, "");
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (TOKEN) h["X-Audit-Token"] = TOKEN;
  return h;
}

export function isApiConfigured(): boolean {
  return Boolean(BASE_URL);
}

export interface RunSummary {
  id: number;
  run_at: string;
  program: string;
  invoice_ref: string | null;
  ruleset_ver: string;
}

export interface Finding {
  id: number;
  check_id: string;
  verdict: "flag" | "warn" | "pass" | "na";
  severity: string | null;
  confidence: number | null;
  entity_ref: string | null;
  label: "tp" | "fp" | "fn" | null;
  label_note: string | null;
  labeled_at: string | null;
  missed_finding: boolean;
  missed_description: string | null;
  /** Full flagged-row detail from the audit engine (T-496 D). Null on old findings. */
  detail: Record<string, unknown> | null;
}

/** Shape returned by GET /api/rules */
export interface ServerRules {
  program: string;
  version: string;
  rules: Record<string, unknown>;
  updated_at: string;
  updated_by: string | null;
}

/** POST /api/runs — persist an audit run. Returns the new run_id. */
export async function postRun(
  payload: Record<string, unknown>
): Promise<{ run_id: number }> {
  const resp = await fetch(`${BASE_URL}/api/runs`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`POST /api/runs → ${resp.status}`);
  return resp.json() as Promise<{ run_id: number }>;
}

/** GET /api/runs — list recent runs (newest first, limit 50). */
export async function listRuns(): Promise<RunSummary[]> {
  const resp = await fetch(`${BASE_URL}/api/runs`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`GET /api/runs → ${resp.status}`);
  return resp.json() as Promise<RunSummary[]>;
}

/** GET /api/runs/:id/findings — all findings for a run. */
export async function getFindings(runId: number): Promise<Finding[]> {
  const resp = await fetch(`${BASE_URL}/api/runs/${runId}/findings`, {
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`GET /api/runs/${runId}/findings → ${resp.status}`);
  return resp.json() as Promise<Finding[]>;
}

/** PATCH /api/findings/:id/label — apply tp/fp/fn label. Note required for fp. */
export async function labelFinding(
  id: number,
  label: "tp" | "fp" | "fn",
  note?: string
): Promise<Finding> {
  const resp = await fetch(`${BASE_URL}/api/findings/${id}/label`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ label, label_note: note ?? null }),
  });
  if (!resp.ok) throw new Error(`PATCH /api/findings/${id}/label → ${resp.status}`);
  return resp.json() as Promise<Finding>;
}

// ── Rules API (T-496 Workstream C) ─────────────────────────────────────────────

/**
 * GET /api/rules?program= — fetch globally-shared rules from Neon.
 * Returns null when not yet seeded (404 from server → caller should POST defaults).
 */
export async function getRulesFromServer(
  program: "fsm" | "ses" | "ci"
): Promise<Record<string, unknown> | null> {
  const resp = await fetch(`${BASE_URL}/api/rules?program=${program}`, {
    headers: authHeaders(),
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GET /api/rules?program=${program} → ${resp.status}`);
  const data = (await resp.json()) as ServerRules;
  return data.rules;
}

/**
 * POST /api/rules — upsert rules to Neon for a program.
 * Fire-and-forget safe; callers should catch.
 */
export async function saveRulesToServer(
  program: "fsm" | "ses" | "ci",
  rules: Record<string, unknown>,
  updatedBy?: string
): Promise<void> {
  const resp = await fetch(`${BASE_URL}/api/rules`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ program, rules, updated_by: updatedBy ?? "browser" }),
  });
  if (!resp.ok) throw new Error(`POST /api/rules → ${resp.status}`);
}

/**
 * POST /api/rules/reset?program= — delete server row; client re-seeds from defaults on next load.
 */
export async function resetRulesToDefault(
  program: "fsm" | "ses" | "ci"
): Promise<void> {
  const resp = await fetch(`${BASE_URL}/api/rules/reset?program=${program}`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!resp.ok) throw new Error(`POST /api/rules/reset?program=${program} → ${resp.status}`);
}

/** POST /api/runs/:run_id/missed-finding — log a false-negative (missed issue). */
export async function logMissedFinding(
  runId: number,
  checkId: string,
  description: string,
  entityRef?: string
): Promise<Finding> {
  const resp = await fetch(`${BASE_URL}/api/runs/${runId}/missed-finding`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      check_id: checkId,
      description,
      entity_ref: entityRef ?? null,
    }),
  });
  if (!resp.ok)
    throw new Error(`POST /api/runs/${runId}/missed-finding → ${resp.status}`);
  return resp.json() as Promise<Finding>;
}
