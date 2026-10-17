/** Cash records are independent of journal trading P&L and nominal account size. */
export const PROP_PROGRAMS = [
  "evaluation",
  "verification",
  "funded",
  "instant_funded",
  "live",
] as const;
export const PROP_STATES = ["active", "passed", "breached", "closed"] as const;
export const PAYOUT_STATES = [
  "requested",
  "approved",
  "completed",
  "rejected",
  "cancelled",
] as const;
export const EXPENSE_CATEGORIES = [
  "evaluation",
  "reset",
  "activation",
  "subscription",
  "platform",
  "market_data",
  "transfer",
  "other",
] as const;
export type PropAccount = {
  id: string;
  firm: string;
  name: string;
  program: (typeof PROP_PROGRAMS)[number];
  status: (typeof PROP_STATES)[number];
  currency: string;
  sizeMinor: number | null;
  parentId: string | null;
  journalAccountId: string | null;
  openedOn: string;
  closedOn: string | null;
  renewalOn: string | null;
  renewalMinor: number | null;
  notes: string;
  archived: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type PropEntry = {
  id: string;
  accountId: string | null;
  firm: string;
  kind: "expense" | "refund" | "payout";
  category: string;
  currency: string;
  amountMinor: number;
  splitBps: number;
  feeMinor: number;
  occurredOn: string;
  dueOn: string | null;
  status: (typeof PAYOUT_STATES)[number];
  parentId: string | null;
  reference: string;
  notes: string;
  voided: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type PropReceipt = {
  id: string;
  payoutId: string;
  kind: "receipt" | "reversal";
  amountMinor: number;
  occurredOn: string;
  reference: string;
  notes: string;
  voided: boolean;
  createdAt: string;
};
export type PropAudit = {
  id: string;
  entityType: string;
  entityId: string;
  beforeJson: string | null;
  afterJson: string;
  reason: string;
  createdAt: string;
};
/** Reusable account type, e.g. "25K Eval" at a firm with its usual price. */
export type PropTemplate = {
  id: string;
  name: string;
  firm: string;
  program: (typeof PROP_PROGRAMS)[number];
  currency: string;
  size: string;
  cost: string;
  category: string;
};
export type PropData = {
  accounts: PropAccount[];
  entries: PropEntry[];
  receipts: PropReceipt[];
  templates: PropTemplate[];
  today: string;
};
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));
const currencyFormats = new Map<string, Intl.NumberFormat>();
function currencyFormat(currency: string) {
  if (!supportedCurrencies.has(currency))
    throw new Error("Choose a supported three-letter currency code.");
  let format = currencyFormats.get(currency);
  if (!format) {
    format = new Intl.NumberFormat("en", { style: "currency", currency });
    currencyFormats.set(currency, format);
  }
  return format;
}
export function currencyDigits(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency) || !supportedCurrencies.has(currency))
    throw new Error("Choose a supported three-letter currency code.");
  return currencyFormat(currency).resolvedOptions().maximumFractionDigits ?? 2;
}
/** Parse decimal input directly into integer minor units; never silently round user input. */
export function toMinor(value: unknown, currency: string): number {
  const digits = currencyDigits(currency);
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim()))
    throw new Error("Enter a nonnegative decimal amount.");
  const [whole, fraction = ""] = value.trim().split(".");
  if (fraction.length > digits) throw new Error(`${currency} accepts ${digits} decimal places.`);
  const result = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0"));
  if (!Number.isSafeInteger(result) || result > 10_000_000_000)
    throw new Error("Amount is too large.");
  return result;
}
export const fromMinor = (value: number, currency: string) =>
  (value / 10 ** currencyDigits(currency)).toFixed(currencyDigits(currency));
export const propMoney = (value: number, currency: string) =>
  currencyFormat(currency).format(value / 10 ** currencyDigits(currency));
export const label = (value: string) =>
  value === "breached"
    ? "Failed"
    : value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
