"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { EquityPoint } from "@luxalgo/journal-core";
import type { HistogramBin, TopTrade } from "@/lib/extended-stats";
import { tradePath } from "@/lib/trade-links";
import { fmtMoney, fmtPercent, pnlClass } from "@/lib/utils";
import { MonetaryValue } from "./privacy";

const PROFIT = "var(--profit-fill, #2b9a6b)";
const LOSS = "var(--loss, #d4565e)";

const money = (value: number, currency: string) => (
  <MonetaryValue>{fmtMoney(value, currency)}</MonetaryValue>
);

/* ------------------------------------------------------------------ */
/* Layout helpers                                                      */
/* ------------------------------------------------------------------ */

/** A titled divider that starts each group of cards. `id` makes it a jump target. */
export function SectionHeading({
  title,
  hint,
  id,
}: {
  title: string;
  hint?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className="flex scroll-mt-20 flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-[var(--rpt-line)] pb-3 pt-10 first:pt-2"
    >
      <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
      {hint && <p className="text-[13px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A small status label: a colored dot and plain text. Replaces filled pills. */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "good" | "bad" | "warn" | "neutral";
  children: ReactNode;
}) {
  const styles = {
    good: "text-profit",
    bad: "text-loss",
    warn: "text-amber-600 dark:text-amber-400",
    neutral: "text-muted-foreground",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium ${styles[tone]}`}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** Compact switcher for views inside a card. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-md border border-[var(--rpt-line)] p-0.5">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`whitespace-nowrap rounded-[5px] px-3 py-1 text-[12.5px] font-medium transition-colors ${
            value === key
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Page-level underline tabs. Styled by `.rpt-tab` inside `.report-skin`. */
export function TabBar<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Report views"
      className="flex gap-6 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-[var(--rpt-line)]"
    >
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className="rpt-tab"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Several related panels on one surface, split by hairlines instead of a box each.
 * Keep the panel count equal to the column count so no empty cell shows.
 */
export function PanelGroup({
  panels,
  className = "lg:grid-cols-3",
}: {
  panels: Array<{ title: string; hint?: string; content: ReactNode }>;
  className?: string;
}) {
  return (
    <section className="rpt-surface overflow-hidden rounded-[10px] border border-[var(--rpt-line)] bg-card">
      <div className={`grid gap-px bg-[var(--rpt-line)] ${className}`}>
        {panels.map((panel) => (
          <div key={panel.title} className="min-w-0 bg-card p-5">
            <h3 className="text-[14px] font-semibold tracking-tight">{panel.title}</h3>
            {panel.hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{panel.hint}</p>}
            <div className="mt-4">{panel.content}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * A statement-style grid of figures: hairline dividers instead of a box per figure.
 * Cells wrap with the container, and the dividers stay even.
 */
export function StatGrid({
  items,
  className = "grid-cols-2 sm:grid-cols-4",
}: {
  items: Array<{ label: string; value: ReactNode; sub?: ReactNode }>;
  className?: string;
}) {
  return (
    <dl
      className={`grid gap-px overflow-hidden rounded-lg border border-[var(--rpt-line)] bg-[var(--rpt-line)] ${className}`}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0 bg-card px-4 py-3">
          <dt className="text-[12.5px] text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 break-words text-[19px] font-semibold leading-tight tracking-tight tabular-nums">
            {item.value}
          </dd>
          {item.sub && <p className="mt-1 text-[12px] text-muted-foreground">{item.sub}</p>}
        </div>
      ))}
    </dl>
  );
}

/**
 * A horizontal P&L bar. When the list mixes profits and losses the bars grow out
 * of a centre line (right = profit, left = loss) so direction reads at a glance.
 */
function PnlBar({
  value,
  scale,
  diverging,
  thin = false,
}: {
  value: number;
  scale: number;
  diverging: boolean;
  thin?: boolean;
}) {
  const pct = Math.min(100, (Math.abs(value) / scale) * 100);
  const color = value >= 0 ? PROFIT : LOSS;
  const height = thin ? "h-1" : "h-1.5";
  if (!diverging)
    return (
      <div className={`${height} overflow-hidden rounded-full bg-muted/50`}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(3, pct)}%`, background: color }}
        />
      </div>
    );
  const half = Math.max(1.5, pct / 2);
  return (
    <div className={`relative ${height} rounded-full bg-muted/50`}>
      <div
        className="absolute w-px bg-border"
        style={{ left: "50%", top: -3, bottom: -3 }}
        aria-hidden
      />
      <div
        className="absolute inset-y-0"
        style={
          value >= 0
            ? { left: "50%", width: `${half}%`, background: color, borderRadius: "0 9999px 9999px 0" }
            : { right: "50%", width: `${half}%`, background: color, borderRadius: "9999px 0 0 9999px" }
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drawdown (underwater) chart                                         */
/* ------------------------------------------------------------------ */

/** Money lost from the running peak of cumulative P&L; zero means a new high. */
export function DrawdownArea({
  data,
  currency,
  height = 300,
}: {
  data: EquityPoint[];
  currency: string;
  height?: number;
}) {
  if (data.length === 0)
    return (
      <p className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        No data yet.
      </p>
    );
  let peak = 0;
  const points = data.map((point) => {
    peak = Math.max(peak, point.cumNetPnl);
    return { t: point.t, dd: point.cumNetPnl - peak };
  });
  const worst = Math.min(0, ...points.map((point) => point.dd));
  const width = 1000;
  const span = Math.max(1, points.length - 1);
  const x = (i: number) => (points.length === 1 ? width / 2 : (i / span) * width);
  const y = (dd: number) => (worst === 0 ? 0 : (dd / worst) * 100);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.dd).toFixed(2)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},0 L${x(0).toFixed(1)},0 Z`;
  const current = points[points.length - 1]!.dd;
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-10 gap-y-2">
        <div>
          <p className="text-[12.5px] text-muted-foreground">Max drawdown</p>
          <p className="tnum mt-0.5 text-lg font-semibold tracking-tight text-loss">{money(worst, currency)}</p>
        </div>
        <div>
          <p className="text-[12.5px] text-muted-foreground">Right now</p>
          <p className={`tnum mt-0.5 text-lg font-semibold tracking-tight ${current < 0 ? "text-loss" : "text-profit"}`}>
            {current === 0 ? "At a new high" : money(current, currency)}
          </p>
        </div>
      </div>
      <div className="relative" style={{ height }}>
        <svg
          viewBox={`0 0 ${width} 100`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label="Drawdown from peak"
        >
          <line x1="0" x2={width} y1="0" y2="0" style={{ stroke: "var(--baseline, #30303a)" }} strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={area} style={{ fill: LOSS, opacity: 0.16 }} />
          <path d={line} fill="none" style={{ stroke: LOSS }} strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{points[0]!.t.slice(0, 10)}</span>
        <span>Distance below your equity peak</span>
        <span>{points[points.length - 1]!.t.slice(0, 10)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Trade P&L distribution                                              */
/* ------------------------------------------------------------------ */

export function PnlHistogram({
  bins,
  currency,
  height = 180,
}: {
  bins: HistogramBin[];
  currency: string;
  height?: number;
}) {
  if (bins.length === 0)
    return <p className="py-10 text-center text-sm text-muted-foreground">No closed trades yet.</p>;
  const peak = Math.max(...bins.map((bin) => bin.count), 1);
  const lo = bins[0]!.from;
  const hi = bins[bins.length - 1]!.to;
  const zero = hi > lo ? (0 - lo) / (hi - lo) : -1;
  const showZero = zero > 0 && zero < 1;
  return (
    <div>
      <div className="relative">
        <div className="flex items-end gap-1" style={{ height }}>
          {bins.map((bin) => {
            const positive = bin.from >= 0 && bin.to > 0;
            return (
              <div
                key={`${bin.from}-${bin.to}`}
                className="flex h-full min-w-0 flex-1 flex-col justify-end"
                title={`${fmtMoney(bin.from, currency)} to ${fmtMoney(bin.to, currency)}: ${bin.count} trade${bin.count === 1 ? "" : "s"}`}
              >
                {bin.count > 0 && (
                  <span className="mb-0.5 text-center text-[10px] tabular-nums text-muted-foreground">
                    {bin.count}
                  </span>
                )}
                <div
                  className="w-full rounded-t"
                  style={{
                    height: `${(bin.count / peak) * 100}%`,
                    minHeight: bin.count > 0 ? 3 : 0,
                    background: positive ? PROFIT : LOSS,
                    opacity: bin.count > 0 ? 0.9 : 0,
                  }}
                />
              </div>
            );
          })}
        </div>
        {showZero && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground/50"
            style={{ left: `${zero * 100}%` }}
          >
            <span className="absolute -top-0.5 left-1 text-[10px] text-muted-foreground">break-even</span>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{money(lo, currency)}</span>
        <span>Net P&L per trade · bar height = number of trades</span>
        <span>{money(hi, currency)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ranked horizontal bars (symbols, weekdays, tags, ...)               */
/* ------------------------------------------------------------------ */

export interface BarRow {
  key: string;
  label: string;
  netPnl: number;
  trades: number;
  winRate: number | null;
}

export function BarList({
  rows,
  currency,
  empty = "No data yet.",
  limit = 12,
}: {
  rows: BarRow[];
  currency: string;
  empty?: string;
  limit?: number;
}) {
  if (rows.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  const shown = rows.slice(0, limit);
  const scale = Math.max(...shown.map((row) => Math.abs(row.netPnl)), 1);
  const diverging = shown.some((row) => row.netPnl > 0) && shown.some((row) => row.netPnl < 0);
  return (
    <ul className="divide-y divide-[var(--rpt-line)] [&>li]:py-2.5 [&>li:first-child]:pt-0">
      {shown.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-[minmax(3.5rem,6.5rem)_1fr_auto] items-center gap-4"
          title={`${row.trades} trades · win rate ${fmtPercent(row.winRate, 0)}`}
        >
          <span className="truncate text-[13.5px] font-medium" title={row.label}>
            {row.label}
          </span>
          <PnlBar value={row.netPnl} scale={scale} diverging={diverging} />
          <span className={`tnum min-w-[5.5rem] text-right text-[13.5px] font-medium ${pnlClass(row.netPnl)}`}>
            {money(row.netPnl, currency)}
            <span className="block text-[12px] font-normal text-muted-foreground">
              {row.trades} trade{row.trades === 1 ? "" : "s"} · {fmtPercent(row.winRate, 0)} win
            </span>
          </span>
        </li>
      ))}
      {rows.length > shown.length && (
        <li className="!border-t-0 pt-3 text-[12.5px] text-muted-foreground">
          Showing {shown.length} of {rows.length}. Breakdowns lists them all.
        </li>
      )}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Breakdown views: each question gets the chart that suits it         */
/* ------------------------------------------------------------------ */

const compactMoney = (value: number, currency: string) => {
  try {
    const text = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(Math.abs(value));
    return `${value < 0 ? "-" : value > 0 ? "+" : ""}${text}`;
  } catch {
    return fmtMoney(value, currency);
  }
};

/** A win rate as 0 to 1; missing or non-numeric values (no decided trades) count as 0. */
const winShare = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const SERIES = [
  "var(--series-1, #4c9bff)",
  "var(--series-3, #2ec9a0)",
  "var(--series-7, #a393ff)",
  "var(--series-4, #f2b53c)",
  "var(--series-5, #ef7fb0)",
  "var(--series-2, #f08a4b)",
];

/** Day of week as seven columns: up for profit, down for loss, best day outlined. */
export function WeekdayColumns({ rows, currency }: { rows: BarRow[]; currency: string }) {
  if (rows.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>;
  const scale = Math.max(...rows.map((row) => Math.abs(row.netPnl)), 1);
  const best = rows.reduce((a, b) => (b.netPnl > a.netPnl ? b : a), rows[0]!);
  const hasLoss = rows.some((row) => row.netPnl < 0);
  const half = hasLoss ? 64 : 120;
  return (
    <div className="grid grid-cols-7 gap-1.5 sm:gap-2.5">
      {rows.map((row) => {
        const height = Math.max((Math.abs(row.netPnl) / scale) * half, row.netPnl === 0 ? 0 : 3);
        const empty = row.trades === 0;
        return (
          <div
            key={row.key}
            className="flex min-w-0 flex-col items-center text-center"
            title={`${row.label}: ${row.trades} trades · win rate ${fmtPercent(row.winRate, 0)}`}
          >
            <div
              className="relative flex w-full flex-col items-center"
              style={{ height: hasLoss ? half * 2 : half }}
            >
              <div
                className="absolute left-0 right-0 border-t border-dashed border-[var(--rpt-line)]"
                style={{ top: hasLoss ? half : half }}
              />
              {row.netPnl !== 0 && (
                <div
                  className={`absolute w-full max-w-9 rounded-sm ${row.key === best.key && best.netPnl > 0 ? "ring-2 ring-offset-1 ring-offset-card ring-[var(--profit-fill,#2b9a6b)]" : ""}`}
                  style={{
                    height,
                    background: row.netPnl > 0 ? PROFIT : LOSS,
                    ...(row.netPnl > 0 ? { bottom: hasLoss ? half : 0 } : { top: half }),
                    opacity: empty ? 0.3 : 1,
                  }}
                />
              )}
            </div>
            <span className="mt-1.5 text-[12.5px] font-medium">{row.label}</span>
            <span className={`tnum text-[11.5px] font-medium ${pnlClass(row.netPnl)}`}>
              <MonetaryValue>{empty ? "–" : compactMoney(row.netPnl, currency)}</MonetaryValue>
            </span>
            <span className="text-[11px] text-muted-foreground">
              {empty ? "no trades" : `${row.trades} · ${fmtPercent(row.winRate, 0)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Holding time as tiles whose width follows how many trades fall in each bucket. */
export function DurationTiles({ rows, currency }: { rows: BarRow[]; currency: string }) {
  if (rows.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>;
  const total = rows.reduce((sum, row) => sum + row.trades, 0) || 1;
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((row) => (
        <div
          key={row.key}
          className="min-w-[6.5rem] overflow-hidden rounded-lg border bg-muted/20"
          style={{ flexGrow: Math.max(row.trades, 1), flexBasis: "6.5rem" }}
          title={`${row.trades} trades · win rate ${fmtPercent(row.winRate, 0)}`}
        >
          <div className="h-1" style={{ background: row.netPnl >= 0 ? PROFIT : LOSS }} />
          <div className="space-y-1 p-2.5">
            <p className="text-[12.5px] font-medium">{row.label}</p>
            <p className={`tnum text-base font-semibold ${pnlClass(row.netPnl)}`}>
              {money(row.netPnl, currency)}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(winShare(row.winRate) * 100)}%`, background: PROFIT }}
              />
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              {fmtPercent(row.winRate, 0)} win · {row.trades} trade{row.trades === 1 ? "" : "s"} (
              {Math.round((row.trades / total) * 100)}%)
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Symbols as a ranked leaderboard with a win-rate meter per row. */
export function SymbolLeaderboard({
  rows,
  currency,
  limit = 8,
}: {
  rows: BarRow[];
  currency: string;
  limit?: number;
}) {
  if (rows.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>;
  const shown = rows.slice(0, limit);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
            <th className="w-7 pb-1.5 font-medium">#</th>
            <th className="pb-1.5 font-medium">Symbol</th>
            <th className="pb-1.5 text-right font-medium">Trades</th>
            <th className="hidden w-28 pb-1.5 pl-4 font-medium sm:table-cell">Win rate</th>
            <th className="pb-1.5 text-right font-medium">Net P&L</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--rpt-line)]">
          {shown.map((row, index) => (
            <tr key={row.key}>
              <td className="py-2 text-muted-foreground tnum">{index + 1}</td>
              <td className="py-2 font-semibold">{row.label}</td>
              <td className="py-2 text-right tnum text-muted-foreground">{row.trades}</td>
              <td className="hidden py-2 pl-4 sm:table-cell">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.round(winShare(row.winRate) * 100)}%`,
                        background: winShare(row.winRate) >= 0.5 ? PROFIT : LOSS,
                      }}
                    />
                  </div>
                  <span className="tnum text-[12px] text-muted-foreground">
                    {fmtPercent(row.winRate, 0)}
                  </span>
                </div>
              </td>
              <td className={`py-2 text-right tnum font-medium ${pnlClass(row.netPnl)}`}>
                {money(row.netPnl, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <p className="pt-2 text-[12.5px] text-muted-foreground">
          Showing {shown.length} of {rows.length}. Breakdowns lists them all.
        </p>
      )}
    </div>
  );
}

/** Markets as one share bar (by number of trades) with a legend of results. */
export function MarketShare({
  rows,
  currency,
  empty = "No data yet.",
}: {
  rows: BarRow[];
  currency: string;
  empty?: string;
}) {
  if (rows.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  const total = rows.reduce((sum, row) => sum + row.trades, 0) || 1;
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[12px] text-muted-foreground">Share of your trades</p>
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
          {rows.map((row, index) => (
            <div
              key={row.key}
              title={`${row.label}: ${row.trades} trades`}
              style={{
                width: `${(row.trades / total) * 100}%`,
                background: SERIES[index % SERIES.length],
                minWidth: row.trades > 0 ? 4 : 0,
              }}
            />
          ))}
        </div>
      </div>
      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li key={row.key} className="flex items-center gap-3 text-[13px]">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: SERIES[index % SERIES.length] }}
            />
            <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
            <span className="tnum text-muted-foreground">
              {Math.round((row.trades / total) * 100)}% · {fmtPercent(row.winRate, 0)} win
            </span>
            <span className={`tnum w-24 text-right font-medium ${pnlClass(row.netPnl)}`}>
              {money(row.netPnl, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Monthly performance                                                 */
/* ------------------------------------------------------------------ */

interface DayLike {
  date: string;
  netPnl: number;
  trades: number;
  wins: number;
  losses: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function MonthlyTable({ days, currency }: { days: DayLike[]; currency: string }) {
  const months = new Map<string, { pnl: number; trades: number; wins: number; losses: number; days: number; green: number }>();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    const m = months.get(key) ?? { pnl: 0, trades: 0, wins: 0, losses: 0, days: 0, green: 0 };
    m.pnl += day.netPnl;
    m.trades += day.trades;
    m.wins += day.wins;
    m.losses += day.losses;
    m.days += 1;
    if (day.netPnl > 0) m.green += 1;
    months.set(key, m);
  }
  const rows = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 18);
  if (rows.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">No data yet.</p>;
  const scale = Math.max(...rows.map(([, m]) => Math.abs(m.pnl)), 1);
  const diverging = rows.some(([, m]) => m.pnl > 0) && rows.some(([, m]) => m.pnl < 0);
  const profitable = rows.filter(([, m]) => m.pnl > 0).length;
  return (
    <div>
      <p className="mb-3 text-[13px] text-muted-foreground">
        {profitable} of {rows.length} recent month{rows.length === 1 ? "" : "s"} finished in profit.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-[12.5px] text-muted-foreground">
            <tr className="border-b border-[var(--rpt-line-strong)]">
              <th className="py-2 pr-3 text-left font-medium">Month</th>
              <th className="px-3 py-2 text-right font-medium">Trades</th>
              <th className="px-3 py-2 text-right font-medium">Win rate</th>
              <th className="px-3 py-2 text-right font-medium">Green days</th>
              <th className="w-1/3 px-3 py-2 text-left font-medium">
                <span className="sr-only">Result</span>
              </th>
              <th className="py-2 pl-3 text-right font-medium">Net P&L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, m]) => {
              const decided = m.wins + m.losses;
              return (
                <tr key={key} className="border-b border-[var(--rpt-line)] last:border-0">
                  <td className="py-2.5 pr-3 font-medium">
                    {MONTHS[Number(key.slice(5, 7)) - 1]} {key.slice(0, 4)}
                  </td>
                  <td className="tnum px-3 text-right text-muted-foreground">{m.trades}</td>
                  <td className="tnum px-3 text-right">{decided ? fmtPercent(m.wins / decided, 0) : "—"}</td>
                  <td className="tnum px-3 text-right text-muted-foreground">
                    {m.green}/{m.days}
                  </td>
                  <td className="px-3">
                    <PnlBar value={m.pnl} scale={scale} diverging={diverging} thin />
                  </td>
                  <td className={`tnum py-2.5 pl-3 text-right font-medium ${pnlClass(m.pnl)}`}>
                    {money(m.pnl, currency)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Best and worst trades                                               */
/* ------------------------------------------------------------------ */

export function TopTrades({
  trades,
  currency,
  empty,
}: {
  trades: TopTrade[];
  currency: string;
  empty: string;
}): ReactNode {
  if (trades.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-[var(--rpt-line)]">
      {trades.map((trade, index) => (
        <li key={trade.key}>
          <Link
            href={tradePath(trade.key)}
            className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-foreground/[0.03]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="tnum w-4 shrink-0 text-xs text-muted-foreground">{index + 1}</span>
              <span className="min-w-0">
                <span className="font-medium">{trade.symbol}</span>{" "}
                <span
                  className={`text-[12px] font-medium capitalize ${trade.direction === "long" ? "text-profit" : "text-loss"}`}
                >
                  {trade.direction}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {trade.closedAt ? trade.closedAt.slice(0, 10) : ""}
                </span>
              </span>
            </span>
            <span className={`tnum text-sm font-semibold ${pnlClass(trade.netPnl)}`}>
              {money(trade.netPnl, currency)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
