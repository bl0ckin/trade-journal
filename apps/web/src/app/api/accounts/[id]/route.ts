import { eq } from "drizzle-orm";
import { accounts, db } from "@/db";
import { bad, handler, ok, requireValue } from "@/server/api";
import { clearAccountData } from "@/server/account-data";
import { rebuildAccount } from "@/server/rebuild";
import { hasSyncedExecutions, isIbkrSyncAccount } from "@/server/ibkr-sync-timezone";
import { deleteSetting, getPrimaryAccountId, setSetting } from "@/server/settings";

type Params = { params: Promise<{ id: string }> };

interface PatchBody {
  name?: string;
  broker?: string;
  currency?: string;
  initialBalance?: number;
  profitCalcMethod?: "fifo" | "lifo" | "wavg";
  autoSync?: boolean;
  /** Make this the account the Add trade form picks automatically (false clears it). */
  primary?: boolean;
}

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const account = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!account) return bad("Account not found", 404);

  const body = (await request.json()) as PatchBody;
  if (body.primary !== undefined) {
    requireValue(typeof body.primary === "boolean", "Invalid primary value.");
    if (body.primary) {
      requireValue(account.kind !== "sync", "Choose a manual or import account as primary.");
      requireValue(!account.archivedAt, "Unarchive this account before making it primary.");
      setSetting("primaryAccountId", id);
    } else if (getPrimaryAccountId() === id) deleteSetting("primaryAccountId");
  }
  const patch: Partial<typeof accounts.$inferInsert> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.broker !== undefined) patch.broker = body.broker;
  if (body.currency !== undefined) patch.currency = body.currency;
  if (body.initialBalance !== undefined) patch.initialBalance = body.initialBalance;
  if (body.autoSync !== undefined) patch.autoSync = body.autoSync;
  if (body.profitCalcMethod !== undefined) patch.profitCalcMethod = body.profitCalcMethod;

  db.transaction(
    () => {
      const current = db.select().from(accounts).where(eq(accounts.id, id)).get();
      requireValue(current, "Account not found.");
      if (
        body.broker !== undefined &&
        body.broker !== current.broker &&
        isIbkrSyncAccount(current)
      ) {
        requireValue(
          !hasSyncedExecutions(id),
          "An IBKR account with synced history cannot change brokers. Connect a separate account to preserve its timestamp history.",
        );
      }
      if (Object.keys(patch).length > 0) {
        db.update(accounts).set(patch).where(eq(accounts.id, id)).run();
      }
      // A new profit-calc method changes per-exit attribution — recompute.
      if (body.profitCalcMethod && body.profitCalcMethod !== current.profitCalcMethod) {
        rebuildAccount(id);
      }
    },
    { behavior: "immediate" },
  );
  return ok({ updated: true });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  if (getPrimaryAccountId() === id) deleteSetting("primaryAccountId");
  clearAccountData(id, { deleteAccount: true });
  return ok({ deleted: true });
});
