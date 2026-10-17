import { asc, eq } from "drizzle-orm";
import { accounts, db, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { encryptJson } from "@/server/crypto";
import { newId, nowIso } from "@/server/ids";
import { getPrimaryAccountId } from "@/server/settings";
import { syncAccount } from "@/server/sync";

/** All-time net P&L per account, from the materialized trades. */
const netPnlByAccount = () => {
  const totals = new Map<string, number>();
  for (const row of db.select({ accountId: trades.accountId, netPnl: trades.netPnl }).from(trades).all())
    totals.set(row.accountId, (totals.get(row.accountId) ?? 0) + row.netPnl);
  return totals;
};

export const GET = handler((request: Request) => {
  if (new URL(request.url).searchParams.get("summary") === "1") {
    const pnl = netPnlByAccount();
    return ok({
      primaryAccountId: getPrimaryAccountId(),
      accounts: db
        .select({
          id: accounts.id,
          name: accounts.name,
          broker: accounts.broker,
          archivedAt: accounts.archivedAt,
          currency: accounts.currency,
          initialBalance: accounts.initialBalance,
          kind: accounts.kind,
          autoSync: accounts.autoSync,
          lastSyncAt: accounts.lastSyncAt,
        })
        .from(accounts)
        .orderBy(asc(accounts.createdAt))
        .all()
        .map((account) => ({
          ...account,
          netPnl: pnl.get(account.id) ?? 0,
          balance: account.initialBalance + (pnl.get(account.id) ?? 0),
        })),
    });
  }
  const rows = db.select().from(accounts).orderBy(asc(accounts.createdAt)).all();
  return ok({
    primaryAccountId: getPrimaryAccountId(),
    accounts: rows.map(({ credentialsEnc, ...safe }) => ({
      ...safe,
      connected: credentialsEnc !== null,
      snapshot: safe.snapshotJson ? JSON.parse(safe.snapshotJson) : null,
    })),
  });
});

interface CreateBody {
  name?: string;
  kind?: "sync" | "import" | "manual";
  broker?: string;
  currency?: string;
  initialBalance?: number;
  profitCalcMethod?: "fifo" | "lifo" | "wavg";
  credentials?: Record<string, string>;
  autoSync?: boolean;
}

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as CreateBody;
  if (!body.name || !body.kind) return bad("name and kind are required");
  if (body.kind === "sync" && (!body.broker || !body.credentials)) {
    return bad("sync accounts need a broker and credentials");
  }

  const id = newId();
  db.insert(accounts)
    .values({
      id,
      name: body.name,
      broker: body.broker ?? "",
      kind: body.kind,
      currency: body.currency ?? "USD",
      initialBalance: body.initialBalance ?? 0,
      profitCalcMethod: body.profitCalcMethod ?? "fifo",
      credentialsEnc: body.kind === "sync" ? encryptJson(body.credentials) : null,
      autoSync: body.autoSync ?? body.kind === "sync",
      createdAt: nowIso(),
    })
    .run();

  // First sync happens right away so the account isn't born empty.
  let sync = null;
  if (body.kind === "sync") {
    try {
      sync = await syncAccount(id);
    } catch (error) {
      // Bad credentials shouldn't strand a half-created account.
      db.delete(accounts).where(eq(accounts.id, id)).run();
      return bad(error instanceof Error ? error.message : "Broker connection failed", 502);
    }
  }
  return ok({ id, sync });
});
