import { autoMarketTarget, type SymbolHit } from "@/lib/market-routing";
import { connectionKey, connections } from "./connections";
import { array, credentials, number, readJson, record } from "./http";
import { MarketDataError } from "./provider";

const BINANCE = "https://data-api.binance.vision";
const COINBASE = "https://api.exchange.coinbase.com";
const ALPACA_DATA = "https://data.alpaca.markets";

export interface Quote {
  provider: string;
  symbol: string;
  price: number;
  asOf: string;
}


const connectedIds = () =>
  connections()
    .filter((connection) => connection.configured)
    .map((connection) => connection.id);

/** Latest traded price. Binance and Coinbase need no keys; Alpaca uses the saved key. */
export async function latestQuote(input: { symbol: string; provider?: string }): Promise<Quote> {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new MarketDataError("Enter a symbol first.");
  const connected = connectedIds();
  const target = input.provider
    ? { provider: input.provider, symbol, dataset: "" }
    : autoMarketTarget(symbol, null, connected);
  if (!target)
    throw new MarketDataError(
      connected.length
        ? `No connected provider covers ${symbol} (stocks use Alpaca; crypto uses Binance or Coinbase). Enter the price by hand.`
        : "Connect Alpaca (stocks) or enable Binance or Coinbase (crypto) in Settings to fetch prices.",
    );
  if (!connected.includes(target.provider))
    throw new MarketDataError("Connect this data source in Settings first.");
  const asOf = new Date().toISOString();
  const signal = AbortSignal.timeout(15_000);
  if (target.provider === "binance") {
    const body = record(
      await readJson(
        `${BINANCE}/api/v3/ticker/price?symbol=${encodeURIComponent(target.symbol)}`,
        {},
        signal,
        { cache: false },
      ),
    );
    return { provider: "binance", symbol: target.symbol, price: number(body.price), asOf };
  }
  if (target.provider === "coinbase") {
    const body = record(
      await readJson(
        `${COINBASE}/products/${encodeURIComponent(target.symbol)}/ticker`,
        {},
        signal,
        { cache: false },
      ),
    );
    return { provider: "coinbase", symbol: target.symbol, price: number(body.price), asOf };
  }
  if (target.provider === "alpaca") {
    const config = credentials(connectionKey("alpaca"));
    const body = record(
      await readJson(
        `${ALPACA_DATA}/v2/stocks/${encodeURIComponent(target.symbol)}/trades/latest?feed=iex`,
        { "APCA-API-KEY-ID": config.apiKey!, "APCA-API-SECRET-KEY": config.secretKey! },
        signal,
        { cache: false },
      ),
    );
    const trade = record(body.trade);
    return {
      provider: "alpaca",
      symbol: target.symbol,
      price: number(trade.p),
      asOf: typeof trade.t === "string" ? trade.t : asOf,
    };
  }
  throw new MarketDataError("This data source cannot give a current price.");
}

let listCache: { at: number; hits: SymbolHit[] } | null = null;
const HOUR = 3_600_000;

/** Listed crypto pairs from the public venues you have enabled, cached for an hour. */
async function cryptoList(connected: string[]): Promise<SymbolHit[]> {
  if (listCache && Date.now() - listCache.at < HOUR) return listCache.hits;
  const hits: SymbolHit[] = [];
  if (connected.includes("binance")) {
    try {
      const rows = array(await readJson(`${BINANCE}/api/v3/ticker/price`, {}, AbortSignal.timeout(20_000)));
      for (const row of rows) {
        const symbol = String(record(row).symbol ?? "");
        if (/^[A-Z0-9]{2,}(USDT|USDC)$/.test(symbol))
          hits.push({ symbol, name: "Binance spot", market: "crypto", provider: "binance" });
      }
    } catch {
      /* the other sources still work */
    }
  }
  if (connected.includes("coinbase")) {
    try {
      const rows = array(await readJson(`${COINBASE}/products`, {}, AbortSignal.timeout(20_000)));
      for (const row of rows) {
        const item = record(row);
        if (item.status === "online" && /^(USD|USDC)$/.test(String(item.quote_currency)))
          hits.push({
            symbol: String(item.id),
            name: "Coinbase spot",
            market: "crypto",
            provider: "coinbase",
          });
      }
    } catch {
      /* ignore */
    }
  }
  if (hits.length) listCache = { at: Date.now(), hits };
  return hits;
}

let stockCache: { at: number; hits: SymbolHit[] } | null = null;

/** US stocks and ETFs from Alpaca's asset list. Returns nothing if the key cannot read it. */
async function stockList(connected: string[]): Promise<SymbolHit[]> {
  if (!connected.includes("alpaca")) return [];
  if (stockCache && Date.now() - stockCache.at < 6 * HOUR) return stockCache.hits;
  try {
    const config = credentials(connectionKey("alpaca"));
    const headers = { "APCA-API-KEY-ID": config.apiKey!, "APCA-API-SECRET-KEY": config.secretKey! };
    let rows: unknown[] | null = null;
    for (const host of ["https://api.alpaca.markets", "https://paper-api.alpaca.markets"]) {
      try {
        rows = array(
          await readJson(
            `${host}/v2/assets?status=active&asset_class=us_equity`,
            headers,
            AbortSignal.timeout(30_000),
          ),
        );
        break;
      } catch {
        /* try the paper host next */
      }
    }
    const hits = (rows ?? [])
      .map(record)
      .filter((row) => row.tradable !== false && typeof row.symbol === "string")
      .map(
        (row): SymbolHit => ({
          symbol: String(row.symbol),
          name: String(row.name ?? ""),
          market: "equity",
          provider: "alpaca",
        }),
      );
    if (hits.length) stockCache = { at: Date.now(), hits };
    return hits;
  } catch {
    return [];
  }
}

/** Ticker search across the connected data sources. */
export async function searchSymbols(query: string, limit = 12): Promise<SymbolHit[]> {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const connected = connectedIds();
  const [crypto, stocks] = await Promise.all([cryptoList(connected), stockList(connected)]);
  const score = (hit: SymbolHit) => {
    const symbol = hit.symbol.toUpperCase();
    if (symbol === q) return 0;
    if (symbol.startsWith(q)) return 1;
    if (symbol.replace(/[^A-Z0-9]/g, "").startsWith(q.replace(/[^A-Z0-9]/g, ""))) return 2;
    if (hit.name.toUpperCase().includes(q)) return 3;
    return symbol.includes(q) ? 4 : 9;
  };
  return [...stocks, ...crypto]
    .map((hit) => ({ hit, rank: score(hit) }))
    .filter((item) => item.rank < 9)
    .sort((a, b) => a.rank - b.rank || a.hit.symbol.length - b.hit.symbol.length)
    .slice(0, limit)
    .map((item) => item.hit);
}
