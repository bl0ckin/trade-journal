import {
  cashSummary,
  type CashMovement,
  type PropAccount,
  type PropReceipt,
  payoutProgress,
} from "./prop-firms";

/**
 * Read-only roll-ups for the Prop firms page. Everything is derived from data the page already
 * loads; nothing here writes, converts currencies or touches journal P&L.
 */
type Payouts = ReturnType<typeof payoutProgress>;

export const isChallenge = (a: Pick<PropAccount, "program">) =>
  a.program === "evaluation" || a.program === "verification";
export const isFunded = (a: Pick<PropAccount, "program">) =>
  a.program === "funded" || a.program === "instant_funded" || a.program === "live";

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** Counts by stage plus pass rate over resolved challenge phases (passed or failed only). */
export function accountPipeline(accounts: PropAccount[]) {
  const live = accounts.filter((a) => !a.archived);
  const active = live.filter((a) => a.status === "active");
  const resolved = live.filter((a) => isChallenge(a) && ["passed", "breached"].includes(a.status));
  const passed = resolved.filter((a) => a.status === "passed");
  const failed = resolved.filter((a) => a.status === "breached");
  const span = (rows: PropAccount[]) =>
    mean(rows.filter((a) => a.closedOn).map((a) => Math.max(0, daysBetween(a.openedOn, a.closedOn!))));
  return {
    challenges: active.filter(isChallenge).length,
    funded: active.filter(isFunded).length,
    passed: passed.length,
    failed: failed.length,
    resolved: resolved.length,
    passRate: resolved.length ? passed.length / resolved.length : null,
    avgDaysToPass: span(passed),
    avgDaysToFail: span(failed),
  };
}

export interface FirmCard {
  firm: string;
  accounts: number;
  active: number;
  passed: number;
  failed: number;
  passRate: number | null;
  spent: number;
  netSpend: number;
  received: number;
  net: number;
  roi: number | null;
}

/** One row per firm for a single currency. Shared firm costs count towards the firm's totals. */
export function firmCards(accounts: PropAccount[], cash: CashMovement[]): FirmCard[] {
  const firms = new Set([...accounts.map((a) => a.firm), ...cash.map((c) => c.firm)]);
  return [...firms]
    .map((firm) => {
      const own = accounts.filter((a) => a.firm === firm && !a.archived);
      const resolved = own.filter((a) => isChallenge(a) && ["passed", "breached"].includes(a.status));
      const passed = resolved.filter((a) => a.status === "passed").length;
      const summary = cashSummary(cash.filter((c) => c.firm === firm));
      return {
        firm,
        accounts: own.length,
        active: own.filter((a) => a.status === "active").length,
        passed,
        failed: resolved.length - passed,
        passRate: resolved.length ? passed / resolved.length : null,
        spent: summary.spent,
        netSpend: summary.netSpend,
        received: summary.received,
        net: summary.net,
        roi: summary.roi,
      };
    })
    .sort((a, b) => b.net - a.net || a.firm.localeCompare(b.firm));
}

/** Waiting, overdue and typical time-to-cash for payouts in one currency. */
export function payoutPulse(payouts: Payouts, receipts: PropReceipt[], currency: string) {
  const rows = payouts.filter((p) => p.entry.currency === currency);
  const open = rows.filter((p) => p.entry.status === "requested" || p.entry.status === "approved");
  const firstReceipt = new Map<string, string>();
  for (const r of receipts)
    if (!r.voided && r.kind === "receipt") {
      const seen = firstReceipt.get(r.payoutId);
      if (!seen || r.occurredOn < seen) firstReceipt.set(r.payoutId, r.occurredOn);
    }
  const waits = rows
    .filter((p) => firstReceipt.has(p.entry.id))
    .map((p) => Math.max(0, daysBetween(p.entry.occurredOn, firstReceipt.get(p.entry.id)!)));
  const due = open
    .map((p) => p.entry.dueOn)
    .filter((d): d is string => Boolean(d))
    .sort();
  return {
    waiting: open.length,
    overdue: open.filter((p) => p.overdue).length,
    outstanding: open.reduce((sum, p) => sum + p.remaining, 0),
    nextDue: due[0] ?? null,
    avgDaysToCash: mean(waits),
    payoutsPaid: rows.filter((p) => p.actual > 0).length,
    largest: rows.reduce((max, p) => Math.max(max, p.actual), 0),
  };
}

export interface AttentionItem {
  id: string;
  tone: "danger" | "warn";
  text: string;
  action: "payouts" | "renewals";
}

/** Things worth a look today: overdue payouts and renewals due within a week. */
export function attentionItems(
  accounts: PropAccount[],
  payouts: Payouts,
  today: string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const overdue = payouts.filter((p) => p.overdue);
  if (overdue.length)
    items.push({
      id: "overdue",
      tone: "danger",
      text: `${overdue.length} payout${overdue.length === 1 ? " is" : "s are"} past the expected date`,
      action: "payouts",
    });
  const soon = accounts.filter(
    (a) =>
      a.status === "active" &&
      !a.archived &&
      a.renewalOn &&
      daysBetween(today, a.renewalOn) <= 7,
  );
  for (const a of soon.sort((x, y) => x.renewalOn!.localeCompare(y.renewalOn!)).slice(0, 3)) {
    const d = daysBetween(today, a.renewalOn!);
    items.push({
      id: `renewal-${a.id}`,
      tone: d < 0 ? "danger" : "warn",
      text: `${a.firm} · ${a.name} ${d < 0 ? `renewal was due ${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "renews today" : `renews in ${d} day${d === 1 ? "" : "s"}`}`,
      action: "renewals",
    });
  }
  return items;
}

/** Share of what you spent that has come back as refunds plus payout cash. */
export const recoveryRate = (s: { spent: number; refunds: number; received: number }) =>
  s.spent > 0 ? (s.refunds + s.received) / s.spent : null;
