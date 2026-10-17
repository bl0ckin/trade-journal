import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ syncAccount: vi.fn() }));
vi.mock("../src/server/sync", () => ({ syncAccountExclusive: mocks.syncAccount }));

const originalDir = process.env.JOURNAL_DATA_DIR;
const originalInterval = process.env.AUTO_SYNC_INTERVAL_MINUTES;
const scratch = mkdtempSync(join(tmpdir(), "journal-auto-sync-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
delete process.env.AUTO_SYNC_INTERVAL_MINUTES;
const { db, accounts } = await import("../src/db");
const { eligibleSyncAccounts, getSyncStatus, runAutoSync, syncMany } = await import(
  "../src/server/auto-sync"
);

const now = Date.parse("2026-10-13T12:00:00Z");
const outcome = (accountId: string) => ({
  accountId,
  inserted: 1,
  duplicates: 0,
  skipped: 0,
  skippedReasons: [],
  equity: null,
  positions: 0,
  syncedAt: "2026-10-13T12:00:00Z",
});
const add = (id: string, over: Partial<typeof accounts.$inferInsert> = {}) =>
  db
    .insert(accounts)
    .values({
      id,
      name: id,
      kind: "sync",
      credentialsEnc: "enc",
      autoSync: true,
      createdAt: "2026-01-01",
      ...over,
    })
    .run();

beforeEach(() => {
  db.delete(accounts).run();
  mocks.syncAccount.mockReset();
  mocks.syncAccount.mockImplementation(async (id: string) => outcome(id));
});
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  if (originalInterval !== undefined) process.env.AUTO_SYNC_INTERVAL_MINUTES = originalInterval;
  rmSync(scratch, { recursive: true, force: true });
});

describe("background auto-sync", () => {
  it("syncs only due, active, auto-sync broker accounts", async () => {
    add("due", { lastSyncAt: "2026-10-13T11:00:00Z" });
    add("fresh", { lastSyncAt: "2026-10-13T11:55:00Z" });
    add("off", { autoSync: false });
    add("archived", { archivedAt: "2026-02-01" });
    add("csv", { kind: "import", credentialsEnc: null });
    const results = await runAutoSync(now);
    expect(results.map((r) => r.accountId)).toEqual(["due"]);
    expect(mocks.syncAccount).toHaveBeenCalledTimes(1);
    expect(mocks.syncAccount).toHaveBeenCalledWith("due");
  });

  it("does not hammer a failing account: the failed attempt delays the retry", async () => {
    add("expired", { lastSyncAt: "2026-10-12T00:00:00Z" });
    mocks.syncAccount.mockRejectedValue(new Error("token expired"));
    const first = await runAutoSync(now);
    expect(first).toEqual([
      { accountId: "expired", name: "expired", ok: false, error: "token expired" },
    ]);
    expect(getSyncStatus().failures.expired?.message).toBe("token expired");

    expect(await runAutoSync(now + 60_000)).toEqual([]);
    expect(mocks.syncAccount).toHaveBeenCalledTimes(1);
  });

  it("clears a recorded failure after the next success", async () => {
    add("flaky");
    mocks.syncAccount.mockRejectedValueOnce(new Error("boom"));
    await syncMany([{ id: "flaky", name: "flaky" }]);
    expect(getSyncStatus().failures.flaky).toBeDefined();
    await syncMany([{ id: "flaky", name: "flaky" }]);
    expect(getSyncStatus().failures.flaky).toBeUndefined();
  });
});

describe("manual sync across accounts", () => {
  it("reports one result per account, so one failure doesn't hide the others", async () => {
    mocks.syncAccount.mockImplementation(async (id: string) => {
      if (id === "bad") throw new Error("auth failed");
      return outcome(id);
    });
    const results = await syncMany([
      { id: "good", name: "Good" },
      { id: "bad", name: "Bad" },
    ]);
    expect(results.map((r) => [r.accountId, r.ok])).toEqual([
      ["good", true],
      ["bad", false],
    ]);
  });

  it("only offers active broker accounts", () => {
    add("a");
    add("b", { archivedAt: "2026-02-01" });
    add("c", { kind: "manual", credentialsEnc: null });
    expect(eligibleSyncAccounts().map((x) => x.id)).toEqual(["a"]);
    expect(eligibleSyncAccounts(["b", "c"])).toEqual([]);
  });
});
