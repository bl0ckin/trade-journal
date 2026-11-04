import { dailyStats as coreDailyStats, dayKeyOf, type RoundTrip } from "@luxalgo/journal-core";
import { accounts, db } from "@/db";
import { handler, ok, requireValue } from "@/server/api";
import { getTimeZone, getCurrencyConversion } from "@/server/settings";
import { currencyProjection } from "@/server/currency-conversion";
import { queryTrades, readTradeFilters } from "@/server/trades-query";
import { calendarYearFromDays, yearScope } from "@/lib/calendar-year";

/** Sells decide the day, so load without the date window and clip the finished days instead. */
const dailyStats = (trades: RoundTrip[], timeZone: string, scope: { from: string; to: string }) =>
  coreDailyStats(trades, timeZone).filter((day) => day.date >= scope.from && day.date <= scope.to);

/** Twelve months of closed-trade P&L for the yearly calendar view. */
export const GET = handler(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const timeZone = getTimeZone();
  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const year = Number(params.get("calYear") ?? today.slice(0, 4));
  requireValue(
    Number.isInteger(year) && year >= 1900 && year <= 9999,
    "Choose a valid calendar year.",
  );
  const scope = yearScope(readTradeFilters(params), year);
  const { trades: originalTrades } = queryTrades({ ...scope, from: undefined, to: undefined });
  const selectedIds = scope.accounts?.split(",").map((id) => id.trim());
  const accountRows = db
    .select()
    .from(accounts)
    .all()
    .filter((account) => !selectedIds || selectedIds.includes(account.id));
  const { trades, scope: currencyScope } = currencyProjection(
    originalTrades,
    accountRows,
    getCurrencyConversion(),
  );
  const currencies = currencyScope.monetary
    ? [currencyScope.currency ?? "USD"]
    : currencyScope.sourceCurrencies;
  const currencyGroups = currencyScope.monetary
    ? []
    : currencyScope.sourceCurrencies.map((currency) => {
        const ids = new Set(
          accountRows.filter((account) => account.currency === currency).map((account) => account.id),
        );
        return {
          currency,
          year: calendarYearFromDays(
            dailyStats(
              originalTrades.filter((trade) => ids.has(trade.accountId)),
              timeZone,
              scope,
            ),
            year,
          ),
        };
      });
  return ok({
    year: calendarYearFromDays(dailyStats(trades, timeZone, scope), year),
    currencyScope,
    currencyGroups,
    timeZone,
    currencies,
    scope,
  });
});
