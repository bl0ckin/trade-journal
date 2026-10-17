import { describe, expect, it } from "vitest";
import { inferMarket, resolveMarket } from "../src/lib/markets";

describe("inferMarket", () => {
  it.each(["NQ", "ES", "GC", "CL", "YM", "nq", "ESZ6", "NQZ2026", "CLX6", "GCG27", "YMH6"])(
    "treats %s as futures",
    (symbol) => expect(inferMarket(symbol)).toBe("futures"),
  );

  it.each(["NQ1!", "ES1!", "/ES", "ES Z6", "MNQ", "MESZ6", "MGC", "MCL", "MYM"])(
    "recognises the futures forms %s",
    (symbol) => expect(inferMarket(symbol)).toBe("futures"),
  );

  it.each(["BTCUSDT", "ETHUSDT", "SOL/USDT", "BTCUSDT.P", "BTCUSD", "ETH-USD"])(
    "treats %s as crypto",
    (symbol) => expect(inferMarket(symbol)).toBe("crypto"),
  );

  it.each(["AAPL", "TSLA", "NVDA", "SPY", "BRK.B", "ESS", "ESTC", "CLX", "CLF", "GCT", "NQUS"])(
    "treats everything else (%s) as stocks",
    (symbol) => expect(inferMarket(symbol)).toBe("equity"),
  );

  it("keeps fiat pairs as forex and an empty symbol as unknown", () => {
    expect(inferMarket("EURUSD")).toBe("forex");
    expect(inferMarket("GBP/JPY")).toBe("forex");
    expect(inferMarket("  ")).toBeNull();
  });
});

describe("resolveMarket", () => {
  it("prefers the stored market over the ticker guess", () => {
    expect(resolveMarket("equity", "ES")).toBe("equity");
    expect(resolveMarket("futures", "AAPL")).toBe("futures");
  });

  it("falls back to the ticker guess when no market is stored", () => {
    expect(resolveMarket(null, "NQ")).toBe("futures");
    expect(resolveMarket(undefined, "BTCUSDT")).toBe("crypto");
    expect(resolveMarket(null, "AAPL")).toBe("equity");
  });
});
