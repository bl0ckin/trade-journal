/** Which broker-synced accounts a "Sync" button should act on, given the account filter. */
export interface SyncScopeAccount {
  id: string;
  name: string;
  kind: "sync" | "import" | "manual";
  archivedAt: string | null;
  lastSyncAt: string | null;
}

/**
 * Broker-synced, non-archived accounts inside the current selection.
 * An empty selection means "all accounts".
 */
export const syncScope = <T extends SyncScopeAccount>(
  accounts: readonly T[],
  selectedIds: readonly string[],
): T[] =>
  accounts.filter(
    (account) =>
      account.kind === "sync" &&
      !account.archivedAt &&
      (selectedIds.length === 0 || selectedIds.includes(account.id)),
  );

/** The least recently synced account decides how fresh the data is. Null if any never synced. */
export const oldestSyncAt = (accounts: readonly SyncScopeAccount[]): string | null => {
  let oldest: string | null = null;
  for (const account of accounts) {
    if (!account.lastSyncAt) return null;
    if (oldest === null || Date.parse(account.lastSyncAt) < Date.parse(oldest))
      oldest = account.lastSyncAt;
  }
  return oldest;
};

/** The most recent sync across accounts, used to notice background syncs. */
export const latestSyncAt = (accounts: readonly SyncScopeAccount[]): string | null => {
  let latest: string | null = null;
  for (const account of accounts) {
    if (account.lastSyncAt && (latest === null || Date.parse(account.lastSyncAt) > Date.parse(latest)))
      latest = account.lastSyncAt;
  }
  return latest;
};
