"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AnalysisFilters, BucketStats, EquityPoint, TradeMetrics } from "@luxalgo/journal-core";
import type { ExtendedStats, PsychologyStats } from "@/lib/extended-stats";
import { ReportStatistics, type StatDay } from "./report-statistics";
import { TimeHeatmap } from "./charts/time-heatmap";
import { EquityArea } from "./charts/equity-area";
import { DailyBars } from "./charts/daily-bars";
import { KpiStrip, OutcomeDonut, PayoffBars } from "./report-kpis";
import {
  BarList,
  DrawdownArea,
  MonthlyTable,
  PnlHistogram,
  SectionHeading,
  Segmented,
  TopTrades,
  type BarRow,
} from "./report-charts";
import { ReportInsights } from "./report-insights";
import { ReviewExport } from "./review-export";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { useApi } from "@/lib/use-api";
import { fmtMoney, fmtPercent } from "@/lib/utils";
import type { MarketBucket } from "@/lib/markets";
import { describeFilters } from "@/lib/filter-description";

interface OverviewData {
  buckets: Record<
    "symbol" | "tag" | "mistake" | "playbook" | "weekday" | "hour" | "duration" | "direction",
    BucketStats[]
  >;
  currencies: string[];
  timeZone: string;
  accounts: { id: string; name: string }[];
  playbooks: { id: string; name: string }[];
  metrics: TradeMetrics | null;
  extended: ExtendedStats | null;
  days: Array<StatDay & { trades: number; wins: number; losses: number }>;
  dailyCumulative: EquityPoint[];
  psychology: PsychologyStats | null;
  markets: MarketBucket[];
}

// Keep the original overview's aggregations and ordering alongside the advanced reports.
const SECTIONS = [
  { key: "symbol", title: "By symbol" },
  { key: "direction", title: "Long vs short" },
  { key: "weekday", title: "By weekday" },
  { key: "duration", title: "By holding time" },
  { key: "tag", title: "By tag" },
  { key: "mistake", title: "By mistake" },
  { key: "playbook", title: "By playbook" },
] as const;

