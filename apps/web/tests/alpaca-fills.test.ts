import { describe, expect, it } from "vitest";
import { withAlpacaShortSides } from "../src/server/alpaca-fills";

const respond = (body: unknown, status = 200) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

const ACTIVITIES = "https://paper-api.alpaca.markets/v2/account/activities/FILL?page_size=100";

describe("withAlpacaShortSides", () => {
  it("turns the sale that opens a short into a plain sell", async () => {
    const fetchFixed = withAlpacaShortSides(
      respond([
        { side: "sell_short", symbol: "TSLA", qty: "1", price: "200" },
        { side: "buy", symbol: "TSLA", qty: "1", price: "190" },
        { side: "buy_to_cover", symbol: "NVDA", qty: "2", price: "100" },
      ]),
    );
    const fills = (await (await fetchFixed(ACTIVITIES)).json()) as { side: string }[];
    expect(fills.map((fill) => fill.side)).toEqual(["sell", "buy", "buy"]);
  });

  it("leaves other Alpaca responses alone", async () => {
    const account = { equity: "10000", side: "sell_short" };
    const fetchFixed = withAlpacaShortSides(respond(account));
    const response = await fetchFixed("https://paper-api.alpaca.markets/v2/account");
    expect(await response.json()).toEqual(account);
  });

  it("passes errors through untouched", async () => {
    const fetchFixed = withAlpacaShortSides(respond({ message: "forbidden" }, 403));
    const response = await fetchFixed(ACTIVITIES);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: "forbidden" });
  });
});
