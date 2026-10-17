"use client";
import { DatePicker } from "@/components/ui/date-picker";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";

import { Suspense, useMemo, useState } from "react";
import {
  Archive,
  CalendarCheck,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Flame,
  Pencil,
  Sparkles,
  Target,
  Trash2,
  Trophy,
} from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { Field, fieldClass } from "@/components/filter-fields";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReviewExport } from "@/components/review-export";
import {
  Heatmap,
  Meter,
  ProgressRing,
  RoutineTable,
  StatTile,
  WeekdayBars,
  WeeklyTrend,
} from "@/components/progress-widgets";
import { useApi, postJson } from "@/lib/use-api";
import {
  STAGES,
  STARTER_ROUTINES,
  WEEKDAY_SHORT,
  addDays,
  dayScores,
  formatDay,
  pct,
  perfectStreaks,
  progressScore,
  rateTone,
  rollingAverage,
  routineStats,
  scheduledRules,
  weekdayScores,
  weeklyScores,
  type Routine,
  type RoutineCheck,
} from "@/lib/progress";

export default function ProgressPage() {
  return (
    <Suspense>
      <Progress />
    </Suspense>
  );
}

function Progress() {
  const { data, error, loading, refresh } = useApi<{
    rules: Routine[];
    checks: RoutineCheck[];
    today: string;
  }>("/api/workspace/progress");
  const [date, setDate] = useState(""),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [title, setTitle] = useState(""),
    [stage, setStage] = useState<string>(STAGES[0]),
    [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false);
  const today = data?.today ?? "",
    selected = date || today,
    rules = data ? scheduledRules(data.rules, selected) : [],
    score = data ? progressScore(data.rules, data.checks, selected) : null;

  const isDone = (ruleId: string) =>
    data?.checks.some((c) => c.ruleId === ruleId && c.date === selected && c.done) ?? false;

  // 13 full weeks (Sunday-aligned) for the heatmap; everything else reads from the same series.
  const analytics = useMemo(() => {
    if (!data) return null;
    const span = 13 * 7 + 6;
    const series = dayScores(data.rules, data.checks, data.today, span);
    return {
      map: new Map(series.map((d) => [d.date, d])),
      last7: rollingAverage(series, 7),
      last30: rollingAverage(series, 30),
      streaks: perfectStreaks(data.rules, data.checks, data.today),
      weeks: weeklyScores(data.rules, data.checks, data.today, 12),
      weekdays: weekdayScores(series.slice(-90)),
      stats: routineStats(data.rules, data.checks, data.today, 30),
    };
  }, [data]);

  const bestWeekday = useMemo(() => {
    const scored = (analytics?.weekdays ?? []).filter((d) => d.score !== null && d.days >= 2);
    if (scored.length < 2) return null;
    return [...scored].sort((a, b) => b.score! - a.score!)[0]!.weekday;
  }, [analytics]);

  function startNew(preset?: { title: string; stage: string }) {
    setEditing(null);
    setTitle(preset?.title ?? "");
    setStage(preset?.stage ?? STAGES[0]);
    setWeekdays([1, 2, 3, 4, 5]);
    setFailure("");
    setOpen(true);
  }
  function startEdit(r: Routine) {
    setEditing(r.id);
    setTitle(r.title);
    setStage(r.stage);
    setWeekdays([...r.weekdays]);
    setFailure("");
    setOpen(true);
  }
  async function act(body: unknown, method: "POST" | "DELETE" | "PATCH" = "POST") {
    setBusy(true);
    try {
      await postJson("/api/workspace/progress", body, method);
      setFailure("");
      refresh();
      return true;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function addStarterPack() {
    setBusy(true);
    try {
      for (const r of STARTER_ROUTINES)
        await postJson("/api/workspace/progress", { ...r, weekdays: [1, 2, 3, 4, 5] });
      setFailure("");
      refresh();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not add the starter routines.");
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function completeStage(stageName: string) {
    const pending = rules.filter((r) => r.stage === stageName && !isDone(r.id));
    if (!pending.length) return;
    setBusy(true);
    try {
      await Promise.all(
        pending.map((r) =>
          postJson("/api/workspace/progress", { ruleId: r.id, date: selected, done: true }),
        ),
      );
      setFailure("");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not save.");
    } finally {
      refresh();
      setBusy(false);
    }
  }

  const future = selected > today;
  const isToday = selected === today;
  const remaining = (score?.total ?? 0) - (score?.completed ?? 0);
  const hasRules = (data?.rules.filter((r) => !r.archivedAt).length ?? 0) > 0;
  const weakest = analytics?.stats
    .filter((s) => s.rate !== null && s.scheduled >= 3)
    .sort((a, b) => a.rate! - b.rate!)[0];
  const weekdayName = bestWeekday === null ? null : WEEKDAY_SHORT[bestWeekday];

  return (
    <div>
      <FilterBar
        title="Progress"
        actions={
          <Button size="sm" onClick={() => startNew()}>
            Add routine
          </Button>
        }
      />
      <div className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Daily routine</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Build a repeatable trading day. Routines are tracked independently of trade filters and
            profit, so a good process still counts on a losing day.
          </p>
        </div>
        {(error || failure) && (
          <p role="alert" className="text-sm text-destructive">
            {error || failure}
          </p>
        )}
        {loading && !data && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading your routines…
          </p>
        )}

        {data && !hasRules && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-5 py-7">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-6 w-6" />
              </span>
              <div className="max-w-2xl flex-1">
                <h3 className="font-semibold">Start with a routine you can repeat</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add the habits that make up your trading day, then tick them off daily to build
                  streaks. Not sure where to start? Add a starter pack of {STARTER_ROUTINES.length}{" "}
                  routines and edit or delete anything you do not want.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void addStarterPack()}>
                  Add starter pack
                </Button>
                <Button variant="outline" onClick={() => startNew()}>
                  Create my own
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="overflow-hidden">
          <CardContent className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <ProgressRing
                score={score?.score ?? null}
                label={`${score?.completed ?? 0} of ${score?.total ?? 0}`}
              />
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {isToday ? "Today" : future ? "Upcoming" : "Reviewing"}
                  </p>
                  <p className="text-xl font-semibold tracking-tight">
                    {selected
                      ? formatDay(selected, { weekday: "long", month: "long", day: "numeric" })
                      : "–"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {!score || score.total === 0
                      ? "Nothing scheduled for this day."
                      : remaining === 0
                        ? "Every routine is done. Nice work."
                        : `${remaining} routine${remaining === 1 ? "" : "s"} left${isToday ? " today" : ""}.`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    aria-label="Previous day"
                    disabled={!data}
                    onClick={() => setDate(addDays(selected, -1))}
                  >
                    <ChevronLeft />
                  </Button>
                  <DatePicker
                    label="Progress date"
                    value={selected}
                    max={today}
                    onValueChange={setDate}
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8"
                    aria-label="Next day"
                    disabled={!data || selected >= today}
                    onClick={() => setDate(addDays(selected, 1))}
                  >
                    <ChevronRight />
                  </Button>
                  {!isToday && (
                    <Button size="sm" variant="ghost" onClick={() => setDate("")}>
                      Jump to today
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <ReviewExport
              document={{
                title: `Routine review · ${selected}`,
                lines: [
                  `Completed: ${score?.completed ?? 0}/${score?.total ?? 0}`,
                  ...rules.map(
                    (r) => `${isDone(r.id) ? "[done]" : "[ ]"} ${r.stage}: ${r.title}`,
                  ),
                ],
              }}
            />
          </CardContent>
        </Card>

        {analytics && hasRules && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              icon={<Flame />}
              label="Current streak"
              value={`${analytics.streaks.current} day${analytics.streaks.current === 1 ? "" : "s"}`}
              hint={`Perfect days in a row · best ${analytics.streaks.best}`}
            />
            <StatTile
              icon={<CalendarCheck />}
              label="Last 7 days"
              value={pct(analytics.last7)}
              tone={rateTone(analytics.last7)}
              hint="Average completion"
            />
            <StatTile
              icon={<Target />}
              label="Last 30 days"
              value={pct(analytics.last30)}
              tone={rateTone(analytics.last30)}
              hint="Average completion"
            />
            <StatTile
              icon={<Trophy />}
              label="Perfect days"
              value={analytics.streaks.perfectDays}
              hint="Every scheduled routine done"
            />
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-3">
          {STAGES.map((s) => {
            const stageRules = rules.filter((r) => r.stage === s);
            const doneCount = stageRules.filter((r) => isDone(r.id)).length;
            const stageScore = stageRules.length ? doneCount / stageRules.length : null;
            return (
              <Card key={s}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{s}</CardTitle>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {doneCount}/{stageRules.length}
                    </span>
                  </div>
                  <Meter value={stageScore} className="mt-2" />
                </CardHeader>
                <CardContent className="space-y-1 pt-3">
                  {stageRules.map((r) => {
                    const done = isDone(r.id);
                    return (
                      <div
                        key={r.id}
                        className="group -mx-2 flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50"
                      >
                        <label
                          className={`flex min-w-0 cursor-pointer items-start gap-3 text-sm ${done ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={done}
                            disabled={busy || future}
                            onCheckedChange={(checked) =>
                              void act({ ruleId: r.id, date: selected, done: checked === true })
                            }
                          />
                          <span className="min-w-0 break-words">{r.title}</span>
                        </label>
                        <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                          {!r.archivedAt && (
                            <>
                              <button
                                className="rounded p-1 hover:bg-accent hover:text-foreground"
                                aria-label={`Edit ${r.title}`}
                                title="Edit"
                                onClick={() => startEdit(r)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                className="rounded p-1 hover:bg-accent hover:text-foreground"
                                aria-label={`Archive ${r.title}`}
                                title="Archive: stops scheduling it, keeps history"
                                onClick={() => {
                                  if (confirm(`Archive “${r.title}”? Previous days are preserved.`))
                                    void act({ id: r.id }, "DELETE");
                                }}
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            className="rounded p-1 hover:bg-accent hover:text-destructive"
                            aria-label={`Delete ${r.title}`}
                            title="Delete permanently"
                            onClick={() => {
                              if (
                                confirm(
                                  `Delete “${r.title}” permanently? Its completion history is removed from every day.`,
                                )
                              )
                                void act({ id: r.id, permanent: true }, "DELETE");
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!stageRules.length && (
                    <p className="py-2 text-xs text-muted-foreground">No routines scheduled.</p>
                  )}
                  <div className="flex items-center justify-between pt-2">
                    <button
                      className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      onClick={() => startNew({ title: "", stage: s })}
                    >
                      + Add to {s.toLowerCase()}
                    </button>
                    {stageRules.length > 0 && doneCount < stageRules.length && !future && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={busy}
                        onClick={() => void completeStage(s)}
                      >
                        <CheckCheck />
                        Mark all done
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {analytics && hasRules && (
          <>
            {(weakest || weekdayName) && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-dashed px-4 py-3 text-sm">
                {weekdayName && (
                  <p>
                    <span className="text-muted-foreground">Strongest day · </span>
                    <strong>{weekdayName}</strong>
                  </p>
                )}
                {weakest && weakest.rate! < 0.8 && (
                  <p className="min-w-0">
                    <span className="text-muted-foreground">Most skipped · </span>
                    <strong className="break-words">{weakest.rule.title}</strong>{" "}
                    <span className="text-muted-foreground">({pct(weakest.rate)})</span>
                  </p>
                )}
              </div>
            )}
            <div className="grid gap-4 xl:grid-cols-3">
              <Card className="xl:col-span-2">
                <CardHeader>
                  <CardTitle>Weekly completion · last 12 weeks</CardTitle>
                </CardHeader>
                <CardContent>
                  <WeeklyTrend weeks={analytics.weeks} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>By weekday · last 90 days</CardTitle>
                </CardHeader>
                <CardContent>
                  <WeekdayBars days={analytics.weekdays} best={bestWeekday} />
                </CardContent>
              </Card>
            </div>
            <RoutineTable stats={analytics.stats} />
            <Card>
              <CardHeader>
                <CardTitle>Last 13 weeks</CardTitle>
              </CardHeader>
              <CardContent>
                <Heatmap
                  days={analytics.map}
                  today={today}
                  selected={selected}
                  onSelect={(d) => setDate(d === today ? "" : d)}
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  Brighter squares mean a higher completion rate. New routines start today, so
                  earlier days stay grey.
                </p>
              </CardContent>
            </Card>
          </>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Edit routine" : "Add a daily routine"}</DialogTitle>
            </DialogHeader>
            <Field label="Routine">
              <input
                className={fieldClass}
                value={title}
                placeholder="Review the economic calendar"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="When">
              <OptionSelect
                className={fieldClass}
                value={stage}
                onValueChange={(next) => setStage(next)}
              >
                {STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </OptionSelect>
            </Field>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Repeats on</p>
                <div className="flex gap-2 text-xs">
                  <button
                    className="underline-offset-4 hover:underline"
                    onClick={() => setWeekdays([1, 2, 3, 4, 5])}
                  >
                    Weekdays
                  </button>
                  <button
                    className="underline-offset-4 hover:underline"
                    onClick={() => setWeekdays([0, 1, 2, 3, 4, 5, 6])}
                  >
                    Every day
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {WEEKDAY_SHORT.map((day, i) => (
                  <label key={day} className="flex items-center gap-1 text-xs">
                    <Checkbox
                      checked={weekdays.includes(i)}
                      onCheckedChange={(checked) =>
                        setWeekdays(
                          checked === true ? [...weekdays, i] : weekdays.filter((n) => n !== i),
                        )
                      }
                    />
                    {day}
                  </label>
                ))}
              </div>
            </div>
            {failure && (
              <p role="alert" className="text-xs text-destructive">
                {failure}
              </p>
            )}
            <Button
              disabled={!title.trim() || !weekdays.length || busy}
              onClick={async () => {
                const saved = editing
                  ? await act({ id: editing, title, stage, weekdays }, "PATCH")
                  : await act({ title, stage, weekdays });
                if (saved) {
                  setOpen(false);
                  setEditing(null);
                  setTitle("");
                }
              }}
            >
              {editing ? "Save changes" : "Add routine"}
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
