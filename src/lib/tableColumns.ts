// tableColumns.ts — shared column derivation for anything that renders a
// CheckResult's flaggedRows as a table: the on-screen CheckCard tables, the
// CSV export (DownloadReport.tsx), and the PDF export (DownloadPDF.tsx).
//
// T-675: all four render sites derived their header row from
// `Object.keys(flaggedRows[0])` alone. That silently breaks whenever ANY row
// past row 0 carries a key row 0 doesn't — which is exactly what
// check03_ses_threeWayRecon.ts's summary ('— TOTAL —') vs per-person rows do:
// the summary row never carried `associateId` while per-person rows did
// (T-672 added it there only). Allan saw employee IDs rendered under the
// PUNCHHRS header with an extra unlabeled trailing column, because the two
// screen-table sites paired a 7-column header (from row 0) with each row's
// own 7-or-8-entry Object.entries() in that row's own key order — a classic
// header/value misalignment.
//
// The fix has two parts, both required:
//   1. Derive the column list from the UNION of every row's keys, first-seen
//      order preserved (unionFlaggedRowColumns below) — not just row 0.
//   2. Every render site must build each row's cells by INDEXING the column
//      list (row[col] ?? placeholder), never by iterating that row's own
//      Object.entries() — so a row missing a column renders blank in the
//      right place instead of shifting every later column.
//
// This is a general defect class, not a Check-3-only bug: check07_otApproval,
// check17_otMath, check18_holidays, and checkCi_holidaySplit all combine
// multiple differently-shaped row arrays into one flaggedRows array the same
// way (see T-675 deliverable for the full sweep). Fixing header derivation
// here, once, covers all of them — no per-check fix needed.

export function unionFlaggedRowColumns(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}
