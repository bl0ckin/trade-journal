"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { MonetaryField } from "@/components/privacy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { postJson, useApi } from "@/lib/use-api";

import { AccountPicker } from "./account-picker";
import { nowZonedInput, zonedInputToIso } from "@/lib/datetime-input";
import { inferMarket, MARKETS } from "@/lib/markets";
import { DailyLimitWarning } from "./daily-limit-warning";

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

interface ManualLeg {
  datetime: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  fee: string;
  /** False until the user edits the date and time; untouched legs use the moment of saving. */
  edited: boolean;
  /** True while the quantity is only a copy of the first execution's. */
  quantityAuto?: boolean;
  /** True once the user chose this execution's side themselves. */
  sideEdited?: boolean;
}

const newLeg = (side: "buy" | "sell", timeZone: string): ManualLeg => ({
  datetime: nowZonedInput(timeZone),
  side,
  quantity: "",
  price: "",
  fee: "",
  edited: false,
});

export interface ManualTradeInitial {
  accountId?: string;
  symbol?: string;
  side?: "buy" | "sell";
  quantity?: number;
}

export function ManualTradeEntry({
  onSaved,
  initial,
}: {
  onSaved: () => void;
  initial?: ManualTradeInitial;
}) {
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [notes, setNotes] = useState("");
  // The market follows the ticker (…USDT → crypto, ES/NQ… → futures, else stocks) until the user picks one.
  const [market, setMarket] = useState<string>(() =>
    initial?.symbol ? (inferMarket(initial.symbol) ?? "none") : "none",
  );
  const [marketPicked, setMarketPicked] = useState(false);
  const [legs, setLegs] = useState<ManualLeg[]>(() => {
    const first = newLeg(initial?.side ?? "buy", deviceZone());
    const second = newLeg(first.side === "buy" ? "sell" : "buy", deviceZone());
    if (initial?.quantity) {
      first.quantity = String(initial.quantity);
      second.quantity = String(initial.quantity);
      second.quantityAuto = true;
    }
    return [first, second];
  });
  // Symbols you have traded before, for suggestions and a remembered quantity.
  const { data: known } = useApi<{ symbols: { symbol: string; lastQuantity: number }[] }>(
    "/api/symbols",
  );
  const recent = known?.symbols.slice(0, 6) ?? [];
  const applyKnownQuantity = (name: string) =>
    setLegs((current) => {
      const [first, second] = current;
      if (!first || (first.quantity !== "" && !first.quantityAuto)) return current;
      const match = known?.symbols.find((item) => item.symbol.toUpperCase() === name.trim().toUpperCase());
      const quantity = match ? String(match.lastQuantity) : "";
      const next = [...current];
      next[0] = { ...first, quantity, quantityAuto: Boolean(match) };
      if (second && (second.quantityAuto || second.quantity === ""))
        next[1] = { ...second, quantity, quantityAuto: Boolean(match) };
      return next;
    });
  const chooseSymbol = (name: string) => {
    setSymbol(name);
    if (!marketPicked) setMarket(inferMarket(name) ?? "none");
    applyKnownQuantity(name);
  };
  // Times are entered and shown in the journal timezone, like the trade pages.
  const { data: settings } = useApi<{ timeZone: string }>("/api/settings");
  const timeZone = settings?.timeZone ?? deviceZone();
  useEffect(() => {
    setLegs((current) =>
      current.map((leg) => (leg.edited ? leg : { ...leg, datetime: nowZonedInput(timeZone) })),
    );
  }, [timeZone]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fieldId = useId();

  const setLeg = (index: number, patch: Partial<ManualLeg>) =>
    setLegs((current) => {
      const own: Partial<ManualLeg> = { ...patch };
      if ("quantity" in patch) own.quantityAuto = false;
      if ("side" in patch && index > 0) own.sideEdited = true;
      const next = current.map((leg, i) => (i === index ? { ...leg, ...own } : leg));
      // The second execution follows the first: same quantity, opposite side,
      // until the user edits those fields on the second execution themselves.
      const second = next[1];
      if (index === 0 && second) {
        const follow: Partial<ManualLeg> = {};
        if ("quantity" in patch && (second.quantityAuto || second.quantity === ""))
          Object.assign(follow, { quantity: patch.quantity ?? "", quantityAuto: true });
        if ("side" in patch && !second.sideEdited)
          follow.side = patch.side === "buy" ? "sell" : "buy";
        next[1] = { ...second, ...follow };
      }
      return next;
    });

  const valid =
    accountId &&
    symbol &&
    legs.some((leg) => leg.datetime && Number(leg.quantity) > 0 && leg.price !== "");

  const removeLeg = (index: number) =>
    setLegs((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current));

  const save = async () => {
    if (!valid || busy) return;
    setError("");
    const incomplete = legs.findIndex((leg) => {
      const started =
        (leg.quantity.trim() !== "" && !leg.quantityAuto) ||
        leg.price.trim() !== "" ||
        leg.fee.trim() !== "";
      const complete = Number(leg.quantity) > 0 && leg.price.trim() !== "" && Number.isFinite(Number(leg.price));
      return started && !complete;
    });
    if (incomplete >= 0) {
      setError(
        `Execution ${incomplete + 1} is incomplete. Enter a quantity above 0 and a price, or remove it.`,
      );
      return;
    }
    setBusy(true);
    try {
      await postJson("/api/executions", {
        accountId,
        ...(notes.trim() ? { notes } : {}),
        executions: legs
          .filter((leg) => leg.datetime && Number(leg.quantity) > 0 && leg.price !== "")
          .map((leg) => ({
            symbol,
            ...(market !== "none" ? { assetClass: market } : {}),
            side: leg.side,
            quantity: Number(leg.quantity),
            price: Number(leg.price),
            fee: leg.fee === "" ? 0 : Number(leg.fee),
            // Legs whose time was never edited are stamped with the moment of saving.
            executedAt: (leg.edited ? zonedInputToIso(leg.datetime, timeZone) : null) ?? new Date().toISOString(),
          })),
      });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t save the trade. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <AccountPicker value={accountId} onChange={setAccountId} kind="manual" />
      <div>
        <Label htmlFor={`${fieldId}-symbol`} className="mb-1 block text-xs text-muted-foreground">
          Symbol
        </Label>
        <Input
          id={`${fieldId}-symbol`}
          value={symbol}
          list={`${fieldId}-symbols`}
          autoComplete="off"
          onChange={(event) => chooseSymbol(event.target.value.toUpperCase())}
          placeholder="AAPL, ESZ6, BTCUSDT…"
        />
        <datalist id={`${fieldId}-symbols`}>
          {(known?.symbols ?? []).map((item) => (
            <option key={item.symbol} value={item.symbol} />
          ))}
        </datalist>
        {recent.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Recent:</span>
            {recent.map((item) => (
              <button
                key={item.symbol}
                type="button"
                onClick={() => chooseSymbol(item.symbol)}
                className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
              >
                {item.symbol}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
        <span id={`${fieldId}-market`}>Market</span>
        <Select
          value={market}
          onValueChange={(value) => {
            setMarket(value);
            setMarketPicked(true);
          }}
        >
          <SelectTrigger aria-labelledby={`${fieldId}-market`}>
            <SelectValue />
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
        {!marketPicked && market !== "none" && (
          <span>Detected from the ticker. Change it if that’s wrong.</span>
        )}
      </div>
      <DailyLimitWarning accountId={accountId} />
      <div className="manual-executions space-y-3">
        {legs.map((leg, index) => (
          <fieldset
            key={index}
            className="manual-execution-row relative grid min-w-0 gap-2 rounded-lg border p-3"
          >
            <legend className="px-1 text-xs text-muted-foreground">Execution {index + 1}</legend>
            {legs.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1 h-7 w-7"
                aria-label={`Remove execution ${index + 1}`}
                onClick={() => removeLeg(index)}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            <label className="manual-execution-date grid min-w-0 gap-1 text-xs text-muted-foreground">
              Date & time
              <DateTimePicker
                seconds
                label={`Execution ${index + 1} date and time`}
                value={leg.datetime}
                getNow={() => nowZonedInput(timeZone)}
                onValueChange={(value) => setLeg(index, { datetime: value, edited: true })}
              />
            </label>
            <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              <span id={`${fieldId}-execution-side-${index}`}>Side</span>
              <Select
                value={leg.side}
                onValueChange={(value) => setLeg(index, { side: value as "buy" | "sell" })}
              >
                <SelectTrigger aria-labelledby={`${fieldId}-execution-side-${index}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="buy">Buy</SelectItem>
                  <SelectItem value="sell">Sell</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              Quantity
              <Input
                placeholder="qty"
                inputMode="decimal"
                value={leg.quantity}
                onChange={(event) => setLeg(index, { quantity: event.target.value })}
              />
            </label>
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              Price
              <MonetaryField>
                <Input
                  placeholder="price"
                  inputMode="decimal"
                  value={leg.price}
                  onChange={(event) => setLeg(index, { price: event.target.value })}
                />
              </MonetaryField>
            </label>
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              Fee
              <MonetaryField>
                <Input
                  placeholder="fee"
                  inputMode="decimal"
                  value={leg.fee}
                  onChange={(event) => setLeg(index, { fee: event.target.value })}
                />
              </MonetaryField>
            </label>
          </fieldset>
        ))}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${fieldId}-notes`}>Notes (optional)</Label>
        <textarea
          id={`${fieldId}-notes`}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={100000}
          rows={4}
          placeholder="Your setup, why you took the trade, or what you learned…"
          className="flex w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
        <p className="text-xs text-muted-foreground">
          Markdown supported. Notes are saved with the trade; existing notes are kept when adding to
          an open position.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLegs((current) => [...current, newLeg("sell", timeZone)])}
        >
          Add execution
        </Button>
        <Button size="sm" onClick={save} disabled={!valid || busy}>
          {busy ? "Saving…" : "Save trade"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Picking a symbol you have traded fills in the quantity you used last. The second execution copies the first one’s quantity and takes the opposite side. Leave its
        price empty to keep the position open. Dates and times use your journal timezone ({timeZone}). Each trade you add is kept on its own, so it never changes your other trades. To add to a position, open the trade and use Edit executions.
      </p>
    </fieldset>
  );
}
