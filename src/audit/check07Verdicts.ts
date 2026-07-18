// check07Verdicts.ts — Thin persistence adapter for Check 7 OT review verdicts.
//
// Design goals (T-590):
//   • Four-state model: 'none' | 'approved' | 'not_approved' (user verdicts) +
//     system states 'blanket' | 'tab_approved' (emitted by the engine, never persisted).
//   • Swappable adapter: load/save/remove/clearAll. No localStorage calls may leak
//     into components or the export function — only this module touches storage.
//   • Stale-detection: each persisted entry carries a snapshot of (name, otType, hours).
//     On load, the snapshot is compared to the current row; on mismatch, the verdict
//     is DISCARDED and flagged as stale.  A missing key is silently orphaned.
//   • Future Neon→Azure swap touches ONLY this file: swap the adapter object.

export type UserVerdict = 'none' | 'approved' | 'not_approved';

/** The snapshot used for stale detection. Stored alongside the verdict. */
export interface VerdictSnapshot {
  name: string;
  otType: string;
  hours: string; // stored as the toFixed(2) string to avoid float drift
}

export interface PersistedVerdict {
  verdict: UserVerdict;
  snapshot: VerdictSnapshot;
}

/** The adapter interface. Swap the export below to change the backend. */
export interface VerdictAdapter {
  load(rowKey: string): PersistedVerdict | null;
  save(rowKey: string, verdict: UserVerdict, snapshot: VerdictSnapshot): void;
  remove(rowKey: string): void;
  clearAll(): void;
}

// ── localStorage adapter ──────────────────────────────────────────────────────

const LS_PREFIX = 'ot-verdict-v1:';

const localStorageAdapter: VerdictAdapter = {
  load(rowKey: string): PersistedVerdict | null {
    try {
      const raw = localStorage.getItem(LS_PREFIX + rowKey);
      if (!raw) return null;
      return JSON.parse(raw) as PersistedVerdict;
    } catch {
      return null;
    }
  },

  save(rowKey: string, verdict: UserVerdict, snapshot: VerdictSnapshot): void {
    try {
      const entry: PersistedVerdict = { verdict, snapshot };
      localStorage.setItem(LS_PREFIX + rowKey, JSON.stringify(entry));
    } catch {
      // localStorage full or unavailable — fail silently
    }
  },

  remove(rowKey: string): void {
    try {
      localStorage.removeItem(LS_PREFIX + rowKey);
    } catch { /* ok */ }
  },

  clearAll(): void {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch { /* ok */ }
  },
};

/** The active adapter. Replace this export to swap backends. */
export const verdictAdapter: VerdictAdapter = localStorageAdapter;

// ── Higher-level helpers used by the UI ──────────────────────────────────────

/**
 * Load a verdict for a row, checking for staleness.
 * Returns { verdict, stale } where stale=true means the persisted snapshot
 * doesn't match the current row (verdict has been discarded).
 */
export function loadVerdict(
  rowKey: string,
  currentSnapshot: VerdictSnapshot,
): { verdict: UserVerdict; stale: boolean } {
  const persisted = verdictAdapter.load(rowKey);
  if (!persisted) return { verdict: 'none', stale: false };

  const s = persisted.snapshot;
  const isStale =
    s.name !== currentSnapshot.name ||
    s.otType !== currentSnapshot.otType ||
    s.hours !== currentSnapshot.hours;

  if (isStale) {
    // Discard stale verdict — don't persist the removal (leave it; will overwrite on next save)
    return { verdict: 'none', stale: true };
  }

  return { verdict: persisted.verdict, stale: false };
}

/** Save a user verdict with its current snapshot. */
export function saveVerdict(
  rowKey: string,
  verdict: UserVerdict,
  snapshot: VerdictSnapshot,
): void {
  if (verdict === 'none') {
    verdictAdapter.remove(rowKey);
  } else {
    verdictAdapter.save(rowKey, verdict, snapshot);
  }
}
