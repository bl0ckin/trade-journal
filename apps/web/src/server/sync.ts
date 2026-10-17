import { connect, listBrokers, type BrokerId } from "@luxalgo/broker-sdk";
import { eq } from "drizzle-orm";
import { accounts, db } from "@/db";
import { decryptJson, encryptJson } from "./crypto";
import { nowIso } from "./ids";
import { brokerTradesToExecutions, untimedFillsReason } from "./broker-trades";
import { insertExecutions, type InsertResult } from "./executions";
import { getImportTimeZone } from "./settings";
import { withAlpacaShortSides } from "./alpaca-fills";
import { requireValue } from "./api";
import {
  assertIbkrSyncTimeZone,
  canonicalImportTimeZone,
  isIbkrSyncAccount,
} from "./ibkr-sync-timezone";

/** All broker connectivity goes through @luxalgo/broker-sdk, never direct API code. */
export { listBrokers };

export interface SyncOutcome extends InsertResult {
  accountId: string;
  equity: number | null;
  positions: number;
  syncedAt: string;
}

export const syncAccount = async (accountId: string): Promise<SyncOutcome> => {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error("Account not found");
  if (account.kind !== "sync" || !account.credentialsEnc) {
    throw new Error("Account is not broker-connected");
  }

  const statementTimeZone = isIbkrSyncAccount(account)
    ? canonicalImportTimeZone(getImportTimeZone())
    : undefined;
  if (statementTimeZone !== undefined) assertIbkrSyncTimeZone(account, statementTimeZone);

  const credentials = decryptJson<Record<string, string>>(account.credentialsEnc);
  const connection = connect({
    broker: account.broker as BrokerId,
    credentials,
    ...(statementTimeZone !== undefined ? { statementTimeZone } : {}),
    // The SDK drops Alpaca's "sell_short" fills (the sale that opens a short); see alpaca-fills.ts.
    ...(account.broker === "alpaca" ? { fetch: withAlpacaShortSides() } : {}),
    // Some brokers rotate tokens on every fetch (Questrade): persist or die.
    onCredentialsRotated: (next: Record<string, string>) => {
      db.update(accounts)
        .set({ credentialsEnc: encryptJson(next) })
        .where(eq(accounts.id, accountId))
        .run();
    },
  } as Parameters<typeof connect>[0]);

  const snapshot = await connection.fetchSnapshot();
  const syncedAt = nowIso();

  const { timed, untimed } = brokerTradesToExecutions(
    snapshot.accounts.flatMap((brokerAccount) => brokerAccount.trades),
  );

  const equity = snapshot.accounts.reduce((total, a) => total + a.equity, 0);
  const positions = snapshot.accounts.flatMap((a) => a.positions);
  const result = db.transaction(
    () => {
      if (statementTimeZone !== undefined) {
        const current = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
        requireValue(
          current &&
            isIbkrSyncAccount(current) &&
            current.credentialsEnc === account.credentialsEnc,
          "The IBKR connection changed during sync. Try again.",
        );
        assertIbkrSyncTimeZone(current, statementTimeZone);
      }
      // Validation, history provenance, deduplication and sync status commit together.
      const inserted = insertExecutions(accountId, timed, "sync");
      db.update(accounts)
        .set({
          lastSyncAt: syncedAt,
          snapshotJson: JSON.stringify({ equity, positions, fetchedAt: snapshot.fetchedAt }),
          ...(statementTimeZone !== undefined && inserted.inserted > 0
            ? { ibkrSyncTimeZone: statementTimeZone }
            : {}),
        })
        .where(eq(accounts.id, accountId))
        .run();
      return inserted;
    },
    { behavior: "immediate" },
  );
  if (untimed > 0) {
    result.skipped += untimed;
    if (result.skippedReasons.length < 5)
      result.skippedReasons.push(untimedFillsReason(untimed, statementTimeZone !== undefined));
  }

  return { accountId, ...result, equity, positions: positions.length, syncedAt };
};

// One sync per account at a time, for the UI button, the Accounts page and the background job.
// A manual click and the scheduler can ask for the same account together; later callers join the
// sync already running instead of hitting the broker twice. `syncAccount` above stays unlocked on
// purpose: its own transaction checks (e.g. IBKR timezone provenance) must hold even when two
// syncs overlap. Kept on globalThis because route handlers and the instrumentation hook can be
// bundled separately.
const globalSync = globalThis as typeof globalThis & {
  __journalSyncInFlight?: Map<string, Promise<SyncOutcome>>;
};
const inFlight = (globalSync.__journalSyncInFlight ??= new Map<string, Promise<SyncOutcome>>());

export const isSyncing = (accountId: string): boolean => inFlight.has(accountId);

export const syncAccountExclusive = (accountId: string): Promise<SyncOutcome> => {
  const running = inFlight.get(accountId);
  if (running) return running;
  const next: Promise<SyncOutcome> = syncAccount(accountId).finally(() => {
    if (inFlight.get(accountId) === next) inFlight.delete(accountId);
  });
  inFlight.set(accountId, next);
  return next;
};
