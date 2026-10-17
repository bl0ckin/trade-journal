/**
 * Runs once when the Next.js server starts. Starts the background broker sync for accounts that
 * have "Auto-sync" on. Interval: AUTO_SYNC_INTERVAL_MINUTES (default 15; 0 or "off" disables).
 */
export async function register() {
  // The import must sit inside a positive `=== "nodejs"` check. Next.js compiles this file
  // for the Edge runtime too, and only this form lets webpack drop the import there. An
  // early `return` is not recognised, so the Edge build tries to bundle better-sqlite3
  // (which needs fs/path) and `next build` fails.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAutoSyncScheduler } = await import("@/server/auto-sync");
    startAutoSyncScheduler();
  }
}
