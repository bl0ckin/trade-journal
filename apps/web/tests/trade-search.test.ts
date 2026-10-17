import { describe, expect, it } from "vitest";
import { htmlToText, matchesTradeSearch } from "../src/lib/trade-search";
import { parseTradesView } from "../src/lib/trades-view";

const trade = {
  symbol: "NQ",
  direction: "long",
  notes: "<p>Chased the <strong>breakout</strong> &amp; ignored my stop</p>",
  emotionalState: "FOMO, anxious",
  tags: ["A+ setup"],
  mistakes: ["Moved stop"],
};

describe("matchesTradeSearch", () => {
  it("matches symbol, tags, mistakes, emotions and note text, ignoring case", () => {
    for (const q of ["nq", "a+ setup", "moved stop", "fomo", "breakout", "ignored my stop"])
      expect(matchesTradeSearch(trade, q), q).toBe(true);
  });
  it("requires every term, in any field", () => {
    expect(matchesTradeSearch(trade, "nq breakout")).toBe(true);
    expect(matchesTradeSearch(trade, "nq revenge")).toBe(false);
  });
  it("does not match HTML markup or entities", () => {
    expect(matchesTradeSearch(trade, "strong")).toBe(false);
    expect(matchesTradeSearch(trade, "&amp;")).toBe(false);
    expect(htmlToText("<p>a&nbsp;b</p>").trim()).toBe("a b");
  });
  it("treats an empty query as match-all and tolerates missing fields", () => {
    expect(matchesTradeSearch({ symbol: "ES" }, "  ")).toBe(true);
    expect(matchesTradeSearch({ symbol: "ES" }, "es")).toBe(true);
  });
});

describe("parseTradesView", () => {
  it("returns null for empty or broken storage", () => {
    expect(parseTradesView(null)).toBeNull();
    expect(parseTradesView("{nope")).toBeNull();
    expect(parseTradesView("42")).toBeNull();
  });
  it("keeps only well-formed sort and visibility entries", () => {
    const view = parseTradesView(
      JSON.stringify({
        sorting: [{ id: "netPnl", desc: true }, { id: 3 }, null],
        columnVisibility: { fees: true, rating: "yes", market: false },
      }),
    );
    expect(view).toEqual({
      sorting: [{ id: "netPnl", desc: true }],
      columnVisibility: { fees: true, market: false },
    });
  });
});