export function ReportOverview({ query, filters }: { query: string; filters: AnalysisFilters }) {
  const { data, error, loading } = useApi<OverviewData>(`/api/stats?${query}`);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (loading || !data) return <Skeleton className="h-72" />;
  if (data.currencies.length > 1)
    return (
      <p className="rounded-lg border p-4 text-sm">
        These accounts use different currencies ({data.currencies.join(", ")}). Select accounts with
        the same currency in Filters to compare monetary results.
      </p>
    );
  const currency = data.currencies[0] ?? "USD";
  const label = (dimension: string, key: string) =>
    dimension === "playbook" ? (data.playbooks.find((book) => book.id === key)?.name ?? key) : key;
  const metrics = data.metrics;
  const extended = data.extended;
  const sortedDays = [...data.days].sort((a, b) => a.date.localeCompare(b.date));
  const range =
    sortedDays.length > 0
      ? `${sortedDays[0]!.date} to ${sortedDays[sortedDays.length - 1]!.date}`
      : "No trading days yet";
  const rows = (key: keyof OverviewData["buckets"], sortKeys?: string[]): BarRow[] => {
    const list = [...data.buckets[key]];
    if (sortKeys) list.sort((a, b) => sortKeys.indexOf(a.key) - sortKeys.indexOf(b.key));
    return list.map((b) => ({
      key: b.key,
      label:
        key === "direction"
          ? b.key.charAt(0).toUpperCase() + b.key.slice(1)
          : label(key, b.key),
      netPnl: b.netPnl,
      trades: b.trades,
      winRate: b.winRate,
    }));
  };
  const weekdayOrder = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Performance overview</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5">{range}</span>
            {metrics && metrics.closedTrades > 0 && (
              <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5">
                {metrics.closedTrades} closed trade{metrics.closedTrades === 1 ? "" : "s"}
              </span>
            )}
            <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5">{currency}</span>
            <span className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5">{data.timeZone}</span>
          </div>
        </div>
        <ReviewExport
          containsFinancialData
          document={{
            title: "Trading overview",
            subtitle: `${data.timeZone} · ${currency}`,
            lines: [
              `Filters: ${describeFilters(filters, data.accounts, data.playbooks)}`,
              "",
              ...(data.metrics && data.extended && data.metrics.closedTrades > 0
                ? [
                    "Key statistics",
                    `Net P&L ${fmtMoney(data.metrics.netPnl, currency)} (gross ${fmtMoney(data.metrics.grossPnl, currency)}, fees ${fmtMoney(-data.metrics.fees, currency)})`,
                    `Closed trades ${data.metrics.closedTrades} | Win rate ${fmtPercent(data.metrics.winRate, 1)} | Profit factor ${data.metrics.profitFactorIsInfinite ? "infinite" : (data.metrics.profitFactor?.toFixed(2) ?? "-")}`,
                    `Average win ${data.metrics.avgWin === null ? "-" : fmtMoney(data.metrics.avgWin, currency)} | Average loss ${data.metrics.avgLoss === null ? "-" : fmtMoney(data.metrics.avgLoss, currency)} | Expectancy ${data.metrics.expectancy === null ? "-" : fmtMoney(data.metrics.expectancy, currency)}`,
                    `Largest win ${data.extended.largestWin === null ? "-" : fmtMoney(data.extended.largestWin, currency)} | Largest loss ${data.extended.largestLoss === null ? "-" : fmtMoney(data.extended.largestLoss, currency)}`,
                    `Max drawdown ${fmtMoney(data.metrics.maxDrawdown, currency)} | Sharpe per trade ${data.extended.sharpePerTrade?.toFixed(2) ?? "-"}`,
                    "",
                  ]
                : []),
              "Trade time performance (opening hour)",
              ...data.buckets.hour.map(
                (b) => `${b.key}:00: ${b.trades} trades | Net P&L ${fmtMoney(b.netPnl, currency)}`,
              ),
              "",
              "Markets",
              ...data.markets.map(
                (m) =>
                  `${m.label}: ${m.trades} trades | Win ${fmtPercent(m.winRate, 0)} | Net P&L ${fmtMoney(m.netPnl, currency)}`,
              ),
              ...SECTIONS.flatMap((section) => [
                "",
                section.title,
                ...data.buckets[section.key].map(
                  (b) =>
                    `${label(section.key, b.key)}: ${b.trades} trades | Win ${fmtPercent(b.winRate, 0)} | Net P&L ${fmtMoney(b.netPnl, currency)}`,
                ),
              ]),
            ],
          }}
        />
      </div>

      {!metrics || !extended || metrics.closedTrades === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No closed trades in this range</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Close a trade, change the filters, or widen the date range to see your report.
          </p>
        </div>
      ) : (
        <>
          <KpiStrip
            metrics={metrics}
            extended={extended}
            daily={data.dailyCumulative}
            currency={currency}
          />

          <div id="takeaways" className="scroll-mt-20">
            <ReportInsights
              metrics={metrics}
              extended={extended}
              currency={currency}
              days={data.days}
              dailyCumulative={data.dailyCumulative}
              buckets={{
                symbol: data.buckets.symbol,
                weekday: data.buckets.weekday,
                hour: data.buckets.hour,
                direction: data.buckets.direction,
                mistake: data.buckets.mistake,
              }}
            />
          </div>

          <SectionNav />

          <SectionHeading
            id="performance"
            title="Performance"
            hint="How your account has grown, and how the results are distributed"
          />
          <PerformanceOverTime data={data} currency={currency} />

          <div className="grid gap-3 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Trade outcomes</CardTitle>
              </CardHeader>
              <CardContent>
                <OutcomeDonut metrics={metrics} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Win and loss size</CardTitle>
              </CardHeader>
              <CardContent>
                <PayoffBars metrics={metrics} extended={extended} currency={currency} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Long vs short</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList rows={rows("direction")} currency={currency} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Trade P&L distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <PnlHistogram bins={extended.histogram} currency={currency} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Best and worst trades</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-profit">Best</p>
                  <TopTrades trades={extended.topWins} currency={currency} empty="No winning trades." />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-loss">Worst</p>
                  <TopTrades trades={extended.topLosses} currency={currency} empty="No losing trades." />
                </div>
              </CardContent>
            </Card>
          </div>

          <SectionHeading id="timing" title="When you trade" hint="Based on trade opening times" />
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Time of day</CardTitle>
              </CardHeader>
              <CardContent>
                <TimeHeatmap hours={data.buckets.hour} currency={currency} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Day of week</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList rows={rows("weekday", weekdayOrder)} currency={currency} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Holding time</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList rows={rows("duration")} currency={currency} />
              </CardContent>
            </Card>
          </div>

          <SectionHeading id="markets" title="What you trade" hint="Where your money is made and lost" />
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>By symbol</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList rows={rows("symbol")} currency={currency} limit={10} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>By market</CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  rows={data.markets.map((m) => ({
                    key: m.key,
                    label: m.label,
                    netPnl: m.netPnl,
                    trades: m.trades,
                    winRate: m.winRate,
                  }))}
                  currency={currency}
                  empty="No closed trades yet."
                  limit={8}
                />
              </CardContent>
            </Card>
          </div>

          <SectionHeading id="consistency" title="Consistency" hint="Month by month" />
          <Card>
            <CardContent className="pt-4">
              <MonthlyTable days={data.days} currency={currency} />
            </CardContent>
          </Card>

          <SectionHeading
            id="discipline"
            title="Strategy and discipline"
            hint="Annotate trades with playbooks, tags and mistakes to unlock these"
          />
          <div className="grid gap-3 lg:grid-cols-3">
            {(
              [
                ["playbook", "Playbooks", "Assign a playbook to a trade to see how each setup performs."],
                ["tag", "Tags", "Tag your trades to compare setups and conditions."],
                ["mistake", "Mistakes", "Log mistakes on trades to see what they cost you."],
              ] as const
            ).map(([key, title, empty]) => (
              <Card key={key}>
                <CardHeader>
                  <CardTitle>{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarList rows={rows(key)} currency={currency} empty={empty} limit={8} />
                </CardContent>
              </Card>
            ))}
          </div>

          <SectionHeading
            title="Psychology"
            hint="From the quality, confidence and emotional state you log on trades"
          />
          {data.psychology && data.psychology.tagged > 0 ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {(
                [
                  ["Emotional state", data.psychology.emotions],
                  ["Trade quality", data.psychology.quality],
                  ["Confidence", data.psychology.confidence],
                ] as const
              ).map(([title, buckets]) => (
                <Card key={title}>
                  <CardHeader>
                    <CardTitle>{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BarList
                      rows={buckets.map((b) => ({
                        key: b.key,
                        label: b.label,
                        netPnl: b.netPnl,
                        trades: b.trades,
                        winRate: b.winRate,
                      }))}
                      currency={currency}
                      empty="Not logged on any of these trades yet."
                      limit={8}
                    />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Log a trade quality, confidence and emotional state on your trades to see how your
              mindset affects your results.
            </p>
          )}

          <SectionHeading id="statistics" title="All statistics" hint="Hover a figure for its definition" />
          <details className="group rounded-xl border border-border/70 bg-card/40 open:bg-transparent">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors hover:bg-accent/30 [&::-webkit-details-marker]:hidden">
              <span>
                Full statistics
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  Performance, wins and losses, risk, holding time and days
                </span>
              </span>
              <ChevronDown
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="p-3 pt-1">
              <ReportStatistics
                metrics={data.metrics}
                extended={data.extended}
                days={data.days}
                currency={currency}
              />
            </div>
          </details>
        </>
      )}
      <p className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
        Weekday and hour use trade opening times. Win rates and statistics use closed trades. Tags
        and mistakes can overlap, so their totals can add up to more than your overall result. By
        symbol shows the top 20 by net P&L; Breakdowns includes every symbol and more metrics.
      </p>
    </div>
  );
}

function PerformanceOverTime({ data, currency }: { data: OverviewData; currency: string }) {
  const [view, setView] = useState<"equity" | "drawdown" | "daily">("equity");
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>Performance over time</CardTitle>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            ["equity", "Equity curve"],
            ["drawdown", "Drawdown"],
            ["daily", "Daily P&L"],
          ]}
        />
      </CardHeader>
      <CardContent>
        {view === "equity" ? (
          <EquityArea
            height={300}
            currency={currency}
            data={data.dailyCumulative.map((p) => ({ t: p.t, cumNetPnl: p.cumNetPnl }))}
          />
        ) : view === "drawdown" ? (
          <DrawdownArea data={data.dailyCumulative} currency={currency} />
        ) : (
          <DailyBars
            height={300}
            currency={currency}
            data={data.days.map((d) => ({ date: d.date, netPnl: d.netPnl }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

const NAV = [
  ["takeaways", "Takeaways"],
  ["performance", "Performance"],
  ["timing", "Timing"],
  ["markets", "Markets"],
  ["consistency", "Consistency"],
  ["discipline", "Discipline"],
  ["statistics", "Statistics"],
] as const;

/** Jump links to each part of the overview. */
function SectionNav() {
  const jump = (id: string) => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  return (
    <nav aria-label="Jump to section" className="flex gap-1.5 overflow-x-auto pb-1">
      <span className="flex shrink-0 items-center pr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Jump to
      </span>
      {NAV.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => jump(id)}
          className="shrink-0 rounded-full border border-border/70 bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
