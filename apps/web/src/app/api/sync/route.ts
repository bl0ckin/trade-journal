import { handler, ok, requireValue } from "@/server/api";
import { eligibleSyncAccounts, getSyncStatus, syncMany } from "@/server/auto-sync";

/** Background-sync settings and the latest failure per account. */
export const GET = handler(() => ok(getSyncStatus()));

/**
 * Sync broker-connected accounts. Body: { accountIds?: string[] }. Omit accountIds to sync every
 * active broker account. Returns one result per account so a single failure doesn't hide the rest.
 */
export const POST = handler(async (request: Request) => {
  const body = (await request.json().catch(() => ({}))) as { accountIds?: unknown };
  let ids: string[] | undefined;
  if (body.accountIds !== undefined) {
    requireValue(
      Array.isArray(body.accountIds) && body.accountIds.every((id) => typeof id === "string"),
      "accountIds must be a list of account ids.",
    );
    ids = body.accountIds as string[];
  }
  const targets = eligibleSyncAccounts(ids);
  requireValue(targets.length > 0, "No broker-synced accounts to sync.");
  return ok({ results: await syncMany(targets) });
});
