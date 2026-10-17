"use client";

import type { ReactNode } from "react";
import type { TradeMetrics } from "@luxalgo/journal-core";
import type { ExtendedStats } from "@/lib/extended-stats";
import { Pnl } from "./pnl";
import { MonetaryValue } from "./privacy";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";

export interface StatDay {
  date: string;
  netPnl: number;
}

interface Tile {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
}

const dash = <span className="text-muted-foreground">—</span>;
const ratio = (value: number | null, digits = 2) => (value === null ? dash : fmtNumber(value, digits));
const duration = (ms: number | null) => (ms === null ? dash : fmtDuration(ms));
const pnl = (value: number | null, currency: string) =>
  value === null ? dash : <Pnl value={value} currency={currency} />;
const money = (value: number | null, currency: string) =>
  value === null ? dash : <MonetaryValue>{fmtMoney(value, currency)}</MonetaryValue>;

function Group({ title, tiles }: { title: string; tiles: Tile[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              title={tile.hint}
              className={`min-w-0 rounded-lg bg-muted/30 px-3 py-2.5 ${tile.hint ? "cursor-help" : ""}`}
            >
              <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                {tile.label}
                {tile.hint && (
                  <span
                    aria-hidden
                    className="inline-flex size-3.5 items-center justify-center rounded-full border border-border text-[9px] leading-none"
                  >
                    ?
                  </span>
                )}
              </dt>
              <dd className="mt-1 break-words text-base font-semibold tabular-nums">{tile.value}</dd>
              {tile.sub && <div className="mt-0.5 text-xs text-muted-foreground">{tile.sub}</div>}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/** A full statistics panel for the Reports overview: everything the dashboard shows, and more. */
export function ReportStatistics({
  metrics,
  extended,
  days,
  currency,
}: {
  metrics: TradeMetrics | null;
  extended: ExtendedStats | null;
  days: StatDay[];
  currency: string;
}) {
  if (!metrics || !extended) return null;
  if (metrics.closedTrades === 0)
    return (
      <p className="rounded-lg border p-4 text-sm text-muted-foreground">
        Statistics appear once you have closed trades in the selected range.
      </p>
    );

  const sortedDays = [...days].sort((a, b) => a.netPnl - b.netPnl);
  const worstDay = sortedDays[0];
  const bestDay = sortedDays[sortedDays.length - 1];
  const avgDay = days.length ? days.reduce((sum, day) => sum + day.netPnl, 0) / days.length : null;
  const streak = metrics.currentStreak;

  const groups: Array<{ title: string; tiles: Tile[] }> = [
    {
      title: "Performance",
      tiles: [
        {
          label: "Net P&L",
          value: pnl(metrics.netPnl, currency),
          sub: (
            <>
              Gross <MonetaryValue>{fmtMoney(metrics.grossPnl, currency)}</MonetaryValue> ·{" "}
              <MonetaryValue>{fmtMoney(-metrics.fees, currency)}</MonetaryValue> fees
            </>
          ),
        },
        { label: "Gross profit", value: pnl(extended.grossProfit, currency) },
        { label: "Gross loss", value: pnl(extended.grossLoss, currency) },
        {
          label: "Average trade",
          value: pnl(extended.avgTrade, currency),
          sub: <>Median {pnl(extended.medianTrade, currency)}</>,
          hint: "Mean and median net P&L across closed trades.",
        },
        {
          label: "Expectancy",
          value: pnl(metrics.expectancy, currency),
          hint: "Win rate × average win − loss rate × average loss, per trade.",
        },
        {
          label: "Total fees",
          value: money(metrics.fees, currency),
          sub: <>{money(extended.avgFeePerTrade, currency)} per trade</>,
        },
        { label: "Volume", value: fmtNumber(metrics.totalVolume, 2) },
        {
          label: "Avg realized R",
          value: metrics.avgRealizedR === null ? dash : `${fmtNumber(metrics.avgRealizedR)}R`,
          sub: `${metrics.tradesWithRisk} trades with a stop`,
          hint: "Needs a stop-loss on the trade to measure risk.",
        },
      ],
    },
    {
      title: "Wins and losses",
      tiles: [
        {
          label: "Trades",
          value: fmtNumber(metrics.closedTrades, 0),
          sub: `${metrics.openTrades} open`,
        },
        {
          label: "Win rate",
          value: fmtPercent(metrics.winRate, 1),
          sub: `${metrics.wins}W · ${metrics.losses}L · ${metrics.breakevens}BE`,
        },
        {
          label: "Profit factor",
          value: metrics.profitFactorIsInfinite ? "∞" : ratio(metrics.profitFactor),
          hint: "Gross profit divided by gross loss.",
        },
        {
          label: "Win / loss ratio",
          value: ratio(extended.payoffRatio),
          sub:
            extended.breakEvenWinRate === null
              ? undefined
              : `Break-even win rate ${fmtPercent(extended.breakEvenWinRate, 0)}`,
          hint: "Average win divided by the size of the average loss. The break-even win rate is the win rate you need at this ratio.",
        },
        { label: "Average win", value: pnl(metrics.avgWin, currency) },
        { label: "Average loss", value: pnl(metrics.avgLoss, currency) },
        { label: "Largest win", value: pnl(extended.largestWin, currency) },
        { label: "Largest loss", value: pnl(extended.largestLoss, currency) },
      ],
    },
    {
      title: "Risk and consistency",
      tiles: [
        {
          label: "Sharpe (per trade)",
          value: ratio(extended.sharpePerTrade),
          hint: "Average trade divided by the standard deviation of trades. Not annualized; needs at least 2 closed trades.",
        },
        {
          label: "Sortino (per trade)",
          value: ratio(extended.sortinoPerTrade),
          hint: "Like Sharpe, but only losing trades count as risk.",
        },
        {
          label: "Std. deviation",
          value: money(extended.stdDev, currency),
          hint: "How widely individual trade results vary.",
        },
        {
          label: "Max drawdown",
          value: money(metrics.maxDrawdown, currency),
          sub: metrics.maxDrawdownPct === null ? undefined : fmtPercent(metrics.maxDrawdownPct, 1),
        },
        { label: "Recovery factor", value: ratio(metrics.recoveryFactor) },
        {
          label: "Profit concentration",
          value: metrics.profitConcentration === null ? dash : fmtPercent(metrics.profitConcentration, 0),
          hint: "Share of total profit that came from the single best day.",
        },
        {
          label: "Best streak",
          value: `${metrics.maxWinStreak} wins`,
          sub: `Worst ${metrics.maxLossStreak} losses`,
        },
        {
          label: "Current streak",
          value: streak === 0 ? dash : `${Math.abs(streak)} ${streak > 0 ? "wins" : "losses"}`,
        },
      ],
    },
    {
      title: "Holding time",
      tiles: [
        { label: "Average hold", value: duration(metrics.avgDurationMs) },
        { label: "Avg win hold", value: duration(extended.avgWinHoldMs) },
        { label: "Avg loss hold", value: duration(extended.avgLossHoldMs) },
        { label: "Longest hold", value: duration(extended.longestHoldMs) },
        { label: "Shortest hold", value: duration(extended.shortestHoldMs) },
      ],
    },
    {
      title: "Days",
      tiles: [
        { label: "Trading days", value: fmtNumber(metrics.tradingDays, 0) },
        { label: "Day win rate", value: fmtPercent(metrics.dayWinRate, 1) },
        {
          label: "Trades per day",
          value:
            metrics.tradingDays > 0 ? fmtNumber(metrics.closedTrades / metrics.tradingDays, 1) : dash,
        },
        { label: "Average day", value: pnl(avgDay, currency) },
        {
          label: "Best day",
          value: bestDay ? pnl(bestDay.netPnl, currency) : dash,
          sub: bestDay?.date,
        },
        {
          label: "Worst day",
          value: worstDay ? pnl(worstDay.netPnl, currency) : dash,
          sub: worstDay?.date,
        },
      ],
    },
  ];

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <Group key={group.title} title={group.title} tiles={group.tiles} />
      ))}
    </div>
  );
}
