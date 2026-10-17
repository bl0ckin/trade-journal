/** Scheduling rules for background broker sync. Pure so they can be tested without a database. */
export const DEFAULT_AUTO_SYNC_MINUTES = 15;

/**
 * Interval from AUTO_SYNC_INTERVAL_MINUTES. Unset or invalid → 15 minutes.
 * "0" or "off" disables background sync. Anything under one minute is raised to one.
 * Returns milliseconds, 0 meaning disabled.
 */
export const autoSyncIntervalMs = (raw: string | undefined = process.env.AUTO_SYNC_INTERVAL_MINUTES) => {
  const text = raw?.trim().toLowerCase();
  if (!text) return DEFAULT_AUTO_SYNC_MINUTES * 60_000;
  if (text === "off" || text === "false") return 0;
  const minutes = Number(text);
  if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_AUTO_SYNC_MINUTES * 60_000;
  if (minutes === 0) return 0;
  return Math.max(1, minutes) * 60_000;
};

/**
 * An account is due when the last success or the last attempt, whichever is newer, is at least one
 * interval old. Counting failed attempts keeps an expired token from being retried every minute.
 */
export const isSyncDue = (
  lastSyncAt: string | null,
  lastAttemptAt: number | undefined,
  now: number,
  intervalMs: number,
): boolean => {
  if (intervalMs <= 0) return false;
  const synced = lastSyncAt ? Date.parse(lastSyncAt) : Number.NaN;
  const reference = Math.max(
    Number.isFinite(synced) ? synced : Number.NEGATIVE_INFINITY,
    lastAttemptAt ?? Number.NEGATIVE_INFINITY,
  );
  return reference === Number.NEGATIVE_INFINITY || now - reference >= intervalMs;
};
