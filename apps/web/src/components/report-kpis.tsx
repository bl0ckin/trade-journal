"use client";

import type { ReactNode } from "react";
import type { EquityPoint, TradeMetrics } from "@luxalgo/journal-core";
import type { ExtendedStats } from "@/lib/extended-stats";
import { fmtMoney, fmtNumber, fmtPercent, pnlClass } from "@/lib/utils";
import { MonetaryValue } from "./privacy";
import { Badge } from "./report-charts";

const PROFIT = "var(--profit-fill, #2b9a6b)";
const LOSS = "var(--loss, #d4565e)";

const money = (value: number, currency: string) => (
  <MonetaryValue>{fmtMoney(value, currency)}</MonetaryValue>
);

type Tone = "good" | "bad" | "warn" | "neutral";

function KpiCard({
  label,
  children,
  caption,
  footer,
  accent,
  verdict,
  className = "",
  large = false,
}: {
  label: string;
  children: ReactNode;
  caption?: ReactNode;
  footer?: ReactNode;
  accent?: ReactNode;
  verdict?: { tone: Tone; text: string };
  className?: string;
  large?: boolean;
}) {
  return (
    <div
      className={`card-sheen flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-border/70 bg-card p-4 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </p>
            {verdict && <Badge tone={verdict.tone}>{verdict.text}</Badge>}
          </div>
          <div
            className={`mt-2 break-words font-semibold tabular-nums leading-none tracking-tight ${
              large ? "text-3xl sm:text-4xl" : "text-2xl"
            }`}
          >
            {children}
          </div>
          {caption && <p className="mt-2 text-xs leading-snug text-muted-foreground">{caption}</p>}
        </div>
        {accent}
      </div>
      {footer && <div className="text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** A circular gauge for a 0..1 ratio. */
function Ring({ value, size = 56 }: { value: number; size?: number }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(1, value)) * circumference;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden className="shrink-0 -rotate-90">
      <circle cx="28" cy="28" r={radius} fill="none" strokeWidth="6" style={{ stroke: "var(--border, #2c2c2a)" }} />
      <circle
        cx="28"
        cy="28"
        r={radius}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circumference}`}
        style={{ stroke: PROFIT }}
      />
    </svg>
  );
}

