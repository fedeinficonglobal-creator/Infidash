// Pure decision logic for the automatic GA4 load in the Traffic tab (no React, no I/O).

/** A persisted GA4 snapshot older than this is shown but refreshed in the background. */
export const GA4_FRESH_MS = 6 * 60 * 60 * 1000;

export type Ga4RefreshKind =
  | 'none'
  | 'background-sync'
  | 'background-preview'
  | 'blocking-sync'
  | 'blocking-preview';

export interface Ga4SnapshotLike {
  complete: boolean;
  syncedAt?: string;
}

export interface Ga4LoadPlan<T extends Ga4SnapshotLike> {
  /** Data to display immediately, or null when there is nothing usable yet. */
  show: T | null;
  refresh: Ga4RefreshKind;
}

/** Fresh means synced no more than GA4_FRESH_MS ago. Missing, invalid or future timestamps are stale. */
export function isSnapshotFresh(syncedAt: string | undefined, now: number): boolean {
  if (!syncedAt) return false;
  const time = Date.parse(syncedAt);
  if (!Number.isFinite(time)) return false;
  const age = now - time;
  return age >= 0 && age <= GA4_FRESH_MS;
}

/**
 * Decide what to show and which refresh (if any) to run.
 * Admins refresh with a persisting sync; viewers with a non-persisted live preview.
 * `force` (manual button) never skips the refresh and keeps any existing data visible.
 */
export function planGa4Load<T extends Ga4SnapshotLike>(input: {
  isAdmin: boolean;
  snapshot: T | null;
  now: number;
  force?: boolean;
}): Ga4LoadPlan<T> {
  const { isAdmin, snapshot, now, force = false } = input;
  const show = snapshot && snapshot.complete ? snapshot : null;
  if (!show) return { show: null, refresh: isAdmin ? 'blocking-sync' : 'blocking-preview' };
  if (!force && isSnapshotFresh(show.syncedAt, now)) return { show, refresh: 'none' };
  return { show, refresh: isAdmin ? 'background-sync' : 'background-preview' };
}
