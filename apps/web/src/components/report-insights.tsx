"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { BucketStats, EquityPoint, TradeMetrics } from "@luxalgo/journal-core";
import type { ExtendedStats } from "@/lib/extended-stats";
import { fmtBalance, fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import { MonetaryValue } from "./privacy";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

type Tone = "good" | "bad" | "warn" | "info";

interface Insight {
  id: string;
  tone: Tone;
  title: string;
  body: ReactNode;
  /** Lower ranks are shown first. */
  rank: number;
}

interface InsightDay {
  date: string;
  netPnl: number;
}

export interface InsightInput {
  metrics: TradeMetrics;
  extended: ExtendedStats;
  currency: string;
  days: InsightDay[];
  dailyCumulative: EquityPoint[];
  buckets: {
    symbol: BucketStats[];
    weekday: BucketStats[];
    hour: BucketStats[];
    direction: BucketStats[];
    mistake: BucketStats[];
  };
}

/** Slices with fewer trades than this are too noisy to call a pattern. */
const MIN_TRADES = 3;
/** Show this many takeaways before the "show more" toggle. */
const VISIBLE = 6;

const signed = (value: number, currency: string) => (
  <MonetaryValue>{fmtMoney(value, currency)}</MonetaryValue>
);
const plain = (value: number, currency: string) => (
  <MonetaryValue>{fmtBalance(Math.abs(value), currency)}</MonetaryValue>
);

const eligible = (rows: BucketStats[]) => rows.filter((row) => row.trades >= MIN_TRADES);
const best = (rows: BucketStats[]) =>
  rows.reduce<BucketStats | null>((top, row) => (top === null || row.netPnl > top.netPnl ? row : top), null);
const worst = (rows: BucketStats[]) =>
  rows.reduce<BucketStats | null>((low, row) => (low === null || row.netPnl < low.netPnl ? row : low), null);

const hourLabel = (key: string) => `${key}:00–${key}:59`;

export function buildInsights({ metrics, extended, currency, days, dailyCumulative, buckets }: InsightInput): Insight[] {
  const out: Insight[] = [];
  const push = (insight: Insight) => out.push(insight);
  const trades = metrics.closedTrades;

  // 1. Is there an edge at all?
  if (metrics.expectancy !== null) {
    if (metrics.expectancy > 0)
      push({
        id: "expectancy",
        tone: "good",
        rank: 10,
        title: "Your average trade makes money",
        body: (
          <>
            Each trade is worth {signed(metrics.expectancy, currency)} on average across {trades} closed trades.
            {trades < 30 ? " The sample is still small, so treat this as a signal rather than proof." : ""}
          </>
        ),
      });
    else if (metrics.expectancy < 0)
      push({
        id: "expectancy",
        tone: "bad",
        rank: 10,
        title: "Your average trade loses money",
        body: (
          <>
            Each trade costs you {plain(metrics.expectancy, currency)} on average. Improving either your win rate or the
            size of winners versus losers is what moves this number.
          </>
        ),
      });
  }

  // 2. Fees flipping the result.
  if (metrics.grossPnl > 0 && metrics.netPnl < 0)
    push({
      id: "fees-flip",
      tone: "bad",
      rank: 5,
      title: "Fees turn a profit into a loss",
      body: (
        <>
          Before costs you were up {plain(metrics.grossPnl, currency)}; after {plain(metrics.fees, currency)} in fees you
          are down {plain(metrics.netPnl, currency)}. Fewer, higher-quality trades would help.
        </>
      ),
    });
  else if (extended.grossProfit > 0 && metrics.fees / extended.grossProfit >= 0.15)
    push({
      id: "fees-heavy",
      tone: "warn",
      rank: 45,
      title: "Fees take a big bite",
      body: (
        <>
          You paid {plain(metrics.fees, currency)} in fees, about {fmtPercent(metrics.fees / extended.grossProfit, 0)} of
          your gross profit.
        </>
      ),
    });

  // 3. Win rate vs the win rate the payoff needs.
  const winRate = metrics.winRate;
  const breakEven = extended.breakEvenWinRate;
  if (winRate !== null && breakEven !== null) {
    const margin = winRate - breakEven;
    if (margin >= 0.03)
      push({
        id: "winrate",
        tone: "good",
        rank: 20,
        title: "Win rate clears the bar",
        body: (
          <>
            You win {fmtPercent(winRate, 0)} of trades and only need {fmtPercent(breakEven, 0)} to break even at your
            current win/loss size.
          </>
        ),
      });
    else if (margin <= -0.03)
      push({
        id: "winrate",
        tone: "bad",
        rank: 20,
        title: "Win rate is below break-even",
        body: (
          <>
            At your win/loss size you need {fmtPercent(breakEven, 0)} winners, but you are at {fmtPercent(winRate, 0)}.
            Either win more often, let winners run, or cut losers sooner.
          </>
        ),
      });
    else
      push({
        id: "winrate",
        tone: "warn",
        rank: 20,
        title: "Razor-thin margin",
        body: (
          <>
            Your {fmtPercent(winRate, 0)} win rate is almost exactly the {fmtPercent(breakEven, 0)} you need to break
            even, so small changes in execution decide whether you profit.
          </>
        ),
      });
  }

  // 4. Most expensive mistake.
  const costly = worst(buckets.mistake.filter((row) => row.trades >= 2 && row.netPnl < 0));
  if (costly)
    push({
      id: "mistake",
      tone: "bad",
      rank: 25,
      title: `“${costly.key}” is your costliest mistake`,
      body: (
        <>
          Trades logged with it lost {plain(costly.netPnl, currency)} across {costly.trades} trades. Fixing this one habit
          is the quickest win available.
        </>
      ),
    });

  // 5. Holding losers vs winners.
  const winHold = extended.avgWinHoldMs;
  const lossHold = extended.avgLossHoldMs;
  if (winHold !== null && lossHold !== null) {
    if (lossHold > winHold * 1.5 && lossHold - winHold > 60_000)
      push({
        id: "hold",
        tone: "warn",
        rank: 30,
        title: "You hold losers longer than winners",
        body: (
          <>
            Losing trades last {fmtDuration(lossHold)} on average versus {fmtDuration(winHold)} for winners, a common sign
            of hoping a loss will turn around.
          </>
        ),
      });
    else if (winHold > lossHold * 1.5 && winHold - lossHold > 60_000)
      push({
        id: "hold",
        tone: "good",
        rank: 30,
        title: "You let winners run",
        body: (
          <>
            Winners are held {fmtDuration(winHold)} on average versus {fmtDuration(lossHold)} for losers, which is the
            pattern good risk management produces.
          </>
        ),
      });
  }

  // 6. Dependence on a few big days.
  if (days.length >= 5 && metrics.netPnl > 0 && metrics.profitConcentration !== null && metrics.profitConcentration >= 0.4) {
    const top = days.reduce<InsightDay | null>((a, d) => (a === null || d.netPnl > a.netPnl ? d : a), null);
    if (top)
      push({
        id: "concentration",
        tone: "warn",
        rank: 35,
        title: "One day drives your results",
        body: (
          <>
            {top.date} produced {fmtPercent(metrics.profitConcentration, 0)} of your total profit. Without it you would
            be at {signed(metrics.netPnl - top.netPnl, currency)}.
          </>
        ),
      });
  }

  // 7. Where you are on the equity curve.
  if (dailyCumulative.length >= 5) {
    const cumulative = dailyCumulative.map((point) => point.cumNetPnl);
    const peak = Math.max(0, ...cumulative);
    const last = cumulative[cumulative.length - 1]!;
    const drop = last - peak;
    const maxDrop = Math.abs(metrics.maxDrawdown);
    if (drop < 0 && maxDrop > 0 && Math.abs(drop) >= maxDrop * 0.25)
      push({
        id: "drawdown",
        tone: "warn",
        rank: 40,
        title: "You are in a drawdown",
        body: (
          <>
            Equity is {plain(drop, currency)} below its peak. Your worst drop so far is {plain(maxDrop, currency)}.
          </>
        ),
      });
    else if (drop === 0 && peak > 0)
      push({
        id: "drawdown",
        tone: "good",
        rank: 40,
        title: "Equity is at an all-time high",
        body: <>You are at your highest cumulative P&L in this period.</>,
      });
  }

  // 8. Tail risk.
  if (metrics.avgWin !== null && metrics.avgWin > 0 && extended.largestLoss !== null) {
    const ratio = Math.abs(extended.largestLoss) / metrics.avgWin;
    if (extended.largestLoss < 0 && ratio >= 3)
      push({
        id: "tail",
        tone: "warn",
        rank: 50,
        title: "One loss can erase many wins",
        body: (
          <>
            Your largest loss ({plain(extended.largestLoss, currency)}) is {fmtNumber(ratio, 1)}× your average win. A
            hard stop or smaller size on outliers protects your edge.
          </>
        ),
      });
  }

  // 9. Weekday.
  const days7 = eligible(buckets.weekday);
  const bestDay = best(days7);
  const worstDay = worst(days7);
  if (days7.length >= 2 && bestDay && bestDay.netPnl > 0)
    push({
      id: "day-best",
      tone: "good",
      rank: 60,
      title: `${bestDay.key} is your strongest day`,
      body: (
        <>
          {signed(bestDay.netPnl, currency)} over {bestDay.trades} trades
          {bestDay.winRate !== null ? ` with a ${fmtPercent(bestDay.winRate, 0)} win rate` : ""}.
        </>
      ),
    });
  if (days7.length >= 2 && worstDay && worstDay.netPnl < 0 && worstDay.key !== bestDay?.key)
    push({
      id: "day-worst",
      tone: "bad",
      rank: 61,
      title: `${worstDay.key} is your weakest day`,
      body: (
        <>
          {worstDay.trades} trades lost {plain(worstDay.netPnl, currency)}. Worth reviewing what is different about those
          sessions, or trading smaller on that day.
        </>
      ),
    });

  // 10. Time of day.
  const hours = eligible(buckets.hour);
  const bestHour = best(hours);
  const worstHour = worst(hours);
  if (hours.length >= 2 && bestHour && bestHour.netPnl > 0)
    push({
      id: "hour-best",
      tone: "good",
      rank: 70,
      title: `Your best hour is ${hourLabel(bestHour.key)}`,
      body: (
        <>
          {signed(bestHour.netPnl, currency)} from {bestHour.trades} trades opened in that window.
        </>
      ),
    });
  if (hours.length >= 2 && worstHour && worstHour.netPnl < 0 && worstHour.key !== bestHour?.key)
    push({
      id: "hour-worst",
      tone: "bad",
      rank: 71,
      title: `Your worst hour is ${hourLabel(worstHour.key)}`,
      body: (
        <>
          {worstHour.trades} trades opened then lost {plain(worstHour.netPnl, currency)}. Consider stepping aside during
          this window.
        </>
      ),
    });

  // 11. Symbols.
  const symbols = eligible(buckets.symbol);
  const bestSymbol = best(symbols);
  const worstSymbol = worst(symbols);
  if (symbols.length >= 2 && bestSymbol && bestSymbol.netPnl > 0)
    push({
      id: "symbol-best",
      tone: "good",
      rank: 80,
      title: `${bestSymbol.key} is your top earner`,
      body: (
        <>
          {signed(bestSymbol.netPnl, currency)} over {bestSymbol.trades} trades
          {bestSymbol.winRate !== null ? ` (${fmtPercent(bestSymbol.winRate, 0)} win rate)` : ""}.
        </>
      ),
    });
  if (symbols.length >= 2 && worstSymbol && worstSymbol.netPnl < 0 && worstSymbol.key !== bestSymbol?.key)
    push({
      id: "symbol-worst",
      tone: "bad",
      rank: 81,
      title: `${worstSymbol.key} is costing you`,
      body: (
        <>
          {plain(worstSymbol.netPnl, currency)} lost over {worstSymbol.trades} trades. Ask whether you have a real edge
          there.
        </>
      ),
    });

  // 12. Long vs short.
  const long = buckets.direction.find((row) => row.key === "long");
  const short = buckets.direction.find((row) => row.key === "short");
  if (long && short && long.trades >= 5 && short.trades >= 5 && Math.sign(long.netPnl) !== Math.sign(short.netPnl)) {
    const strong = long.netPnl > short.netPnl ? "long" : "short";
    push({
      id: "direction",
      tone: "info",
      rank: 90,
      title: `Your edge is on the ${strong} side`,
      body: (
        <>
          Longs: {signed(long.netPnl, currency)} ({long.trades} trades). Shorts: {signed(short.netPnl, currency)} (
          {short.trades} trades).
        </>
      ),
    });
  }

  // 13. Streaks.
  if (metrics.currentStreak <= -3)
    push({
      id: "streak",
      tone: "warn",
      rank: 95,
      title: `${Math.abs(metrics.currentStreak)} losses in a row`,
      body: <>Review the last few trades before sizing up. Streaks like this are when discipline slips.</>,
    });
  else if (metrics.currentStreak >= 3)
    push({
      id: "streak",
      tone: "info",
      rank: 95,
      title: `${metrics.currentStreak} wins in a row`,
      body: <>Stay with your plan. Winning streaks are when position size tends to creep up.</>,
    });

  return out.sort((a, b) => a.rank - b.rank);
}

const TONES: Record<Tone, { icon: typeof Info; chip: string; edge: string }> = {
  good: { icon: CheckCircle2, chip: "bg-profit/10 text-profit", edge: "border-l-profit/70" },
  bad: { icon: XCircle, chip: "bg-loss/10 text-loss", edge: "border-l-loss/70" },
  warn: {
    icon: AlertTriangle,
    chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    edge: "border-l-amber-500/70",
  },
  info: { icon: Info, chip: "bg-primary/10 text-primary", edge: "border-l-primary/70" },
};

export function ReportInsights(props: InsightInput) {
  const [expanded, setExpanded] = useState(false);
  const insights = buildInsights(props);
  const { metrics, currency, days } = props;
  const shown = expanded ? insights : insights.slice(0, VISIBLE);
  const profitFactor = metrics.profitFactorIsInfinite
    ? "no losing trades"
    : metrics.profitFactor === null
      ? null
      : `a profit factor of ${fmtNumber(metrics.profitFactor)}`;

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle>Key takeaways</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-3xl text-sm leading-relaxed text-foreground/90">
          Over {days.length} trading day{days.length === 1 ? "" : "s"} and {metrics.closedTrades} closed trade
          {metrics.closedTrades === 1 ? "" : "s"} you netted {signed(metrics.netPnl, currency)}, winning{" "}
          {fmtPercent(metrics.winRate, 0)} of trades
          {profitFactor ? ` with ${profitFactor}` : ""}.
        </p>
        {insights.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Log a few more trades (at least {MIN_TRADES} per symbol, weekday or hour) and specific patterns will show up
            here.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((insight) => {
              const tone = TONES[insight.tone];
              const Icon = tone.icon;
              return (
                <li
                  key={insight.id}
                  className={`flex gap-3 rounded-lg border border-l-2 border-border/60 bg-muted/20 p-3 ${tone.edge}`}
                >
                  <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${tone.chip}`}>
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-snug">{insight.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{insight.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            Generated from your filtered trades.
            {metrics.closedTrades < 30 ? " Under 30 trades, patterns can easily be noise." : ""}
          </p>
          {insights.length > VISIBLE && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="text-xs font-medium text-primary hover:underline"
            >
              {expanded ? "Show fewer" : `Show ${insights.length - VISIBLE} more`}
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
