import { computeMetrics } from "@luxalgo/journal-core";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades, type TradeFilters, readTradeFilters } from "@/server/trades-query";
import { matchesTradeSearch } from "@/lib/trade-search";

const filtersFrom = (url: URL): TradeFilters => readTradeFilters(url.searchParams);

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const found = queryTrades(filtersFrom(url));
  let { rows, trades } = found;
  // Free-text search (symbol, tags, mistakes, emotions, notes). Applied before the metrics so the
  // summary cards describe exactly the trades that are listed.
  const search = url.searchParams.get("q")?.trim();
  if (search) {
    const keep = rows.map((row, index) =>
      matchesTradeSearch(
        {
          symbol: row.symbol,
          direction: row.direction,
          notes: row.notes,
          emotionalState: row.emotionalState,
          tags: trades[index]!.annotations?.tags ?? [],
          mistakes: trades[index]!.annotations?.mistakes ?? [],
        },
        search,
      ),
    );
    rows = rows.filter((_, index) => keep[index]);
    trades = trades.filter((_, index) => keep[index]);
  }
  const timeZone = getTimeZone();
  const metrics = computeMetrics(trades, { timeZone });
  const listView = url.searchParams.get("view") === "list";
  return ok({
    timeZone,
    trades: rows.map((row, index) => {
      const { notes, exitsJson, executionIdsJson, tagsJson, mistakesJson, ...summary } = row;
      return {
        ...(listView ? summary : row),
        contractMultiplier: trades[index]!.contractMultiplier ?? null,
        tags: trades[index]!.annotations?.tags ?? [],
        mistakes: trades[index]!.annotations?.mistakes ?? [],
        reviewed: row.reviewedAt !== null,
      };
    }),
    metrics,
  });
});
