import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";

const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-restore-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, aiChats, aiMessages, executions, folders, journalDays, notes, settings, trades } = await import("../src/db");
const { insertExecutions } = await import("../src/server/executions");
const { rebuildAccount } = await import("../src/server/rebuild");
const { GET: exportAll } = await import("../src/app/api/export/route");
const { isBackup, restoreBackup } = await import("../src/server/restore");

const fills: ImportedExecution[] = [
  { symbol: "TEST", side: "buy", quantity: 10, price: 100, fee: 0, executedAt: "2026-09-01T10:00:00Z" },
  { symbol: "TEST", side: "sell", quantity: 10, price: 102, fee: 0, executedAt: "2026-09-01T11:00:00Z" },
];

const wipe = () => {
  db.delete(notes).run();
  db.delete(folders).run();
  db.delete(journalDays).run();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(aiMessages).run();
  db.delete(aiChats).run();
  db.delete(settings).run();
};

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  wipe();
});
afterAll(() => {
  vi.unstubAllEnvs();
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

/** A journal with one annotated trade, a note and a daily note, saved as a Full backup. */
const makeBackup = async () => {
  db.insert(accounts)
    .values({ id: "acc", name: "Main", kind: "manual", currency: "USD", createdAt: "2026-01-01" })
    .run();
  insertExecutions("acc", fills, "manual");
  rebuildAccount("acc");
  const key = db.select().from(trades).all()[0]!.key;
  db.update(trades)
    .set({
      notes: "Waited for the retest",
      tagsJson: '["breakout"]',
      mistakesJson: '["fomo"]',
      confidence: 7,
      tradeQuality: 8,
      emotionalState: '["calm"]',
      rating: 4,
      stopLoss: 98,
    })
    .where(eq(trades.key, key))
    .run();
  db.insert(folders).values({ id: "f1", name: "Ideas", kind: "user", createdAt: "2026-01-01" }).run();
  db.insert(notes)
    .values({ id: "n1", folderId: "f1", title: "Plan", content: "Trade the open", createdAt: "2026-01-01", updatedAt: "2026-01-01" })
    .run();
  db.insert(journalDays).values({ date: "2026-09-01", note: "Good day", updatedAt: "2026-09-01" }).run();
  const response = await exportAll(new Request("http://localhost/api/export"));
  return { key, backup: (await response.json()) as Record<string, unknown> };
};

describe("restoring a full backup", () => {
  it("recognises only backup files", async () => {
    const { backup } = await makeBackup();
    expect(isBackup(backup)).toBe(true);
    expect(isBackup({ accounts: [] })).toBe(false);
    expect(isBackup("nope")).toBe(false);
  });

  it("previews without changing anything, then restores fills and annotations", async () => {
    const { key, backup } = await makeBackup();
    wipe();

    const preview = restoreBackup(backup, { overwrite: false, dryRun: true });
    expect(preview.accountsAdded).toBe(1);
    expect(preview.executionsAdded).toBe(2);
    expect(preview.tradesAnnotated).toBe(1);
    expect(db.select().from(accounts).all()).toHaveLength(0);
    expect(db.select().from(executions).all()).toHaveLength(0);

    const result = restoreBackup(backup, { overwrite: false, dryRun: false });
    expect(result).toMatchObject({ accountsAdded: 1, executionsAdded: 2, tradesAnnotated: 1, notes: 1, folders: 1, journalDays: 1 });
    const trade = db.select().from(trades).where(eq(trades.key, key)).get()!;
    expect(trade).toMatchObject({
      notes: "Waited for the retest",
      tagsJson: '["breakout"]',
      mistakesJson: '["fomo"]',
      confidence: 7,
      tradeQuality: 8,
      emotionalState: '["calm"]',
      rating: 4,
      stopLoss: 98,
    });
    expect(db.select().from(accounts).all()[0]!.credentialsEnc).toBeNull();
  });

  it("is repeatable and keeps existing annotations unless told to replace them", async () => {
    const { key, backup } = await makeBackup();
    wipe();
    restoreBackup(backup, { overwrite: false, dryRun: false });

    const again = restoreBackup(backup, { overwrite: false, dryRun: false });
    expect(again).toMatchObject({ accountsAdded: 0, executionsAdded: 0, tradesAnnotated: 0, notes: 0 });

    db.update(trades).set({ confidence: 3 }).where(eq(trades.key, key)).run();
    restoreBackup(backup, { overwrite: false, dryRun: false });
    expect(db.select().from(trades).where(eq(trades.key, key)).get()!.confidence).toBe(3);

    restoreBackup(backup, { overwrite: true, dryRun: false });
    expect(db.select().from(trades).where(eq(trades.key, key)).get()!.confidence).toBe(7);
  });

  it("brings back AI chats, saved prompts, prop templates and settings, and never keys", async () => {
    await makeBackup();
    db.insert(aiChats).values({ id: "c1", title: "Review", createdAt: "2026-01-01", updatedAt: "2026-01-01" }).run();
    db.insert(aiMessages).values({ id: "m1", chatId: "c1", role: "user", content: "hi", createdAt: "2026-01-01" }).run();
    const put = (key: string, value: string) =>
      db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
    put("timeZone", "America/Toronto");
    put("multipliers", JSON.stringify({ ES: 50 }));
    put("aiPrompts", JSON.stringify([{ id: "p1", title: "Recap", text: "Recap my week" }]));
    put("propTemplates", JSON.stringify([{ id: "t1", name: "Template" }]));
    put("riskLimits", JSON.stringify({ maxDailyLoss: 500 }));
    put("anthropicKeyEnc", "SECRET-CIPHERTEXT");
    const full = (await (await exportAll(new Request("http://localhost/api/export"))).json()) as Record<string, unknown>;
    expect(JSON.stringify(full)).not.toContain("SECRET-CIPHERTEXT");

    wipe();
    const result = restoreBackup(full, { overwrite: false, dryRun: false });
    expect(result).toMatchObject({ aiChats: 1, aiMessages: 1 });
    expect(result.settings).toBeGreaterThanOrEqual(4);
    const value = (key: string) => db.select().from(settings).where(eq(settings.key, key)).get()?.value;
    expect(value("timeZone")).toBe("America/Toronto");
    expect(JSON.parse(value("multipliers")!)).toEqual({ ES: 50 });
    expect(JSON.parse(value("aiPrompts")!)).toHaveLength(1);
    expect(JSON.parse(value("propTemplates")!)).toHaveLength(1);
    expect(value("anthropicKeyEnc")).toBeUndefined();

    const again = restoreBackup(full, { overwrite: false, dryRun: false });
    expect(again).toMatchObject({ aiChats: 0, aiMessages: 0, settings: 0 });
  });
});
