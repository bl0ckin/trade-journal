"use client";
import { AiNotice } from "@/components/ai-notice";
import { AssistantMessage } from "@/components/ai-message";
import { Checkbox } from "@/components/ui/checkbox";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { netReturnOnEntry } from "@luxalgo/journal-core";
import { FilterBar } from "@/components/filter-bar";
import { Pnl } from "@/components/pnl";
import { AddTradeDialog } from "@/components/add-trade-dialog";
import { ScoreSlider } from "@/components/score-slider";
import { TagPicker } from "@/components/tag-picker";
import { ChipSelect } from "@/components/chip-select";
import { EMOTIONAL_STATES, parseEmotions } from "@/lib/emotions";
import { MARKETS, resolveMarket } from "@/lib/markets";
import { MonetaryValue, MonetaryField } from "@/components/privacy";
import { TradeMarketData } from "@/components/trade-market-data";
import { TradeNavigation } from "@/components/trade-navigation";
import { TradeRating } from "@/components/trade-rating";
import { EquityArea } from "@/components/charts/equity-area";
import { VoiceNote } from "@/components/voice-note";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Attachments } from "@/components/attachments";
import { ReviewExport } from "@/components/review-export";
import { RuleChecklist } from "@/components/rule-checklist";
import { useAutosave } from "@/lib/use-autosave";
import { postJson, useApi } from "@/lib/use-api";
import { fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import { tradeKeyFromSegment } from "@/lib/trade-links";
import { formatTimestamp } from "@/lib/timezone";
import { isoToZonedInput, nowZonedInput, zonedInputToIso } from "@/lib/datetime-input";

interface TradeDetail {
  riskAmount: number | null;
  realizedR: number | null;
  plannedR: number | null;
  contractMultiplier: number | null;
  currency: string;
  key: string;
  accountId: string;
  symbol: string;
  assetClass: string | null;
  direction: "long" | "short";
  status: string;
  openedAt: string;
  closedAt: string | null;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  grossPnl: number;
  fees: number;
  netPnl: number;
  durationMs: number | null;
  exitsJson: string;
  notes: string | null;
  tagsJson: string | null;
  mistakesJson: string | null;
  playbookId: string | null;
  rating: number | null;
  stopLoss: number | null;
  profitTarget: number | null;
  reviewedAt: string | null;
  tradeQuality: number | null;
  confidence: number | null;
  emotionalState: string | null;
}

interface ExecutionRow {
  id: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
  source?: "sync" | "import" | "manual";
}

export default function TradePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const tradeKey = tradeKeyFromSegment(key);
  return <TradeView key={tradeKey} tradeKey={tradeKey} />;
}

