import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const broker = vi.hoisted(() => ({ fetchSnapshot: vi.fn(), connect: vi.fn() }));
vi.mock("@luxalgo/broker-sdk", () => ({
  connect: broker.connect,
  listBrokers: () => [],
}));

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-sync-lock-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades } = await import("../src/db");
const { encryptJson } = await import("../src/server/crypto");
const { isSyncing, syncAccountExclusive: syncAccount } = await import("../src/server/sync");

const snapshot = {
  fetchedAt: "2026-10-13T12:00:00Z",
  accounts: [
    {
      equity: 1000,
      positions: [],
      trades: [
        { symbol: "ES", side: "buy", quantity: 1, price: 5000, fee: 0, executedAt: "2026-09-01T10:00:00Z" },
      ],
    },
  ],
};

beforeEach(() => {
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.insert(accounts)
    .values({
      id: "lock",
      name: "Lock",
      broker: "tradovate",
      kind: "sync",
      credentialsEnc: encryptJson({ token: "x" }),
      createdAt: "2026-01-01",
    })
    .run();
  broker.fetchSnapshot.mockReset();
  broker.fetchSnapshot.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return snapshot;
  });
  broker.connect.mockReset();
  broker.connect.mockImplementation(() => ({ fetchSnapshot: broker.fetchSnapshot }));
});
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

describe("one sync per account at a time", () => {
  it("joins overlapping requests instead of calling the broker twice", async () => {
    const first = syncAccount("lock");
    const second = syncAccount("lock");
    expect(isSyncing("lock")).toBe(true);
    const [a, b] = await Promise.all([first, second]);
    expect(broker.connect).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a.inserted).toBe(1);
    expect(isSyncing("lock")).toBe(false);
  });

  it("allows a new sync once the previous one finished, even after a failure", async () => {
    broker.fetchSnapshot.mockRejectedValueOnce(new Error("broker down"));
    await expect(syncAccount("lock")).rejects.toThrow("broker down");
    expect(isSyncing("lock")).toBe(false);
    const retry = await syncAccount("lock");
    expect(retry.inserted).toBe(1);
    expect(broker.connect).toHaveBeenCalledTimes(2);
  });
});
