"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKeyOf } from "@luxalgo/journal-core";
import { CurrencyNotice } from "@/components/currency-notice";
import { CalendarPnl } from "@/components/calendar-pnl";
import { CalendarYearView } from "@/components/calendar-year";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/use-api";
import { CalendarPerformance } from "@/components/calendar-insights";
import type { CalendarResponse } from "@/lib/calendar-insights";
import type { CalendarYearResponse } from "@/lib/calendar-year";
import Loading from "@/app/loading";

type View = "month" | "year";

export default function CalendarPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CalendarView />
    </Suspense>
  );
}

/** Keyboard shortcuts must never fire while typing or while a dialog is open. */
const shortcutsAllowed = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return false;
  return !document.querySelector("[role='dialog']");
};

function CalendarView() {
  const { query, timeZone } = useFilters();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // The view lives in the URL so a refresh or a shared link keeps it.
  const view: View = params.get("view") === "year" ? "year" : "month";
  const [selection, setMonth] = useState<{ year: number; month: number } | null>(null);
  const [yearSelection, setYear] = useState<number | null>(null);
  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const todayYear = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7));

  const monthApi = useApi<CalendarResponse>(
    view === "month"
      ? `/api/calendar?${query}${selection ? `&calYear=${selection.year}&calMonth=${selection.month}` : ""}`
      : null,
  );
  const yearApi = useApi<CalendarYearResponse>(
    view === "year" ? `/api/calendar/year?${query}&calYear=${yearSelection ?? todayYear}` : null,
  );
  const { data, error, refresh } = monthApi;

  const month = selection ??
    data?.calendar ?? { year: todayYear, month: todayMonth };
  const year = yearSelection ?? todayYear;

  const setView = (next: View) => {
    if (next === view) return;
    const nextParams = new URLSearchParams(params.toString());
    if (next === "year") {
      nextParams.set("view", "year");
      setYear(month.year);
    } else {
      nextParams.delete("view");
      // Land on the month that matches the year being viewed.
      if (year !== month.year) setMonth({ year, month: year === todayYear ? todayMonth : 12 });
    }
    const qs = nextParams.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const openMonth = (targetYear: number, targetMonth: number) => {
    setMonth({ year: targetYear, month: targetMonth });
    const nextParams = new URLSearchParams(params.toString());
    nextParams.delete("view");
    const qs = nextParams.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const shift = (delta: number) => {
    if (view === "year") {
      setYear(year + delta);
      return;
    }
    const next = new Date(Date.UTC(month.year, month.month - 1 + delta, 1));
    setMonth({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 });
  };
  const goToday = () => {
    setMonth(null);
    setYear(null);
  };
  const atToday =
    view === "year"
      ? year === todayYear
      : month.year === todayYear && month.month === todayMonth;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shortcutsAllowed(event)) return;
      if (event.key === "ArrowLeft") shift(-1);
      else if (event.key === "ArrowRight") shift(1);
      else if (event.key.toLowerCase() === "t") goToday();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const monthLabel = new Date(Date.UTC(month.year, month.month - 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const scope = view === "year" ? yearApi.data?.currencyScope : data?.currencyScope;
  const monetary = data ? data.currencies.length <= 1 : true;
  const currency = data?.currencies[0] ?? "USD";

  return (
    <div>
      <FilterBar
        title="Calendar"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Calendar view"
              className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-0.5"
            >
              {(["month", "year"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-all ${
                    view === option
                      ? "bg-card text-foreground shadow-sm ring-1 ring-border/70"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => shift(-1)}
                aria-label={view === "year" ? "Previous year" : "Previous month"}
              >
                <ChevronLeft />
              </Button>
              <span
                className={`${view === "year" ? "w-20" : "w-36"} text-center text-sm font-medium tabular-nums`}
                aria-live="polite"
              >
                {view === "year" ? year : monthLabel}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => shift(1)}
                aria-label={view === "year" ? "Next year" : "Next month"}
              >
                <ChevronRight />
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={goToday} disabled={atToday}>
              Today
            </Button>
          </div>
        }
      />
      {scope && <CurrencyNotice scope={scope} />}
      <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 sm:p-6">
        {view === "year" ? (
          yearApi.error ? (
            <Card>
              <CardContent className="space-y-3 py-6 text-sm" role="alert">
                <p className="text-destructive">{yearApi.error}</p>
                <Button variant="outline" onClick={yearApi.refresh}>
                  Try again
                </Button>
              </CardContent>
            </Card>
          ) : yearApi.data ? (
            <CalendarYearView data={yearApi.data} query={query} today={today} onOpenMonth={openMonth} />
          ) : (
            <div role="status" aria-label="Loading yearly calendar" className="space-y-4">
              <div className="grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-28" />
                ))}
              </div>
              <Skeleton className="h-96" />
            </div>
          )
        ) : (
          <>
            <Card>
              <CardContent className="pt-4">
                {data?.calendar && monetary && data.currencyScope?.monetary !== false && (
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {monthLabel}
                      </p>
                      <p className="mt-1 text-3xl font-semibold tabular-nums leading-none tracking-tight">
                        <Pnl value={data.calendar.monthNetPnl} currency={currency} />
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {data.calendar.tradingDays} trading day{data.calendar.tradingDays === 1 ? "" : "s"} ·{" "}
                      {data.calendar.winningDays} green
                      <span className="hidden sm:inline"> · ← → to change month, T for today</span>
                    </p>
                  </div>
                )}
                {error ? (
                  <div role="alert" className="space-y-3 py-6 text-sm">
                    <p className="text-destructive">{error}</p>
                    <Button variant="outline" onClick={refresh}>
                      Try again
                    </Button>
                  </div>
                ) : data?.currencyScope?.monetary === false ? (
                  <div className="space-y-6">
                    {data.currencyGroups?.map((group) => (
                      <div key={group.currency}>
                        <p className="mb-3 text-sm font-medium">{group.currency} accounts</p>
                        <CalendarPnl calendar={group.calendar} currency={group.currency} today={today} />
                      </div>
                    ))}
                  </div>
                ) : data ? (
                  <CalendarPnl
                    calendar={data.calendar}
                    currency={currency}
                    monetary={monetary}
                    runningPnl={data.runningPnl}
                    today={today}
                  />
                ) : (
                  <div role="status" aria-label="Loading calendar">
                    <Skeleton className="h-96" />
                  </div>
                )}
              </CardContent>
            </Card>
            {data && data.currencyScope?.monetary !== false && (
              <CalendarPerformance
                key={`${data.calendar.year}-${data.calendar.month}-${query}`}
                data={data}
                query={query}
              />
            )}
            {!data && !error && (
              <div
                role="status"
                aria-label="Loading performance insights"
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              >
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-28" />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
