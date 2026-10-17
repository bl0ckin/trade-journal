"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import { calendarTradeHref } from "@/lib/calendar-insights";
import type { CalendarYear, CalendarYearResponse, YearMonth } from "@/lib/calendar-year";
import { cn, fmtMoney, fmtPercent } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { HelpHint } from "./ui/tooltip";
import { Pnl } from "./pnl";
import { MonetaryValue, usePrivacy } from "./privacy";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const PROFIT = "var(--profit-fill, #2b9a6b)";
const LOSS = "var(--loss, #d4565e)";

const compactFormatters = new Map<string, Intl.NumberFormat>();
const compactMoney = (value: number, currency: string) => {
  let formatter = compactFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
      signDisplay: "exceptZero",
    });
    compactFormatters.set(currency, formatter);
  }
  return formatter.format(value);
};

function Stat({
  title,
  value,
  detail,
  hint,
}: {
  title: string;
  value: ReactNode;
  detail?: ReactNode;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{title}</CardTitle>
        {hint && <HelpHint heading={title}>{hint}</HelpHint>}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
        {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      </CardContent>
    </Card>
  );
}

/** Twelve month tiles, shaded like the daily calendar: tint = size, sign = the number. */
function MonthGrid({
  year,
  currency,
  monetary,
  today,
  onOpenMonth,
}: {
  year: CalendarYear;
  currency: string;
  monetary: boolean;
  today: string;
  onOpenMonth: (month: number) => void;
}) {
  const privacy = usePrivacy();
  const maxAbs = Math.max(1, ...year.months.map((m) => Math.abs(m.netPnl)));
  const todayKey = today.slice(0, 7);
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {year.months.map((m) => {
        const traded = m.trades > 0;
        const key = `${year.year}-${String(m.month).padStart(2, "0")}`;
        const isCurrent = key === todayKey;
        const isFuture = key > todayKey;
        const intensity = traded ? 0.1 + 0.38 * (Math.abs(m.netPnl) / maxAbs) : 0;
        const tone = !monetary || m.netPnl === 0 ? "var(--neutral-mid, #888)" : m.netPnl > 0 ? PROFIT : LOSS;
        const decided = m.wins + m.losses;
        return (
          <button
            key={m.month}
            type="button"
            onClick={() => onOpenMonth(m.month)}
            aria-label={`${MONTH_LONG[m.month - 1]} ${year.year}: ${
              !monetary ? "multiple currencies" : privacy ? "P&L hidden" : fmtMoney(m.netPnl, currency)
            }, ${m.trades} trades. Open month.`}
            className={cn(
              "group flex min-h-[7.5rem] min-w-0 flex-col justify-between rounded-xl border p-3 text-left outline-none transition-all hover:-translate-y-0.5 hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring",
              traded ? "border-border/60" : "border-transparent bg-muted/30",
              isCurrent && "ring-1 ring-primary/70",
              isFuture && !traded && "opacity-50",
            )}
            style={
              traded && monetary
                ? { backgroundColor: `color-mix(in oklab, ${tone} ${Math.round(intensity * 100)}%, var(--card))` }
                : undefined
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide">{MONTH_SHORT[m.month - 1]}</span>
              {isCurrent && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                  This month
                </span>
              )}
            </div>
            {traded ? (
              <div className="mt-2">
                <div className="tnum text-lg font-semibold leading-tight sm:text-xl">
                  {monetary ? <MonetaryValue>{compactMoney(m.netPnl, currency)}</MonetaryValue> : "—"}
                </div>
                <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                  <div>
                    {m.trades} trade{m.trades === 1 ? "" : "s"}
                    {monetary && decided > 0 ? ` · ${fmtPercent(m.wins / decided, 0)} win` : ""}
                  </div>
                  <div>
                    {monetary ? `${m.greenDays}/${m.tradingDays} green days` : `${m.tradingDays} trading days`}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{isFuture ? "Upcoming" : "No trades"}</p>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Monthly P&L as columns that rise above or fall below the zero line. */
function MonthlyColumns({ months, currency }: { months: YearMonth[]; currency: string }) {
  const high = Math.max(0, ...months.map((m) => m.netPnl));
  const low = Math.min(0, ...months.map((m) => m.netPnl));
  const range = Math.max(high - low, 1);
  const zero = (high / range) * 100;
  return (
    <div>
      <div className="relative h-44">
        <div
          aria-hidden
          className="absolute inset-x-0 border-t border-dashed border-border"
          style={{ top: `${zero}%` }}
        />
        <div className="absolute inset-0 flex gap-1.5">
          {months.map((m) => {
            const height = (Math.abs(m.netPnl) / range) * 100;
            return (
              <div
                key={m.month}
                className="relative flex-1"
                title={`${MONTH_LONG[m.month - 1]}: ${fmtMoney(m.netPnl, currency)} · ${m.trades} trades`}
              >
                {m.trades > 0 && (
                  <div
                    className="absolute inset-x-0 rounded-sm"
                    style={
                      m.netPnl >= 0
                        ? { bottom: `${100 - zero}%`, height: `${Math.max(height, 1.5)}%`, background: PROFIT }
                        : { top: `${zero}%`, height: `${Math.max(height, 1.5)}%`, background: LOSS }
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1.5 flex gap-1.5 text-[10px] text-muted-foreground">
        {months.map((m) => (
          <span key={m.month} className="flex-1 text-center">
            {MONTH_SHORT[m.month - 1]!.slice(0, 1)}
            <span className="hidden sm:inline">{MONTH_SHORT[m.month - 1]!.slice(1)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Running total at the end of each month. */
function YearToDate({ months, currency }: { months: YearMonth[]; currency: string }) {
  let last = -1;
  months.forEach((m, index) => {
    if (m.trades > 0) last = index;
  });
  const points = months.slice(0, last + 1);
  if (points.length < 2)
    return (
      <p className="flex h-44 items-center justify-center text-center text-xs text-muted-foreground">
        The running total needs at least two months with closed trades.
      </p>
    );
  const values = [0, ...points.map((m) => m.cumulative)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xy = values.map((v, i) => [(i / (values.length - 1)) * 100, 100 - ((v - min) / span) * 100] as const);
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const zeroY = 100 - ((0 - min) / span) * 100;
  const end = values[values.length - 1]!;
  const color = end >= 0 ? PROFIT : LOSS;
  return (
    <div>
      <div className="relative h-44">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Running total by month">
          <line x1="0" x2="100" y1={zeroY} y2={zeroY} stroke="var(--border)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          <path d={`${line} L100,${zeroY} L0,${zeroY} Z`} style={{ fill: color, opacity: 0.12 }} />
          <path d={line} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ stroke: color }} />
        </svg>
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
        <span>Start of year</span>
        <span>
          {MONTH_LONG[points[points.length - 1]!.month - 1]} ·{" "}
          <span className="tnum font-medium text-foreground">
            <MonetaryValue>{fmtMoney(end, currency)}</MonetaryValue>
          </span>
        </span>
      </div>
    </div>
  );
}

export function CalendarYearView({
  data,
  query,
  today,
  onOpenMonth,
}: {
  data: CalendarYearResponse;
  query: string;
  today: string;
  onOpenMonth: (year: number, month: number) => void;
}) {
  const currency = data.currencies[0] ?? "USD";
  const mixed = data.currencyScope?.monetary === false;
  const y = data.year;
  const money = (value: number | null) =>
    value === null || mixed ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <Pnl value={value} currency={currency} />
    );

  if (mixed)
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          These accounts use {data.currencies.join(", ")}. Each currency is shown separately; no exchange-rate
          conversion is applied.
        </p>
        {data.currencyGroups?.map((group) => (
          <Card key={group.currency}>
            <CardHeader>
              <CardTitle>{group.currency} accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthGrid
                year={group.year}
                currency={group.currency}
                monetary
                today={today}
                onOpenMonth={(month) => onOpenMonth(y.year, month)}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    );

  const href = calendarTradeHref(query, data.scope);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{y.year} at a glance</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Closed trades, after fees, by closing month · {data.timeZone} · {currency} · Select a month to open it
          </p>
        </div>
        {y.trades > 0 && (
          <Link
            href={href}
            className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            View matching trades <ArrowUpRight aria-hidden="true" className="size-3.5" />
          </Link>
        )}
      </div>

      {y.trades === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CalendarDays aria-hidden="true" className="mb-1 size-6 text-muted-foreground" />
            <h3 className="text-sm font-medium">No closed trades in {y.year}</h3>
            <p className="max-w-md text-sm text-muted-foreground">
              Pick another year or adjust your account and filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            <Stat
              title="Year net P&L"
              value={money(y.netPnl)}
              detail={`${y.trades} trades across ${y.tradingDays} trading days`}
              hint="Sum of net P&L for every closed trade whose closing day falls in this year. Includes fees."
            />
            <Stat
              title="Profitable months"
              value={
                <>
                  {y.profitableMonths}
                  <span className="text-base font-normal text-muted-foreground"> of {y.activeMonths}</span>
                </>
              }
              detail={y.longestGreenRun > 1 ? `Longest green run: ${y.longestGreenRun} months` : `${y.losingMonths} losing`}
              hint="Months with strictly positive net P&L, out of months that had closed trades."
            />
            <Stat
              title="Average month"
              value={money(y.avgMonth)}
              detail="Across months with closed trades"
              hint="Year net P&L divided by months that had at least one closed trade."
            />
            <Stat
              title="Trade win rate"
              value={fmtPercent(y.winRate)}
              detail={`${y.wins} wins · ${y.losses} losses · ${y.breakevens} break-even`}
              hint="Winning closed trades divided by all closed trades this year."
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Months</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthGrid
                year={y}
                currency={currency}
                monetary
                today={today}
                onOpenMonth={(month) => onOpenMonth(y.year, month)}
              />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-2" aria-hidden="true">
                  Loss
                  <span
                    className="h-2 w-28 rounded-full"
                    style={{
                      background: `linear-gradient(to right, color-mix(in oklab, ${LOSS} 48%, var(--card)), var(--card), color-mix(in oklab, ${PROFIT} 48%, var(--card)))`,
                      boxShadow: "inset 0 0 0 1px var(--border)",
                    }}
                  />
                  Profit
                </span>
                <span>Darker tiles are bigger months.</span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Monthly P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <MonthlyColumns months={y.months} currency={currency} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Running total through the year</CardTitle>
              </CardHeader>
              <CardContent>
                <YearToDate months={y.months} currency={currency} />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Best and worst month</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ["Best month", y.bestMonth] as const,
                  ["Worst month", y.worstMonth] as const,
                ].map(([label, m]) => (
                  <div key={label} className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    {m ? (
                      <button
                        type="button"
                        onClick={() => onOpenMonth(y.year, m.month)}
                        className="inline-flex items-center gap-2 rounded text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {money(m.netPnl)}
                        <span className="text-xs font-normal text-muted-foreground">{MONTH_LONG[m.month - 1]}</span>
                      </button>
                    ) : (
                      money(null)
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  {y.bestMonth && y.netPnl > 0 && y.bestMonth.netPnl > 0
                    ? `${MONTH_LONG[y.bestMonth.month - 1]} accounts for ${fmtPercent(Math.min(1, y.bestMonth.netPnl / y.netPnl), 0)} of the year's net result.`
                    : "Select a month to see its daily calendar."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Best and worst day</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ["Best day", y.bestDay] as const,
                  ["Worst day", y.worstDay] as const,
                ].map(([label, day]) => (
                  <div key={label} className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    {day ? (
                      <Link
                        href={calendarTradeHref(query, data.scope, day.date)}
                        className="inline-flex items-center gap-2 rounded text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {money(day.netPnl)}
                        <span className="text-xs font-normal text-muted-foreground">{day.date}</span>
                        <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
                      </Link>
                    ) : (
                      money(null)
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  {y.greenDays} green and {y.redDays} red days across {y.tradingDays} trading days.
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
