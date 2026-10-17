"use client";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HoverHint } from "@/components/ui/tooltip";
import {
  addDays,
  formatDay,
  pct,
  rateTone,
  type DayScore,
  type RoutineStat,
  type WeekScore,
} from "@/lib/progress";

/** Circular completion meter. The number is always printed; the arc only reinforces it. */
export function ProgressRing({
  score,
  size = 132,
  label,
}: {
  score: number | null;
  size?: number;
  label?: ReactNode;
}) {
  const stroke = 10,
    r = (size - stroke) / 2,
    c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={score === 1 ? "var(--profit-fill)" : "var(--brand)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (score ?? 0))}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums tracking-tight">{pct(score)}</span>
        {label && <span className="mt-0.5 text-[11px] text-muted-foreground">{label}</span>}
      </div>
    </div>
  );
}

export function StatTile({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-3.5">
            {icon}
          </span>
          {label}
        </div>
        <p className={`mt-3 text-2xl font-semibold tabular-nums tracking-tight ${tone ?? ""}`}>
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

/** Thin labelled completion bar used on each stage card. */
export function Meter({ value, className = "" }: { value: number | null; className?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-muted ${className}`}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${(value ?? 0) * 100}%`,
          background: value === 1 ? "var(--profit-fill)" : "var(--brand)",
          transition: "width 400ms cubic-bezier(.2,.8,.2,1)",
        }}
      />
    </div>
  );
}

/** Vertical bars from 0–100%, with the value printed above each bar. */
function Bars({
  items,
  highlight,
}: {
  items: { key: string; label: string; score: number | null; title: string; minor?: boolean }[];
  highlight?: string;
}) {
  return (
    <div className="flex h-40 items-end gap-1.5 sm:gap-2">
      {items.map((item) => (
        <HoverHint key={item.key} heading={item.title} content={`${pct(item.score)} completed`}>
          <div className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {item.score === null ? "" : pct(item.score)}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-md transition-all duration-500"
                style={{
                  height: item.score === null ? 3 : `${Math.max(3, item.score * 100)}%`,
                  background:
                    item.score === null
                      ? "var(--muted)"
                      : `color-mix(in srgb, var(--brand) ${item.key === highlight ? 100 : 55}%, var(--card))`,
                }}
              />
            </div>
            <span
              className={`text-[10px] ${item.minor ? "invisible sm:visible" : ""} ${item.key === highlight ? "font-semibold text-foreground" : "text-muted-foreground"}`}
            >
              {item.label}
            </span>
          </div>
        </HoverHint>
      ))}
    </div>
  );
}

export function WeeklyTrend({ weeks }: { weeks: WeekScore[] }) {
  const last = weeks.at(-1)?.start;
  return (
    <Bars
      highlight={last}
      items={weeks.map((w, i) => ({
        minor: (weeks.length - 1 - i) % 2 === 1,
        key: w.start,
        label: formatDay(w.start, { month: "short", day: "numeric" }).replace(" ", " "),
        score: w.score,
        title: `Week of ${formatDay(w.start, { month: "short", day: "numeric" })}`,
      }))}
    />
  );
}

export function WeekdayBars({
  days,
  best,
}: {
  days: { weekday: number; label: string; score: number | null }[];
  best: number | null;
}) {
  return (
    <Bars
      highlight={best === null ? undefined : String(best)}
      items={days.map((d) => ({
        key: String(d.weekday),
        label: d.label,
        score: d.score,
        title: d.label,
      }))}
    />
  );
}

function cellColor(d: DayScore) {
  if (d.score === null) return "var(--muted)";
  if (d.score === 0) return "color-mix(in srgb, var(--loss) 28%, var(--card))";
  return `color-mix(in srgb, var(--brand) ${25 + d.score * 70}%, var(--card))`;
}

