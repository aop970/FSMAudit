import { Router } from "express";
import type { Request, Response } from "express";
import { sql } from "../db.ts";

const router = Router();

// PATCH /api/findings/:id/label
// Body: { label: 'tp' | 'fp' | 'fn', label_note?: string }
// label_note is required when label === 'fp'
router.patch("/:id/label", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid finding ID" });
      return;
    }

    const { label, label_note } = req.body as { label: string; label_note?: string };

    if (!["tp", "fp", "fn"].includes(label)) {
      res.status(400).json({ error: "label must be tp, fp, or fn" });
      return;
    }

    if (label === "fp" && (!label_note || !label_note.trim())) {
      res.status(400).json({ error: "label_note is required for fp label" });
      return;
    }

    const note = label_note?.trim() ?? null;
    const [updated] = await sql`
      UPDATE audit_findings
      SET label = ${label}, label_note = ${note}, labeled_at = NOW()
      WHERE id = ${id}
      RETURNING id, label, label_note, labeled_at
    ` as { id: number; label: string; label_note: string | null; labeled_at: string }[];

    if (!updated) {
      res.status(404).json({ error: "Finding not found" });
      return;
    }

    res.json(updated);
  } catch (err: unknown) {
    console.error("[PATCH /api/findings/:id/label] Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export { router as findingsRouter };
