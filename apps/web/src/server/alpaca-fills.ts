/**
 * Alpaca reports the sale that opens a short as side "sell_short". The broker SDK's Alpaca
 * adapter only accepts "buy" and "sell" and silently drops every other fill, so a short's
 * opening sale never reached the journal: only the buy that closed it did, and that looked
 * like a freshly opened long. These are plain sells and buys as far as the journal is
 * concerned (it pairs fills by side and works out long or short itself), so we rename them
 * in the broker's response before the SDK reads it.
 */
const ALPACA_SIDE_FIXES = new Map<string, "buy" | "sell">([
  ["sell_short", "sell"],
  ["buy_to_cover", "buy"],
]);

const urlOf = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/** Wraps `fetch` so Alpaca fill activities use only the "buy" and "sell" sides. */
export const withAlpacaShortSides =
  (base: typeof fetch = (...args) => globalThis.fetch(...args)): typeof fetch =>
  async (input, init) => {
    const response = await base(input, init);
    if (!response.ok || !urlOf(input).includes("/account/activities")) return response;

    const body: unknown = await response.json();
    if (Array.isArray(body)) {
      for (const fill of body) {
        if (!fill || typeof fill !== "object" || typeof fill.side !== "string") continue;
        const fixed = ALPACA_SIDE_FIXES.get(fill.side);
        if (fixed) fill.side = fixed;
      }
    }
    return new Response(JSON.stringify(body), {
      status: response.status,
      statusText: response.statusText,
      headers: { "content-type": "application/json" },
    });
  };
