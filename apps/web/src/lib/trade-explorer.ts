import { clockTime, tradeR, type AnnotatedTrade } from "@luxalgo/journal-core";

export type TradeXAxis = "durationMinutes" | "entryMinute" | "mae" | "mfe";
export type TradeYAxis = "netPnl" | "realizedR" | "mae" | "mfe";
export interface TradePoint {
  key: string;
  accountId?: string;
  symbol: string;
  direction: string;
  closedAt: string;
  durationMinutes: number | null;
  entryMinute: number | null;
  netPnl: number | null;
  realizedR: number | null;
  mae: number | null;
  mfe: number | null;
}
export interface TradeExplorerResponse {
  points: TradePoint[];
  currencies: string[];
  timeZone: string;
}
const finite = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) ? value : null;

export function tradeExplorerPoints(trades: AnnotatedTrade[], timeZone: string): TradePoint[] {
  return trades
    .filter((trade) => trade.status !== "open" && trade.closedAt)
    .map((trade) => {
      const opened = Date.parse(trade.openedAt),
        closed = Date.parse(trade.closedAt!);
      const elapsed = (closed - opened) / 60000;
      const clock = Number.isFinite(opened)
        ? clockTime(trade.openedAt, timeZone).split(":").map(Number)
        : null;
      return {
        key: trade.key,
        accountId: trade.accountId,
        symbol: trade.symbol,
        direction: trade.direction,
        closedAt: trade.closedAt!,
        durationMinutes: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
        entryMinute: clock ? finite(clock[0]! * 60 + clock[1]!) : null,
        netPnl: finite(trade.netPnl),
        realizedR: finite(tradeR(trade)),
        mae: null,
        mfe: null,
      };
    })
    .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt) || a.key.localeCompare(b.key));
}

export function plotTradePoints(points: TradePoint[], x: TradeXAxis, y: TradeYAxis) {
  return points.flatMap((point) =>
    point[x] == null ||
    point[y] == null ||
    !Number.isFinite(point[x]) ||
    !Number.isFinite(point[y]) ||
    !Number.isFinite(Date.parse(point.closedAt))
      ? []
      : [{ ...point, x: point[x]!, y: point[y]! }],
  );
}
export type PlottedTrade = ReturnType<typeof plotTradePoints>[number];

export const clockLabel = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.round(minute % 60)).padStart(2, "0")}`;
