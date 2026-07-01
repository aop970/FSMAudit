import { Router } from "express";
import type { Request, Response } from "express";
import { sql } from "../db.ts";

const router = Router();

// ── Slug map: checkName → canonical 21-slug ─────────────────────────────────
// Source of truth: T-494 locked canonical table. Exact match first, then prefix.
const SLUG_MAP: Record<string, string> = {
  // FSM / shared
  "Labor Billing Validation": "labor_billing",
  "Formula Compliance": "formula_compliance",
  "Punch Reconciliation": "punch_recon",
  "Punch Integrity": "punch_integrity",
  "Management Billing Validation": "management_billing",
  "Cloud Services Validation": "cloud_services",
  "OT Approval (Tiered)": "ot_approval",
  "Roster Validation": "roster_mapping",
  "Invoice Tie-Out": "tie_out",
  "Invoice Identity": "invoice_identity",
  "Date Range Validation": "date_range",
  "Time Off Validation": "time_off",
  "Termed PTO Validation": "termed_pto",
  "Custom Rules": "custom_rules",
  "RI Sunday Premium Pay": "ri_sunday_premium",
  "OT Math Validation": "ot_math",
  "Holiday Pay Validation": "holiday_billing",
  // SES-specific
  "OT Flag": "ot_flag",
  "Roster": "roster_mapping",           // SES NA stub uses short name
  "Three-Way Punch Recon": "punch_recon",
  "Management Billing": "management_billing",
  "2020CO Internal Rows": "ses_2020co",
  "Store ID Format": "ses_store_id_format",
  "Payroll Tag Exceptions": "ses_payroll_tag",
  // CI-specific
  "Activity Reconciliation": "punch_recon",
  "Holiday Billing (Format Split)": "holiday_billing",
  "Cloud & New Hire Fees = $0": "cloud_services",
  "Roster / Letter Mapping": "roster_mapping",
  "Date Range": "date_range",
  // CI NA stubs (short names)
  "OT Approval": "ot_approval",
  "Time Off Reconciliation": "time_off",
  "Termed PTO": "termed_pto",
  "RI Sunday Premium": "ri_sunday_premium",
  "OT Math": "ot_math",
};

function nameToSlug(checkName: string): string {
  if (SLUG_MAP[checkName]) return SLUG_MAP[checkName];
  // PO Number (E17) / PO Number (E19) etc.
  if (checkName.startsWith("PO Number")) return "po_number";
  // Fallback: kebab-case
  return checkName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/, "");
}

function statusToVerdict(status: string): "flag" | "warn" | "pass" | "na" {
  switch (status) {
    case "fail":    return "flag";
    case "warning": return "warn";
    case "pass":    return "pass";
    case "na":      return "na";
    default:        return "pass";
  }
}

function invoiceRefFromFilename(invoiceFile: string): string {
  // Strip extension: FSM26-W13-14.xlsb → FSM26-W13-14
  return invoiceFile.replace(/\.[^/.]+$/, "");
}

function entityRef(row: Record<string, unknown>): string | null {
  // Try associate ID first (most specific)
  const id = row["associateId"] ?? row["associate_id"];
  if (typeof id === "string" && id.trim()) return id.trim();
  // Most checks emit 'name' (check01, check18, check07, etc.)
  // check17/OT math uses 'employeeName'; normalize both
  const name = row["name"] ?? row["employeeName"] ?? row["employee_name"];
  if (typeof name === "string" && name.trim()) return name.trim();
  // Fall back to row number — check01 emits 'row', older code used 'rowNum'
  const rowNum = row["row"] ?? row["rowNum"] ?? row["row_num"];
  if (rowNum !== undefined) return `row:${rowNum}`;
  return null;
}

interface CheckResult {
  checkName: string;
  status: string;
  flaggedRows: Record<string, unknown>[];
}

// POST /api/runs
router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = req.body as Record<string, unknown>;
    if (!payload?.results || !payload?.invoiceFile) {
      res.status(400).json({ error: "Missing results or invoiceFile" });
      return;
    }

    const program = (payload.program as string) ?? "fsm";
    const invoiceRef = invoiceRefFromFilename(payload.invoiceFile as string);
    const rulesetVer = "v1";

    // Insert run record
    const [run] = await sql`
      INSERT INTO audit_runs (program, invoice_ref, ruleset_ver, payload)
      VALUES (${program}, ${invoiceRef}, ${rulesetVer}, ${JSON.stringify(payload)})
      RETURNING id
    ` as { id: number }[];
    const runId: number = run.id;

    // Insert findings:
    //   pass/na  → always ONE aggregate row (prevents explosion from pass checks with data)
    //   flag/warn → one row per flagged entity (or one aggregate if no flaggedRows)
    // Each flag/warn finding stores the full flaggedRow as `detail` JSONB so the
    // Review tab can display name, issue text, and key amounts without opening the invoice.
    const results = payload.results as CheckResult[];
    for (const r of results) {
      const checkId = nameToSlug(r.checkName);
      const verdict = statusToVerdict(r.status);

      if (verdict === "pass" || verdict === "na") {
        // Always single aggregate row for clean checks — no per-detail explosion
        await sql`
          INSERT INTO audit_findings (run_id, check_id, verdict, entity_ref, detail)
          VALUES (${runId}, ${checkId}, ${verdict}, NULL, NULL)
        `;
      } else if (!r.flaggedRows || r.flaggedRows.length === 0) {
        // flag/warn with no detail rows — aggregate
        await sql`
          INSERT INTO audit_findings (run_id, check_id, verdict, entity_ref, detail)
          VALUES (${runId}, ${checkId}, ${verdict}, NULL, NULL)
        `;
      } else {
        // flag/warn with per-row detail — one finding per flagged entity
        for (const row of r.flaggedRows) {
          const eRef = entityRef(row);
          await sql`
            INSERT INTO audit_findings (run_id, check_id, verdict, entity_ref, detail)
            VALUES (${runId}, ${checkId}, ${verdict}, ${eRef}, ${JSON.stringify(row)})
          `;
        }
      }
    }

    res.status(201).json({ run_id: runId });
  } catch (err: unknown) {
    console.error("[POST /api/runs] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/runs — list runs, most recent first, limit 50
router.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    const runs = await sql`
      SELECT id, run_at, program, invoice_ref, ruleset_ver
      FROM audit_runs
      ORDER BY run_at DESC
      LIMIT 50
    `;
    res.json(runs);
  } catch (err: unknown) {
    console.error("[GET /api/runs] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/runs/:id/findings
router.get("/:id/findings", async (req: Request, res: Response): Promise<void> => {
  try {
    const runId = parseInt(req.params.id as string, 10);
    if (isNaN(runId)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }
    const findings = await sql`
      SELECT id, check_id, verdict, severity, confidence, entity_ref,
             label, label_note, labeled_at, missed_finding, missed_description, detail
      FROM audit_findings
      WHERE run_id = ${runId}
      ORDER BY check_id, id
    `;
    res.json(findings);
  } catch (err: unknown) {
    console.error("[GET /api/runs/:id/findings] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export { router as runsRouter };
