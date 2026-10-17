"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  createSortedRowModel,
  rowSelectionFeature,
  rowSortingFeature,
  columnVisibilityFeature,
  tableFeatures,
  useTable,
  sortFns,
  type ColumnDef,
} from "@tanstack/react-table";
import { ArrowUpDown, Check, Columns3, Download, Search, Tag, Trash2 } from "lucide-react";
import { dayKeyOf, netReturnOnEntry, type TradeMetrics } from "@luxalgo/journal-core";
import { AddTradeDialog } from "@/components/add-trade-dialog";
import { CloseTradeDialog } from "@/components/close-trade-dialog";
import { DailyLimitWarning } from "@/components/daily-limit-warning";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { MonetaryValue } from "@/components/privacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SyncButton } from "@/components/sync-button";
import Loading from "@/app/loading";
import { useOnSynced } from "@/lib/sync-events";
import { loadTradesView, saveTradesView } from "@/lib/trades-view";
import { postJson, useApi } from "@/lib/use-api";
import { MARKETS, marketLabel, resolveMarket } from "@/lib/markets";
import { parseEmotions } from "@/lib/emotions";
import { cn, fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";

interface TradeRow {
  key: string;
  accountId: string;
  symbol: string;
  contractMultiplier: number | null;
  direction: "long" | "short";
  status: string;
  openedAt: string;
  closedAt: string | null;
  quantity: number;
  openQuantity: number;
  avgEntry: number;
  avgExit: number | null;
  grossPnl: number;
  fees: number;
  netPnl: number;
  executionCount: number;
  durationMs: number | null;
  rating: number | null;
  assetClass: string | null;
  emotionalState: string | null;
  tradeQuality: number | null;
  confidence: number | null;
  tags: string[];
  mistakes: string[];
  reviewed: boolean;
}

const features = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

const EMPTY_TRADES: TradeRow[] = [];

export default function TradesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Trades />
    </Suspense>
  );
}

