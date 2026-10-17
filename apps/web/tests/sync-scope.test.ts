import { describe, expect, it } from "vitest";
import { autoSyncIntervalMs, isSyncDue } from "../src/lib/auto-sync-schedule";
import { latestSyncAt, oldestSyncAt, syncScope, type SyncScopeAccount } from "../src/lib/sync-scope";
import { isStale, timeAgo } from "../src/lib/time-ago";

const account = (over: Partial<SyncScopeAccount> & { id: string }): SyncScopeAccount => ({
  name: over.id,
  kind: "sync",
  archivedAt: null,
  lastSyncAt: null,
  ...over,
});

describe("timeAgo / isStale", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  it("formats short relative times", () => {
    expect(timeAgo(null, now)).toBe("never");
    expect(timeAgo("garbage", now)).toBe("never");
    expect(timeAgo("2026-10-13T11:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-10-13T11:48:00Z", now)).toBe("12m ago");
    expect(timeAgo("2026-10-13T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo("2026-10-11T12:00:00Z", now)).toBe("2d ago");
  });
  it("treats a missing or old timestamp as stale", () => {
    expect(isStale(null, 1000, now)).toBe(true);
    expect(isStale("2026-10-13T11:59:59Z", 60_000, now)).toBe(false);
    expect(isStale("2026-10-13T10:00:00Z", 60_000, now)).toBe(true);
  });
});

describe("syncScope", () => {
  const all = [
    account({ id: "a" }),
    account({ id: "b" }),
    account({ id: "archived", archivedAt: "2026-01-01" }),
    account({ id: "csv", kind: "import" }),
    account({ id: "manual", kind: "manual" }),
  ];
  it("with no selection, covers every active broker account only", () => {
    expect(syncScope(all, []).map((a) => a.id)).toEqual(["a", "b"]);
  });
  it("narrows to the selected accounts", () => {
    expect(syncScope(all, ["b", "csv"]).map((a) => a.id)).toEqual(["b"]);
  });
  it("is empty when the selection has no broker account, so the button hides", () => {
    expect(syncScope(all, ["csv", "manual"])).toEqual([]);
  });
  it("reports the oldest and latest sync, and null oldest if any never synced", () => {
    const synced = [
      account({ id: "a", lastSyncAt: "2026-10-13T10:00:00Z" }),
      account({ id: "b", lastSyncAt: "2026-10-13T11:00:00Z" }),
    ];
    expect(oldestSyncAt(synced)).toBe("2026-10-13T10:00:00Z");
    expect(latestSyncAt(synced)).toBe("2026-10-13T11:00:00Z");
    expect(oldestSyncAt([...synced, account({ id: "c" })])).toBeNull();
  });
});

describe("auto-sync schedule", () => {
  const minute = 60_000;
  it("defaults to 15 minutes and understands off / 0", () => {
    expect(autoSyncIntervalMs(undefined)).toBe(15 * minute);
    expect(autoSyncIntervalMs("")).toBe(15 * minute);
    expect(autoSyncIntervalMs("30")).toBe(30 * minute);
    expect(autoSyncIntervalMs("0")).toBe(0);
    expect(autoSyncIntervalMs("off")).toBe(0);
  });
  it("falls back to the default on nonsense and floors at one minute", () => {
    expect(autoSyncIntervalMs("abc")).toBe(15 * minute);
    expect(autoSyncIntervalMs("-5")).toBe(15 * minute);
    expect(autoSyncIntervalMs("0.2")).toBe(minute);
  });
  it("is due after a full interval, counting failed attempts too", () => {
    const now = Date.parse("2026-10-13T12:00:00Z");
    const interval = 15 * minute;
    expect(isSyncDue(null, undefined, now, interval)).toBe(true);
    expect(isSyncDue("2026-10-13T11:50:00Z", undefined, now, interval)).toBe(false);
    expect(isSyncDue("2026-10-13T11:40:00Z", undefined, now, interval)).toBe(true);
    // A failed attempt 2 minutes ago postpones the retry even though lastSyncAt is old.
    expect(isSyncDue("2026-10-13T08:00:00Z", now - 2 * minute, now, interval)).toBe(false);
    expect(isSyncDue("2026-10-13T08:00:00Z", now - 16 * minute, now, interval)).toBe(true);
    expect(isSyncDue(null, undefined, now, 0)).toBe(false);
  });
});
