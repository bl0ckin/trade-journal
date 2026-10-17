import { detectBehaviours } from "@luxalgo/journal-core";
import { accounts, db } from "@/db";
import { handler, ok } from "@/server/api";
import { getCurrencyConversion, getTimeZone } from "@/server/settings";
import { currencyProjection } from "@/server/currency-conversion";
import { queryTrades, readTradeFilters } from "@/server/trades-query";

/** Behaviour patterns (revenge trades, trading on after losses, size, late fade) for the filters. */
export const GET = handler((request: Request) => {
  const params = new URL(request.url).searchParams;
  const filters = readTradeFilters(params);
  const { trades: original } = queryTrades(filters);
  const timeZone = getTimeZone();
  const selectedIds = filters.accounts?.split(",").map((id) => id.trim());
  const accountRows = db
    .select()
    .from(accounts)
    .all()
    .filter((account) => !selectedIds || selectedIds.includes(account.id));
  const { trades, scope } = currencyProjection(original, accountRows, getCurrencyConversion());
  const report = detectBehaviours(trades, { timeZone });
  const byKey = new Map(trades.map((t) => [t.key, t]));
  const currencies = scope.monetary ? [scope.currency ?? "USD"] : scope.sourceCurrencies;
  return ok({
    ...report,
    currencies,
    timeZone,
    examples: Object.fromEntries(
      report.patterns
        .flatMap((p) => p.examples)
        .map((key) => byKey.get(key))
        .filter((t) => t !== undefined)
        .map((t) => [
          t.key,
          { symbol: t.symbol, direction: t.direction, openedAt: t.openedAt, netPnl: t.netPnl },
        ]),
    ),
  });
});
