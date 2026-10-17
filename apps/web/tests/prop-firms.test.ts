import { afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  toMinor,
  expectedPayout,
  cashMovements,
  cashSummary,
  cashTimeline,
  payoutProgress,
  type PropEntry,
} from "../src/lib/prop-firms";
const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-prop-test-"));
process.env.JOURNAL_DATA_DIR = scratch;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const {
  db,
  propAccounts,
  propEntries,
  propReceipts,
  propAudit,
  accounts,
  settings,
  trades,
  attachments,
} = await import("../src/db");
const { mutateProp, propData, PropConflict } = await import("../src/server/prop-firms");
const { importPropCsv } = await import("../src/server/prop-csv");
const { GET, POST } = await import("../src/app/api/prop-firms/route");
const { POST: csvPost } = await import("../src/app/api/prop-firms/csv/route");
const { GET: exportData } = await import("../src/app/api/export/route");
const account = (override: Record<string, unknown> = {}) => ({
  action: "account.save",
  id: "a",
  revision: 0,
  firm: "Fixture firm",
  name: "Attempt one",
  program: "funded",
  status: "active",
  currency: "USD",
  openedOn: "2025-01-01",
  ...override,
});
const entry = (override: Record<string, unknown> = {}) => ({
  action: "entry.save",
  id: "e",
  revision: 0,
  kind: "expense",
  accountId: "a",
  firm: "Fixture firm",
  currency: "USD",
  amount: "100.00",
  category: "evaluation",
  occurredOn: "2025-01-02",
  ...override,
});
const payout = (override: Record<string, unknown> = {}) =>
  entry({
    id: "p",
    kind: "payout",
    amount: "1000",
    splitPercent: "90",
    fee: "10",
    status: "requested",
    occurredOn: "2025-12-30",
    dueOn: "2026-01-10",
    ...override,
  });
const receipt = (override: Record<string, unknown> = {}) => ({
  action: "receipt.add",
  id: "r",
  payoutId: "p",
  revision: 1,
  kind: "receipt",
  amount: "400",
  occurredOn: "2026-01-02",
  ...override,
});
const request = (body: unknown) =>
  new Request("http://localhost/api/prop-firms", { method: "POST", body: JSON.stringify(body) });
