"use client";
import { AiRecap } from "@/components/ai-recap";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, use, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { dayKeyOf, type IntradayPoint, type TradeMetrics } from "@luxalgo/journal-core";
import { EquityArea } from "@/components/charts/equity-area";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { MonetaryValue } from "@/components/privacy";
import { VoiceNote } from "@/components/voice-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { Attachments } from "@/components/attachments";
import { ReviewExport } from "@/components/review-export";
import { useAutosave } from "@/lib/use-autosave";
import { useApi } from "@/lib/use-api";
import { DAY_PROMPTS, wordCount } from "@/lib/note-tools";
import { cn, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";

interface TradeRowLite {
  key: string;
  symbol: string;
  direction: string;
  status: string;
  netPnl: number;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  fees: number;
}

interface DayPayload {
  date: string;
  metrics: TradeMetrics;
  trades: TradeRowLite[];
  intraday: IntradayPoint[];
  note: string;
}

const longDate = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Arrow-key navigation must never fire while typing or while a dialog is open. */
const shortcutsAllowed = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return false;
  return !document.querySelector("[role='dialog']");
};

export default function JournalDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  return (
    <Suspense>
      <JournalDay key={date} date={date} />
    </Suspense>
  );
}

function JournalDay({ date }: { date: string }) {
  const { query, values: filters, timeZone } = useFilters();
  const router = useRouter();
  const { data, error } = useApi<DayPayload>(`/api/journal/${date}?${query}`);
  const chronology = useApi<{ days: { date: string }[] }>(`/api/journal?${query}`);
  const [note, setNote] = useState<string | null>(null);
  const noteEditor = useRef<RichEditorHandle>(null);
  const [noteEditing, setNoteEditing] = useState(false);
  const { save, status: saving, flush } = useAutosave(`/api/journal/${date}`, "PUT");
  const noteValue = note ?? data?.note ?? "";
  const latestNote = useRef(noteValue);
  latestNote.current = noteValue;
  const scheduleSave = (value: string) => {
    latestNote.current = value;
    setNote(value);
    save({ note: value });
  };

  // The journal list is newest first, so older days come later in the array.
  const dates = chronology.data?.days.map((day) => day.date) ?? [];
  const older = dates.find((other) => other < date) ?? null;
  const newer = [...dates].reverse().find((other) => other > date) ?? null;
  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const hrefFor = (target: string) => `/journal/${target}?${query}`;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shortcutsAllowed(event)) return;
      if (event.key === "ArrowLeft" && older) router.push(hrefFor(older));
      else if (event.key === "ArrowRight" && newer) router.push(hrefFor(newer));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const addPrompt = (content: string) => {
    const current = latestNote.current.trimEnd();
    scheduleSave(current ? `${current}\n\n${content}` : content);
    noteEditor.current?.focus();
  };

  const m = data?.metrics;
  const closed = data?.trades.filter((trade) => trade.status !== "open") ?? [];
  const maxAbs = Math.max(1, ...closed.map((trade) => Math.abs(trade.netPnl)));
  const best = closed.length > 1 ? closed.reduce((a, b) => (b.netPnl > a.netPnl ? b : a)) : null;
  const worst = closed.length > 1 ? closed.reduce((a, b) => (b.netPnl < a.netPnl ? b : a)) : null;
  const words = wordCount(noteValue);
  const decided = m ? m.wins + m.losses : 0;

  return (
    <div>
      <FilterBar title={`Journal · ${date}`} />
      <div className="mx-auto w-full max-w-[1500px] space-y-3 p-4 sm:p-6">
        {/* Day header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {date === today ? "Today" : "Daily journal"}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
              {longDate.format(new Date(`${date}T12:00:00Z`))}
            </h1>
          </div>
          <nav aria-label="Change day" className="flex items-center gap-1.5">
            <Button
              asChild={Boolean(older)}
              variant="outline"
              size="sm"
              disabled={!older}
              aria-label="Previous journal day"
            >
              {older ? (
                <Link href={hrefFor(older)}>
                  <ChevronLeft />
                  <span className="hidden sm:inline">{older}</span>
                </Link>
              ) : (
                <span>
                  <ChevronLeft />
                </span>
              )}
            </Button>
            {date !== today && (
              <Button asChild variant="outline" size="sm">
                <Link href={hrefFor(today)}>Today</Link>
              </Button>
            )}
            <Button
              asChild={Boolean(newer)}
              variant="outline"
              size="sm"
              disabled={!newer}
              aria-label="Next journal day"
            >
              {newer ? (
                <Link href={hrefFor(newer)}>
                  <span className="hidden sm:inline">{newer}</span>
                  <ChevronRight />
                </Link>
              ) : (
                <span>
                  <ChevronRight />
                </span>
              )}
            </Button>
          </nav>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            {m && m.closedTrades > 0 ? (
              <Card>
                <CardContent className="space-y-5 pt-5">
                  <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        Net P&L
                      </p>
                      <p className="mt-1 text-4xl font-semibold leading-none tracking-tight">
                        <Pnl value={m.netPnl} />
                      </p>
                    </div>
                    <div className="min-w-48 flex-1 sm:max-w-xs">
                      <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                        <span>
                          {m.wins} win{m.wins === 1 ? "" : "s"}
                        </span>
                        <span>
                          {m.losses} loss{m.losses === 1 ? "" : "es"}
                        </span>
                      </div>
                      <div className="flex h-2 overflow-hidden rounded-full bg-muted/60" aria-hidden>
                        {decided > 0 && (
                          <>
                            <div className="bg-profit" style={{ width: `${(m.wins / decided) * 100}%` }} />
                            <div className="bg-loss" style={{ width: `${(m.losses / decided) * 100}%` }} />
                          </>
                        )}
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {fmtPercent(m.winRate, 0)} win rate over {m.closedTrades} trade
                        {m.closedTrades === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-5">
                    <Stat label="Gross">
                      <MonetaryValue>{fmtMoney(m.grossPnl)}</MonetaryValue>
                    </Stat>
                    <Stat label="Fees">
                      <MonetaryValue>{fmtMoney(m.fees)}</MonetaryValue>
                    </Stat>
                    <Stat label="Profit factor">
                      {m.profitFactorIsInfinite
                        ? "∞"
                        : m.profitFactor === null
                          ? "–"
                          : fmtNumber(m.profitFactor)}
                    </Stat>
                    <Stat label="Expectancy">
                      <MonetaryValue>{m.expectancy === null ? "–" : fmtMoney(m.expectancy)}</MonetaryValue>
                    </Stat>
                    <Stat label="Avg win / loss">
                      <MonetaryValue>{m.avgWin === null ? "–" : fmtMoney(m.avgWin)}</MonetaryValue>
                      <span className="text-muted-foreground"> / </span>
                      <MonetaryValue>{m.avgLoss === null ? "–" : fmtMoney(m.avgLoss)}</MonetaryValue>
                    </Stat>
                    <Stat label="Volume">{fmtNumber(m.totalVolume, 0)}</Stat>
                    {best && (
                      <Stat label="Best trade">
                        <span className="font-medium">{best.symbol}</span>{" "}
                        <Pnl value={best.netPnl} />
                      </Stat>
                    )}
                    {worst && (
                      <Stat label="Worst trade">
                        <span className="font-medium">{worst.symbol}</span>{" "}
                        <Pnl value={worst.netPnl} />
                      </Stat>
                    )}
                  </dl>
                </CardContent>
              </Card>
            ) : (
              m && (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    No closed trades this day. Use the note to plan or review.
                  </CardContent>
                </Card>
              )
            )}

            {data && data.intraday.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Intraday cumulative net P&L</CardTitle>
                </CardHeader>
                <CardContent>
                  <EquityArea
                    data={data.intraday.map((p) => ({
                      t: p.t.slice(11, 16),
                      cumNetPnl: p.cumNetPnl,
                    }))}
                    height={200}
                  />
                </CardContent>
              </Card>
            )}

            {data && data.trades.length > 0 && (
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle>Trades</CardTitle>
                  <span className="text-xs text-muted-foreground">{data.trades.length} total</span>
                </CardHeader>
                <CardContent className="space-y-0.5">
                  {data.trades.map((trade) => (
                    <Link
                      key={trade.key}
                      href={`/trades/${encodeURIComponent(trade.key)}?${query}`}
                      className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 rounded-lg px-2.5 py-2.5 text-sm transition-colors hover:bg-accent/60"
                    >
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            trade.status === "win"
                              ? "profit"
                              : trade.status === "loss"
                                ? "loss"
                                : trade.status === "open"
                                  ? "open"
                                  : "secondary"
                          }
                        >
                          {trade.status.toUpperCase()}
                        </Badge>
                        <span className="font-medium">{trade.symbol}</span>
                        <span
                          className={cn(
                            "text-[11px] font-medium uppercase tracking-wide",
                            trade.direction === "long" ? "text-profit" : "text-loss",
                          )}
                        >
                          {trade.direction}
                        </span>
                        {best?.key === trade.key && (
                          <span className="rounded-full bg-profit/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-profit">
                            Best
                          </span>
                        )}
                        {worst?.key === trade.key && (
                          <span className="rounded-full bg-loss/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-loss">
                            Worst
                          </span>
                        )}
                      </span>
                      <Pnl value={trade.netPnl} className="text-right font-medium" />
                      <span className="tnum text-xs text-muted-foreground">
                        {fmtNumber(trade.quantity, 4)} @{" "}
                        <MonetaryValue>{fmtNumber(trade.avgEntry)}</MonetaryValue>
                        {trade.avgExit !== null && (
                          <>
                            {" "}
                            → <MonetaryValue>{fmtNumber(trade.avgExit)}</MonetaryValue>
                          </>
                        )}
                      </span>
                      <span
                        className="h-1 w-24 justify-self-end overflow-hidden rounded-full bg-muted/60"
                        aria-hidden
                      >
                        {trade.status !== "open" && (
                          <span
                            className={cn(
                              "block h-full rounded-full",
                              trade.netPnl >= 0 ? "bg-profit" : "bg-loss",
                            )}
                            style={{ width: `${Math.max(6, (Math.abs(trade.netPnl) / maxAbs) * 100)}%` }}
                          />
                        )}
                      </span>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}
            {!data && <Skeleton className="h-64" />}
          </div>

          <Card className="h-fit">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>Day note</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {words} {words === 1 ? "word" : "words"}
                </span>
                <VoiceNote
                  onPrepare={() => noteEditor.current?.focus()}
                  onText={(text) =>
                    scheduleSave(
                      noteValue ? `${noteValue}${noteValue.endsWith(" ") ? "" : " "}${text}` : text,
                    )
                  }
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Add a section">
                {DAY_PROMPTS.map((prompt) => {
                  const used = noteValue.includes(prompt.content.split("\n")[0]!);
                  return (
                    <button
                      key={prompt.id}
                      type="button"
                      disabled={!data || used}
                      onClick={() => addPrompt(prompt.content)}
                      className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border/70 disabled:hover:text-muted-foreground"
                    >
                      <Plus className="size-3" aria-hidden />
                      {prompt.label}
                    </button>
                  );
                })}
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                This note is shared across accounts. AI recaps use the selected filters and append a
                labeled section. Shared notes are excluded from filtered AI context.
              </p>
              <div className="mb-3">
                <AiRecap
                  key={`${date}:${timeZone}:${query}`}
                  date={date}
                  filters={filters}
                  timeZone={timeZone}
                  disabled={!data || !m?.closedTrades}
                  onRecap={({ recap, scope }) => {
                    // Append to the current draft, including edits made while AI was running.
                    const section = `## AI recap\n\n${scope.label.replace(/[\\`*_{}\[\]<>#]/g, "").replace(/[\r\n]+/g, " ")}\n\n${recap}`;
                    scheduleSave(
                      latestNote.current ? `${latestNote.current}\n\n---\n\n${section}` : section,
                    );
                  }}
                />
              </div>
              {data ? (
                <RichEditor
                  editorRef={noteEditor}
                  value={noteValue}
                  onChange={scheduleSave}
                  onModeChange={(next) => setNoteEditing(next === "edit")}
                />
              ) : error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : (
                <Skeleton className="h-48" />
              )}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span role="status">{saving}</span>
                <Button variant="ghost" size="sm" onClick={() => void flush()}>
                  Save now
                </Button>
              </div>
              <Attachments type="day" id={date} editable={noteEditing} />
              <ReviewExport
                containsFinancialData
                document={{
                  title: `Daily review · ${date}`,
                  subtitle: query ? `Filters: ${query}` : "All accounts",
                  lines: [
                    `Closed trades: ${m?.closedTrades ?? 0} | Net P&L: ${m?.netPnl.toFixed(2) ?? "0.00"}`,
                    "",
                    noteValue,
                  ],
                }}
              />
              <p className="mt-3 hidden text-[11px] text-muted-foreground xl:block">
                Tip: use ← and → to move between journal days.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/30 px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tnum mt-0.5 break-words text-sm font-medium">{children}</dd>
    </div>
  );
}
