import { and, asc, eq, inArray } from "drizzle-orm";
import { matchesFilters, type AnalysisFilters, type AnnotatedTrade } from "@luxalgo/journal-core";
import { getTimeZone, getMultipliers, getJournalDefaults } from "./settings";
import { db, trades } from "@/db";
import { readFilters } from "@luxalgo/journal-core";
import { readExtraFilters, type ExtraFilters } from "@/lib/extra-filters";
import { parseEmotions } from "@/lib/emotions";
import { resolveMarket } from "@/lib/markets";

export type TradeFilters = AnalysisFilters & ExtraFilters & { accountIds?: string[] };

/** Core filters plus the journal's own psychology filters, from a request's query string. */
export const readTradeFilters = (params: URLSearchParams): TradeFilters => ({
  ...readFilters(params),
  ...readExtraFilters(params),
});

export type TradeRow = typeof trades.$inferSelect;

const parseJsonArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

const context = () => ({ multipliers: getMultipliers(), defaults: getJournalDefaults() });
export const rowToTrade = (row: TradeRow, config = context()): AnnotatedTrade => {
  const multiplier = config.multipliers[row.symbol];
  const defaults = config.defaults;
  const market = resolveMarket(row.assetClass, row.symbol);
  const missingMultiplier =
    multiplier == null && ["futures", "option", "forex", "cfd"].includes(market ?? "");
  const notional = missingMultiplier
    ? 0
    : Math.abs(row.avgEntry * row.quantity * (multiplier ?? 1));
  const tolerance =
    defaults.breakevenMode === "percent"
      ? (notional * defaults.breakeven) / 100
      : defaults.breakeven;
  const status =
    row.status === "open"
      ? "open"
      : Math.abs(row.netPnl) <= Math.max(1e-9, tolerance)
        ? "breakeven"
        : row.netPnl > 0
          ? "win"
          : "loss";
  return {
    key: row.key,
    accountId: row.accountId,
    symbol: row.symbol,
    // Trades without a stored market fall back to a guess from the ticker (BTCUSDT → crypto, ES → futures, else stocks).
    assetClass: (market ?? undefined) as AnnotatedTrade["assetClass"],
    direction: row.direction,
    status,
    contractMultiplier: multiplier,
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? undefined,
    quantity: row.quantity,
    openQuantity: row.openQuantity,
    avgEntry: row.avgEntry,
    avgExit: row.avgExit ?? undefined,
    grossPnl: row.grossPnl,
    fees: row.fees,
    netPnl: row.netPnl,
    executionCount: row.executionCount,
    executionIds: parseJsonArray(row.executionIdsJson),
    exits: JSON.parse(row.exitsJson) as AnnotatedTrade["exits"],
    durationMs: row.durationMs ?? undefined,
    annotations: {
      tags: parseJsonArray(row.tagsJson),
      mistakes: parseJsonArray(row.mistakesJson),
      playbook: row.playbookId ?? undefined,
      rating: row.rating ?? undefined,
      stopLoss: row.stopLoss ?? undefined,
      profitTarget: row.profitTarget ?? undefined,
      reviewed: row.reviewedAt !== null,
    },
  };
};

/**
 * Narrow indexed identity fields before decoding rows. The core predicate
 * remains authoritative for timezone, risk and breakeven semantics.
 */
export const queryTrades = (
  filters: TradeFilters = {},
): { rows: TradeRow[]; trades: AnnotatedTrade[] } => {
  const { emotion, qualityMin, qualityMax, confidenceMin, confidenceMax, ...rest } = filters;
  // Market is matched here (not in SQL or the core predicate) so a guessed market counts too.
  const { assetClass: market, ...coreFilters } = rest;
  const effective = {
    ...coreFilters,
    accounts: filters.accounts ?? filters.accountIds?.join(","),
  };
  const accountIds = effective.accounts
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const all = db
    .select()
    .from(trades)
    .where(
      and(
        accountIds?.length ? inArray(trades.accountId, accountIds) : undefined,
        effective.playbookId ? eq(trades.playbookId, effective.playbookId) : undefined,
        effective.direction
          ? eq(trades.direction, effective.direction as "long" | "short")
          : undefined,
      ),
    )
    .orderBy(asc(trades.openedAt))
    .all();
  const timeZone = getTimeZone();
  const config = context();
  const pairs = all
    .map((row) => ({ row, trade: rowToTrade(row, config) }))
    .filter(({ trade }) => matchesFilters(trade, effective, timeZone))
    .filter(({ row, trade }) => {
      if (market && trade.assetClass !== market) return false;
      const wanted = emotion
        ?.split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      if (wanted?.length) {
        const states = parseEmotions(row.emotionalState).map((item) => item.toLowerCase());
        if (!wanted.some((item) => states.includes(item))) return false;
      }
      for (const [value, min, max] of [
        [row.tradeQuality, qualityMin, qualityMax],
        [row.confidence, confidenceMin, confidenceMax],
      ] as const) {
        if (min === undefined && max === undefined) continue;
        // Trades without a score cannot satisfy a score filter.
        if (value === null) return false;
        if (min !== undefined && value < Number(min)) return false;
        if (max !== undefined && value > Number(max)) return false;
      }
      return true;
    });
  return {
    rows: pairs.map(({ row, trade }) => ({ ...row, status: trade.status })),
    trades: pairs.map((p) => p.trade),
  };
};

export const getTradeByKey = (key: string): TradeRow | undefined =>
  db.select().from(trades).where(eq(trades.key, key)).get();

/** Navigate chronologically within the active filters, with a stable tie-break for equal entries. */
export const getAdjacentTradeKeys = (
  currentKey: string,
  filters: TradeFilters = {},
  accountId?: string,
) => {
  const ordered = queryTrades(filters)
    .trades.filter((trade) => !accountId || trade.accountId === accountId)
    .sort((a, b) => {
      const time = Date.parse(a.openedAt) - Date.parse(b.openedAt);
      return time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });
  const index = ordered.findIndex((trade) => trade.key === currentKey);
  return {
    prevKey: index > 0 ? (ordered[index - 1]?.key ?? null) : null,
    nextKey: index >= 0 ? (ordered[index + 1]?.key ?? null) : null,
    position: index >= 0 ? index + 1 : null,
    total: ordered.length,
  };
};
