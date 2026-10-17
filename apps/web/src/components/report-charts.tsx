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
      className="flex scroll-mt-20 flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-border/60 pb-2 pt-8 first:pt-2"
    >
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Small rounded pill used for verdicts and counts. */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "good" | "bad" | "warn" | "neutral";
  children: ReactNode;
}) {
  const styles = {
    good: "bg-profit/10 text-profit",
    bad: "bg-loss/10 text-loss",
    warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    neutral: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

/** Compact pill switcher for views inside a card. */
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
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border/70 bg-muted/40 p-0.5">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`whitespace-nowrap rounded-md px-3 py-1 text-xs font-medium transition-all ${
            value === key
              ? "bg-card text-foreground shadow-sm ring-1 ring-border/70"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Page-level underline tabs. */
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
      className="-mx-1 flex overflow-x-auto border-b border-border/70 px-1"
    >
      {options.map(([key, label]) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`relative whitespace-nowrap px-3.5 py-2.5 text-sm font-medium transition-colors ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
            <span
              aria-hidden
              className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full transition-opacity ${
                active ? "bg-primary opacity-100" : "bg-transparent opacity-0"
              }`}
            />
          </button>
        );
      })}
    </div>
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
  const height = thin ? "h-1.5" : "h-2";
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
      <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Max drawdown</p>
          <p className="tnum mt-0.5 text-sm font-semibold text-loss">{money(worst, currency)}</p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Right now</p>
          <p className={`tnum mt-0.5 text-sm font-semibold ${current < 0 ? "text-loss" : "text-profit"}`}>
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
    <ul className="space-y-3">
      {shown.map((row) => (
        <li
          key={row.key}
          className="grid grid-cols-[minmax(3.5rem,6.5rem)_1fr_auto] items-center gap-3"
          title={`${row.trades} trades · win rate ${fmtPercent(row.winRate, 0)}`}
        >
          <span className="truncate text-sm font-medium" title={row.label}>
            {row.label}
          </span>
          <PnlBar value={row.netPnl} scale={scale} diverging={diverging} />
          <span className={`tnum min-w-[5.5rem] text-right text-sm font-medium ${pnlClass(row.netPnl)}`}>
            {money(row.netPnl, currency)}
            <span className="block text-[10px] font-normal text-muted-foreground">
              {row.trades} trade{row.trades === 1 ? "" : "s"} · {fmtPercent(row.winRate, 0)} win
            </span>
          </span>
        </li>
      ))}
      {rows.length > shown.length && (
        <li className="pt-1 text-xs text-muted-foreground">
          Showing {shown.length} of {rows.length}. Breakdowns lists them all.
        </li>
      )}
    </ul>
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
      <p className="mb-3 text-xs text-muted-foreground">
        {profitable} of {rows.length} recent month{rows.length === 1 ? "" : "s"} finished in profit.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border/70">
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
                <tr key={key} className="border-b border-border/40 transition-colors last:border-0 hover:bg-accent/30">
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
    <ul className="divide-y divide-border/50">
      {trades.map((trade, index) => (
        <li key={trade.key}>
          <Link
            href={tradePath(trade.key)}
            className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent/40"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="tnum w-4 shrink-0 text-xs text-muted-foreground">{index + 1}</span>
              <span className="min-w-0">
                <span className="font-medium">{trade.symbol}</span>{" "}
                <span
                  className={`text-[11px] font-medium uppercase tracking-wide ${trade.direction === "long" ? "text-profit" : "text-loss"}`}
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