/** Cumulative P&L line with a soft fill underneath. */
function Sparkline({ data }: { data: EquityPoint[] }) {
  if (data.length < 2) return null;
  const values = data.map((point) => point.cumNetPnl);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 100 - ((v - min) / span) * 100] as const);
  const path = pts.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`).join(" ");
  const area = `${path} L100,100 L0,100 Z`;
  const up = values[values.length - 1]! >= 0;
  const color = up ? PROFIT : LOSS;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-14 w-32 shrink-0 sm:w-44" aria-hidden>
      <path d={area} style={{ fill: color, opacity: 0.12 }} />
      <path d={path} fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{ stroke: color }} />
    </svg>
  );
}

/** A two-part proportion bar (for example gross profit against gross loss). */
function Split({ left, right }: { left: number; right: number }) {
  const total = left + right;
  const share = total > 0 ? (left / total) * 100 : 50;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
      <div style={{ width: `${share}%`, background: PROFIT }} />
      <div style={{ width: `${100 - share}%`, background: LOSS }} />
    </div>
  );
}

const profitFactorVerdict = (metrics: TradeMetrics): { tone: Tone; text: string } | undefined => {
  if (metrics.profitFactorIsInfinite) return { tone: "good", text: "No losses" };
  const pf = metrics.profitFactor;
  if (pf === null) return undefined;
  if (pf >= 2) return { tone: "good", text: "Strong" };
  if (pf >= 1.3) return { tone: "good", text: "Healthy" };
  if (pf >= 1) return { tone: "warn", text: "Thin" };
  return { tone: "bad", text: "Losing" };
};

export function KpiStrip({
  metrics,
  extended,
  daily,
  currency,
}: {
  metrics: TradeMetrics;
  extended: ExtendedStats;
  daily: EquityPoint[];
  currency: string;
}) {
  const winLoss =
    metrics.avgWin !== null && metrics.avgLoss !== null && metrics.avgLoss !== 0
      ? metrics.avgWin / Math.abs(metrics.avgLoss)
      : null;
  const breakEven = extended.breakEvenWinRate;
  const winVerdict: { tone: Tone; text: string } | undefined =
    metrics.winRate === null || breakEven === null
      ? undefined
      : metrics.winRate >= breakEven
        ? { tone: "good", text: "Above break-even" }
        : { tone: "bad", text: "Below break-even" };
  const expectancyVerdict: { tone: Tone; text: string } | undefined =
    metrics.expectancy === null
      ? undefined
      : metrics.expectancy > 0
        ? { tone: "good", text: "Positive edge" }
        : metrics.expectancy < 0
          ? { tone: "bad", text: "Negative edge" }
          : undefined;
  const payoffVerdict: { tone: Tone; text: string } | undefined =
    winLoss === null ? undefined : winLoss >= 1 ? { tone: "good", text: "Winners > losers" } : { tone: "warn", text: "Winners < losers" };

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard
        large
        className="col-span-2"
        label="Net P&L"
        accent={<Sparkline data={daily} />}
        caption={
          <>
            {money(metrics.grossPnl, currency)} gross, after {money(-metrics.fees, currency)} in fees
          </>
        }
      >
        <span className={pnlClass(metrics.netPnl)}>{money(metrics.netPnl, currency)}</span>
      </KpiCard>

      <KpiCard
        label="Win rate"
        verdict={winVerdict}
        accent={<Ring value={metrics.winRate ?? 0} />}
        caption={breakEven === null ? undefined : `Break-even at your win/loss size: ${fmtPercent(breakEven, 0)}`}
        footer={`${metrics.wins}W · ${metrics.losses}L · ${metrics.breakevens}BE`}
      >
        {fmtPercent(metrics.winRate, 1)}
      </KpiCard>

      <KpiCard
        label="Profit factor"
        verdict={profitFactorVerdict(metrics)}
        caption="Gross profit ÷ gross loss. Above 1 means you make money."
        footer={<Split left={extended.grossProfit} right={Math.abs(extended.grossLoss)} />}
      >
        {metrics.profitFactorIsInfinite ? "∞" : metrics.profitFactor === null ? "—" : fmtNumber(metrics.profitFactor)}
      </KpiCard>

      <KpiCard
        label="Win / loss size"
        verdict={payoffVerdict}
        caption="Average winner relative to average loser."
        footer={
          <span className="flex justify-between gap-2">
            <span className="text-profit">{metrics.avgWin === null ? "—" : money(metrics.avgWin, currency)}</span>
            <span className="text-loss">{metrics.avgLoss === null ? "—" : money(metrics.avgLoss, currency)}</span>
          </span>
        }
      >
        {winLoss === null ? "—" : `${fmtNumber(winLoss)}×`}
      </KpiCard>

      <KpiCard
        label="Expectancy"
        verdict={expectancyVerdict}
        caption={
          extended.medianTrade === null
            ? "Average result per trade."
            : <>Average per trade · median {money(extended.medianTrade, currency)}</>
        }
      >
        {metrics.expectancy === null ? (
          "—"
        ) : (
          <span className={pnlClass(metrics.expectancy)}>{money(metrics.expectancy, currency)}</span>
        )}
      </KpiCard>

      <KpiCard
        label="Max drawdown"
        caption="Largest drop from an equity peak."
        footer={
          <>
            {metrics.maxDrawdownPct === null ? "" : `${fmtPercent(metrics.maxDrawdownPct, 1)} · `}
            Recovery factor {metrics.recoveryFactor === null ? "—" : fmtNumber(metrics.recoveryFactor)}
          </>
        }
      >
        <span className="text-loss">{money(metrics.maxDrawdown, currency)}</span>
      </KpiCard>

      <KpiCard
        label="Closed trades"
        caption={`Across ${fmtNumber(metrics.tradingDays, 0)} trading day${metrics.tradingDays === 1 ? "" : "s"}`}
        footer={
          metrics.tradingDays > 0
            ? `${fmtNumber(metrics.closedTrades / metrics.tradingDays, 1)} trades per day`
            : undefined
        }
      >
        {fmtNumber(metrics.closedTrades, 0)}
      </KpiCard>
    </div>
  );
}

/** Wins, losses and break-evens as a donut with a legend. */
export function OutcomeDonut({ metrics }: { metrics: TradeMetrics }) {
  const total = metrics.wins + metrics.losses + metrics.breakevens;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const parts = [
    { label: "Wins", value: metrics.wins, color: PROFIT },
    { label: "Losses", value: metrics.losses, color: LOSS },
    { label: "Break-even", value: metrics.breakevens, color: "var(--ink-muted, #898781)" },
  ];
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label="Trade outcomes">
          <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="12" style={{ stroke: "var(--border, #2c2c2a)" }} />
          {total > 0 &&
            parts.map((part) => {
              if (part.value === 0) return null;
              const length = (part.value / total) * circumference;
              const circle = (
                <circle
                  key={part.label}
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  strokeWidth="12"
                  strokeDasharray={`${Math.max(0, length - 1.5)} ${circumference}`}
                  strokeDashoffset={-offset}
                  style={{ stroke: part.color }}
                />
              );
              offset += length;
              return circle;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums">{total}</span>
          <span className="text-[11px] text-muted-foreground">trades</span>
        </div>
      </div>
      <ul className="space-y-2 text-sm">
        {parts.map((part) => (
          <li key={part.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: part.color }} />
            <span className="w-20 text-muted-foreground">{part.label}</span>
            <span className="tnum font-medium">{part.value}</span>
            <span className="tnum text-xs text-muted-foreground">
              {total > 0 ? fmtPercent(part.value / total, 0) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Average win against average loss, drawn to the same scale. */
export function PayoffBars({
  metrics,
  extended,
  currency,
}: {
  metrics: TradeMetrics;
  extended: ExtendedStats;
  currency: string;
}) {
  const win = metrics.avgWin ?? 0;
  const loss = Math.abs(metrics.avgLoss ?? 0);
  const scale = Math.max(win, loss, 1);
  const rows = [
    { label: "Average win", value: win, shown: metrics.avgWin, color: PROFIT },
    { label: "Average loss", value: loss, shown: metrics.avgLoss, color: LOSS },
    { label: "Largest win", value: Math.max(0, extended.largestWin ?? 0), shown: extended.largestWin, color: PROFIT },
    { label: "Largest loss", value: Math.abs(extended.largestLoss ?? 0), shown: extended.largestLoss, color: LOSS },
  ];
  const scaleAll = Math.max(scale, ...rows.map((row) => row.value));
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="tnum font-medium">
              {row.shown === null ? "—" : money(row.shown, currency)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted/60">
            <div
              className="h-full rounded-full"
              style={{ width: `${(row.value / scaleAll) * 100}%`, background: row.color }}
            />
          </div>
        </div>
      ))}
      <p className="pt-1 text-xs text-muted-foreground">
        {extended.payoffRatio === null
          ? "Needs at least one win and one loss."
          : `You make ${fmtNumber(extended.payoffRatio)}× what you lose on an average trade. At that ratio you break even at a ${fmtPercent(extended.breakEvenWinRate, 0)} win rate.`}
      </p>
    </div>
  );
}
