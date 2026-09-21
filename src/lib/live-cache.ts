/**
 * Last-known-good cache for the /api/live snapshot.
 *
 * The live panel polls the cloud plane every ~5s. When the cloud edge is
 * briefly unreachable (Supabase degrade / local network blip) the route used
 * to return 502 and the UI dropped to OFFLINE even though the browser itself
 * was healthy the whole time. This cache keeps the last successful snapshot
 * process-locally so the route can serve a clearly-marked STALE response.
 *
 * Semantics:
 *  - setLiveSnapshot()  — called ONLY on a successful fresh cloud readback
 *  - getLiveSnapshot()  — returns the cached payload + staleness metadata
 *  - cache is process-local (no persistence) — empty until first success
 */

export interface LiveCacheEntry {
  snapshot: Record<string, unknown>;
  fetchedAt: string;
}

const MAX_AGE_MS = 10 * 60 * 1000; // beyond 10 minutes a cached snapshot is worthless

let entry: LiveCacheEntry | null = null;

export function setLiveSnapshot(snapshot: Record<string, unknown>): void {
  entry = { snapshot, fetchedAt: new Date().toISOString() };
}

export function getLiveSnapshot(): {
  snapshot: Record<string, unknown> | null;
  fetchedAt: string | null;
  staleMs: number | null;
  tooOld: boolean;
} {
  if (!entry) return { snapshot: null, fetchedAt: null, staleMs: null, tooOld: false };
  const staleMs = Math.max(0, Date.now() - new Date(entry.fetchedAt).getTime());
  return {
    snapshot: entry.snapshot,
    fetchedAt: entry.fetchedAt,
    staleMs,
    tooOld: staleMs > MAX_AGE_MS,
  };
}
