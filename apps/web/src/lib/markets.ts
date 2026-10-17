/**
 * Market type of a trade (stored in the existing `asset_class` column).
 * Values match the journal core's asset classes so imports, filters and
 * market-data lookups keep working unchanged.
 */
export const MARKETS = [
  ["equity", "Stocks"],
  ["futures", "Futures"],
  ["crypto", "Crypto"],
  ["forex", "Forex"],
  ["option", "Options"],
  ["cfd", "CFDs"],
  ["other", "Other"],
] as const;

export type Market = (typeof MARKETS)[number][0];

export const marketLabel = (market: string | null | undefined): string =>
  MARKETS.find(([value]) => value === market)?.[1] ?? "Unspecified";

export const isMarket = (value: unknown): value is Market =>
  typeof value === "string" && MARKETS.some(([market]) => market === value);

const FIAT = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SEK", "NOK", "MXN", "ZAR"];
const CRYPTO_BASES = [
  "BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "BNB", "LTC", "DOT", "AVAX", "LINK", "MATIC",
  "SHIB", "TRX", "ATOM", "XLM", "BCH", "NEAR", "APT", "ARB", "OP", "PEPE", "SUI", "TON",
];

/**
 * Futures products that are recognised from the ticker alone: Nasdaq (NQ), S&P 500 (ES),
 * Gold (GC), Crude Oil (CL) and Dow (YM), plus their micro contracts (MNQ, MES, MGC, MCL, MYM).
 * Add a root here to have it treated as futures.
 */
const FUTURES_ROOTS = ["NQ", "ES", "GC", "CL", "YM"];

/**
 * Matches the product on its own (NQ), with a contract month and year (ESZ6, NQZ2026), or as a
 * continuous contract (NQ1!). A month code needs a year after it, so stocks such as CLX
 * (Clorox) or CLF (Cleveland-Cliffs) are not mistaken for crude oil futures.
 */
const FUTURES_TICKER = new RegExp(
  `^/?M?(?:${FUTURES_ROOTS.join("|")})(?:[FGHJKMNQUVXZ](?:\\d{1,2}|20\\d{2})|\\d{1,2}!)?$`,
);

/**
 * Best guess at the market from a ticker alone: crypto for stablecoin pairs and well-known
 * coins, futures for the products above, forex for fiat pairs, and stocks for everything else.
 * Returns null only for an empty symbol.
 */
export const inferMarket = (symbol: string): Market | null => {
  const s = symbol.trim().toUpperCase();
  if (!s) return null;
  // Stablecoin-quoted pairs: BTCUSDT, ETH/USDC, SOL-USDT, BTCUSDT.P, BTCUSDT-PERP
  if (/(USDT|USDC|BUSD|FDUSD|TUSD)(?![A-Z])/.test(s) || /(USDT|USDC|BUSD|FDUSD)$/.test(s))
    return "crypto";
  if (FUTURES_TICKER.test(s.replace(/\s+/g, ""))) return "futures";
  const compact = s.replace(/[^A-Z]/g, "");
  // Coin priced in fiat: BTCUSD, ETH-USD, SOL/EUR (a bare coin ticker counts too)
  if (CRYPTO_BASES.some((coin) => compact === coin || FIAT.some((f) => compact === coin + f)))
    return "crypto";
  // Six-letter fiat pairs: EURUSD, GBP/JPY
  if (compact.length === 6 && FIAT.includes(compact.slice(0, 3)) && FIAT.includes(compact.slice(3)))
    return "forex";
  return "equity";
};

/** The stored market when set, otherwise a guess from the ticker. */
export const resolveMarket = (
  stored: string | null | undefined,
  symbol: string,
): Market | null => (isMarket(stored) ? stored : inferMarket(symbol));

export interface MarketBucket {
  key: string;
  label: string;
  netPnl: number;
  trades: number;
  winRate: number | null;
}

/** Closed-trade results per market, most profitable first. */
export const byMarket = (
  trades: Array<{ status: string; netPnl: number; assetClass?: string | null }>,
): MarketBucket[] => {
  const groups = new Map<string, { pnl: number; trades: number; wins: number }>();
  for (const trade of trades) {
    if (trade.status === "open") continue;
    const key = isMarket(trade.assetClass) ? trade.assetClass : "unspecified";
    const group = groups.get(key) ?? { pnl: 0, trades: 0, wins: 0 };
    group.pnl += trade.netPnl;
    group.trades += 1;
    if (trade.status === "win") group.wins += 1;
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: marketLabel(key),
      netPnl: group.pnl,
      trades: group.trades,
      winRate: group.trades ? group.wins / group.trades : null,
    }))
    .sort((a, b) => b.netPnl - a.netPnl);
};
