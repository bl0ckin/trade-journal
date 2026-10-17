import { expectedPayout, type PropAccount, type PropData, type PropEntry } from "./prop-firms";

/** Fictional, browser-only preview. Never persisted or linked to journal accounts. */
export function createPropDemo(today: string): PropData {
  const anchor = Date.parse(`${today}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(anchor))
    throw new Error("Invalid demo date.");
  const day = (ago: number) => new Date(anchor - ago * 86_400_000).toISOString().slice(0, 10);
  const data: PropData = { today, accounts: [], entries: [], receipts: [], templates: [] };
  const note = "Simulated demo data. Fictional firm, fees and payouts.";
  function account(
    key: string,
    firm: string,
    name: string,
    program: PropAccount["program"],
    ago: number,
    options: Partial<PropAccount> = {},
  ) {
    const row: PropAccount = {
      id: `demo-${key}`,
      firm: `${firm} (Demo)`,
      name,
      program,
      status: "active",
      currency: "USD",
      sizeMinor: 5_000_000,
      parentId: null,
      journalAccountId: null,
      openedOn: day(ago),
      closedOn: null,
      renewalOn: null,
      renewalMinor: null,
      notes: note,
      archived: false,
      revision: 1,
      createdAt: `${day(ago)}T12:00:00Z`,
      updatedAt: `${today}T12:00:00Z`,
      ...options,
    };
    data.accounts.push(row);
    return row;
  }
  function entry(
    a: PropAccount,
    kind: PropEntry["kind"],
    amountMinor: number,
    ago: number,
    options: Partial<PropEntry> = {},
  ) {
    const row: PropEntry = {
      id: `demo-entry-${data.entries.length + 1}`,
      accountId: a.id,
      firm: a.firm,
      kind,
      category: kind === "expense" ? "evaluation" : kind,
      currency: a.currency,
      amountMinor,
      splitBps: 10000,
      feeMinor: 0,
      occurredOn: day(ago),
      dueOn: null,
      status: "completed",
      parentId: null,
      reference: `SIM-${String(data.entries.length + 1).padStart(3, "0")}`,
      notes: note,
      voided: false,
      revision: 1,
      createdAt: `${day(ago)}T12:00:00Z`,
      updatedAt: `${today}T12:00:00Z`,
      ...options,
    };
    data.entries.push(row);
    return row;
  }
  function receipt(
    p: PropEntry,
    amountMinor: number,
    ago: number,
    kind: "receipt" | "reversal" = "receipt",
  ) {
    data.receipts.push({
      id: `demo-cash-${data.receipts.length + 1}`,
      payoutId: p.id,
      amountMinor,
      kind,
      occurredOn: day(ago),
      reference: `SIM-PAY-${data.receipts.length + 1}`,
      notes: note,
      voided: false,
      createdAt: `${day(ago)}T12:00:00Z`,
    });
  }
  const first = account("first", "Harbor", "Evaluation · attempt 1", "evaluation", 540, {
    status: "breached",
    closedOn: day(510),
    archived: true,
  });
  entry(first, "expense", 14900, 540);
  const reset = account("reset", "Harbor", "Evaluation · attempt 2", "evaluation", 505, {
    parentId: first.id,
    status: "passed",
    closedOn: day(475),
  });
  entry(reset, "expense", 9900, 505, { category: "reset" });
  const funded = account("funded", "Harbor", "Funded · 50K", "funded", 470, { parentId: reset.id });
  entry(funded, "expense", 14900, 470, { category: "activation" });
  for (let i = 0; i < 15; i++) {
    const ago = 455 - i * 30;
    entry(funded, "expense", 2900, ago, { category: i % 3 === 0 ? "market_data" : "platform" });
    if (i === 3 || i === 8) continue;
    const p = entry(funded, "payout", [95000, 132000, 74000, 185000, 118000][i % 5]!, ago - 12, {
      splitBps: 9000,
      feeMinor: 1500,
      dueOn: day(ago - 17),
    });
    receipt(p, expectedPayout(p), ago - 16);
  }
  const pending = entry(funded, "payout", 125000, 8, {
    status: "approved",
    splitBps: 9000,
    feeMinor: 1500,
    dueOn: day(2),
  });
  receipt(pending, 45000, 4);
  const requested = entry(funded, "payout", 80000, 2, {
    status: "requested",
    splitBps: 9000,
    dueOn: day(-5),
  });
  requested.notes = `${note} Awaiting review; no cash received.`;
  entry(funded, "payout", 50000, 100, {
    status: "rejected",
    splitBps: 9000,
    notes: `${note} Example of a rejected request.`,
  });
  entry(funded, "payout", 35000, 65, { status: "cancelled", splitBps: 9000 });
  const adjusted = entry(funded, "payout", 100000, 50, { splitBps: 9000, feeMinor: 1000 });
  receipt(adjusted, 89000, 46);
  receipt(adjusted, 4000, 44, "reversal");
  const phase1 = account("phase1", "Summit", "Evaluation · phase 1", "evaluation", 300, {
    sizeMinor: 10_000_000,
    status: "passed",
    closedOn: day(265),
  });
  const fee = entry(phase1, "expense", 45000, 300);
  const phase2 = account("phase2", "Summit", "Verification · phase 2", "verification", 260, {
    sizeMinor: 10_000_000,
    parentId: phase1.id,
    status: "passed",
    closedOn: day(220),
  });
  entry(phase2, "expense", 0, 260);
  const second = account("second", "Summit", "Funded · 100K", "funded", 215, {
    sizeMinor: 10_000_000,
    parentId: phase2.id,
  });
  entry(phase1, "refund", 45000, 190, { parentId: fee.id });
  for (let i = 0; i < 6; i++) {
    const ago = 190 - i * 30,
      p = entry(second, "payout", [160000, 225000, 110000][i % 3]!, ago, { splitBps: 8000 });
    receipt(p, expectedPayout(p), ago - 4);
  }
  const active = account("active", "Harbor", "Evaluation · 25K", "evaluation", 20, {
    sizeMinor: 2_500_000,
    renewalOn: day(-10),
    renewalMinor: 9900,
  });
  entry(active, "expense", 9900, 20);
  const euro = account("euro", "Orchard", "Instant funded · EUR", "instant_funded", 120, {
    currency: "EUR",
    sizeMinor: 2_500_000,
  });
  entry(euro, "expense", 29900, 120);
  for (let i = 0; i < 3; i++) {
    const ago = 90 - i * 30,
      p = entry(euro, "payout", [70000, 93000, 62000][i]!, ago, { splitBps: 8000, feeMinor: 500 });
    receipt(p, expectedPayout(p), ago - 3);
  }
  entry(funded, "expense", 4900, 35, {
    accountId: null,
    category: "transfer",
    notes: `${note} Shared firm cost.`,
  });
  return data;
}