/** 13-week calendar heatmap, one column per week starting on Sunday so weekdays line up. */
export function Heatmap({
  days,
  today,
  selected,
  onSelect,
}: {
  days: Map<string, DayScore>;
  today: string;
  selected: string;
  onSelect: (date: string) => void;
}) {
  const WEEKS = 13;
  const thisWeek = addDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay());
  const first = addDays(thisWeek, -(WEEKS - 1) * 7);
  const columns = Array.from({ length: WEEKS }, (_, w) => {
    const start = addDays(first, w * 7);
    return {
      start,
      cells: Array.from({ length: 7 }, (_, d) => addDays(start, d)),
    };
  });
  return (
    <div className="max-w-[30rem]">
      <div className="flex gap-1.5">
        <div className="mt-5 grid grid-rows-7 gap-1 pr-1 text-[10px] text-muted-foreground">
          {["", "Mon", "", "Wed", "", "Fri", ""].map((l, i) => (
            <span key={i} className="flex items-center">
              {l}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 gap-1">
          {columns.map((col, i) => {
            const month = formatDay(col.start, { month: "short" });
            const prev = i ? formatDay(columns[i - 1]!.start, { month: "short" }) : "";
            return (
              <div key={col.start} className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="h-4 whitespace-nowrap text-[10px] text-muted-foreground">
                  {month !== prev ? month : ""}
                </span>
                {col.cells.map((date) => {
                  const d = days.get(date);
                  if (!d || date > today) return <span key={date} className="aspect-square" />;
                  return (
                    <HoverHint
                      key={date}
                      heading={formatDay(date, { weekday: "short", month: "short", day: "numeric" })}
                      content={
                        d.total
                          ? `${d.completed} of ${d.total} routines completed`
                          : "Nothing scheduled"
                      }
                    >
                      <button
                        aria-label={`${date}: ${d.completed}/${d.total} complete`}
                        aria-pressed={selected === date}
                        onClick={() => onSelect(date)}
                        className={`aspect-square w-full rounded-[5px] outline-offset-1 transition-transform hover:scale-110 focus-visible:outline-2 ${
                          selected === date
                            ? "outline outline-2 outline-foreground"
                            : date === today
                              ? "outline outline-1 outline-foreground/40"
                              : ""
                        }`}
                        style={{ background: cellColor(d) }}
                      />
                    </HoverHint>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
        {[
          ["Nothing scheduled", "var(--muted)"],
          ["Missed all", "color-mix(in srgb, var(--loss) 28%, var(--card))"],
          ["Partial", "color-mix(in srgb, var(--brand) 55%, var(--card))"],
          ["Perfect", "color-mix(in srgb, var(--brand) 95%, var(--card))"],
        ].map(([name, color]) => (
          <span key={name} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[4px]" style={{ background: color }} />
            {name}
          </span>
        ))}
        <span className="ml-auto">Click a day to review it</span>
      </div>
    </div>
  );
}

/** Last 14 days as dots: filled = done, hollow = missed, tiny = not scheduled. */
function Dots({ recent }: { recent: (boolean | null)[] }) {
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {recent.map((s, i) => (
        <span
          key={i}
          className={`rounded-full ${s === null ? "h-1 w-1 bg-muted-foreground/30" : "h-2.5 w-2.5"}`}
          style={
            s === true
              ? { background: "var(--profit-fill)" }
              : s === false
                ? { boxShadow: "inset 0 0 0 1.5px var(--loss)" }
                : undefined
          }
        />
      ))}
    </div>
  );
}

export function RoutineTable({ stats }: { stats: RoutineStat[] }) {
  const rated = stats.filter((s) => s.rate !== null);
  const weakest = rated.length > 1 ? [...rated].sort((a, b) => a.rate! - b.rate!)[0] : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Routine consistency · last 30 days</CardTitle>
      </CardHeader>
      <CardContent>
        {stats.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No routines yet.</p>
        ) : (
          <div className="divide-y">
            {stats.map((s) => (
              <div
                key={s.rule.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_4rem_4.5rem]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{s.rule.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.rule.stage}
                    {weakest?.rule.id === s.rule.id && s.rate! < 0.8 && (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                        Needs attention
                      </span>
                    )}
                  </p>
                </div>
                <div className="hidden sm:block">
                  <Dots recent={s.recent} />
                </div>
                <p className={`text-right text-sm font-medium tabular-nums ${rateTone(s.rate)}`}>
                  {pct(s.rate)}
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {s.completed}/{s.scheduled}
                  </span>
                </p>
                <p className="text-right text-xs tabular-nums text-muted-foreground">
                  {s.streak > 0 ? `${s.streak} in a row` : "–"}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
