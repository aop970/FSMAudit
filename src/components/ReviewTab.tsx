/**
 * ReviewTab.tsx — TP/FP/FN labeling + missed-finding logger for the FSM Audit eval layer.
 *
 * Props:
 *   runId           — current session run_id (null if run not yet saved or API not configured)
 *   checkSlugsFromRun — check slugs from the current run (for missed-finding dropdown)
 */

import { useState, useEffect, useCallback } from "react";
import { ThumbsUp, ThumbsDown, Plus, RefreshCw, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import {
  getFindings,
  labelFinding,
  logMissedFinding,
  listRuns,
  isApiConfigured,
} from "../lib/auditApi.ts";
import type { Finding, RunSummary } from "../lib/auditApi.ts";

// Reverse-map slug → human display name
const SLUG_DISPLAY: Record<string, string> = {
  labor_billing: "Labor Billing Validation",
  formula_compliance: "Formula Compliance",
  punch_recon: "Punch Reconciliation",
  punch_integrity: "Punch Integrity",
  management_billing: "Management Billing",
  cloud_services: "Cloud Services",
  ot_approval: "OT Approval",
  ot_flag: "OT Flag",
  roster_mapping: "Roster / Letter Mapping",
  tie_out: "Invoice Tie-Out",
  invoice_identity: "Invoice Identity",
  date_range: "Date Range",
  time_off: "Time Off",
  po_number: "PO Number",
  termed_pto: "Termed PTO",
  custom_rules: "Custom Rules",
  ri_sunday_premium: "RI Sunday Premium",
  ot_math: "OT Math",
  holiday_billing: "Holiday Billing",
  ses_2020co: "2020CO Internal Rows",
  ses_store_id_format: "Store ID Format",
  ses_payroll_tag: "Payroll Tag Exceptions",
};

function displayName(slug: string): string {
  return SLUG_DISPLAY[slug] ?? slug;
}

interface ReviewTabProps {
  runId: number | null;
  checkSlugsFromRun: string[];
}

interface FindingsByCheck {
  slug: string;
  findings: Finding[];
  hasFlag: boolean;
}

export function ReviewTab({ runId, checkSlugsFromRun }: ReviewTabProps) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Run picker (when no current runId)
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(runId);

  // Labeling state: findingId → 'saving' | 'done' | 'error'
  const [labelState, setLabelState] = useState<Record<number, string>>({});
  // FP note input: findingId → note text
  const [fpNotes, setFpNotes] = useState<Record<number, string>>({});
  // Which finding is showing the FP note form
  const [fpOpen, setFpOpen] = useState<number | null>(null);

  // Missed-finding form
  const [missedOpen, setMissedOpen] = useState(false);
  const [missedSlug, setMissedSlug] = useState(checkSlugsFromRun[0] ?? "");
  const [missedDesc, setMissedDesc] = useState("");
  const [missedEntity, setMissedEntity] = useState("");
  const [missedSaving, setMissedSaving] = useState(false);
  const [missedError, setMissedError] = useState<string | null>(null);

  // Collapsed sections
  const [cleanExpanded, setCleanExpanded] = useState(false);

  // Sync selectedRunId with prop
  useEffect(() => {
    if (runId !== null) setSelectedRunId(runId);
  }, [runId]);

  // Load run list when no runId provided
  useEffect(() => {
    if (runId !== null) return;
    if (!isApiConfigured()) return;
    listRuns()
      .then((list) => {
        setRuns(list);
        if (list.length > 0 && selectedRunId === null) {
          setSelectedRunId(list[0].id);
        }
      })
      .catch((err: unknown) => {
        console.error("[ReviewTab] listRuns error:", err);
      });
  }, [runId, selectedRunId]);

  const loadFindings = useCallback(async (id: number) => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getFindings(id);
      setFindings(data);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRunId === null) return;
    if (!isApiConfigured()) return;
    loadFindings(selectedRunId);
  }, [selectedRunId, loadFindings]);

  // Group findings by check_id
  function groupedFindings(): FindingsByCheck[] {
    const map = new Map<string, Finding[]>();
    for (const f of findings) {
      const arr = map.get(f.check_id) ?? [];
      arr.push(f);
      map.set(f.check_id, arr);
    }
    const result: FindingsByCheck[] = [];
    for (const [slug, fArr] of map.entries()) {
      result.push({
        slug,
        findings: fArr,
        hasFlag: fArr.some((f) => f.verdict === "flag" || f.verdict === "warn"),
      });
    }
    // Flagged checks first, then clean
    result.sort((a, b) => {
      if (a.hasFlag && !b.hasFlag) return -1;
      if (!a.hasFlag && b.hasFlag) return 1;
      return a.slug.localeCompare(b.slug);
    });
    return result;
  }

  async function applyLabel(finding: Finding, label: "tp" | "fp" | "fn", note?: string) {
    setLabelState((prev) => ({ ...prev, [finding.id]: "saving" }));
    try {
      const updated = await labelFinding(finding.id, label, note);
      setFindings((prev) => prev.map((f) => (f.id === finding.id ? { ...f, ...updated } : f)));
      setLabelState((prev) => ({ ...prev, [finding.id]: "done" }));
      setFpOpen(null);
    } catch (err: unknown) {
      console.error("[ReviewTab] labelFinding error:", err);
      setLabelState((prev) => ({ ...prev, [finding.id]: "error" }));
    }
  }

  async function submitMissed() {
    if (!selectedRunId) return;
    if (!missedSlug || !missedDesc.trim()) {
      setMissedError("Check and description are required");
      return;
    }
    setMissedSaving(true);
    setMissedError(null);
    try {
      const f = await logMissedFinding(
        selectedRunId,
        missedSlug,
        missedDesc.trim(),
        missedEntity.trim() || undefined
      );
      setFindings((prev) => [...prev, f]);
      setMissedDesc("");
      setMissedEntity("");
      setMissedOpen(false);
    } catch (err: unknown) {
      setMissedError(err instanceof Error ? err.message : String(err));
    } finally {
      setMissedSaving(false);
    }
  }

  if (!isApiConfigured()) {
    return (
      <div className="mt-8 rounded-xl border-2 border-dashed px-8 py-12 text-center"
        style={{ borderColor: "color-mix(in srgb, var(--mc-text-dim) 20%, transparent)" }}>
        <p className="text-sm font-semibold text-mc-text">Review layer not configured</p>
        <p className="mt-1 text-xs text-mc-dim">
          Set <code className="text-mc-blue">VITE_AUDIT_API_URL</code> and redeploy the frontend to enable TP/FP/FN labeling.
        </p>
      </div>
    );
  }

  const grouped = groupedFindings();
  const flaggedGroups = grouped.filter((g) => g.hasFlag);
  const cleanGroups = grouped.filter((g) => !g.hasFlag);

  return (
    <div className="space-y-4">
      {/* Run picker header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-mc-dim">Review Run</h2>
          {selectedRunId && (
            <span className="text-xs text-mc-blue font-mono">#{selectedRunId}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Run selector (visible when no current runId) */}
          {runId === null && runs.length > 0 && (
            <select
              value={selectedRunId ?? ""}
              onChange={(e) => setSelectedRunId(Number(e.target.value))}
              className="rounded-md px-2 py-1 text-xs text-mc-text"
              style={{ backgroundColor: "var(--mc-bg2)", border: "1px solid var(--mc-card-border)" }}
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  #{r.id} — {r.invoice_ref ?? "unknown"} ({r.program})
                </option>
              ))}
            </select>
          )}
          {selectedRunId && (
            <button
              type="button"
              onClick={() => loadFindings(selectedRunId)}
              disabled={loading}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-mc-dim transition hover:text-mc-text"
              style={{ border: "1px solid var(--mc-card-border)" }}
            >
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Loading / error */}
      {loading && (
        <div className="flex items-center justify-center gap-2 py-8 text-mc-dim">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading findings…</span>
        </div>
      )}

      {loadError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
          {loadError}
        </div>
      )}

      {/* Flagged checks — labels */}
      {!loading && flaggedGroups.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-rose-400">
            Flagged Checks ({flaggedGroups.length})
          </h3>
          <div className="space-y-3">
            {flaggedGroups.map((g) => (
              <div
                key={g.slug}
                className="rounded-lg p-3 space-y-2"
                style={{ border: "1px solid var(--mc-card-border)", backgroundColor: "var(--mc-card-bg)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-mc-text">{displayName(g.slug)}</span>
                  <span className="text-[10px] font-mono text-mc-dim">{g.slug}</span>
                </div>

                {g.findings.filter((f) => !f.missed_finding).map((f) => (
                  <FindingRow
                    key={f.id}
                    finding={f}
                    labelState={labelState[f.id] ?? "idle"}
                    fpNote={fpNotes[f.id] ?? ""}
                    fpIsOpen={fpOpen === f.id}
                    onFpNote={(v) => setFpNotes((prev) => ({ ...prev, [f.id]: v }))}
                    onFpOpen={() => setFpOpen(fpOpen === f.id ? null : f.id)}
                    onLabel={applyLabel}
                  />
                ))}

                {/* Logged missed findings for this check */}
                {g.findings.filter((f) => f.missed_finding).map((f) => (
                  <div
                    key={f.id}
                    className="rounded px-2 py-1 text-[10px] text-mc-amber"
                    style={{ backgroundColor: "color-mix(in srgb, var(--mc-amber) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--mc-amber) 20%, transparent)" }}
                  >
                    <span className="font-semibold">Missed:</span>{" "}
                    {f.missed_description}
                    {f.entity_ref && <span className="ml-1 text-mc-dim">({f.entity_ref})</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Clean checks — collapsed */}
      {!loading && cleanGroups.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setCleanExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-mc-dim hover:text-mc-text transition"
          >
            {cleanExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Passed Checks ({cleanGroups.length})
          </button>

          {cleanExpanded && (
            <div className="mt-2 space-y-1">
              {cleanGroups.map((g) => (
                <div
                  key={g.slug}
                  className="flex items-center justify-between rounded-md px-3 py-1.5"
                  style={{ border: "1px solid var(--mc-card-border)", backgroundColor: "var(--mc-card-bg)" }}
                >
                  <span className="text-xs text-mc-text">{displayName(g.slug)}</span>
                  <span className="text-[10px] text-mc-green">
                    {g.findings[0]?.verdict === "na" ? "n/a" : "pass"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* No findings state */}
      {!loading && !loadError && selectedRunId !== null && findings.length === 0 && (
        <div className="py-8 text-center text-xs text-mc-dim">
          No findings found for run #{selectedRunId}
        </div>
      )}

      {/* Log missed finding */}
      {selectedRunId !== null && !loading && (
        <section className="pt-2" style={{ borderTop: "1px solid var(--mc-card-border)" }}>
          {!missedOpen ? (
            <button
              type="button"
              onClick={() => {
                setMissedOpen(true);
                if (checkSlugsFromRun.length > 0 && !missedSlug) {
                  setMissedSlug(checkSlugsFromRun[0]);
                }
              }}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-mc-dim transition hover:text-mc-text"
              style={{ border: "1px dashed var(--mc-card-border)" }}
            >
              <Plus className="h-3 w-3" />
              Log a Missed Finding
            </button>
          ) : (
            <div
              className="rounded-lg p-3 space-y-2"
              style={{ border: "1px solid color-mix(in srgb, var(--mc-amber) 30%, transparent)", backgroundColor: "color-mix(in srgb, var(--mc-amber) 5%, transparent)" }}
            >
              <p className="text-xs font-semibold text-mc-amber">Log Missed Finding</p>

              {/* Check selector */}
              <div>
                <label className="text-[10px] text-mc-dim block mb-0.5">Check</label>
                <select
                  value={missedSlug}
                  onChange={(e) => setMissedSlug(e.target.value)}
                  className="w-full rounded-md px-2 py-1 text-xs text-mc-text"
                  style={{ backgroundColor: "var(--mc-bg2)", border: "1px solid var(--mc-card-border)" }}
                >
                  {/* Show all unique slugs from findings + run checks */}
                  {Array.from(
                    new Set([
                      ...checkSlugsFromRun,
                      ...findings.map((f) => f.check_id),
                    ])
                  ).sort().map((slug) => (
                    <option key={slug} value={slug}>
                      {displayName(slug)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] text-mc-dim block mb-0.5">Description *</label>
                <textarea
                  value={missedDesc}
                  onChange={(e) => setMissedDesc(e.target.value)}
                  rows={2}
                  placeholder="What issue was missed and why it matters…"
                  className="w-full rounded-md px-2 py-1 text-xs text-mc-text resize-none"
                  style={{ backgroundColor: "var(--mc-bg2)", border: "1px solid var(--mc-card-border)" }}
                />
              </div>

              {/* Entity ref (optional) */}
              <div>
                <label className="text-[10px] text-mc-dim block mb-0.5">Entity ref (optional)</label>
                <input
                  type="text"
                  value={missedEntity}
                  onChange={(e) => setMissedEntity(e.target.value)}
                  placeholder="Associate ID or name"
                  className="w-full rounded-md px-2 py-1 text-xs text-mc-text"
                  style={{ backgroundColor: "var(--mc-bg2)", border: "1px solid var(--mc-card-border)" }}
                />
              </div>

              {missedError && (
                <p className="text-[10px] text-rose-400">{missedError}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={submitMissed}
                  disabled={missedSaving}
                  className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50"
                  style={{ backgroundColor: "#d97706" }}
                >
                  {missedSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Log
                </button>
                <button
                  type="button"
                  onClick={() => { setMissedOpen(false); setMissedError(null); }}
                  className="rounded-md px-3 py-1.5 text-xs text-mc-dim hover:text-mc-text transition"
                  style={{ border: "1px solid var(--mc-card-border)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── FindingRow ───────────────────────────────────────────────────────────────

interface FindingRowProps {
  finding: Finding;
  labelState: string;
  fpNote: string;
  fpIsOpen: boolean;
  onFpNote: (v: string) => void;
  onFpOpen: () => void;
  onLabel: (f: Finding, label: "tp" | "fp" | "fn", note?: string) => void;
}

function FindingRow({ finding, labelState, fpNote, fpIsOpen, onFpNote, onFpOpen, onLabel }: FindingRowProps) {
  const verdictColor =
    finding.verdict === "flag" ? "#f87171"
    : finding.verdict === "warn" ? "#ffba08"
    : "var(--mc-text-dim)";

  const labeled = Boolean(finding.label);
  const saving = labelState === "saving";

  return (
    <div
      className="rounded-md px-2.5 py-1.5 space-y-1.5"
      style={{
        backgroundColor: "color-mix(in srgb, var(--mc-bg) 50%, transparent)",
        border: "1px solid var(--mc-card-border)",
        opacity: labeled ? 0.75 : 1,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Entity / finding summary */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: verdictColor }}
          />
          <span className="text-[10px] text-mc-dim truncate">
            {finding.entity_ref ?? "aggregate"}
          </span>
          <span
            className="text-[10px] font-mono font-semibold shrink-0"
            style={{ color: verdictColor }}
          >
            {finding.verdict}
          </span>
        </div>

        {/* Label controls */}
        {!labeled && !saving ? (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              title="True Positive — correctly flagged"
              onClick={() => onLabel(finding, "tp")}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-mc-green transition hover:bg-mc-green/10"
            >
              <ThumbsUp className="h-3 w-3" />
              TP
            </button>
            <button
              type="button"
              title="False Positive — add a note"
              onClick={onFpOpen}
              className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-rose-400 transition hover:bg-rose-400/10"
            >
              <ThumbsDown className="h-3 w-3" />
              FP
            </button>
          </div>
        ) : labeled ? (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
            style={{
              backgroundColor:
                finding.label === "tp" ? "color-mix(in srgb, #22d06b 15%, transparent)"
                : "color-mix(in srgb, #f87171 15%, transparent)",
              color: finding.label === "tp" ? "#22d06b" : "#f87171",
            }}
          >
            {finding.label?.toUpperCase()}
          </span>
        ) : (
          <Loader2 className="h-3 w-3 animate-spin text-mc-dim" />
        )}
      </div>

      {/* FP note form (inline) */}
      {fpIsOpen && !labeled && (
        <div className="space-y-1.5 pt-1" style={{ borderTop: "1px solid var(--mc-card-border)" }}>
          <p className="text-[10px] text-mc-dim">Why is this a false positive?</p>
          <textarea
            value={fpNote}
            onChange={(e) => onFpNote(e.target.value)}
            rows={2}
            placeholder="Explain why this flag doesn't represent a real issue…"
            className="w-full rounded px-2 py-1 text-[10px] text-mc-text resize-none"
            style={{ backgroundColor: "var(--mc-bg2)", border: "1px solid var(--mc-card-border)" }}
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={!fpNote.trim() || saving}
              onClick={() => onLabel(finding, "fp", fpNote.trim())}
              className="rounded px-2 py-0.5 text-[10px] font-semibold text-white transition disabled:opacity-40"
              style={{ backgroundColor: "#dc2626" }}
            >
              Confirm FP
            </button>
            <button
              type="button"
              onClick={onFpOpen}
              className="rounded px-2 py-0.5 text-[10px] text-mc-dim hover:text-mc-text transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Existing label note */}
      {labeled && finding.label_note && (
        <p className="text-[10px] text-mc-dim italic">&ldquo;{finding.label_note}&rdquo;</p>
      )}
    </div>
  );
}
