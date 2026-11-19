import { describe, expect, it } from "vitest";
import { autoMarketTarget } from "../src/lib/market-routing";

describe("auto market routing for Hyperliquid accounts", () => {
  it("routes a bare coin to a connected crypto source, whatever the stored asset class", () => {
    for (const assetClass of [null, "crypto", "futures"]) {
      expect(autoMarketTarget("HYPE", assetClass, ["binance"], "hyperliquid")).toEqual({
        provider: "binance",
        symbol: "HYPEUSDT",
        dataset: "",
      });
    }
    expect(autoMarketTarget("BTC", null, ["coinbase"], "hyperliquid")).toEqual({
      provider: "coinbase",
      symbol: "BTC-USD",
      dataset: "",
    });
  });
  it("skips markets no spot pair matches, and unconnected setups", () => {
    expect(autoMarketTarget("kPEPE", null, ["binance"], "hyperliquid")).toBeNull();
    expect(autoMarketTarget("xyz:AAPL", null, ["binance"], "hyperliquid")).toBeNull();
    expect(autoMarketTarget("BTC", null, ["alpaca"], "hyperliquid")).toBeNull();
  });
  it("leaves other brokers unchanged", () => {
    expect(autoMarketTarget("BTC", null, ["coinbase"], "alpaca")).toBeNull();
  });
});
