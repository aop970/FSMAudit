import { Router } from "express";
import type { Request, Response } from "express";
import { sql } from "../db.ts";

const router = Router();

// POST /api/runs/:run_id/missed-finding
// Body: { check_id: string, description: string, entity_ref?: string }
// Inserts a finding with missed_finding=TRUE and label='fn' (false negative)
router.post("/:run_id/missed-finding", async (req: Request, res: Response): Promise<void> => {
  try {
    const runId = parseInt(req.params.run_id as string, 10);
    if (isNaN(runId)) {
      res.status(400).json({ error: "Invalid run ID" });
      return;
    }

    const { check_id, description, entity_ref } = req.body as {
      check_id: string;
      description: string;
      entity_ref?: string;
    };

    if (!check_id || !check_id.trim()) {
      res.status(400).json({ error: "check_id is required" });
      return;
    }

    if (!description || !description.trim()) {
      res.status(400).json({ error: "description is required" });
      return;
    }

    const eRef = entity_ref?.trim() ?? null;

    const [finding] = await sql`
      INSERT INTO audit_findings
        (run_id, check_id, verdict, entity_ref, missed_finding, missed_description, label)
      VALUES
        (${runId}, ${check_id.trim()}, 'flag', ${eRef}, TRUE, ${description.trim()}, 'fn')
      RETURNING id, check_id, verdict, entity_ref, missed_finding, missed_description, label
    `;

    res.status(201).json(finding);
  } catch (err: unknown) {
    console.error("[POST /api/runs/:run_id/missed-finding] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export { router as missedRouter };
