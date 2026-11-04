import { bad, handler, ok } from "@/server/api";
import { latestQuote } from "@/server/market-data/quotes";
import { MarketDataError } from "@/server/market-data/provider";

/** GET /api/quote?symbol=AAPL[&provider=alpaca] → the latest traded price. */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const provider = url.searchParams.get("provider") ?? undefined;
  if (symbol.length > 40) return bad("That symbol is too long.");
  try {
    return ok(await latestQuote({ symbol, provider }));
  } catch (error) {
    if (error instanceof MarketDataError) return bad(error.message);
    throw error;
  }
});
