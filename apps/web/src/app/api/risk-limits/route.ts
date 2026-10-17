import { gte, or } from "drizzle-orm";
import { dayKeyOf } from "@luxalgo/journal-core";
import { accounts, db, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { getRiskLimits, getTimeZone, setSetting } from "@/server/settings";
import { hasRiskLimits, parseRiskLimits } from "@/lib/risk-limits";
import { rowToTrade } from "@/server/trades-query";

/**
 * Limits plus how today (journal timezone) compares with them, per account.
 * Pass ?accounts=a,b to restrict the check; omit it to check every account.
 */
export const GET = handler(async (request: Request) => {
  const limits = getRiskLimits();
  const timeZone = getTimeZone();
  if (!hasRiskLimits(limits)) return ok({ limits, timeZone, statuses: [] });

  const wanted = new URL(request.url).searchParams
    .get("accounts")
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const accountRows = db
    .select()
    .from(accounts)
    .all()
    .filter((account) => !account.archivedAt && (!wanted?.length || wanted.includes(account.id)));

  const today = dayKeyOf(new Date().toISOString(), timeZone);
  // Narrow by time first (3 days covers every timezone offset), then match the exact journal day.
  const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const recent = db
    .select()
    .from(trades)
    .where(or(gte(trades.openedAt, cutoff), gte(trades.closedAt, cutoff)))
    .all();

  const statuses = accountRows.map((account) => {
    const own = recent.filter((trade) => trade.accountId === account.id);
    const realizedPnl = own
      .filter((trade) => trade.closedAt && dayKeyOf(trade.closedAt, timeZone) === today)
      .reduce((sum, trade) => sum + trade.netPnl, 0);
    // Current losing streak among today's closed trades, newest first.
    let consecutiveLosses = 0;
    const closedToday = own
      .filter((trade) => trade.closedAt && dayKeyOf(trade.closedAt, timeZone) === today)
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
    for (const trade of closedToday) {
      if (rowToTrade(trade).status !== "loss") break;
      consecutiveLosses += 1;
    }
    const tradesOpened = own.filter((trade) => dayKeyOf(trade.openedAt, timeZone) === today).length;
    return {
      accountId: account.id,
      accountName: account.name,
      currency: account.currency,
      realizedPnl,
      tradesOpened,
      consecutiveLosses,
    };
  });
  return ok({ limits, timeZone, statuses });
});

export const PUT = handler(async (request: Request) => {
  const parsed = parseRiskLimits(await request.json());
  if (parsed.error !== undefined) return bad(parsed.error);
  setSetting("riskLimits", JSON.stringify(parsed.limits));
  return ok({ saved: true, limits: parsed.limits });
});
