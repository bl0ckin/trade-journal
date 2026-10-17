import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { accounts, db } from "@/db";
import { autoSyncIntervalMs, isSyncDue } from "@/lib/auto-sync-schedule";
import { syncAccountExclusive, type SyncOutcome } from "./sync";

export type SyncResult =
  | { accountId: string; name: string; ok: true; outcome: SyncOutcome }
  | { accountId: string; name: string; ok: false; error: string };

interface AutoSyncState {
  timer?: ReturnType<typeof setInterval>;
  /** Epoch ms of the last attempt per account, successful or not (drives retry spacing). */
  attempts: Map<string, number>;
  /** Latest failure per account; cleared by the next success. */
  failures: Map<string, { message: string; at: string }>;
}

// globalThis, because the scheduler (instrumentation) and the API routes may be separate bundles.
const globalState = globalThis as typeof globalThis & { __journalAutoSync?: AutoSyncState };
const state: AutoSyncState = (globalState.__journalAutoSync ??= {
  attempts: new Map<string, number>(),
  failures: new Map<string, { message: string; at: string }>(),
} satisfies AutoSyncState);

type SyncTarget = Pick<typeof accounts.$inferSelect, "id" | "name">;

/** Broker-connected, non-archived accounts, optionally limited to the given ids. */
export const eligibleSyncAccounts = (ids?: readonly string[]): SyncTarget[] =>
  db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(
      and(eq(accounts.kind, "sync"), isNotNull(accounts.credentialsEnc), isNull(accounts.archivedAt)),
    )
    .all()
    .filter((account) => !ids || ids.includes(account.id));

/** Sync one account and remember how it went. Never throws. */
const trySync = async (account: SyncTarget): Promise<SyncResult> => {
  state.attempts.set(account.id, Date.now());
  try {
    const outcome = await syncAccountExclusive(account.id);
    state.failures.delete(account.id);
    return { accountId: account.id, name: account.name, ok: true, outcome };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    state.failures.set(account.id, { message, at: new Date().toISOString() });
    return { accountId: account.id, name: account.name, ok: false, error: message };
  }
};

/** Sync several accounts at once; one failing account never hides the others' results. */
export const syncMany = (targets: readonly SyncTarget[]): Promise<SyncResult[]> =>
  Promise.all(targets.map(trySync));

/** Sync every auto-sync account whose last sync or attempt is at least one interval old. */
export const runAutoSync = async (now: number = Date.now()): Promise<SyncResult[]> => {
  const intervalMs = autoSyncIntervalMs();
  if (intervalMs === 0) return [];
  const due = db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.kind, "sync"),
        eq(accounts.autoSync, true),
        isNotNull(accounts.credentialsEnc),
        isNull(accounts.archivedAt),
      ),
    )
    .all()
    .filter((account) => isSyncDue(account.lastSyncAt, state.attempts.get(account.id), now, intervalMs));
  const results: SyncResult[] = [];
  // One at a time: background work should be gentle on broker rate limits.
  for (const account of due) results.push(await trySync(account));
  return results;
};

export const getSyncStatus = () => ({
  intervalMinutes: Math.round(autoSyncIntervalMs() / 60_000),
  failures: Object.fromEntries(state.failures),
});

/** Start the background loop once per server process. */
export const startAutoSyncScheduler = () => {
  if (state.timer || autoSyncIntervalMs() === 0) return;
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runAutoSync()
      .catch((error: unknown) => console.error("[auto-sync] run failed:", error))
      .finally(() => {
        running = false;
      });
  };
  // Due-ness is evaluated every minute, so changing an account's setting takes effect quickly.
  state.timer = setInterval(tick, 60_000);
  // Don't keep the process alive just for this loop.
  (state.timer as { unref?: () => void }).unref?.();
  // Catch up shortly after boot rather than waiting a full minute.
  (setTimeout(tick, 10_000) as { unref?: () => void }).unref?.();
};

export const stopAutoSyncScheduler = () => {
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
};
