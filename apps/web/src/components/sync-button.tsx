"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { announceSynced } from "@/lib/sync-events";
import { isStale, timeAgo } from "@/lib/time-ago";
import {
  latestSyncAt,
  oldestSyncAt,
  syncScope,
  type SyncScopeAccount,
} from "@/lib/sync-scope";
import { formatTimestamp, isTimeZone } from "@/lib/timezone";
import { postJson, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";

interface SyncOutcome {
  inserted: number;
  duplicates: number;
  skipped: number;
  skippedReasons: string[];
}

type SyncResult =
  | { accountId: string; name: string; ok: true; outcome: SyncOutcome }
  | { accountId: string; name: string; ok: false; error: string };

type Feedback = { kind: "results"; results: SyncResult[] } | { kind: "error"; message: string };

/** Older than this and the "synced …" label turns yellow. */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
/** How often to re-read account state, so background syncs show up without a reload. */
const POLL_MS = 60_000;

/**
 * Sync button for broker-connected accounts. Follows the account selector: one account selected
 * syncs that one, otherwise every active broker account. Renders nothing when none are in scope.
 * `onSynced` runs after any sync with new data, whether started here or by the background job.
 */
export function SyncButton({ onSynced }: { onSynced?: () => void }) {
  const params = useSearchParams();
  const selectedKey = params.get("accounts") ?? "";
  const accountsApi = useApi<{ accounts: SyncScopeAccount[] }>("/api/accounts?summary=1");
  const statusApi = useApi<{ failures: Record<string, { message: string; at: string }> }>(
    "/api/sync",
  );
  const { data: settings } = useApi<{ timeZone: string }>("/api/settings");
  const savedZone = settings?.timeZone;
  const timeZone = isTimeZone(savedZone) ? savedZone : "UTC";
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [, setClock] = useState(0);

  const scope = useMemo(
    () =>
      syncScope(
        accountsApi.data?.accounts ?? [],
        selectedKey.split(",").filter(Boolean),
      ),
    [accountsApi.data, selectedKey],
  );

  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;
  const { refresh: refreshAccounts } = accountsApi;
  const { refresh: refreshStatus } = statusApi;
  const refreshAll = useCallback(() => {
    refreshAccounts();
    refreshStatus();
  }, [refreshAccounts, refreshStatus]);

  // Poll so the label stays honest and background syncs refresh the page; tick the clock so
  // "5m ago" keeps moving between polls.
  useEffect(() => {
    const poll = setInterval(refreshAll, POLL_MS);
    const clock = setInterval(() => setClock((value) => value + 1), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refreshAll]);

  // A newer lastSyncAt that this button didn't cause means the background job ran.
  const latest = latestSyncAt(scope);
  const seenLatest = useRef<{ selection: string; latest: string | null } | null>(null);
  const ownSync = useRef(false);
  useEffect(() => {
    if (!accountsApi.data) return;
    const seen = seenLatest.current;
    seenLatest.current = { selection: selectedKey, latest };
    // First load, or the account selector changed: not a sync.
    if (seen === null || seen.selection !== selectedKey) return;
    const previous = seen.latest;
    if (latest === previous) return;
    if (ownSync.current) {
      ownSync.current = false;
      return;
    }
    if (latest && (!previous || Date.parse(latest) > Date.parse(previous))) {
      onSyncedRef.current?.();
      announceSynced();
    }
  }, [latest, selectedKey, accountsApi.data]);

  // Successes fade on their own; anything that needs attention stays until dismissed.
  useEffect(() => {
    if (feedback?.kind !== "results") return;
    const needsAttention = feedback.results.some((r) => !r.ok || r.outcome.skipped > 0);
    if (needsAttention) return;
    const timer = setTimeout(() => setFeedback(null), 6000);
    return () => clearTimeout(timer);
  }, [feedback]);

  if (scope.length === 0) return null;

  const run = async () => {
    setSyncing(true);
    setFeedback(null);
    try {
      const { results } = await postJson<{ results: SyncResult[] }>("/api/sync", {
        accountIds: scope.map((account) => account.id),
      });
      setFeedback({ kind: "results", results });
      if (results.some((result) => result.ok)) {
        ownSync.current = true;
        onSyncedRef.current?.();
        announceSynced();
      }
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "Sync failed" });
    } finally {
      setSyncing(false);
      refreshAll();
    }
  };

  const failures = statusApi.data?.failures ?? {};
  const failing = scope.filter((account) => failures[account.id]);
  const oldest = oldestSyncAt(scope);
  const stale = isStale(oldest, STALE_AFTER_MS);
  const label = failing.length
    ? "Last sync failed"
    : oldest
      ? `Synced ${timeAgo(oldest)}`
      : "Never synced";
  const labelTitle = failing.length
    ? failing.map((account) => `${account.name}: ${failures[account.id]!.message}`).join("\n")
    : `${scope.length > 1 ? `Oldest of ${scope.length} broker accounts` : scope[0]!.name}${
        oldest ? ` · ${formatTimestamp(oldest, timeZone).slice(0, 16)} (${timeZone})` : ""
      }`;

  return (
    <div className="relative flex items-center gap-2">
      <span
        title={labelTitle}
        className={cn(
          "hidden text-xs sm:inline",
          failing.length ? "text-destructive" : stale ? "text-yellow-500" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={syncing}
        onClick={() => void run()}
        title={
          scope.length > 1
            ? `Sync ${scope.length} broker accounts`
            : `Sync ${scope[0]!.name} from the broker`
        }
      >
        <RefreshCw className={syncing ? "animate-spin" : undefined} />
        {syncing ? "Syncing…" : "Sync"}
      </Button>
      {feedback && (
        <div
          role="status"
          className="absolute left-0 top-full z-30 mt-2 w-80 max-w-[85vw] rounded-lg border bg-card p-3 text-xs shadow-lg"
        >
          <button
            type="button"
            aria-label="Dismiss sync result"
            className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
            onClick={() => setFeedback(null)}
          >
            <X className="h-3.5 w-3.5" />
          </button>
          <ul className="space-y-1.5 pr-5">
            {feedback.kind === "error" ? (
              <li className="text-destructive">{feedback.message}</li>
            ) : (
              feedback.results.map((result) => (
                <li key={result.accountId}>
                  <span className="font-medium">{result.name}</span>{" "}
                  {result.ok ? (
                    <span className="text-muted-foreground">
                      {result.outcome.inserted === 0
                        ? "is up to date"
                        : `added ${result.outcome.inserted} new fill${result.outcome.inserted === 1 ? "" : "s"}`}
                      {result.outcome.skipped > 0 &&
                        ` · ${result.outcome.skipped} skipped: ${result.outcome.skippedReasons.join(" ")}`}
                    </span>
                  ) : (
                    <span className="text-destructive">failed: {result.error}</span>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
