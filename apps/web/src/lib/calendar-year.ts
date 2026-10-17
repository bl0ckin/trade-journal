import type { CurrencyScope } from "./currencies";
import type { AnalysisFilters, DayStats } from "@luxalgo/journal-core";

type DayLike = Pick<DayStats, "date" | "netPnl" | "trades" | "wins" | "losses" | "breakevens">;

export interface YearDay {
  date: string;
  netPnl: number;
}

export interface YearMonth {
  /** 1-12 */
  month: number;
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  tradingDays: number;
  greenDays: number;
  redDays: number;
  bestDay: YearDay | null;
  worstDay: YearDay | null;
  /** Running total at the end of this month. */
  cumulative: number;
}

export interface CalendarYear {
  year: number;
  months: YearMonth[];
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  tradingDays: number;
  greenDays: number;
  redDays: number;
  winRate: number | null;
  activeMonths: number;
  profitableMonths: number;
  losingMonths: number;
  avgMonth: number | null;
  bestMonth: YearMonth | null;
  worstMonth: YearMonth | null;
  bestDay: YearDay | null;
  worstDay: YearDay | null;
  /** Longest run of consecutive profitable months. */
  longestGreenRun: number;
}

/** Clamp the user's date filters to the chosen calendar year. */
export function yearScope<T extends AnalysisFilters>(filters: T, year: number) {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  return {
    ...filters,
    from: filters.from && filters.from > start ? filters.from : start,
    to: filters.to && filters.to < end ? filters.to : end,
  };
}

/** Roll closed-trade day stats up into the 12 months of one year. */
export function calendarYearFromDays(allDays: readonly DayLike[], year: number): CalendarYear {
  const prefix = `${year}-`;
  const days = allDays.filter((day) => day.date.startsWith(prefix) && day.trades > 0);
  let running = 0;
  const months: YearMonth[] = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const key = `${year}-${String(month).padStart(2, "0")}-`;
    const inMonth = days.filter((day) => day.date.startsWith(key));
    const netPnl = inMonth.reduce((sum, day) => sum + day.netPnl, 0);
    running += netPnl;
    const pick = (better: (a: number, b: number) => boolean) =>
      inMonth.reduce<YearDay | null>(
        (top, day) => (top === null || better(day.netPnl, top.netPnl) ? { date: day.date, netPnl: day.netPnl } : top),
        null,
      );
    return {
      month,
      netPnl,
      trades: inMonth.reduce((sum, day) => sum + day.trades, 0),
      wins: inMonth.reduce((sum, day) => sum + day.wins, 0),
      losses: inMonth.reduce((sum, day) => sum + day.losses, 0),
      breakevens: inMonth.reduce((sum, day) => sum + day.breakevens, 0),
      tradingDays: inMonth.length,
      greenDays: inMonth.filter((day) => day.netPnl > 0).length,
      redDays: inMonth.filter((day) => day.netPnl < 0).length,
      bestDay: pick((a, b) => a > b),
      worstDay: pick((a, b) => a < b),
      cumulative: running,
    };
  });
  const active = months.filter((m) => m.trades > 0);
  const netPnl = active.reduce((sum, m) => sum + m.netPnl, 0);
  const trades = active.reduce((sum, m) => sum + m.trades, 0);
  const wins = active.reduce((sum, m) => sum + m.wins, 0);
  let run = 0;
  let longestGreenRun = 0;
  for (const m of months) {
    run = m.trades > 0 && m.netPnl > 0 ? run + 1 : 0;
    longestGreenRun = Math.max(longestGreenRun, run);
  }
  const dayExtreme = (better: (a: number, b: number) => boolean) =>
    days.reduce<YearDay | null>(
      (top, day) => (top === null || better(day.netPnl, top.netPnl) ? { date: day.date, netPnl: day.netPnl } : top),
      null,
    );
  return {
    year,
    months,
    netPnl,
    trades,
    wins,
    losses: active.reduce((sum, m) => sum + m.losses, 0),
    breakevens: active.reduce((sum, m) => sum + m.breakevens, 0),
    tradingDays: days.length,
    greenDays: days.filter((day) => day.netPnl > 0).length,
    redDays: days.filter((day) => day.netPnl < 0).length,
    winRate: trades ? wins / trades : null,
    activeMonths: active.length,
    profitableMonths: active.filter((m) => m.netPnl > 0).length,
    losingMonths: active.filter((m) => m.netPnl < 0).length,
    avgMonth: active.length ? netPnl / active.length : null,
    // Ties keep the earliest month.
    bestMonth: active.reduce<YearMonth | null>((top, m) => (top === null || m.netPnl > top.netPnl ? m : top), null),
    worstMonth: active.reduce<YearMonth | null>((top, m) => (top === null || m.netPnl < top.netPnl ? m : top), null),
    bestDay: dayExtreme((a, b) => a > b),
    worstDay: dayExtreme((a, b) => a < b),
    longestGreenRun,
  };
}

export interface CalendarYearResponse {
  currencyScope?: CurrencyScope;
  currencyGroups?: { currency: string; year: CalendarYear }[];
  year: CalendarYear;
  timeZone: string;
  currencies: string[];
  scope: AnalysisFilters & { from: string; to: string };
}