const totals = () => {
  const d = propData();
  return cashSummary(cashMovements(d.entries, d.receipts));
};
const header = "id,kind,firm,account_id,currency,date,amount,category,expense_id,reference,notes";
const csv = [
  header,
  "csv-purchase,expense,Fixture firm,a,USD,2025-01-02,100,evaluation,,INV1,Purchase",
  "rebate,refund,Fixture firm,a,USD,2025-02-01,20,,csv-purchase,,Rebate",
  "reward,payout,Fixture firm,a,USD,2026-01-02,890,,,,Paid",
].join("\n");
beforeEach(() => {
  db.delete(attachments).run();
  db.delete(propAudit).run();
  db.delete(propReceipts).run();
  db.update(propEntries).set({ parentId: null }).run();
  db.delete(propEntries).run();
  db.update(propAccounts).set({ parentId: null }).run();
  db.delete(propAccounts).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  vi.stubEnv("JOURNAL_PASSWORD", "");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => {
  db.$client.close();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});
describe("prop cash arithmetic", () => {
  it("keeps currency precision and refuses silent rounding, unsafe amounts and mixed currencies", () => {
    expect(toMinor("0.29", "USD")).toBe(29);
    expect(toMinor("101", "JPY")).toBe(101);
    expect(toMinor("1.234", "KWD")).toBe(1234);
    for (const amount of ["1.234", "-1", "1e4", "Infinity", "100000001", 10])
      expect(() => toMinor(amount, "USD")).toThrow();
    expect(() => toMinor("1.0", "JPY")).toThrow();
    expect(() => toMinor("1", "BAD")).toThrow();
    expect(expectedPayout({ amountMinor: 101, splitBps: 5000, feeMinor: 1 } as PropEntry)).toBe(50);
    mutateProp(account());
    mutateProp(entry());
    mutateProp(entry({ id: "eur", accountId: null, currency: "EUR" }));
    expect(totals).toThrow("one currency");
  });
  it("uses settlement dates, refunds and net reversals, with pending requests excluded from cash", () => {
    mutateProp(account());
    mutateProp(entry());
    mutateProp(
      entry({
        id: "refund",
        kind: "refund",
        amount: "20",
        parentId: "e",
        occurredOn: "2025-02-01",
      }),
    );
    mutateProp(payout());
    expect(totals()).toMatchObject({
      spent: 10000,
      refunds: 2000,
      received: 0,
      net: -8000,
      roi: -1,
    });
    mutateProp(receipt());
    mutateProp(receipt({ id: "r2", revision: 2, amount: "490", occurredOn: "2026-01-03" }));
    mutateProp(
      receipt({ id: "rev", revision: 3, kind: "reversal", amount: "90", occurredOn: "2026-02-01" }),
    );
    const d = propData(),
      flows = cashMovements(d.entries, d.receipts);
    expect(totals()).toMatchObject({ received: 80000, net: 72000, roi: 9 });
    expect(cashSummary(flows.filter((r) => r.date < "2026"))).toMatchObject({
      received: 0,
      net: -8000,
    });
    expect(cashTimeline(flows).at(-1)).toEqual({ date: "2026-02-01", net: 72000 });
    expect(payoutProgress(d.entries, d.receipts, "2026-02-02")[0]).toMatchObject({
      expected: 89000,
      actual: 80000,
      remaining: 9000,
      partial: true,
      overdue: true,
    });
  });
  it("leaves zero-spend ROI unavailable and distinguishes completed variance from money still due", () => {
    mutateProp(account());
    mutateProp(payout());
    mutateProp(receipt({ amount: "880" }));
    mutateProp(payout({ revision: 2, status: "completed", reason: "Final bank confirmation" }));
    const d = propData();
    expect(totals().roi).toBeNull();
    expect(payoutProgress(d.entries, d.receipts, d.today)[0]).toMatchObject({
      actual: 88000,
      remaining: 0,
      variance: -1000,
      overdue: false,
    });
  });
});
describe("prop account lifecycle and corrections", () => {
  it("starts empty with no network requests and links a journal account without changing trading facts", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(
        (await (await GET(new Request("http://localhost/api/prop-firms"))).json()).accounts,
      ).toEqual([]);
      db.insert(accounts)
        .values({
          id: "journal",
          name: "Journal",
          kind: "manual",
          createdAt: "2025-01-01",
          credentialsEnc: "hidden-fixture",
        })
        .run();
      const before = db.select().from(trades).all();
      mutateProp(account({ journalAccountId: "journal", size: "50000" }));
      expect(db.select().from(trades).all()).toEqual(before);
      expect(fetcher).not.toHaveBeenCalled();
      db.delete(accounts).where(eq(accounts.id, "journal")).run();
      expect(propData().accounts[0]?.journalAccountId).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("preserves prior attempts and archived expenses in results; rejects invalid lineage", () => {
    mutateProp(account({ program: "evaluation", status: "breached", closedOn: "2025-02-01" }));
    mutateProp(entry());
    mutateProp(
      account({ id: "reset", parentId: "a", program: "evaluation", openedOn: "2025-02-02" }),
    );
    mutateProp({
      action: "account.archive",
      id: "a",
      revision: 1,
      archived: true,
      reason: "Keep previous attempt",
    });
    expect(totals().spent).toBe(10000);
    expect(propData().accounts).toHaveLength(2);
    expect(() =>
      mutateProp(
        account({
          revision: 2,
          parentId: "reset",
          program: "evaluation",
          openedOn: "2025-03-01",
          reason: "Cycle",
        }),
      ),
    ).toThrow();
    expect(() =>
      mutateProp(account({ id: "bad", parentId: "reset", firm: "Different" })),
    ).toThrow();
    expect(() =>
      mutateProp(
        account({ id: "reset", revision: 1, parentId: "a", firm: "Different", reason: "Rename" }),
      ),
    ).toThrow();
    expect(() =>
      mutateProp(account({ revision: 2, program: "funded", reason: "Overwrite phase" })),
    ).toThrow();
  });
  it("protects children when an account without transactions is edited", () => {
    mutateProp(account());
    mutateProp(account({ id: "b", parentId: "a" }));
    expect(() => mutateProp(account({ revision: 1, firm: "Changed", reason: "Rename" }))).toThrow(
      "linked phase",
    );
  });
  it("rejects incomplete, future and impossible dates and invalid funded status", () => {
    for (const override of [
      { openedOn: "2025-02-30" },
      { openedOn: "2999-01-01" },
      { status: "breached" },
      { status: "passed", closedOn: "2025-02-01" },
      { renewalOn: "2026-10-01" },
    ])
      expect(() => mutateProp(account(override))).toThrow();
    mutateProp(account({ program: "evaluation" }));
    expect(() => mutateProp(payout())).toThrow("funded");
  });
  it("records a default reason for corrections, requires current revisions, and retries of new records are idempotent", () => {
    mutateProp(account());
    mutateProp(account());
    mutateProp(entry());
    mutateProp(entry());
    expect(propData().accounts).toHaveLength(1);
    expect(propData().entries).toHaveLength(1);
    const auditBefore = db.select().from(propAudit).all().length;
    // Reasons are optional: a correction without one is saved and audited as "Edited".
    mutateProp(entry({ revision: 1, amount: "120" }));
    expect(totals().spent).toBe(12000);
    const audit = db.select().from(propAudit).all();
    expect(audit).toHaveLength(auditBefore + 1);
    expect(audit.some((row) => row.reason === "Edited")).toBe(true);
    // The revision moved on, so a stale edit is still rejected and changes nothing.
    expect(() => mutateProp(entry({ revision: 1, amount: "150", reason: "Stale edit" }))).toThrow(
      PropConflict,
    );
    expect(totals().spent).toBe(12000);
    expect(db.select().from(propAudit).all()).toHaveLength(auditBefore + 1);
  });
  it("enforces refund caps, chronology, and dependencies on void and restore", () => {
    mutateProp(account());
    mutateProp(entry());
    mutateProp(
      entry({ id: "f", kind: "refund", parentId: "e", amount: "80", occurredOn: "2025-02-01" }),
    );
    expect(() =>
      mutateProp(
        entry({ id: "f2", kind: "refund", parentId: "e", amount: "21", occurredOn: "2025-02-01" }),
      ),
    ).toThrow("exceed");
    expect(() =>
      mutateProp(entry({ revision: 1, amount: "70", reason: "Correct invoice" })),
    ).toThrow("refunds");
    expect(() =>
      mutateProp({ action: "entry.void", id: "e", revision: 1, voided: true, reason: "Incorrect" }),
    ).toThrow("refunds");
    mutateProp({ action: "entry.void", id: "f", revision: 1, voided: true, reason: "Incorrect" });
    mutateProp(entry({ revision: 1, occurredOn: "2025-03-01", reason: "Correct date" }));
    expect(() =>
      mutateProp({ action: "entry.void", id: "f", revision: 2, voided: false, reason: "Restore" }),
    ).toThrow();
    mutateProp({ action: "entry.void", id: "e", revision: 2, voided: true, reason: "Duplicate" });
    expect(totals().spent).toBe(0);
  });
});
describe("payout receipt integrity", () => {
  beforeEach(() => {
    mutateProp(account());
    mutateProp(payout());
  });
  it("rejects fees above share, completion without cash, and cancellations of received cash", () => {
    expect(() => mutateProp(payout({ revision: 1, fee: "901", reason: "Fee" }))).toThrow("fees");
    expect(() => mutateProp(payout({ revision: 1, status: "completed", reason: "Done" }))).toThrow(
      "received",
    );
    mutateProp(receipt());
    mutateProp(receipt());
    expect(propData().receipts).toHaveLength(1);
    expect(() =>
      mutateProp(payout({ revision: 2, status: "cancelled", reason: "Cancel" })),
    ).toThrow("reversal");
    expect(() =>
      mutateProp(receipt({ id: "over", revision: 2, kind: "reversal", amount: "401" })),
    ).toThrow("exceed");
    expect(() =>
      mutateProp(
        receipt({
          id: "early",
          revision: 2,
          kind: "reversal",
          amount: "1",
          occurredOn: "2025-12-31",
        }),
      ),
    ).toThrow("exceed");
  });
  it("prevents a receipt correction from creating a negative historical cash balance", () => {
    mutateProp(receipt());
    mutateProp(receipt({ id: "rev", revision: 2, kind: "reversal", amount: "100" }));
    expect(() =>
      mutateProp({
        action: "receipt.void",
        id: "r",
        payoutId: "p",
        revision: 3,
        voided: true,
        reason: "Wrong amount",
      }),
    ).toThrow("exceed");
    mutateProp({
      action: "receipt.void",
      id: "rev",
      payoutId: "p",
      revision: 3,
      voided: true,
      reason: "Reverse correction first",
    });
    mutateProp({
      action: "receipt.void",
      id: "r",
      payoutId: "p",
      revision: 4,
      voided: true,
      reason: "Wrong amount",
    });
    expect(totals().received).toBe(0);
    mutateProp(payout({ revision: 5, status: "cancelled", reason: "Cancelled request" }));
    expect(() =>
      mutateProp({
        action: "receipt.void",
        id: "r",
        payoutId: "p",
        revision: 6,
        voided: false,
        reason: "Restore",
      }),
    ).toThrow("Reopen");
  });
  it("voids an entire duplicate payout without deleting receipts, and supports restoration", () => {
    mutateProp(receipt());
    mutateProp({ action: "entry.void", id: "p", revision: 2, voided: true, reason: "Duplicate" });
    expect(totals().received).toBe(0);
    expect(propData().receipts).toHaveLength(1);
    mutateProp({
      action: "entry.void",
      id: "p",
      revision: 3,
      voided: false,
      reason: "Verified unique",
    });
    expect(totals().received).toBe(40000);
  });
  it("reopens completed payouts after a full reversal", () => {
    mutateProp(receipt());
    mutateProp(payout({ revision: 2, status: "completed", reason: "Settled" }));
    mutateProp(receipt({ id: "rev", revision: 3, kind: "reversal", amount: "400" }));
    expect(propData().entries[0]?.status).toBe("approved");
    expect(totals().received).toBe(0);
  });
});
describe("generic cash imports and API boundaries", () => {
  it("previews without persistent writes, imports all rows atomically and deduplicates repeat files", () => {
    mutateProp(account());
    const before = db.select().from(propAudit).all();
    expect(importPropCsv(csv, true)).toMatchObject({ imported: 3, skipped: 0 });
    expect(propData().entries).toEqual([]);
    expect(propData().receipts).toEqual([]);
    expect(db.select().from(propAudit).all()).toEqual(before);
    expect(importPropCsv(csv, false)).toMatchObject({ imported: 3 });
    expect(totals()).toMatchObject({ spent: 10000, refunds: 2000, received: 89000, net: 81000 });
    expect(importPropCsv(csv, false)).toMatchObject({ imported: 0, skipped: 3 });
    expect(() => importPropCsv(csv.replace(",100,evaluation", ",200,evaluation"), false)).toThrow(
      "different data",
    );
    expect(totals().spent).toBe(10000);
  });
  it("rolls back a whole invalid batch, rejects repeated IDs, and requires funded account mapping", () => {
    mutateProp(account());
    expect(() =>
      importPropCsv(csv.replace(",20,,csv-purchase", ",200,,csv-purchase"), false),
    ).toThrow("Row 3");
    expect(propData().entries).toEqual([]);
    expect(() => importPropCsv(csv.replace("rebate,refund", "csv-purchase,refund"), false)).toThrow(
      "unique",
    );
    expect(() =>
      importPropCsv(
        csv.replace("reward,payout,Fixture firm,a,", "reward,payout,Fixture firm,,"),
        false,
      ),
    ).toThrow("funded");
    expect(propData().entries).toEqual([]);
  });
  it("attaches evidence only to existing prop accounts or ledger entries", async () => {
    const { POST: attach, GET: list } = await import("../src/app/api/attachments/route");
    mutateProp(account());
    mutateProp(entry());
    for (const [type, id] of [
      ["prop-account", "a"],
      ["prop-entry", "e"],
      ["prop-entry", "missing"],
    ]) {
      const form = new FormData();
      form.set("type", type!);
      form.set("id", id!);
      form.set(
        "file",
        new File(["%PDF-1.4\nQA evidence"], "receipt.pdf", { type: "application/pdf" }),
      );
      const response = await attach(
        new Request("http://localhost/api/attachments", { method: "POST", body: form }),
      );
      expect(response.status).toBe(id === "missing" ? 400 : 200);
    }
    const result = await (
      await list(new Request("http://localhost/api/attachments?type=prop-entry&id=e"))
    ).json();
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({ name: "receipt.pdf", mime: "application/pdf" });
  });
  it("exports complete histories but excludes credentials", async () => {
    db.insert(accounts)
      .values({
        id: "j",
        name: "Journal",
        kind: "manual",
        credentialsEnc: "secret-fixture",
        createdAt: "2025-01-01",
      })
      .run();
    mutateProp(account());
    importPropCsv(csv, false);
    const result = await (await exportData(new Request("http://localhost/api/export"))).json();
    expect(result.propAccounts).toHaveLength(1);
    expect(result.propEntries).toHaveLength(3);
    expect(result.propReceipts).toHaveLength(1);
    expect(result.propAudit.length).toBeGreaterThan(5);
    expect(JSON.stringify(result)).not.toContain("secret-fixture");
  });
  it("uses authentication, bounded requests, conflict status and private no-store responses", async () => {
    const first = await POST(request(account()));
    expect(first.status).toBe(200);
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(
      (await POST(request(account({ revision: 3, name: "Stale", reason: "Edit" })))).status,
    ).toBe(409);
    expect((await POST(request({ padding: "a".repeat(33000) }))).status).toBe(400);
    vi.stubEnv("JOURNAL_PASSWORD", "fixture");
    expect((await GET(new Request("http://localhost/api/prop-firms"))).status).toBe(401);
    expect((await POST(request(account()))).status).toBe(401);
    expect((await csvPost(request({ action: "preview", content: csv }))).status).toBe(401);
  });
});
