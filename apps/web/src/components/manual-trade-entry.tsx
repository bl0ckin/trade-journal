"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X, Zap } from "lucide-react";
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
import type { SymbolHit } from "@/lib/market-routing";

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
      // Only replace an auto-filled quantity when the new ticker has a remembered one.
      // Clearing it on every keystroke of an unknown ticker emptied the executions.
      if (!match) return current;
      const quantity = String(match.lastQuantity);
      const next = [...current];
      next[0] = { ...first, quantity, quantityAuto: true };
      if (second && (second.quantityAuto || second.quantity === ""))
        next[1] = { ...second, quantity, quantityAuto: true };
      return next;
    });
  const chooseSymbol = (name: string) => {
    setSymbol(name);
    if (!marketPicked) setMarket(inferMarket(name) ?? "none");
    applyKnownQuantity(name);
  };
  // Ticker search across the connected data sources (Alpaca stocks, Binance/Coinbase crypto).
  const [hits, setHits] = useState<SymbolHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [priceStatus, setPriceStatus] = useState<{ leg: number; text: string; bad?: boolean } | null>(
    null,
  );
  const [pricing, setPricing] = useState<number | null>(null);
  // Latest ticker, so a slow price reply for an old ticker is never applied to a new one.
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;
  useEffect(() => {
    const query = symbol.trim();
    if (!searchOpen || query.length < 1) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/symbols/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { results: [] }))
        .then((body: { results?: SymbolHit[] }) => setHits(body.results ?? []))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [symbol, searchOpen]);
  const pickHit = (hit: SymbolHit) => {
    setSymbol(hit.symbol);
    if (!marketPicked) setMarket(hit.market);
    applyKnownQuantity(hit.symbol);
    setSearchOpen(false);
    setHits([]);
  };
  /** Fill one execution's price with the latest traded price for the symbol. */
  const fillCurrentPrice = async (index: number) => {
    // The ticker suggestions float over the execution rows; never leave them open.
    setSearchOpen(false);
    setHits([]);
    setPricing(index);
    setPriceStatus(null);
    const asked = symbol.trim().toUpperCase();
    try {
      const response = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol.trim())}`);
      const body = (await response.json()) as { price?: number; provider?: string; error?: string };
      if (!response.ok || typeof body.price !== "number" || !(body.price > 0))
        throw new Error(body.error ?? "Could not get a price.");
      if (symbolRef.current.trim().toUpperCase() !== asked) return;
      setLeg(index, { price: String(body.price) });
      setPriceStatus({ leg: index, text: `Latest ${body.provider} price filled in.` });
    } catch (error) {
      setPriceStatus({
        leg: index,
        text: error instanceof Error ? error.message : "Could not get a price.",
        bad: true,
      });
    } finally {
      setPricing(null);
    }
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

  // The wrapper is a plain div, not a <fieldset>: Chrome collapses the .manual-executions size
  // container to zero height inside a fieldset when the content around it re-renders (the
  // executions "disappeared" after a second "current price" click). `inert` still blocks input while saving.
  return (
    <div inert={busy || undefined} aria-busy={busy} className="min-w-0 space-y-3">
      <AccountPicker value={accountId} onChange={setAccountId} kind="manual" />
      <div className="grid min-w-0 items-start gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <Label htmlFor={`${fieldId}-symbol`} className="mb-1 block text-xs text-muted-foreground">
          Symbol
        </Label>
        <div className="relative">
          <Input
            id={`${fieldId}-symbol`}
            value={symbol}
            autoComplete="off"
            role="combobox"
            aria-expanded={searchOpen && hits.length > 0}
            aria-controls={`${fieldId}-symbols`}
            onChange={(event) => {
              chooseSymbol(event.target.value.toUpperCase());
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Enter") {
                setSearchOpen(false);
                setHits([]);
              }
            }}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            placeholder="Search AAPL, BTCUSDT, ESZ6…"
          />
          {searchOpen && hits.length > 0 && (
            <ul
              id={`${fieldId}-symbols`}
              role="listbox"
              className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
            >
              {hits.map((hit) => (
                <li key={`${hit.provider}:${hit.symbol}`} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pickHit(hit)}
                    className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left hover:bg-accent"
                  >
                    <span className="font-medium">{hit.symbol}</span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{hit.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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
      <div className="min-w-0 text-xs text-muted-foreground">
        <Label id={`${fieldId}-market`} className="mb-1 block text-xs text-muted-foreground">
          Market
        </Label>
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
          <span className="mt-1 block">Detected from the ticker. Change it if that’s wrong.</span>
        )}
      </div>
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
            <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              <label htmlFor={`${fieldId}-price-${index}`}>Price</label>
              <div className="relative">
                <MonetaryField>
                  <Input
                    id={`${fieldId}-price-${index}`}
                    placeholder="price"
                    inputMode="decimal"
                    className="pr-9"
                    value={leg.price}
                    onChange={(event) => setLeg(index, { price: event.target.value })}
                  />
                </MonetaryField>
                <button
                  type="button"
                  title="Fill in the current market price"
                  aria-label={`Use current price for execution ${index + 1}`}
                  disabled={!symbol.trim() || pricing !== null}
                  onMouseDown={() => {
                    setSearchOpen(false);
                    setHits([]);
                  }}
                  onClick={() => fillCurrentPrice(index)}
                  className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  <Zap className={`size-3.5 ${pricing === index ? "animate-pulse" : ""}`} />
                </button>
              </div>
            </div>
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
      {priceStatus && (
        <p
          role={priceStatus.bad ? "alert" : "status"}
          className={`text-xs ${priceStatus.bad ? "text-destructive" : "text-muted-foreground"}`}
        >
          Execution {priceStatus.leg + 1}: {priceStatus.text}
        </p>
      )}
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
    </div>
  );
}
