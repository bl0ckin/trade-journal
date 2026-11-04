import type { RoundTrip } from "./types";
import { dayKeyOf } from "./time";

export interface EquityPoint {
  /** ISO timestamp (trade close) or day key, depending on the curve. */
  t: string;
  cumNetPnl: number;
}

export interface DayStats {
  date: string;
  netPnl: number;
  grossPnl: number;
  fees: number;
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  volume: number;
}

const closedByCloseTime = (trades: RoundTrip[]): RoundTrip[] =>
  trades
    .filter((t): t is RoundTrip & { closedAt: string } => t.status !== "open" && !!t.closedAt)
    .sort(
      (a, b) => Date.parse(a.closedAt!) - Date.parse(b.closedAt!) || a.key.localeCompare(b.key),
    );

/** Trade-level equity curve: cumulative net P&L at each trade close. */
export const equityCurve = (trades: RoundTrip[]): EquityPoint[] => {
  let cum = 0;
  return closedByCloseTime(trades).map((trade) => {
    cum += trade.netPnl;
    return { t: trade.closedAt!, cumNetPnl: cum };
  });
};

export interface Realization {
  /** ISO timestamp of the sell that realized this slice of P&L. */
  t: string;
  netPnl: number;
  grossPnl: number;
  fees: number;
}

/**
 * Split a closed trade's P&L by the fill that sold it, so each slice lands on the
 * day of that sale. Fees are spread across exits pro-rata by quantity (the same
 * rule the intraday curve uses), so the slices always add up to the trade's totals.
 * Falls back to one slice at the close time when exit times are unknown.
 */
export type RealizableTrade = Pick<RoundTrip, "status" | "netPnl"> &
  Partial<Pick<RoundTrip, "closedAt" | "grossPnl" | "fees" | "exits">>;

export const realizations = (trade: RealizableTrade): Realization[] => {
  const closedAt = trade.closedAt;
  if (trade.status === "open" || !closedAt) return [];
  const whole: Realization[] = [
    { t: closedAt, netPnl: trade.netPnl, grossPnl: trade.grossPnl ?? trade.netPnl, fees: trade.fees ?? 0 },
  ];
  const exits = trade.exits ?? [];
  if (!exits.length || exits.some((exit) => !exit.executedAt)) return whole;
  const totalQty = exits.reduce((total, exit) => total + exit.quantity, 0);
  if (!(totalQty > 0)) return whole;
  // Merge fills that happened at the same instant so a single sell is one slice.
  const slices = new Map<string, Realization>();
  for (const exit of exits) {
    const fees = (trade.fees ?? 0) * (exit.quantity / totalQty);
    const slice = slices.get(exit.executedAt!) ?? {
      t: exit.executedAt!,
      netPnl: 0,
      grossPnl: 0,
      fees: 0,
    };
    slice.grossPnl += exit.grossPnl;
    slice.fees += fees;
    slice.netPnl += exit.grossPnl - fees;
    slices.set(exit.executedAt!, slice);
  }
  return [...slices.values()].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
};

/**
 * Per-day realized stats, keyed "YYYY-MM-DD" in the given timezone.
 * P&L lands on the day each part of a trade was SOLD. A position bought Monday and
 * sold half on Tuesday and half on Wednesday books half its P&L on each day. The
 * trade itself (count, win/loss, volume) is counted on the day it closed.
 */
export const dailyStats = (trades: RoundTrip[], timeZone = "UTC"): DayStats[] => {
  const days = new Map<string, DayStats>();
  const dayOf = (date: string): DayStats => {
    let day = days.get(date);
    if (!day) {
      day = {
        date,
        netPnl: 0,
        grossPnl: 0,
        fees: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        volume: 0,
      };
      days.set(date, day);
    }
    return day;
  };
  for (const trade of closedByCloseTime(trades)) {
    for (const slice of realizations(trade)) {
      const day = dayOf(dayKeyOf(slice.t, timeZone));
      day.netPnl += slice.netPnl;
      day.grossPnl += slice.grossPnl;
      day.fees += slice.fees;
    }
    const closeDay = dayOf(dayKeyOf(trade.closedAt!, timeZone));
    closeDay.trades += 1;
    closeDay.volume += trade.quantity;
    if (trade.status === "win") closeDay.wins += 1;
    else if (trade.status === "loss") closeDay.losses += 1;
    else closeDay.breakevens += 1;
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
};

/** Daily cumulative net P&L curve (one point per trading day). */
export const dailyCumulative = (trades: RoundTrip[], timeZone = "UTC"): EquityPoint[] => {
  return dailyCumulativeFromDays(dailyStats(trades, timeZone));
};

/** Daily totals are already ordered by date. */
export const dailyCumulativeFromDays = (days: DayStats[]): EquityPoint[] => {
  let cum = 0;
  return days.map((day) => {
    cum += day.netPnl;
    return { t: day.date, cumNetPnl: cum };
  });
};

export interface DrawdownStats {
  /** Deepest peak-to-trough fall of the curve, as a positive number. */
  maxDrawdown: number;
  /** Fall relative to (initialBalance + peak). Null when the base is not positive. */
  maxDrawdownPct: number | null;
  peak: number;
}

export interface RelativeDrawdownPoint {
  t: string;
  /** Fall from the running equity peak as a positive fraction. */
  drawdownPct: number | null;
}

/** Point-in-time relative drawdown for an underwater chart. */
export const relativeDrawdownCurve = (
  curve: EquityPoint[],
  initialBalance = 0,
): RelativeDrawdownPoint[] => {
  let peak = 0;
  return curve.map((point) => {
    if (point.cumNetPnl > peak) peak = point.cumNetPnl;
    const base = initialBalance + peak;
    return {
      t: point.t,
      drawdownPct: base > 0 ? (peak - point.cumNetPnl) / base : null,
    };
  });
};

/** Drawdown over any cumulative curve. `initialBalance` anchors the percentage. */
export const drawdown = (curve: EquityPoint[], initialBalance = 0): DrawdownStats => {
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct: number | null = null;
  for (const point of curve) {
    if (point.cumNetPnl > peak) peak = point.cumNetPnl;
    const dd = peak - point.cumNetPnl;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      const base = initialBalance + peak;
      maxDrawdownPct = base > 0 ? dd / base : null;
    }
  }
  return { maxDrawdown, maxDrawdownPct, peak };
};

export interface IntradayPoint {
  t: string;
  cumNetPnl: number;
}

/**
 * Running realized P&L across one day, built from per-exit attributions.
 * Fees are spread across a trade's exits pro-rata by exit quantity, so the
 * curve ends exactly at the day's net P&L.
 */
export const intradayCurve = (
  trades: RoundTrip[],
  executionTimes: Map<string, string>,
  date: string,
  timeZone = "UTC",
): IntradayPoint[] => {
  const events: { t: string; pnl: number }[] = [];
  for (const trade of trades) {
    const totalExitQty = trade.exits.reduce((total, exit) => total + exit.quantity, 0);
    for (const exit of trade.exits) {
      const t = executionTimes.get(exit.executionId);
      if (!t || dayKeyOf(t, timeZone) !== date) continue;
      const feeShare = totalExitQty > 0 ? trade.fees * (exit.quantity / totalExitQty) : 0;
      events.push({ t, pnl: exit.grossPnl - feeShare });
    }
  }
  events.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  let cum = 0;
  return events.map((event) => {
    cum += event.pnl;
    return { t: event.t, cumNetPnl: cum };
  });
};
