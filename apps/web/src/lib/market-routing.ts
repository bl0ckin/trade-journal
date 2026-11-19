import { RESOLUTIONS, type Resolution } from "./market-data";
import { resolveMarket } from "./markets";

export interface MarketTarget {
  provider: string;
  symbol: string;
  dataset: string;
}

/**
 * Pick a connected data source for a trade from its own ticker, so nobody has to know the
 * provider's symbol format:
 *  - BTCUSDT / ETHUSDC style pairs use Binance;
 *  - BTC-USD, BTC/USD or BTCUSD style crypto pairs use Coinbase;
 *  - stocks and ETFs use Alpaca (IEX feed, which every Alpaca account can read).
 *  - Hyperliquid perpetuals (synced or imported) store bare coin names such as BTC or HYPE, so
 *    they are routed by the account's broker instead of the ticker shape.
 * Futures, forex and options return null: no automatic source covers them.
 */
export function autoMarketTarget(
  symbol: string,
  assetClass: string | null | undefined,
  connected: readonly string[],
  broker?: string | null,
): MarketTarget | null {
  if (broker === "hyperliquid") return hyperliquidTarget(symbol, connected);
  const raw = symbol.trim().toUpperCase();
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  const market = resolveMarket(assetClass, symbol);
  if (/^[A-Z0-9]{2,}(USDT|USDC)$/.test(compact) && connected.includes("binance"))
    return { provider: "binance", symbol: compact, dataset: "" };
  // Only Coinbase is connected: it quotes the same coins in USD instead of USDT.
  const tether = /^([A-Z0-9]{2,10})(USDT|USDC)$/.exec(compact);
  if (tether && connected.includes("coinbase"))
    return { provider: "coinbase", symbol: `${tether[1]}-USD`, dataset: "" };
  const pair = /^([A-Z0-9]{2,10})[-/]?(USD|USDC|EUR|GBP)$/.exec(raw);
  if (pair && market === "crypto" && connected.includes("coinbase"))
    return { provider: "coinbase", symbol: `${pair[1]}-${pair[2]}`, dataset: "" };
  if (market === "equity" && /^[A-Z][A-Z0-9.-]{0,20}$/.test(raw) && connected.includes("alpaca"))
    return { provider: "alpaca", symbol: raw, dataset: "iex" };
  return null;
}

/**
 * Hyperliquid coins are quoted in USD(C). Spot candles of the same coin stand in for the perp
 * chart. Skipped on purpose: HIP-3 markets ("xyz:AAPL"), which are not spot crypto, and
 * k-prefixed coins (kPEPE = 1000 PEPE), whose price scale differs from any spot pair.
 */
function hyperliquidTarget(symbol: string, connected: readonly string[]): MarketTarget | null {
  const coin = symbol.trim();
  if (!/^[A-Za-z0-9]{2,12}$/.test(coin) || /^k[A-Z0-9]+$/.test(coin)) return null;
  const base = coin.toUpperCase();
  if (connected.includes("binance")) return { provider: "binance", symbol: `${base}USDT`, dataset: "" };
  if (connected.includes("coinbase")) return { provider: "coinbase", symbol: `${base}-USD`, dataset: "" };
  return null;
}

/** The finest candle size that still keeps a trade to a few hundred candles. */
export function pickResolution(openedAt: string, closedAt: string): Resolution {
  const span = Date.parse(closedAt) - Date.parse(openedAt);
  return (
    (Object.keys(RESOLUTIONS) as Resolution[]).find(
      (key) => !(span > 0) || span / RESOLUTIONS[key] <= 300,
    ) ?? "1d"
  );
}

/** One ticker search result. */
export interface SymbolHit {
  symbol: string;
  name: string;
  market: "crypto" | "equity";
  provider: string;
}
