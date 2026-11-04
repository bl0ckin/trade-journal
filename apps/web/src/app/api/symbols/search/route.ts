import { handler, ok } from "@/server/api";
import { searchSymbols } from "@/server/market-data/quotes";

/** GET /api/symbols/search?q=AAP → matching tickers from the connected data sources. */
export const GET = handler(async (request: Request) => {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  if (q.length > 40) return ok({ results: [] });
  return ok({ results: await searchSymbols(q) });
});