export const expectedPayout = (entry: PropEntry) =>
  Number((BigInt(entry.amountMinor) * BigInt(entry.splitBps) + 5000n) / 10000n) - entry.feeMinor;
export const receivedPayout = (id: string, receipts: PropReceipt[]) =>
  receipts.reduce(
    (sum, row) =>
      sum +
      (!row.voided && row.payoutId === id
        ? row.amountMinor * (row.kind === "reversal" ? -1 : 1)
        : 0),
    0,
  );
export type CashMovement = {
  id: string;
  entryId: string;
  accountId: string | null;
  firm: string;
  currency: string;
  date: string;
  kind: "expense" | "refund" | "receipt" | "reversal";
  amountMinor: number;
  category: string;
  reference: string;
};
export function cashMovements(entries: PropEntry[], receipts: PropReceipt[]): CashMovement[] {
  const byId = new Map(entries.filter((e) => !e.voided).map((e) => [e.id, e]));
  const direct = [...byId.values()]
    .filter((e) => e.kind !== "payout")
    .map((e) => ({
      id: e.id,
      entryId: e.id,
      accountId: e.accountId,
      firm: e.firm,
      currency: e.currency,
      date: e.occurredOn,
      kind: e.kind as "expense" | "refund",
      amountMinor: e.amountMinor,
      category: e.category,
      reference: e.reference,
    }));
  return [
    ...direct,
    ...receipts.flatMap((r) => {
      const entry = byId.get(r.payoutId);
      return !entry || r.voided
        ? []
        : [
            {
              id: r.id,
              entryId: entry.id,
              accountId: entry.accountId,
              firm: entry.firm,
              currency: entry.currency,
              date: r.occurredOn,
              kind: r.kind,
              amountMinor: r.amountMinor,
              category: "payout",
              reference: r.reference,
            },
          ];
    }),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
export function cashSummary(rows: CashMovement[]) {
  const currencies = [...new Set(rows.map((r) => r.currency))];
  if (currencies.length > 1) throw new Error("Select one currency before combining cash amounts.");
  let spent = 0,
    refunds = 0,
    received = 0;
  for (const row of rows) {
    if (row.kind === "expense") spent += row.amountMinor;
    else if (row.kind === "refund") refunds += row.amountMinor;
    else received += row.amountMinor * (row.kind === "reversal" ? -1 : 1);
  }
  const netSpend = spent - refunds,
    net = received - netSpend;
  return { spent, refunds, netSpend, received, net, roi: netSpend > 0 ? net / netSpend : null };
}
export function cashTimeline(rows: CashMovement[]) {
  cashSummary(rows); // Fail closed on mixed currencies.
  const days = new Map<string, number>();
  for (const row of rows)
    days.set(
      row.date,
      (days.get(row.date) ?? 0) +
        row.amountMinor * (["expense", "reversal"].includes(row.kind) ? -1 : 1),
    );
  let net = 0;
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, net: (net += value) }));
}
export function payoutProgress(entries: PropEntry[], receipts: PropReceipt[], today: string) {
  const received = new Map<string, number>();
  for (const row of receipts)
    if (!row.voided)
      received.set(
        row.payoutId,
        (received.get(row.payoutId) ?? 0) + row.amountMinor * (row.kind === "reversal" ? -1 : 1),
      );
  return entries
    .filter((e) => e.kind === "payout" && !e.voided)
    .map((entry) => {
      const actual = received.get(entry.id) ?? 0,
        expected = expectedPayout(entry);
      const open = entry.status === "requested" || entry.status === "approved";
      return {
        entry,
        actual,
        expected,
        remaining: open ? Math.max(0, expected - actual) : 0,
        variance: actual - expected,
        partial: open && actual > 0 && actual < expected,
        overdue: open && Boolean(entry.dueOn && entry.dueOn < today) && actual < expected,
      };
    });
}
