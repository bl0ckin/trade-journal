/** Short relative time for status labels: "just now", "12m ago", "3h ago", "2d ago". */
export const timeAgo = (iso: string | null | undefined, now: number = Date.now()): string => {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "never";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

/** True when there is no timestamp or it is older than maxAgeMs. */
export const isStale = (
  iso: string | null | undefined,
  maxAgeMs: number,
  now: number = Date.now(),
): boolean => {
  if (!iso) return true;
  const then = Date.parse(iso);
  return !Number.isFinite(then) || now - then > maxAgeMs;
};
