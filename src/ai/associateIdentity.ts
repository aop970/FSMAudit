// associateIdentity.ts — Shared associate-identity extraction & matching for AI context building.
//
// Different checks emit flagged rows keyed different ways: some carry a real
// associateId (check01, check05, check07, check08, check12, check19...), some
// carry only a name under 'employeeName' (check17, check18), and SES Check 3
// carries only a name under 'associate' with no ID field at all. Cross-check
// bundling and source-row slicing both need to resolve "which associate is
// this row about" the same way, so that logic lives here once.
//
// normalization mirrors check03SesThreeWayRecon's normKey (T-668/T-669):
// trim + lowercase for IDs, trim + lowercase + whitespace-collapse for names,
// ID preferred over name when both are present on the SAME row.

export type IdentityKind = 'id' | 'name';

export interface AssociateIdentity {
  kind: IdentityKind;
  /** Normalized matching key. */
  key: string;
  /** Best human-readable label for this associate. */
  displayName: string;
}

const ID_FIELD_CANDIDATES = [
  'associateId',
  'Associate ID',
  'associate_id',
  'AssociateID',
  'employeeId',
];

const NAME_FIELD_CANDIDATES = [
  'employeeName',
  'Employee Name',
  'employee_name',
  'name',
  'Name',
  'workerName',
  'worker',
  'associate',
  'associateName',
];

// Matches synthetic summary rows like '— TOTAL —', '-- Total --', '_TOTAL_', etc.
const SYNTHETIC_NAME_RE = /^[\s\-—_]*total[\s\-—_]*$/i;

function firstStringField(row: Record<string, unknown>, candidates: string[]): string {
  for (const k of candidates) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function normId(id: string): string {
  return id.trim().toLowerCase();
}

export function normName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Extract an associate identity from a single row, preferring an ID field
 * and falling back to a name field. Returns null for rows with no usable
 * identity, or for synthetic summary rows (e.g. SES Check 3's '— TOTAL —').
 */
export function extractRowIdentity(row: Record<string, unknown>): AssociateIdentity | null {
  const id = firstStringField(row, ID_FIELD_CANDIDATES);
  if (id) {
    return {
      kind: 'id',
      key: normId(id),
      displayName: firstStringField(row, NAME_FIELD_CANDIDATES) || id,
    };
  }
  const name = firstStringField(row, NAME_FIELD_CANDIDATES);
  if (!name || SYNTHETIC_NAME_RE.test(name)) return null;
  return { kind: 'name', key: normName(name), displayName: name };
}

/**
 * Deduplicate a set of flagged rows into a unique associate identity list,
 * in first-seen order.
 */
export function extractAssociateIdentities(rows: Record<string, unknown>[]): AssociateIdentity[] {
  const seen = new Map<string, AssociateIdentity>();
  for (const row of rows) {
    const identity = extractRowIdentity(row);
    if (!identity) continue;
    const dedupeKey = `${identity.kind}:${identity.key}`;
    if (!seen.has(dedupeKey)) seen.set(dedupeKey, identity);
  }
  return [...seen.values()];
}

/**
 * Test whether a row (from ANY source — another check's flagged rows, or a
 * raw ParsedData source row) belongs to the given identity. Matching is
 * kind-consistent: an id-keyed identity only matches rows by their own id
 * field; a name-keyed identity only matches by name field. This mirrors how
 * check03SesThreeWayRecon's normKey resolves per-row (id preferred, else
 * name) rather than blending kinds across rows.
 */
export function rowMatchesIdentity(row: Record<string, unknown>, identity: AssociateIdentity): boolean {
  if (identity.kind === 'id') {
    const id = firstStringField(row, ID_FIELD_CANDIDATES);
    return !!id && normId(id) === identity.key;
  }
  const name = firstStringField(row, NAME_FIELD_CANDIDATES);
  return !!name && !SYNTHETIC_NAME_RE.test(name) && normName(name) === identity.key;
}

/**
 * Given a target set of identities (as normalized key sets, one per kind),
 * test a row for membership and return the matching identity's kind/key/
 * displayName drawn from the ROW itself (not the target set) so cross-check
 * output can show that row's own label.
 */
export function matchRowAgainstIdentitySets(
  row: Record<string, unknown>,
  idKeys: Set<string>,
  nameKeys: Set<string>,
): AssociateIdentity | null {
  const id = firstStringField(row, ID_FIELD_CANDIDATES);
  if (id) {
    const k = normId(id);
    if (idKeys.has(k)) {
      return { kind: 'id', key: k, displayName: firstStringField(row, NAME_FIELD_CANDIDATES) || id };
    }
  }
  const name = firstStringField(row, NAME_FIELD_CANDIDATES);
  if (name && !SYNTHETIC_NAME_RE.test(name)) {
    const k = normName(name);
    if (nameKeys.has(k)) return { kind: 'name', key: k, displayName: name };
  }
  return null;
}

export { SYNTHETIC_NAME_RE };
