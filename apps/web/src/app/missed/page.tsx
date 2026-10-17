"use client";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";

import { Suspense, useMemo, useState, type ReactNode } from "react";
import { Archive, ArchiveRestore, Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { Field, fieldClass } from "@/components/filter-fields";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RichEditor, Markdown } from "@/components/rich-editor";
import { Attachments } from "@/components/attachments";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { AttachmentQueue, uploadAttachments } from "@/components/attachment-queue";
import { ReviewExport } from "@/components/review-export";
import { MonetaryValue, MonetaryField } from "@/components/privacy";
import { useApi, postJson } from "@/lib/use-api";
import { cn } from "@/lib/utils";
interface MissedTrade {
  id: string;
  symbol: string;
  direction: string;
  observedAt: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  playbookId: string | null;
  notes: string;
  archivedAt: string | null;
}
/** Quick answers to "why did I miss it?". The choice is saved as the first line of the note. */
const REASONS = [
  "Hesitated",
  "Was not at my screen",
  "Missed the alert",
  "Afraid after a loss",
  "Setup was unclear",
  "Already in another trade",
  "Overthought it",
];
const REASON_LINE = /^\*\*Reason:\*\*.*$/m;
const reasonOf = (notes: string) => /^\*\*Reason:\*\*\s*(.+)$/m.exec(notes)?.[1]?.trim() ?? null;
const withReason = (notes: string, reason: string) => {
  const line = `**Reason:** ${reason}`;
  if (REASON_LINE.test(notes)) return notes.replace(REASON_LINE, line);
  return notes.trim() ? `${line}\n\n${notes}` : `${line}\n\n`;
};
const withoutReason = (notes: string) => notes.replace(REASON_LINE, "").trim();

/** Risk, reward and their ratio for a planned setup, or null when the levels do not form one. */
function plan(t: Pick<MissedTrade, "direction" | "entry" | "stop" | "target">) {
  if (t.entry === null || t.stop === null || t.target === null) return null;
  const risk = t.direction === "long" ? t.entry - t.stop : t.stop - t.entry;
  const reward = t.direction === "long" ? t.target - t.entry : t.entry - t.target;
  if (!(risk > 0) || !(reward > 0)) return null;
  return { risk, reward, ratio: reward / risk };
}

const ago = (iso: string) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
};

