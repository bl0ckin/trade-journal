"use client";

import Link from "next/link";
import { dayKeyOf } from "@luxalgo/journal-core";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, NotebookPen, PenLine, Search } from "lucide-react";
import type { DayStats } from "@luxalgo/journal-core";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import Loading from "@/app/loading";
import { useApi } from "@/lib/use-api";
import { stripMarkdown } from "@/lib/note-tools";
import { cn, fmtPercent } from "@/lib/utils";

interface JournalDay {
  date: string;
  stats: DayStats | null;
  hasNote: boolean;
  notePreview: string;
}

type Filter = "all" | "green" | "red" | "noted" | "needs-note";

const PAGE_SIZE = 40;
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);

const traded = (day: JournalDay) => (day.stats?.trades ?? 0) > 0;
const net = (day: JournalDay) => day.stats?.netPnl ?? 0;

export default function JournalPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Journal />
    </Suspense>
  );
}

/** Consecutive most-recent trading days that have a written note. */
function noteStreak(days: JournalDay[]) {
  let streak = 0;
  for (const day of days.filter(traded)) {
    if (!day.hasNote) break;
    streak += 1;
  }
  return streak;
}

function Journal() {
  const { query, timeZone } = useFilters();
  const { data, error, refresh } = useApi<{ days: JournalDay[] }>(`/api/journal?${query}`);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  // Reset the visible window immediately when filters change. Keep every day
  // available without mounting years of cards on the first render.
  const windowKey = `${query}|${filter}|${search}`;
  const [visibleWindow, setVisibleWindow] = useState({ key: windowKey, limit: PAGE_SIZE });
  const limit = visibleWindow.key === windowKey ? visibleWindow.limit : PAGE_SIZE;
  useEffect(() => setVisibleWindow({ key: windowKey, limit: PAGE_SIZE }), [windowKey]);

  const days = useMemo(() => data?.days ?? [], [data]);
  const summary = useMemo(() => {
    const tradingDays = days.filter(traded);
    return {
      tradingDays: tradingDays.length,
      noted: days.filter((d) => d.hasNote).length,
      needsNote: tradingDays.filter((d) => !d.hasNote).length,
      green: tradingDays.filter((d) => net(d) > 0).length,
      red: tradingDays.filter((d) => net(d) < 0).length,
      netPnl: tradingDays.reduce((sum, d) => sum + net(d), 0),
      streak: noteStreak(days),
    };
  }, [days]);
  const coverage = summary.tradingDays
    ? (summary.tradingDays - summary.needsNote) / summary.tradingDays
    : null;

  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      days.filter((day) => {
        if (filter === "green" && !(traded(day) && net(day) > 0)) return false;
        if (filter === "red" && !(traded(day) && net(day) < 0)) return false;
        if (filter === "noted" && !day.hasNote) return false;
        if (filter === "needs-note" && !(traded(day) && !day.hasNote)) return false;
        if (needle && !`${day.date} ${day.notePreview}`.toLowerCase().includes(needle)) return false;
        return true;
      }),
    [days, filter, needle],
  );
  const maxAbs = Math.max(1, ...days.map((day) => Math.abs(net(day))));
  const shown = visible.slice(0, limit);

  // Group the visible window by month, newest first.
  const groups = useMemo(() => {
    const map = new Map<string, JournalDay[]>();
    for (const day of shown) {
      const key = day.date.slice(0, 7);
      map.set(key, [...(map.get(key) ?? []), day]);
    }
    return [...map.entries()];
  }, [shown]);

  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const filters: Array<[Filter, string, number]> = [
    ["all", "All days", days.length],
    ["green", "Green", summary.green],
    ["red", "Red", summary.red],
    ["noted", "With notes", summary.noted],
    ["needs-note", "Needs a note", summary.needsNote],
  ];

  return (
    <div>
      <FilterBar
        title="Daily journal"
        actions={
          <Link
            href={`/journal/${today}?${query}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <PenLine className="size-3.5" aria-hidden />
            Write today
          </Link>
        }
      />
      <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
        {error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            <Button variant="outline" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <div role="status" aria-label="Loading journal" className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-48" />
          </div>
        ) : days.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <CalendarDays className="size-7 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                No trading days yet. Import trades or write your first day note.
              </p>
              <Link
                href={`/journal/${today}?${query}`}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                Write today&apos;s note
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryTile label="Net P&L" detail={`${summary.tradingDays} trading days`}>
                <Pnl value={summary.netPnl} />
              </SummaryTile>
              <SummaryTile label="Green days" detail={`${summary.red} red`}>
                {summary.tradingDays ? fmtPercent(summary.green / summary.tradingDays, 0) : "—"}
              </SummaryTile>
              <SummaryTile
                label="Journaled"
                detail={
                  summary.needsNote
                    ? `${summary.needsNote} trading day${summary.needsNote === 1 ? "" : "s"} still need a note`
                    : "Every trading day has a note"
                }
              >
                {coverage === null ? "—" : fmtPercent(coverage, 0)}
              </SummaryTile>
              <SummaryTile
                label="Note streak"
                detail={summary.streak === 1 ? "day in a row" : "days in a row"}
              >
                {summary.streak}
              </SummaryTile>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Filter days"
                className="flex flex-wrap gap-1.5"
              >
                {filters.map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      filter === key
                        ? "border-primary/50 bg-primary/10 text-foreground"
                        : "border-border/70 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label} <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                ))}
              </div>
              <div className="relative ml-auto w-full sm:w-64">
                <Search
                  className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search notes or dates"
                  aria-label="Search the journal"
                  className="pl-8"
                />
              </div>
            </div>

            {visible.length === 0 ? (
              <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
                No days match this view.
              </p>
            ) : (
              groups.map(([month, monthDays]) => {
                const monthNet = visible
                  .filter((day) => day.date.startsWith(month))
                  .reduce((sum, day) => sum + net(day), 0);
                return (
                  <section key={month} aria-label={monthFormatter.format(atNoon(`${month}-01`))} className="space-y-2">
                    <div className="flex items-baseline justify-between gap-3 px-1 pt-2">
                      <h2 className="text-sm font-semibold tracking-tight">
                        {monthFormatter.format(atNoon(`${month}-01`))}
                      </h2>
                      <span className="text-xs text-muted-foreground">
                        {visible.filter((day) => day.date.startsWith(month)).length} days ·{" "}
                        <Pnl value={monthNet} className="font-medium" />
                      </span>
                    </div>
                    {monthDays.map((day) => (
                      <DayRow
                        key={day.date}
                        day={day}
                        href={`/journal/${day.date}?${query}`}
                        maxAbs={maxAbs}
                        isToday={day.date === today}
                      />
                    ))}
                  </section>
                );
              })
            )}

            {visible.length > PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
                <span role="status">
                  Showing {Math.min(limit, visible.length)} of {visible.length} days
                </span>
                {limit < visible.length && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleWindow({ key: windowKey, limit: limit + PAGE_SIZE })}
                  >
                    Show older days
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums leading-none tracking-tight">{children}</p>
      {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function DayRow({
  day,
  href,
  maxAbs,
  isToday,
}: {
  day: JournalDay;
  href: string;
  maxAbs: number;
  isToday: boolean;
}) {
  const stats = day.stats;
  const hasTrades = traded(day);
  const pnl = net(day);
  const preview = stripMarkdown(day.notePreview);
  const pct = Math.min(100, (Math.abs(pnl) / maxAbs) * 100);
  const decided = (stats?.wins ?? 0) + (stats?.losses ?? 0);
  return (
    <Link href={href} className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card
        className={cn(
          "overflow-hidden transition-all group-hover:-translate-y-px group-hover:border-foreground/30",
          isToday && "border-primary/50",
        )}
      >
        <CardContent className="flex flex-wrap items-stretch gap-x-5 gap-y-3 p-0">
          <div
            className={cn(
              "flex w-full shrink-0 items-center gap-3 border-l-4 px-4 py-3 sm:w-36 sm:flex-col sm:items-start sm:gap-0",
              !hasTrades
                ? "border-l-transparent"
                : pnl > 0
                  ? "border-l-profit"
                  : pnl < 0
                    ? "border-l-loss"
                    : "border-l-muted-foreground/40",
            )}
          >
            <div className="text-2xl font-semibold tabular-nums leading-none">{Number(day.date.slice(8))}</div>
            <div className="text-xs text-muted-foreground sm:mt-1">
              {weekdayFormatter.format(atNoon(day.date))}
              {isToday && <span className="ml-1.5 font-medium text-primary">Today</span>}
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-3 pr-4 sm:pr-0">
            {hasTrades && stats ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <Pnl value={pnl} className="min-w-24 text-base font-semibold" />
                <span className="text-muted-foreground">
                  {stats.trades} trade{stats.trades === 1 ? "" : "s"}
                </span>
                <span className="text-muted-foreground">
                  {decided > 0 ? fmtPercent(stats.wins / decided, 0) : "—"} win · {stats.wins}W / {stats.losses}L
                </span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No trades</span>
            )}
            {hasTrades && (
              <div className="h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted/60" aria-hidden>
                <div
                  className={cn("h-full rounded-full", pnl >= 0 ? "bg-profit" : "bg-loss")}
                  style={{ width: `${Math.max(4, pct)}%` }}
                />
              </div>
            )}
            {preview && <p className="line-clamp-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">{preview}</p>}
          </div>

          <div className="flex items-center px-4 py-3 sm:pl-0">
            {day.hasNote ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground">
                <NotebookPen className="size-3.5" aria-hidden />
                Note
              </span>
            ) : hasTrades ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground transition-colors group-hover:border-primary/60 group-hover:text-primary">
                <PenLine className="size-3.5" aria-hidden />
                Add note
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
