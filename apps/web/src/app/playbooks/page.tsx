"use client";

import Link from "next/link";
import { Suspense, useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, CheckCircle2, Copy, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { AdherenceReport } from "@/components/adherence-report";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OptionSelect } from "@/components/ui/option-select";
import { Textarea } from "@/components/ui/textarea";
import { postJson, useApi } from "@/lib/use-api";
import { cn, fmtPercent } from "@/lib/utils";

interface Playbook {
  id: string;
  name: string;
  description: string;
  rules: string[];
  tradeCount: number;
}

/** Per-playbook results for the active filters, taken from the same stats the reports use. */
interface PlaybookStats {
  currencies: string[];
  currencyScope?: { monetary: boolean };
  buckets: { playbook: { key: string; netPnl: number; trades: number; winRate: number | null }[] };
}

type Bucket = PlaybookStats["buckets"]["playbook"][number];
type Scored = { book: Playbook; result: Bucket };
type Sort = "created" | "name" | "usage" | "pnl" | "winrate";

const STARTERS = [
  {
    name: "Opening range breakout",
    description: "Trade the break of the first 15 or 30 minute range.",
    rules: [
      "Wait for the opening range to form",
      "Enter only on a close beyond the range",
      "Stop on the other side of the range",
      "Risk max 1R",
      "No entries after 11:30",
    ],
  },
  {
    name: "Pullback to VWAP",
    description: "Join a trending move on a controlled pullback.",
    rules: [
      "Trend must be clear on the higher timeframe",
      "Enter at VWAP or a prior level, not mid-air",
      "Stop beyond the pullback low or high",
      "Take partials at 1R",
    ],
  },
  {
    name: "Breakout and retest",
    description: "Wait for price to break a level, return to it, and hold.",
    rules: [
      "Level must have at least two clear touches",
      "Enter on the retest, not the first break",
      "Stop back inside the level",
      "Skip if volume fades on the break",
    ],
  },
  {
    name: "Reversal at a key level",
    description: "Fade an extension into a high-timeframe level.",
    rules: [
      "Only at pre-marked levels",
      "Need a clear rejection candle",
      "Size down: this is a lower-probability setup",
      "Target the middle of the range",
    ],
  },
] as const;

const RULES_SHOWN = 4;

export default function PlaybooksPage() {
  return (
    <Suspense>
      <Playbooks />
    </Suspense>
  );
}