const blank = () => ({
  symbol: "",
  direction: "long",
  observedAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16),
  entry: "",
  stop: "",
  target: "",
  playbookId: "",
  notes: "",
});
export default function MissedPage() {
  return (
    <Suspense>
      <MissedView />
    </Suspense>
  );
}
function MissedView() {
  const { data, error, refresh } = useApi<{ trades: MissedTrade[] }>("/api/workspace/missed"),
    { data: books } = useApi<{ playbooks: { id: string; name: string }[] }>("/api/playbooks");
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState(blank),
    [search, setSearch] = useState(""),
    [archived, setArchived] = useState(false),
    [side, setSide] = useState<"all" | "long" | "short">("all"),
    [bookFilter, setBookFilter] = useState(""),
    [sort, setSort] = useState<"newest" | "oldest" | "symbol" | "rr">("newest"),
    [failure, setFailure] = useState(""),
    [pendingFiles, setPendingFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false);
  function edit(t?: MissedTrade, similar = false) {
    setEditing(similar ? null : (t?.id ?? null));
    setDraft(
      t
        ? {
            symbol: t.symbol,
            direction: t.direction,
            observedAt: similar
              ? blank().observedAt
              : new Date(
                  Date.parse(t.observedAt) - new Date(t.observedAt).getTimezoneOffset() * 60000,
                )
                  .toISOString()
                  .slice(0, 16),
            entry: t.entry?.toString() ?? "",
            stop: t.stop?.toString() ?? "",
            target: t.target?.toString() ?? "",
            playbookId: t.playbookId ?? "",
            notes: similar ? "" : t.notes,
          }
        : blank(),
    );
    setFailure("");
    setPendingFiles([]);
    setOpen(true);
  }
  const active = data?.trades.filter((t) => !t.archivedAt) ?? [];
  const rows = useMemo(() => {
    const needle = search.toLowerCase();
    const list = (data?.trades ?? []).filter(
      (t) =>
        Boolean(t.archivedAt) === archived &&
        (side === "all" || t.direction === side) &&
        (!bookFilter || (bookFilter === "none" ? !t.playbookId : t.playbookId === bookFilter)) &&
        `${t.symbol} ${t.notes}`.toLowerCase().includes(needle),
    );
    return list.sort((a, b) =>
      sort === "oldest"
        ? a.observedAt.localeCompare(b.observedAt)
        : sort === "symbol"
          ? a.symbol.localeCompare(b.symbol)
          : sort === "rr"
            ? (plan(b)?.ratio ?? -1) - (plan(a)?.ratio ?? -1)
            : b.observedAt.localeCompare(a.observedAt),
    );
  }, [data, archived, side, bookFilter, search, sort]);

  // Patterns across every active (not archived) opportunity.
  const insights = useMemo(() => {
    const tally = (keys: (string | null)[]) => {
      const counts = new Map<string, number>();
      for (const key of keys) if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    };
    const ratios = active.map((t) => plan(t)?.ratio).filter((r): r is number => r !== undefined);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return {
      thisMonth: active.filter((t) => Date.parse(t.observedAt) >= monthStart.getTime()).length,
      longs: active.filter((t) => t.direction === "long").length,
      shorts: active.filter((t) => t.direction === "short").length,
      topSymbol: tally(active.map((t) => t.symbol)),
      topReason: tally(active.map((t) => reasonOf(t.notes))),
      topBook: tally(
        active.map((t) => books?.playbooks.find((b) => b.id === t.playbookId)?.name ?? null),
      ),
      avgRatio: ratios.length ? ratios.reduce((sum, r) => sum + r, 0) / ratios.length : null,
    };
  }, [active, books]);
  const archivedCount = (data?.trades.length ?? 0) - active.length;
  const formField = (
    key: "symbol" | "observedAt" | "entry" | "stop" | "target",
    label: string,
    type = "text",
  ) => (
    <Field label={label}>
      <MonetaryField sensitive={type === "number"}>
        <input
          className={fieldClass}
          type={type}
          step={type === "number" ? "any" : undefined}
          value={draft[key]}
          style={key === "symbol" ? { textTransform: "uppercase" } : undefined}
          onChange={(e) =>
            setDraft({
              ...draft,
              [key]: key === "symbol" ? e.target.value.toUpperCase() : e.target.value,
            })
          }
        />
      </MonetaryField>
    </Field>
  );
  return (
    <div>
      <FilterBar
        title="Missed trades"
        actions={
          <Button size="sm" onClick={() => edit()}>
            <Plus />
            Log opportunity
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 sm:p-6">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Record setups you watched but did not take. These observations never enter your trade
          count, P&L, or win rate. Use them to spot why you hesitate.
        </p>

        {active.length > 0 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
            <Tile label="Logged" detail={`${insights.thisMonth} this month`}>
              {active.length}
            </Tile>
            <Tile
              label="Long / short"
              detail={
                insights.longs + insights.shorts
                  ? `${Math.round((insights.longs / (insights.longs + insights.shorts)) * 100)}% long`
                  : undefined
              }
            >
              {insights.longs} / {insights.shorts}
            </Tile>
            <Tile
              label="Most missed symbol"
              detail={insights.topSymbol ? `${insights.topSymbol[1]} times` : "Nothing yet"}
            >
              {insights.topSymbol?.[0] ?? "—"}
            </Tile>
            <Tile
              label="Top reason"
              detail={
                insights.topReason
                  ? `${insights.topReason[1]} time${insights.topReason[1] === 1 ? "" : "s"}`
                  : "Pick a reason when logging"
              }
            >
              <span className="text-lg leading-tight">{insights.topReason?.[0] ?? "—"}</span>
            </Tile>
            <Tile
              label="Avg planned R:R"
              detail={insights.topBook ? `Most in ${insights.topBook[0]}` : "Needs entry, stop and target"}
            >
              {insights.avgRatio === null ? "—" : `${insights.avgRatio.toFixed(1)}R`}
            </Tile>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Direction" className="inline-flex rounded-lg border border-border/70 bg-muted/40 p-0.5">
            {(["all", "long", "short"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={side === value}
                onClick={() => setSide(value)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium capitalize transition-all",
                  side === value
                    ? "bg-card text-foreground shadow-sm ring-1 ring-border/70"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <OptionSelect
            aria-label="Filter by strategy"
            className="h-9 w-44 rounded-lg border bg-background px-2 text-sm"
            value={bookFilter}
            onValueChange={setBookFilter}
          >
            <option value="">All strategies</option>
            <option value="none">No strategy</option>
            {books?.playbooks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </OptionSelect>
          <OptionSelect
            aria-label="Sort opportunities"
            className="h-9 w-40 rounded-lg border bg-background px-2 text-sm"
            value={sort}
            onValueChange={(value) => setSort(value as typeof sort)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="symbol">Symbol A to Z</option>
            <option value="rr">Best planned R:R</option>
          </OptionSelect>
          <input
            aria-label="Search missed trades"
            className={`${fieldClass} max-w-xs`}
            placeholder="Search symbol or notes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="ml-auto flex items-center gap-2 text-sm">
            <Checkbox
              checked={archived}
              onCheckedChange={(checked) => setArchived(checked === true)}
            />
            Show archived{archivedCount > 0 && ` (${archivedCount})`}
          </label>
        </div>
        {(error || failure) && (
          <p role="alert" className="text-sm text-destructive">
            {error || failure}
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {rows.map((t) => {
            const levels = plan(t);
            const reason = reasonOf(t.notes);
            const notes = withoutReason(t.notes);
            return (
              <Card key={t.id} className={cn("overflow-hidden", t.archivedAt && "opacity-70")}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <span className="text-base font-semibold text-foreground">{t.symbol}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          t.direction === "long" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss",
                        )}
                      >
                        {t.direction}
                      </span>
                    </CardTitle>
                    <div className="flex items-center gap-0.5">
                      <IconButton label="Edit" onClick={() => edit(t)}>
                        <Pencil />
                      </IconButton>
                      <IconButton label="Log a similar setup" onClick={() => edit(t, true)}>
                        <Copy />
                      </IconButton>
                      <IconButton
                        label={t.archivedAt ? "Restore" : "Archive"}
                        onClick={async () => {
                          try {
                            await postJson(
                              "/api/workspace/missed",
                              { id: t.id, restore: !!t.archivedAt },
                              "DELETE",
                            );
                            refresh();
                          } catch (e) {
                            setFailure(String(e));
                          }
                        }}
                      >
                        {t.archivedAt ? <ArchiveRestore /> : <Archive />}
                      </IconButton>
                      <IconButton
                        label="Delete"
                        danger
                        onClick={async () => {
                          if (
                            !confirm(
                              `Delete this ${t.symbol} opportunity permanently? Its notes and attachments are removed too.`,
                            )
                          )
                            return;
                          try {
                            await postJson(
                              "/api/workspace/missed",
                              { id: t.id, permanent: true },
                              "DELETE",
                            );
                            refresh();
                          } catch (e) {
                            setFailure(String(e));
                          }
                        }}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(t.observedAt).toLocaleString()} · {ago(t.observedAt)} ·{" "}
                    {books?.playbooks.find((b) => b.id === t.playbookId)?.name ?? "No strategy"}
                  </p>
                  {(reason || t.archivedAt) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {reason && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                          {reason}
                        </span>
                      )}
                      {t.archivedAt && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          Archived
                        </span>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    {[
                      ["Entry", t.entry],
                      ["Stop", t.stop],
                      ["Target", t.target],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rounded-lg bg-muted/30 px-3 py-2">
                        <div className="text-[11px] text-muted-foreground">{label}</div>
                        <div className="tnum font-medium">
                          <MonetaryValue>{value ?? "-"}</MonetaryValue>
                        </div>
                      </div>
                    ))}
                  </div>
                  {levels && <PriceLadder t={t} ratio={levels.ratio} />}
                  <Markdown>{notes || "No review yet."}</Markdown>
                  <Attachments type="missed" id={t.id} />
                  <ReviewExport
                    containsFinancialData
                    document={{
                      title: `Missed opportunity · ${t.symbol}`,
                      subtitle: `${t.direction} · ${t.observedAt}`,
                      lines: [
                        "Observation only: no executed trade or actual P&L.",
                        `Planned entry: ${t.entry ?? "-"} | Stop: ${t.stop ?? "-"} | Target: ${t.target ?? "-"}`,
                        "",
                        t.notes,
                      ],
                    }}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
        {data && !rows.length && (
          <div className="rounded-xl border border-dashed py-14 text-center">
            <p className="text-sm font-medium">
              {data.trades.length === 0
                ? "No opportunities logged yet"
                : `No ${archived ? "archived " : ""}opportunities match this view`}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {data.trades.length === 0
                ? "Log the setups you watched but skipped. Over time you will see which ones you keep missing and why."
                : "Try clearing the search or filters."}
            </p>
            {data.trades.length === 0 && (
              <Button size="sm" className="mt-4" onClick={() => edit()}>
                <Plus />
                Log your first one
              </Button>
            )}
          </div>
        )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit opportunity" : "Log a missed opportunity"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {formField("symbol", "Symbol")}
              <Field label="Direction">
                <OptionSelect
                  className={fieldClass}
                  value={draft.direction}
                  onValueChange={(next) => setDraft({ ...draft, direction: next })}
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </OptionSelect>
              </Field>
              <Field label="Observed at (device time)">
                <DateTimePicker
                  label="Observed at"
                  value={draft.observedAt}
                  onValueChange={(observedAt) => setDraft({ ...draft, observedAt })}
                />
              </Field>
              <Field label="Strategy">
                <OptionSelect
                  className={fieldClass}
                  value={draft.playbookId}
                  onValueChange={(next) => setDraft({ ...draft, playbookId: next })}
                >
                  <option value="">No strategy</option>
                  {books?.playbooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </OptionSelect>
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {formField("entry", "Planned entry", "number")}
              {formField("stop", "Planned stop", "number")}
              {formField("target", "Planned target", "number")}
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Why did you miss it?</p>
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map((reason) => {
                  const picked = reasonOf(draft.notes) === reason;
                  return (
                    <button
                      key={reason}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => setDraft({ ...draft, notes: withReason(draft.notes, reason) })}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        picked
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-border/70 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {reason}
                    </button>
                  );
                })}
              </div>
            </div>
            <RichEditor
              defaultMode="edit"
              value={draft.notes}
              onChange={(notes) => setDraft({ ...draft, notes })}
              placeholder="Why did you miss it? What will you do differently?"
            />
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Screenshots and files</p>
              {editing ? (
                <Attachments type="missed" id={editing} editable />
              ) : (
                <AttachmentQueue files={pendingFiles} onChange={setPendingFiles} />
              )}
            </div>
            {failure && (
              <p role="alert" className="text-xs text-destructive">
                {failure}
              </p>
            )}
            <Button
              disabled={busy || !draft.symbol.trim() || !draft.observedAt}
              onClick={async () => {
                setBusy(true);
                try {
                  const saved = await postJson<{ id: string }>("/api/workspace/missed", {
                    ...draft,
                    id: editing,
                    observedAt: new Date(draft.observedAt).toISOString(),
                    entry: draft.entry === "" ? null : Number(draft.entry),
                    stop: draft.stop === "" ? null : Number(draft.stop),
                    target: draft.target === "" ? null : Number(draft.target),
                  });
                  if (pendingFiles.length) {
                    try {
                      await uploadAttachments("missed", saved.id, pendingFiles);
                    } catch (e) {
                      // The opportunity is saved; keep it open on the card so files can be retried.
                      setFailure(
                        `Saved, but an attachment failed: ${e instanceof Error ? e.message : "upload error"}. Add it again from the card.`,
                      );
                      setOpen(false);
                      refresh();
                      return;
                    }
                  }
                  setPendingFiles([]);
                  setOpen(false);
                  refresh();
                  setFailure("");
                } catch (e) {
                  setFailure(e instanceof Error ? e.message : "Could not save.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save opportunity
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function Tile({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold tabular-nums leading-none tracking-tight">{children}</p>
      {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8 text-muted-foreground", danger && "hover:text-destructive")}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** Stop, entry and target laid out on one line so the shape of the plan is obvious. */
function PriceLadder({ t, ratio }: { t: MissedTrade; ratio: number }) {
  const prices = [t.stop!, t.entry!, t.target!];
  const low = Math.min(...prices);
  const span = Math.max(...prices) - low || 1;
  const at = (price: number) => `${((price - low) / span) * 100}%`;
  const risk = Math.abs(t.entry! - t.stop!);
  const reward = Math.abs(t.target! - t.entry!);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Planned setup</span>
        <span className="font-semibold text-foreground">{ratio.toFixed(2)}R reward to risk</span>
      </div>
      <div className="relative h-2 rounded-full bg-muted/60" aria-hidden>
        <div
          className="absolute inset-y-0 rounded-l-full bg-loss/60"
          style={{
            left: at(Math.min(t.stop!, t.entry!)),
            width: `${(risk / span) * 100}%`,
          }}
        />
        <div
          className="absolute inset-y-0 rounded-r-full bg-profit/60"
          style={{
            left: at(Math.min(t.entry!, t.target!)),
            width: `${(reward / span) * 100}%`,
          }}
        />
        {[
          [t.stop!, "bg-loss"],
          [t.entry!, "bg-foreground"],
          [t.target!, "bg-profit"],
        ].map(([price, color]) => (
          <span
            key={String(color)}
            className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card", String(color))}
            style={{ left: at(price as number) }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{t.direction === "long" ? "Stop" : "Target"}</span>
        <span>Entry</span>
        <span>{t.direction === "long" ? "Target" : "Stop"}</span>
      </div>
    </div>
  );
}
