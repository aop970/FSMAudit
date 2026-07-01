/**
 * rules.ts — Neon-backed audit rules CRUD (T-496 Workstream C).
 *
 * One row per program (fsm/ses/ci) in audit_rules table.
 * Rules are globally shared: any machine reads/writes the same set.
 *
 * Endpoints:
 *   GET  /api/rules?program=fsm            — fetch rules (null body = not seeded yet)
 *   POST /api/rules                        — upsert { program, rules, updated_by? }
 *   POST /api/rules/reset?program=fsm      — delete row (client re-seeds on next GET)
 *
 * Write endpoints are token-gated (same X-Audit-Token middleware as the rest of the API).
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { sql } from "../db.ts";

const router = Router();

const VALID_PROGRAMS = new Set(["fsm", "ses", "ci"]);

// GET /api/rules?program=fsm
router.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const program = (req.query.program as string | undefined) ?? "fsm";
    if (!VALID_PROGRAMS.has(program)) {
      res.status(400).json({ error: "program must be fsm, ses, or ci" });
      return;
    }

    const rows = await sql`
      SELECT program, version, rules, updated_at, updated_by
      FROM audit_rules
      WHERE program = ${program}
      LIMIT 1
    ` as { program: string; version: string; rules: unknown; updated_at: string; updated_by: string | null }[];

    if (rows.length === 0) {
      // Not seeded yet — return 404 so client knows to seed with its defaults
      res.status(404).json({ error: "Rules not seeded for this program" });
      return;
    }

    res.json(rows[0]);
  } catch (err: unknown) {
    console.error("[GET /api/rules] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/rules — upsert rules for a program
// Body: { program: 'fsm'|'ses'|'ci', rules: AuditRules object, updated_by?: string }
router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { program, rules, updated_by } = req.body as {
      program?: string;
      rules?: unknown;
      updated_by?: string;
    };

    if (!program || !VALID_PROGRAMS.has(program)) {
      res.status(400).json({ error: "program must be fsm, ses, or ci" });
      return;
    }
    if (!rules || typeof rules !== "object") {
      res.status(400).json({ error: "rules must be a non-null object" });
      return;
    }

    const rulesJson = JSON.stringify(rules);
    const updatedBy = updated_by?.trim() ?? null;

    const [row] = await sql`
      INSERT INTO audit_rules (program, version, rules, updated_at, updated_by)
      VALUES (${program}, 'v1', ${rulesJson}, NOW(), ${updatedBy})
      ON CONFLICT (program) DO UPDATE
        SET rules      = EXCLUDED.rules,
            version    = EXCLUDED.version,
            updated_at = NOW(),
            updated_by = EXCLUDED.updated_by
      RETURNING program, version, updated_at, updated_by
    ` as { program: string; version: string; updated_at: string; updated_by: string | null }[];

    res.status(200).json(row);
  } catch (err: unknown) {
    console.error("[POST /api/rules] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/rules/reset?program=fsm — delete the row; client re-seeds on next GET
router.post("/reset", async (req: Request, res: Response): Promise<void> => {
  try {
    const program = (req.query.program as string | undefined) ?? "fsm";
    if (!VALID_PROGRAMS.has(program)) {
      res.status(400).json({ error: "program must be fsm, ses, or ci" });
      return;
    }

    await sql`DELETE FROM audit_rules WHERE program = ${program}`;
    res.json({ ok: true, program, message: "Rules deleted — client will re-seed from defaults on next load" });
  } catch (err: unknown) {
    console.error("[POST /api/rules/reset] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export { router as rulesRouter };