function Playbooks() {
  const { query } = useFilters();
  const { data, refresh, error } = useApi<{ playbooks: Playbook[] }>("/api/playbooks");
  const { data: stats } = useApi<PlaybookStats>(`/api/stats?${query}`);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("created");

  const monetary = stats?.currencyScope?.monetary !== false;
  const currency = stats?.currencies[0] ?? "USD";
  const resultOf = (id: string) => stats?.buckets.playbook.find((bucket) => bucket.key === id) ?? null;

  const fill = (next?: { name: string; description: string; rules: readonly string[] }, id: string | null = null) => {
    setEditing(id);
    setName(next?.name ?? "");
    setDescription(next?.description ?? "");
    setRules(next?.rules.join("\n") ?? "");
    setFailure("");
    setOpen(true);
  };
  const startNew = () => fill();
  const startEdit = (playbook: Playbook) => fill(playbook, playbook.id);

  const ruleList = rules
    .split("\n")
    .map((rule) => rule.trim())
    .filter(Boolean);

  const save = async () => {
    setBusy(true);
    setFailure("");
    try {
      const body = { name: name.trim(), description, rules: ruleList };
      if (editing) await postJson(`/api/playbooks/${editing}`, body, "PATCH");
      else await postJson("/api/playbooks", body);
      setOpen(false);
      setEditing(null);
      refresh();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not save the playbook.");
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (playbook: Playbook) => {
    try {
      await postJson("/api/playbooks", {
        name: `${playbook.name} copy`,
        description: playbook.description,
        rules: playbook.rules,
      });
      refresh();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Could not duplicate the playbook.");
    }
  };

  const books = useMemo(() => data?.playbooks ?? [], [data]);
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const result = (id: string) => stats?.buckets.playbook.find((bucket) => bucket.key === id) ?? null;
    return books
      .filter((book) => `${book.name} ${book.description} ${book.rules.join(" ")}`.toLowerCase().includes(needle))
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "usage") return b.tradeCount - a.tradeCount;
        if (sort === "pnl") return (result(b.id)?.netPnl ?? -Infinity) - (result(a.id)?.netPnl ?? -Infinity);
        if (sort === "winrate") return (result(b.id)?.winRate ?? -1) - (result(a.id)?.winRate ?? -1);
        return 0; // The API already returns oldest first.
      });
  }, [books, search, sort, stats]);

  const summary = useMemo(() => {
    const scored: Scored[] = [];
    for (const book of books) {
      const result = stats?.buckets.playbook.find((bucket) => bucket.key === book.id);
      if (result && result.trades > 0) scored.push({ book, result });
    }
    const best = scored.reduce<Scored | null>((top, e) => (top === null || e.result.netPnl > top.result.netPnl ? e : top), null);
    const worst = scored.reduce<Scored | null>((low, e) => (low === null || e.result.netPnl < low.result.netPnl ? e : low), null);
    const mostUsed = books.reduce<Playbook | null>((top, book) => (top === null || book.tradeCount > top.tradeCount ? book : top), null);
    return {
      tagged: books.reduce((sum, book) => sum + book.tradeCount, 0),
      best,
      worst: worst && worst.book.id !== best?.book.id ? worst : null,
      mostUsed: mostUsed && mostUsed.tradeCount > 0 ? mostUsed : null,
    };
  }, [books, stats]);

  const maxAbs = Math.max(1, ...(stats?.buckets.playbook ?? []).map((bucket) => Math.abs(bucket.netPnl)));

  return (
    <div>
      <FilterBar
        title="Playbooks"
        actions={
          <Button size="sm" onClick={startNew}>
            <Plus />
            New playbook
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 sm:p-6">
        {(error || failure) && !open && (
          <p role="alert" className="text-sm text-destructive">
            {error || failure}
          </p>
        )}

        {data && books.length === 0 ? (
          <div className="space-y-5">
            <div className="mx-auto max-w-2xl pt-6 text-center">
              <h2 className="text-lg font-semibold tracking-tight">Trade setups on purpose</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                A playbook is a setup you trade deliberately. Name it, write its rules, then tag trades with it and
                let Reports show whether it actually pays. Start from an example or write your own.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter.name}
                  type="button"
                  onClick={() => fill(starter)}
                  className="rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50"
                >
                  <span className="block text-sm font-semibold">{starter.name}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{starter.description}</span>
                  <span className="mt-3 block text-[11px] text-muted-foreground">{starter.rules.length} rules</span>
                </button>
              ))}
            </div>
            <div className="text-center">
              <Button variant="outline" onClick={startNew}>
                <Plus />
                Start from scratch
              </Button>
            </div>
          </div>
        ) : (
          <>
            {data && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="Playbooks" detail={`${summary.tagged} tagged trade${summary.tagged === 1 ? "" : "s"}`}>
                  {books.length}
                </Tile>
                <Tile
                  label="Best performer"
                  detail={summary.best ? `${summary.best.result.trades} trades in view` : "Tag trades to compare"}
                >
                  {summary.best && monetary ? (
                    <span className="block text-base leading-tight">
                      <span className="block truncate">{summary.best.book.name}</span>
                      <Pnl value={summary.best.result.netPnl} currency={currency} className="text-lg" />
                    </span>
                  ) : (
                    "—"
                  )}
                </Tile>
                <Tile
                  label="Needs attention"
                  detail={summary.worst ? `${summary.worst.result.trades} trades in view` : "Nothing is losing money"}
                >
                  {summary.worst && monetary && summary.worst.result.netPnl < 0 ? (
                    <span className="block text-base leading-tight">
                      <span className="block truncate">{summary.worst.book.name}</span>
                      <Pnl value={summary.worst.result.netPnl} currency={currency} className="text-lg" />
                    </span>
                  ) : (
                    "—"
                  )}
                </Tile>
                <Tile
                  label="Most used"
                  detail={summary.mostUsed ? `${summary.mostUsed.tradeCount} trades` : "No trades tagged yet"}
                >
                  <span className="block truncate text-base leading-tight">{summary.mostUsed?.name ?? "—"}</span>
                </Tile>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search playbooks and rules"
                  aria-label="Search playbooks"
                  className="pl-8"
                />
              </div>
              <OptionSelect
                aria-label="Sort playbooks"
                value={sort}
                onValueChange={(value) => setSort(value as Sort)}
                className="h-9 w-48 rounded-lg border bg-background px-2 text-sm"
              >
                <option value="created">Oldest first</option>
                <option value="name">Name A to Z</option>
                <option value="usage">Most trades</option>
                <option value="pnl">Best P&L</option>
                <option value="winrate">Best win rate</option>
              </OptionSelect>
              <p className="ml-auto text-xs text-muted-foreground">
                Results follow your active filters at the top of the page.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {visible.map((playbook) => {
                const result = resultOf(playbook.id);
                return (
                  <Card key={playbook.id} className="flex flex-col">
                    <CardHeader className="space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="text-base font-semibold text-foreground">{playbook.name}</CardTitle>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {playbook.tradeCount} trade{playbook.tradeCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      {playbook.description && (
                        <p className="text-sm text-muted-foreground">{playbook.description}</p>
                      )}
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col gap-4">
                      {result && result.trades > 0 ? (
                        <div className="rounded-lg bg-muted/30 p-3">
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <Mini label="Net P&L">
                              {monetary ? <Pnl value={result.netPnl} currency={currency} className="font-semibold" /> : "—"}
                            </Mini>
                            <Mini label="Win rate">{fmtPercent(result.winRate, 0)}</Mini>
                            <Mini label="In view">{result.trades}</Mini>
                          </div>
                          {monetary && (
                            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/70" aria-hidden>
                              <div
                                className={cn("h-full rounded-full", result.netPnl >= 0 ? "bg-profit" : "bg-loss")}
                                style={{ width: `${Math.max(4, (Math.abs(result.netPnl) / maxAbs) * 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                          {playbook.tradeCount > 0
                            ? "No closed trades with this playbook match the current filters."
                            : "Tag trades with this playbook to see how it performs."}
                        </p>
                      )}

                      {playbook.rules.length > 0 && <RuleList rules={playbook.rules} />}

                      <AdherenceReport bookId={playbook.id} />

                      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                        <Link
                          href={`/trades?playbookId=${encodeURIComponent(playbook.id)}`}
                          className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          View trades <ArrowUpRight className="size-3.5" aria-hidden />
                        </Link>
                        <div className="flex items-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            aria-label={`Edit ${playbook.name}`}
                            onClick={() => startEdit(playbook)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            aria-label={`Duplicate ${playbook.name}`}
                            onClick={() => void duplicate(playbook)}
                          >
                            <Copy />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${playbook.name}`}
                            onClick={async () => {
                              if (
                                confirm(`Delete "${playbook.name}"? Trades keep their data, just lose the link.`)
                              ) {
                                try {
                                  await postJson(`/api/playbooks/${playbook.id}`, undefined, "DELETE");
                                  refresh();
                                } catch (cause) {
                                  setFailure(cause instanceof Error ? cause.message : "Could not delete the playbook.");
                                }
                              }
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {data && visible.length === 0 && (
              <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
                No playbooks match your search.
              </p>
            )}
          </>
        )}
      </div>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit playbook" : "New playbook"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!editing && !name && !rules && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Start from an example</p>
                <div className="flex flex-wrap gap-1.5">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter.name}
                      type="button"
                      onClick={() => fill(starter)}
                      className="rounded-full border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      {starter.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name (e.g. Opening range breakout)"
              aria-label="Playbook name"
              maxLength={100}
            />
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="One-line description"
              aria-label="Description"
            />
            <div className="space-y-1.5">
              <Textarea
                value={rules}
                onChange={(event) => setRules(event.target.value)}
                placeholder={"One rule per line:\nOnly A+ setups\nRisk max 1R\nNo entries after 11:30"}
                aria-label="Rules, one per line"
                className="min-h-36"
              />
              <p className="text-xs text-muted-foreground">
                {ruleList.length} rule{ruleList.length === 1 ? "" : "s"}. You can tick each one off on a trade to track
                adherence.
              </p>
            </div>
            {failure && (
              <p role="alert" className="text-sm text-destructive">
                {failure}
              </p>
            )}
            <Button onClick={() => void save()} disabled={!name.trim() || busy}>
              {busy ? "Saving…" : editing ? "Save changes" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <div className="mt-2 text-2xl font-semibold tabular-nums leading-none tracking-tight">{children}</div>
      {detail && <p className="mt-2 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function Mini({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tnum mt-0.5 font-semibold">{children}</div>
    </div>
  );
}

/** The rules, with the long ones folded away. */
function RuleList({ rules }: { rules: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rules : rules.slice(0, RULES_SHOWN);
  return (
    <div>
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Rules ({rules.length})
      </p>
      <ul className="space-y-1.5 text-sm">
        {shown.map((rule, index) => (
          <li key={index} className="flex min-w-0 items-start gap-2 break-words">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" aria-hidden />
            <span>{rule}</span>
          </li>
        ))}
      </ul>
      {rules.length > RULES_SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="mt-2 text-xs font-medium text-primary hover:underline"
        >
          {all ? "Show fewer" : `Show ${rules.length - RULES_SHOWN} more`}
        </button>
      )}
    </div>
  );
}
