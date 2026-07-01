/**
 * migrate.ts — one-shot schema migration for fsm-audit Neon DB.
 * Safe to re-run: all statements use CREATE ... IF NOT EXISTS.
 * Run via: npx tsx server/migrate.ts
 */
import { sql } from "./db.ts";

async function migrate() {
  console.log("[migrate] Running FSM Audit migration...");

  // ── audit_runs: one row per audit execution ──────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS audit_runs (
      id          SERIAL PRIMARY KEY,
      run_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      program     TEXT NOT NULL,
      invoice_ref TEXT,
      ruleset_ver TEXT NOT NULL DEFAULT 'v1',
      payload     JSONB NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_runs_program ON audit_runs(program)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_runs_run_at ON audit_runs(run_at DESC)
  `;

  // ── audit_findings: one row per flagged entity per check (+ missed findings) ──
  await sql`
    CREATE TABLE IF NOT EXISTS audit_findings (
      id                 SERIAL PRIMARY KEY,
      run_id             INTEGER NOT NULL REFERENCES audit_runs(id) ON DELETE CASCADE,
      check_id           TEXT NOT NULL,
      verdict            TEXT NOT NULL CHECK (verdict IN ('flag', 'warn', 'pass', 'na')),
      severity           TEXT,
      confidence         REAL,
      file_hash          TEXT,
      entity_ref         TEXT,
      label              TEXT CHECK (label IN ('tp', 'fp', 'fn')),
      label_note         TEXT,
      labeled_at         TIMESTAMPTZ,
      missed_finding     BOOLEAN NOT NULL DEFAULT FALSE,
      missed_description TEXT
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_findings_run_id ON audit_findings(run_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_findings_check_id ON audit_findings(check_id)
  `;

  console.log("[migrate] Complete — 2 tables, 4 indexes");
}

migrate().catch((err: unknown) => {
  console.error("[migrate] FAILED:", err);
  process.exit(1);
});