function Trades() {
  const { query, accounts } = useFilters();
  // Typing updates `search` at once; the server is only asked once typing pauses.
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const { data, error, refresh } = useApi<{
    trades: TradeRow[];
    metrics: TradeMetrics;
    timeZone: string;
  }>(
    `/api/trades?view=list&${query}${searchQuery ? `${query ? "&" : ""}q=${encodeURIComponent(searchQuery)}` : ""}`,
  );
  useOnSynced(refresh);
  const router = useRouter();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const timeZone = data?.timeZone ?? "UTC";
  const [tagInput, setTagInput] = useState("");
  const [showColumns, setShowColumns] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  useEffect(() => setPage(0), [query, searchQuery, onlyUnreviewed]);

  // Closed trades still waiting for a review; the toggle narrows the list to them.
  const needsReview = useMemo(
    () => (data?.trades ?? EMPTY_TRADES).filter((trade) => trade.status !== "open" && !trade.reviewed),
    [data],
  );
  const listedTrades = onlyUnreviewed ? needsReview : (data?.trades ?? EMPTY_TRADES);
  // Sort order and visible columns are remembered between visits (read once, on the client).
  const savedView = useMemo(() => loadTradesView(), []);

  const columns = useMemo<ColumnDef<typeof features, TradeRow>[]>(
    () => [
      {
        id: "select",
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected()
                ? true
                : table.getIsSomeRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
            aria-label="Select all matching trades"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
            onClick={(event) => event.stopPropagation()}
            aria-label="Select trade"
          />
        ),
      },
      {
        id: "closedAt",
        // Open trades have no close date, so they sort by when they were opened. Otherwise
        // they would always sink to the bottom, even when opened after other trades closed.
        accessorFn: (row) => row.closedAt ?? row.openedAt,
        header: "Close date",
        cell: ({ row }) =>
          row.original.closedAt ? (
            <span className="text-muted-foreground">
              {dayKeyOf(row.original.closedAt, timeZone)}
            </span>
          ) : row.original.openQuantity > 0 ? (
            <CloseTradeDialog trade={row.original} timeZone={timeZone} onClosed={refresh} />
          ) : (
            <span className="text-muted-foreground">open</span>
          ),
      },
      {
        id: "symbol",
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ row, getValue }) => (
          <span className="flex items-center gap-2 font-medium">
            {getValue<string>()}
            <span
              className={`text-xs font-medium ${row.original.direction === "long" ? "text-profit" : "text-loss"}`}
            >
              {row.original.direction}
            </span>
          </span>
        ),
      },
      {
        id: "market",
        accessorFn: (row) => marketLabel(resolveMarket(row.assetClass, row.symbol)),
        header: "Market",
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => {
          const status = getValue<string>();
          return (
            <Badge
              variant={
                status === "win"
                  ? "profit"
                  : status === "loss"
                    ? "loss"
                    : status === "open"
                      ? "open"
                      : "secondary"
              }
            >
              {status.toUpperCase()}
            </Badge>
          );
        },
      },
      {
        id: "quantity",
        accessorKey: "quantity",
        header: "Volume",
        cell: ({ getValue }) => <span className="tnum">{fmtNumber(getValue<number>(), 4)}</span>,
      },
      {
        id: "avgEntry",
        accessorKey: "avgEntry",
        header: "Entry",
        cell: ({ getValue }) => (
          <span className="tnum">
            <MonetaryValue>{fmtNumber(getValue<number>())}</MonetaryValue>
          </span>
        ),
      },
      {
        id: "avgExit",
        accessorKey: "avgExit",
        header: "Exit",
        cell: ({ getValue }) => (
          <span className="tnum">
            <MonetaryValue>
              {getValue<number | null>() === null ? "–" : fmtNumber(getValue<number>()!)}
            </MonetaryValue>
          </span>
        ),
      },
      {
        id: "netPnl",
        accessorKey: "netPnl",
        header: "Net P&L",
        cell: ({ getValue }) => <Pnl value={getValue<number>()} />,
      },
      {
        id: "roi",
        accessorFn: (row) => netReturnOnEntry(row) ?? undefined,
        sortUndefined: "last",
        sortDescFirst: true,
        sortFn: "basic",
        header: "Net ROI",
        cell: ({ getValue }) => (
          <span className="tnum">{fmtPercent(getValue<number | undefined>() ?? null, 2)}</span>
        ),
      },
      {
        id: "fees",
        accessorKey: "fees",
        header: "Fees",
        cell: ({ getValue }) => (
          <span className="tnum text-muted-foreground">
            <MonetaryValue>{fmtMoney(getValue<number>())}</MonetaryValue>
          </span>
        ),
      },
      {
        id: "durationMs",
        accessorKey: "durationMs",
        header: "Duration",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{fmtDuration(getValue<number | null>())}</span>
        ),
      },
      {
        id: "executionCount",
        accessorKey: "executionCount",
        header: "Execs",
        cell: ({ getValue }) => (
          <span className="tnum text-muted-foreground">{getValue<number>()}</span>
        ),
      },
      {
        id: "tags",
        accessorKey: "tags",
        enableSorting: false,
        header: "Tags",
        cell: ({ getValue }) => (
          <span className="flex max-w-40 flex-wrap gap-1">
            {getValue<string[]>().map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </span>
        ),
      },
      {
        id: "rating",
        accessorKey: "rating",
        header: "Rating",
        cell: ({ getValue }) => {
          const rating = getValue<number | null>();
          return (
            <span className="text-muted-foreground">
              {rating === null ? "–" : "★".repeat(rating)}
            </span>
          );
        },
      },
      {
        id: "emotionalState",
        accessorFn: (row) => parseEmotions(row.emotionalState).join(", "),
        header: "Emotion",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue<string>() || "–"}</span>
        ),
      },
      {
        id: "tradeQuality",
        accessorKey: "tradeQuality",
        header: "Quality",
        cell: ({ getValue }) => (
          <span className="tnum text-muted-foreground">
            {getValue<number | null>() ?? "–"}
          </span>
        ),
      },
      {
        id: "confidence",
        accessorKey: "confidence",
        header: "Confidence",
        cell: ({ getValue }) => (
          <span className="tnum text-muted-foreground">
            {getValue<number | null>() ?? "–"}
          </span>
        ),
      },
      {
        id: "reviewed",
        accessorKey: "reviewed",
        header: "Reviewed",
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <Check className="h-4 w-4 text-profit" />
          ) : (
            <span className="text-muted-foreground">–</span>
          ),
      },
    ],
    [timeZone, refresh],
  );

  const table = useTable({
    features,
    columns,
    data: listedTrades,
    getRowId: (row) => row.key,
    initialState: {
      sorting: savedView?.sorting.length ? savedView.sorting : [{ id: "closedAt", desc: true }],
      columnVisibility: {
        fees: false,
        executionCount: false,
        rating: false,
        emotionalState: false,
        tradeQuality: false,
        confidence: false,
        ...savedView?.columnVisibility,
      },
    },
  });

  const selectedKeys = table.getSelectedRowModel().rows.map((row) => row.original.key);
  const sortedRows = table.getRowModel().rows;
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = sortedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const leafColumns = table.getAllLeafColumns();
  const viewSignature = JSON.stringify({
    sorting: leafColumns
      .filter((column) => column.getIsSorted())
      .map((column) => ({ id: column.id, desc: column.getIsSorted() === "desc" })),
    columnVisibility: Object.fromEntries(leafColumns.map((column) => [column.id, column.getIsVisible()])),
  });
  useEffect(() => saveTradesView(viewSignature), [viewSignature]);

  const { data: playbookData } = useApi<{ playbooks: { id: string; name: string }[] }>(
    selectedKeys.length > 0 ? "/api/playbooks" : null,
  );
  const [mistakeInput, setMistakeInput] = useState("");

  // Keyboard: j/k move, Enter opens, x selects, / searches. Latest values go through a ref so the
  // listener is attached once.
  const keyboard = useRef({ rows: visibleRows, activeKey, query });
  keyboard.current = { rows: visibleRows, activeKey, query };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) {
        if (event.key === "Escape" && target.getAttribute("aria-label") === "Search trades")
          target.blur();
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      const { rows, activeKey: current, query: currentQuery } = keyboard.current;
      const index = rows.findIndex((row) => row.id === current);
      const onControl = Boolean(target?.closest("button, a, [role='checkbox'], [role='combobox']"));
      if (event.key === "/") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="Search trades"]')?.focus();
      } else if (event.key === "j" || event.key === "k") {
        if (rows.length === 0) return;
        event.preventDefault();
        const next = event.key === "j" ? Math.min(rows.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
        const id = rows[next]!.id;
        setActiveKey(id);
        document
          .querySelector(`[data-row-key="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && index >= 0 && !onControl) {
        event.preventDefault();
        router.push(`/trades/${encodeURIComponent(rows[index]!.id)}?${currentQuery}`);
      } else if (event.key === "x" && index >= 0 && !onControl) {
        event.preventDefault();
        const row = rows[index]!;
        row.toggleSelected(!row.getIsSelected());
      } else if (event.key === "Escape") {
        setActiveKey(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const bulk = async (action: string, extra?: Record<string, unknown>) => {
    await postJson("/api/trades/bulk", { keys: selectedKeys, action, ...extra });
    table.resetRowSelection();
    refresh();
  };

  const m = data?.metrics;
  return (
    <div>
      <FilterBar
        title="Trades"
        beforeFilters={<SyncButton onSynced={refresh} />}
        actions={
          <div className="flex items-center gap-2">
            <a href={`/api/export?format=csv&${query}`} download>
              <Button variant="outline" size="sm">
                <Download />
                CSV
              </Button>
            </a>
            <Button variant="outline" size="sm" onClick={() => setShowColumns((value) => !value)}>
              <Columns3 />
              Columns
            </Button>
            <AddTradeDialog onSaved={refresh} />
          </div>
        }
      />
      <div className="space-y-3 p-4">
        <DailyLimitWarning
          accounts={accounts}
          refreshKey={`${data?.trades.length ?? 0}-${data?.metrics?.closedTrades ?? 0}`}
        />
        {m && (
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-5">
            <Card>
              <CardHeader>
                <CardTitle>Net cumulative P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <Pnl value={m.netPnl} className="text-xl font-semibold" />
                <span className="ml-2 text-xs text-muted-foreground">{m.closedTrades} trades</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Profit factor</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-xl font-semibold tnum">
                  {m.profitFactorIsInfinite
                    ? "∞"
                    : m.profitFactor === null
                      ? "–"
                      : fmtNumber(m.profitFactor)}
                </span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Trade win %</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-xl font-semibold tnum">{fmtPercent(m.winRate)}</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Avg win / loss</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-xl font-semibold tnum">
                  {m.avgWinLossRatio === null ? "–" : fmtNumber(m.avgWinLossRatio)}
                </span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Expectancy / trade</CardTitle>
              </CardHeader>
              <CardContent>
                {m.closedTrades > 0 ? (
                  <Pnl value={m.netPnl / m.closedTrades} className="text-xl font-semibold" />
                ) : (
                  <span className="text-xl font-semibold tnum">–</span>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search symbol, tag, mistake, notes…"
              aria-label="Search trades"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            variant={onlyUnreviewed ? "secondary" : "outline"}
            size="sm"
            aria-pressed={onlyUnreviewed}
            onClick={() => setOnlyUnreviewed((value) => !value)}
          >
            <Check />
            Needs review · {needsReview.length}
          </Button>
          <span className="hidden text-xs text-muted-foreground lg:inline">
            j/k move · Enter open · x select · / search
          </span>
        </div>

        {showColumns && (
          <Card>
            <CardContent className="flex flex-wrap gap-3 py-3">
              {table
                .getAllLeafColumns()
                .filter((column) => column.id !== "select")
                .map((column) => (
                  <label key={column.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(value === true)}
                    />
                    {typeof column.columnDef.header === "string"
                      ? column.columnDef.header
                      : column.id}
                  </label>
                ))}
            </CardContent>
          </Card>
        )}

        {selectedKeys.length > 0 && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 py-2">
              <span className="text-sm text-muted-foreground">{selectedKeys.length} selected</span>
              <Button variant="outline" size="sm" onClick={() => bulk("review")}>
                <Check />
                Mark reviewed
              </Button>
              <Button variant="outline" size="sm" onClick={() => bulk("unreview")}>
                Unreview
              </Button>
              <div className="flex max-w-full flex-wrap items-center gap-1">
                <Input
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="tag"
                  className="h-8 w-28 text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!tagInput}
                  onClick={() => {
                    void bulk("tag", { tag: tagInput });
                    setTagInput("");
                  }}
                >
                  <Tag />
                  Tag
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!tagInput}
                  onClick={() => {
                    void bulk("untag", { tag: tagInput });
                    setTagInput("");
                  }}
                >
                  Untag
                </Button>
              </div>
              <div className="flex max-w-full flex-wrap items-center gap-1">
                <Input
                  value={mistakeInput}
                  onChange={(event) => setMistakeInput(event.target.value)}
                  placeholder="mistake"
                  className="h-8 w-28 text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!mistakeInput}
                  onClick={() => {
                    void bulk("mistake", { mistake: mistakeInput });
                    setMistakeInput("");
                  }}
                >
                  Mistake
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!mistakeInput}
                  onClick={() => {
                    void bulk("unmistake", { mistake: mistakeInput });
                    setMistakeInput("");
                  }}
                >
                  Remove
                </Button>
              </div>
              <select
                aria-label="Set playbook for selected trades"
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (value) void bulk("playbook", { playbookId: value === "none" ? null : value });
                }}
              >
                <option value="">Set playbook…</option>
                <option value="none">No playbook</option>
                {playbookData?.playbooks.map((playbook) => (
                  <option key={playbook.id} value={playbook.id}>
                    {playbook.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Set market for selected trades"
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (value) void bulk("market", { market: value === "none" ? null : value });
                }}
              >
                <option value="">Set market…</option>
                <option value="none">Not set</option>
                {MARKETS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (
                    confirm(
                      `Delete ${selectedKeys.length} trades and their executions? This cannot be undone.`,
                    )
                  )
                    void bulk("delete");
                }}
              >
                <Trash2 />
                Delete
              </Button>
            </CardContent>
          </Card>
        )}

        {error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            <Button variant="outline" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <Skeleton className="h-96" />
        ) : (
          <Card>
            <div className="relative min-w-0 max-w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id} className="border-b">
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="h-9 whitespace-nowrap px-2 text-left text-xs font-medium text-muted-foreground"
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <button
                              className="inline-flex items-center gap-1 hover:text-foreground"
                              onClick={(event) => {
                                setPage(0);
                                header.column.getToggleSortingHandler()?.(event);
                              }}
                            >
                              <table.FlexRender header={header} />
                              <ArrowUpDown
                                className={cn(
                                  "h-3 w-3",
                                  header.column.getIsSorted() && "text-foreground",
                                )}
                              />
                            </button>
                          ) : (
                            <table.FlexRender header={header} />
                          )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr
                      key={row.id}
                      data-row-key={row.id}
                      className={cn(
                        "cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50",
                        activeKey === row.id && "bg-muted/60 ring-1 ring-inset ring-ring/50",
                      )}
                      onClick={() =>
                        router.push(`/trades/${encodeURIComponent(row.original.key)}?${query}`)
                      }
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="whitespace-nowrap px-2 py-2 align-middle">
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {table.getRowModel().rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="py-16 text-center text-muted-foreground"
                      >
                        {searchQuery || onlyUnreviewed ? (
                          "Nothing matches this search."
                        ) : (
                          <>
                            No trades match these filters.{" "}
                            <Link href="/import" className="underline">
                              Import some
                            </Link>
                            .
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {sortedRows.length > pageSize && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
                <span>
                  {currentPage * pageSize + 1}–
                  {Math.min((currentPage + 1) * pageSize, sortedRows.length)} of{" "}
                  {fmtNumber(sortedRows.length, 0)} trades
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {currentPage + 1} of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage + 1 === pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