function TradeView({ tradeKey }: { tradeKey: string }) {
  const { data, error, refresh } = useApi<{
    trade: TradeDetail;
    executions: ExecutionRow[];
    timeZone: string;
  }>(`/api/trades/${encodeURIComponent(tradeKey)}`);
  const [aiBusy, setAiBusy] = useState(false);
  const [critique, setCritique] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  if (!data) {
    return (
      <div>
        <FilterBar title="Trade" />
        <div className="p-4">
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : (
            <Skeleton className="h-96" />
          )}
        </div>
      </div>
    );
  }
  const { trade, executions, timeZone } = data;

  const patch = async (body: Record<string, unknown>) => {
    if (Object.keys(body).length)
      await postJson(`/api/trades/${encodeURIComponent(tradeKey)}`, body, "PATCH");
    refresh();
  };

  const runningPnl = (() => {
    const exits = JSON.parse(trade.exitsJson) as {
      executionId: string;
      grossPnl: number;
      quantity: number;
    }[];
    const times = new Map(executions.map((e) => [e.id, e.executedAt]));
    const totalExitQty = exits.reduce((total, exit) => total + exit.quantity, 0);
    let cum = 0;
    return exits
      .map((exit) => ({
        t: times.get(exit.executionId) ?? trade.openedAt,
        pnl: exit.grossPnl - (totalExitQty > 0 ? trade.fees * (exit.quantity / totalExitQty) : 0),
      }))
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
      .map((event) => ({
        t: formatTimestamp(event.t, timeZone).slice(11, 16),
        cumNetPnl: (cum += event.pnl),
      }));
  })();

  const askCritique = async () => {
    setAiBusy(true);
    setAiError(null);
    try {
      const result = await postJson<{ critique: string }>("/api/ai/critique", { key: tradeKey });
      setCritique(result.critique);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI critique failed");
    } finally {
      setAiBusy(false);
    }
  };

  const riskAmount = trade.riskAmount;

  return (
    <div>
      <FilterBar title={`${trade.symbol} · ${trade.direction.toUpperCase()}`} />
      <TradeNavigation tradeKey={tradeKey} />
      <div className="grid gap-3 p-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-3 xl:col-span-2">
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
              <div>
                <div className="text-xs text-muted-foreground">Net P&L</div>
                <Pnl value={trade.netPnl} className="text-2xl font-semibold" />
              </div>
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
                className="text-sm"
              >
                {trade.status.toUpperCase()}
              </Badge>
              <Meta label="Gross" value={fmtMoney(trade.grossPnl)} monetary />
              <Meta label="Fees" value={fmtMoney(trade.fees)} monetary />
              <Meta label="Volume" value={fmtNumber(trade.quantity, 4)} />
              <Meta label="Avg entry" value={fmtNumber(trade.avgEntry)} monetary />
              <Meta
                label="Avg exit"
                monetary
                value={trade.avgExit === null ? "open" : fmtNumber(trade.avgExit)}
              />
              <Meta label="Duration" value={fmtDuration(trade.durationMs)} />
              <Meta label="Net / entry notional" value={fmtPercent(netReturnOnEntry(trade), 2)} />
              <Meta
                label="Planned R"
                value={trade.plannedR === null ? "–" : `${fmtNumber(trade.plannedR)}R`}
              />
              <Meta
                label="Realized R"
                value={trade.realizedR === null ? "–" : `${fmtNumber(trade.realizedR)}R`}
              />
            </CardContent>
          </Card>

          <ExecutionsCard
            trade={trade}
            executions={executions}
            timeZone={timeZone}
            onSaved={refresh}
          />

          <TradeMarketData trade={trade} executions={executions} />

          {runningPnl.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Running P&L</CardTitle>
                <p className="text-xs text-muted-foreground">Times in {timeZone}</p>
              </CardHeader>
              <CardContent>
                <EquityArea data={runningPnl} height={180} />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <AnnotationsCard key={trade.key} trade={trade} onPatch={patch} />
          <RuleChecklist tradeKey={trade.key} playbookId={trade.playbookId} />
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>AI review</CardTitle>
              <Button variant="outline" size="sm" onClick={askCritique} disabled={aiBusy}>
                <Sparkles />
                {aiBusy ? "Thinking…" : "Critique this trade"}
              </Button>
            </CardHeader>
            {aiError && (
              <CardContent>
                <AiNotice
                  error={aiError}
                  onRetry={() => void askCritique()}
                  onDismiss={() => setAiError(null)}
                />
              </CardContent>
            )}
            {critique && (
              <CardContent>
                <AssistantMessage content={critique} />
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Meta({
  label,
  value,
  monetary = false,
}: {
  label: string;
  value: string;
  monetary?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tnum text-sm font-medium">
        {monetary ? <MonetaryValue>{value}</MonetaryValue> : value}
      </div>
    </div>
  );
}

function AnnotationsCard({
  trade,
  onPatch,
}: {
  trade: TradeDetail;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [notes, setNotes] = useState(trade.notes ?? "");
  const noteEditor = useRef<RichEditorHandle>(null);
  // Notes open in the finished (preview) view when there is text, and Save now returns there.
  const [noteMode, setNoteMode] = useState<"preview" | "edit">(
    (trade.notes ?? "").trim() ? "preview" : "edit",
  );
  const noteEditing = noteMode === "edit";
  const [tags, setTags] = useState<string[]>(JSON.parse(trade.tagsJson ?? "[]") as string[]);
  const [mistakes, setMistakes] = useState<string[]>(
    JSON.parse(trade.mistakesJson ?? "[]") as string[],
  );
  const [quality, setQuality] = useState<number | null>(trade.tradeQuality);
  const [confidence, setConfidence] = useState<number | null>(trade.confidence);
  const [emotions, setEmotions] = useState<string[]>(parseEmotions(trade.emotionalState));
  const [listError, setListError] = useState("");
  // Tags, mistakes and emotions save right away, one request after another, so none is lost.
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveNow = (body: Record<string, unknown>) => {
    setListError("");
    saveQueue.current = saveQueue.current
      .then(() => onPatch(body))
      .catch((cause) =>
        setListError(
          `Couldn’t save: ${cause instanceof Error ? cause.message : "connection failed"}`,
        ),
      );
  };
  const [stopLoss, setStopLoss] = useState(trade.stopLoss?.toString() ?? "");
  const [profitTarget, setProfitTarget] = useState(trade.profitTarget?.toString() ?? "");
  const { data: playbookData } = useApi<{ playbooks: { id: string; name: string }[] }>(
    "/api/playbooks",
  );
  const {
    save: debounced,
    status: saveStatus,
    flush,
    dirty,
  } = useAutosave(`/api/trades/${encodeURIComponent(trade.key)}`, "PATCH", () => void onPatch({}));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Journal this trade</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <TradeRating value={trade.rating} onChange={(rating) => onPatch({ rating })} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={trade.reviewedAt !== null}
              onCheckedChange={(checked) => void onPatch({ reviewed: checked === true })}
            />
            Reviewed
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">Stop loss</label>
            <MonetaryField>
              <Input
                value={stopLoss}
                onChange={(event) => {
                  setStopLoss(event.target.value);
                  debounced({
                    stopLoss: event.target.value === "" ? null : Number(event.target.value),
                  });
                }}
                placeholder="planned stop"
                inputMode="decimal"
              />
            </MonetaryField>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Profit target</label>
            <MonetaryField>
              <Input
                value={profitTarget}
                onChange={(event) => {
                  setProfitTarget(event.target.value);
                  debounced({
                    profitTarget: event.target.value === "" ? null : Number(event.target.value),
                  });
                }}
                placeholder="planned target"
                inputMode="decimal"
              />
            </MonetaryField>
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Playbook</label>
          <Select
            value={trade.playbookId ?? "none"}
            onValueChange={(value) => void onPatch({ playbookId: value === "none" ? null : value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="No playbook" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No playbook</SelectItem>
              {playbookData?.playbooks.map((playbook) => (
                <SelectItem key={playbook.id} value={playbook.id}>
                  {playbook.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground">Market</label>
          <Select
            value={resolveMarket(trade.assetClass, trade.symbol) ?? "none"}
            onValueChange={(value) => void onPatch({ market: value === "none" ? null : value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              {MARKETS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Tags</label>
          <TagPicker
            kind="tag"
            noun="tag"
            value={tags}
            onChange={(next) => {
              setTags(next);
              saveNow({ tags: next });
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Mistakes</label>
          <TagPicker
            kind="mistake"
            noun="mistake"
            value={mistakes}
            onChange={(next) => {
              setMistakes(next);
              saveNow({ mistakes: next });
            }}
          />
        </div>

        <ScoreSlider
          label="Trade quality"
          lowLabel="Poor execution"
          highLabel="Textbook"
          value={quality}
          onChange={(next) => {
            setQuality(next);
            debounced({ tradeQuality: next });
          }}
        />
        <ScoreSlider
          label="Confidence"
          lowLabel="Doubtful"
          highLabel="Certain"
          value={confidence}
          onChange={(next) => {
            setConfidence(next);
            debounced({ confidence: next });
          }}
        />
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Emotional state</label>
          <ChipSelect
            options={EMOTIONAL_STATES}
            value={emotions}
            addLabel="Add emotion"
            onChange={(next) => {
              setEmotions(next);
              saveNow({ emotionalStates: next });
            }}
          />
        </div>
        {listError && (
          <p role="alert" className="text-xs text-destructive">
            {listError}
          </p>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-muted-foreground">Notes</label>
            <VoiceNote
              onPrepare={() => noteEditor.current?.focus()}
              onText={(text) => {
                const next = notes ? `${notes} ${text}` : text;
                setNotes(next);
                debounced({ notes: next });
              }}
            />
          </div>
          <RichEditor
            editorRef={noteEditor}
            mode={noteMode}
            onModeChange={setNoteMode}
            value={notes}
            onChange={(value) => {
              setNotes(value);
              debounced({ notes: value });
            }}
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span role="status">{saveStatus}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await flush();
                // Only leave edit mode once everything is saved; a failed save keeps the text open.
                if (!dirty()) setNoteMode("preview");
              }}
            >
              Save now
            </Button>
          </div>
          <Attachments type="trade" id={trade.key} editable={noteEditing} />
          <ReviewExport
            containsFinancialData
            document={{
              title: `${trade.symbol} · ${trade.direction} review`,
              subtitle: `${trade.openedAt} · ${trade.currency}`,
              lines: [
                `Status: ${trade.status} | Quantity: ${trade.quantity}`,
                `Entry: ${trade.avgEntry} | Exit: ${trade.avgExit ?? "Open"}`,
                `Net P&L: ${trade.netPnl.toFixed(2)} | Fees: ${trade.fees.toFixed(2)}`,
                `Stop: ${stopLoss || "Unspecified"} | Target: ${profitTarget || "Unspecified"}`,
                `Tags: ${tags.join(", ") || "None"} | Mistakes: ${mistakes.join(", ") || "None"}`,
                `Trade quality: ${quality ?? "Not set"}/10 | Confidence: ${confidence ?? "Not set"}/10 | Emotional state: ${emotions.join(", ") || "Not set"}`,
                "",
                notes,
              ],
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface EditRow {
  id?: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  fee: string;
  datetime: string;
  originalDatetime?: string;
  originalIso?: string;
  touched: boolean;
}

function ExecutionsCard({
  trade,
  executions,
  timeZone,
  onSaved,
}: {
  trade: TradeDetail;
  executions: ExecutionRow[];
  timeZone: string;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<EditRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sorted = [...executions].sort((a, b) => a.executedAt.localeCompare(b.executedAt));
  const synced = executions.some((execution) => execution.source === "sync");
  const [close, setClose] = useState<{
    quantity: string;
    price: string;
    fee: string;
    datetime: string;
    touched: boolean;
  } | null>(null);
  const openQty = Number(
    Math.abs(
      sorted.reduce((sum, e) => sum + (e.side === "buy" ? e.quantity : -e.quantity), 0),
    ).toFixed(8),
  );
  const closeSide = trade.direction === "long" ? "sell" : "buy";

  const putExecutions = async (
    payload: Array<{
      id?: string;
      side: "buy" | "sell";
      quantity: number;
      price: number;
      fee: number;
      executedAt: string;
    }>,
  ) => {
    setBusy(true);
    try {
      const result = await postJson<{ key: string }>(
        `/api/trades/${encodeURIComponent(trade.key)}/executions`,
        { executions: payload },
        "PUT",
      );
      setRows(null);
      setClose(null);
      if (result.key !== trade.key)
        router.replace(`/trades/${encodeURIComponent(result.key)}${window.location.search}`);
      else onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t save the executions.");
    } finally {
      setBusy(false);
    }
  };

  const startClosing = () => {
    setError("");
    setRows(null);
    setClose({
      quantity: String(openQty),
      price: "",
      fee: "",
      datetime: nowZonedInput(timeZone),
      touched: false,
    });
  };

  const submitClose = async () => {
    if (!close || busy) return;
    setError("");
    const quantity = Number(close.quantity);
    const price = Number(close.price);
    const fee = close.fee === "" ? 0 : Number(close.fee);
    const executedAt = close.touched
      ? zonedInputToIso(close.datetime, timeZone)
      : new Date().toISOString();
    if (!(quantity > 0) || close.price.trim() === "" || !Number.isFinite(price) || !Number.isFinite(fee) || !executedAt) {
      setError("Enter the quantity, the exit price, and a valid date and time.");
      return;
    }
    if (quantity > openQty + 1e-9) {
      setError(
        `The open position is ${fmtNumber(openQty, 4)}. Closing more would open a new position the other way.`,
      );
      return;
    }
    await putExecutions([
      ...sorted.map((e) => ({
        id: e.id,
        side: e.side,
        quantity: e.quantity,
        price: e.price,
        fee: e.fee,
        executedAt: e.executedAt,
      })),
      { side: closeSide, quantity, price, fee, executedAt },
    ]);
  };

  const startEditing = () => {
    setError("");
    setClose(null);
    setRows(
      sorted.map((execution) => {
        const datetime = isoToZonedInput(execution.executedAt, timeZone);
        return {
          id: execution.id,
          side: execution.side,
          quantity: String(execution.quantity),
          price: String(execution.price),
          fee: String(execution.fee),
          datetime,
          originalDatetime: datetime,
          originalIso: execution.executedAt,
          touched: true,
        };
      }),
    );
  };

  const setRow = (index: number, patch: Partial<EditRow>) =>
    setRows((current) =>
      current ? current.map((row, i) => (i === index ? { ...row, ...patch } : row)) : current,
    );

  const addRow = () =>
    setRows((current) => {
      if (!current) return current;
      const last = current[current.length - 1];
      return [
        ...current,
        {
          side: last?.side === "buy" ? "sell" : "buy",
          // A second execution usually closes the first, so start from its quantity.
          quantity: current.length === 1 ? current[0]!.quantity : "",
          price: "",
          fee: "",
          datetime: nowZonedInput(timeZone),
          touched: false,
        },
      ];
    });

  const deleteTrade = async () => {
    if (
      !confirm(
        `Delete this ${trade.symbol} trade and its ${executions.length} execution${executions.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await postJson(`/api/trades/${encodeURIComponent(trade.key)}`, undefined, "DELETE");
      router.push("/trades");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t delete the trade.");
      setBusy(false);
    }
  };

  const save = async () => {
    if (!rows || busy) return;
    setError("");
    const payload = [];
    for (const [index, row] of rows.entries()) {
      const quantity = Number(row.quantity);
      const price = Number(row.price);
      const fee = row.fee === "" ? 0 : Number(row.fee);
      let executedAt: string | null;
      if (!row.id && !row.touched) executedAt = new Date().toISOString();
      else if (row.originalIso && row.datetime === row.originalDatetime)
        executedAt = row.originalIso;
      else executedAt = zonedInputToIso(row.datetime, timeZone);
      if (
        !(quantity > 0) ||
        row.price.trim() === "" ||
        !Number.isFinite(price) ||
        !Number.isFinite(fee) ||
        !executedAt
      ) {
        setError(`Execution ${index + 1} needs a date and time, a quantity above 0, and a price.`);
        return;
      }
      payload.push({ id: row.id, side: row.side, quantity, price, fee, executedAt });
    }
    await putExecutions(payload);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Executions</CardTitle>
          <p className="text-xs text-muted-foreground">Times in {timeZone}</p>
        </div>
        {!rows && (
          <div className="flex flex-wrap justify-end gap-2">
            {trade.status === "open" && !synced && openQty > 0 && !close && (
              <Button size="sm" onClick={startClosing}>
                <Check />
                Close trade
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={startEditing}
              disabled={synced}
              title={synced ? "Broker-synced executions can't be edited" : undefined}
            >
              <Pencil />
              Edit executions
            </Button>
            <AddTradeDialog
              duplicate
              onSaved={onSaved}
              initial={{
                accountId: trade.accountId,
                symbol: trade.symbol,
                side: trade.direction === "long" ? "buy" : "sell",
                quantity: trade.quantity,
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => void deleteTrade()} disabled={busy}>
              <Trash2 />
              Delete trade
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {rows ? (
          <fieldset disabled={busy} className="min-w-0 space-y-2">
            <div className="hidden gap-2 px-1 text-xs text-muted-foreground sm:grid sm:grid-cols-[1.7fr_0.9fr_1fr_1fr_0.8fr_2rem]">
              <span>Date & time</span>
              <span>Side</span>
              <span>Quantity</span>
              <span>Price</span>
              <span>Fee</span>
              <span />
            </div>
            {rows.map((row, index) => (
              <div
                key={row.id ?? `new-${index}`}
                className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1.7fr_0.9fr_1fr_1fr_0.8fr_2rem] sm:items-center sm:border-0 sm:p-0"
              >
                <DateTimePicker
                  seconds
                  label={`Execution ${index + 1} date and time`}
                  value={row.datetime}
                  getNow={() => nowZonedInput(timeZone)}
                  onValueChange={(value) => setRow(index, { datetime: value, touched: true })}
                />
                <Select
                  value={row.side}
                  onValueChange={(value) => setRow(index, { side: value as "buy" | "sell" })}
                >
                  <SelectTrigger aria-label={`Execution ${index + 1} side`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy</SelectItem>
                    <SelectItem value="sell">Sell</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`Execution ${index + 1} quantity`}
                  placeholder="qty"
                  inputMode="decimal"
                  value={row.quantity}
                  onChange={(event) => setRow(index, { quantity: event.target.value })}
                />
                <MonetaryField>
                  <Input
                    aria-label={`Execution ${index + 1} price`}
                    placeholder="price"
                    inputMode="decimal"
                    value={row.price}
                    onChange={(event) => setRow(index, { price: event.target.value })}
                  />
                </MonetaryField>
                <MonetaryField>
                  <Input
                    aria-label={`Execution ${index + 1} fee`}
                    placeholder="fee"
                    inputMode="decimal"
                    value={row.fee}
                    onChange={(event) => setRow(index, { fee: event.target.value })}
                  />
                </MonetaryField>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Remove execution ${index + 1}`}
                  disabled={rows.length <= 1}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={addRow}>
                <Plus />
                Add execution
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={busy}>
                {busy ? "Saving…" : "Save executions"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRows(null);
                  setError("");
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              P&L, status and duration are recalculated when you save. Your notes, tags and rating
              stay with the trade.
            </p>
          </fieldset>
        ) : (
          <>
          {close && (
            <fieldset disabled={busy} className="mb-3 grid gap-2 rounded-lg border p-3">
              <legend className="px-1 text-xs text-muted-foreground">
                Close trade: {closeSide === "sell" ? "sell" : "buy"} to exit
              </legend>
              <div className="grid gap-2 sm:grid-cols-4">
                <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
                  Date & time
                  <DateTimePicker
                    seconds
                    label="Close date and time"
                    value={close.datetime}
                    getNow={() => nowZonedInput(timeZone)}
                    onValueChange={(value) => setClose({ ...close, datetime: value, touched: true })}
                  />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Quantity
                  <Input
                    inputMode="decimal"
                    value={close.quantity}
                    onChange={(event) => setClose({ ...close, quantity: event.target.value })}
                  />
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Exit price
                  <MonetaryField>
                    <Input
                      autoFocus
                      inputMode="decimal"
                      value={close.price}
                      onChange={(event) => setClose({ ...close, price: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void submitClose();
                      }}
                    />
                  </MonetaryField>
                </label>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Fee (optional)
                  <MonetaryField>
                    <Input
                      className="w-28"
                      inputMode="decimal"
                      value={close.fee}
                      onChange={(event) => setClose({ ...close, fee: event.target.value })}
                    />
                  </MonetaryField>
                </label>
                <Button size="sm" onClick={() => void submitClose()} disabled={busy}>
                  {busy ? "Saving…" : "Close trade"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setClose(null);
                    setError("");
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Quantity starts at the full open position. Close less to scale out and keep the
                rest open.
              </p>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="mb-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Side</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Fee</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((execution) => (
                <TableRow key={execution.id}>
                  <TableCell className="text-muted-foreground">
                    {formatTimestamp(execution.executedAt, timeZone)}
                  </TableCell>
                  <TableCell>
                    <span className={execution.side === "buy" ? "text-profit" : "text-loss"}>
                      {execution.side === "buy" ? "▲ BUY" : "▼ SELL"}
                    </span>
                  </TableCell>
                  <TableCell className="tnum">{fmtNumber(execution.quantity, 4)}</TableCell>
                  <TableCell className="tnum">
                    <MonetaryValue>{fmtNumber(execution.price)}</MonetaryValue>
                  </TableCell>
                  <TableCell className="tnum text-muted-foreground">
                    <MonetaryValue>{fmtMoney(execution.fee)}</MonetaryValue>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
