"use client";

import { useState } from "react";
import { Check, Zap } from "lucide-react";
import { MonetaryField } from "@/components/privacy";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { nowZonedInput, zonedInputToIso } from "@/lib/datetime-input";
import { postJson } from "@/lib/use-api";
import { fmtNumber } from "@/lib/utils";

export interface CloseableTrade {
  key: string;
  symbol: string;
  direction: "long" | "short";
  openQuantity: number;
}

/** A compact "Close" button that exits an open trade without leaving the page. */
export function CloseTradeDialog({
  trade,
  timeZone,
  onClosed,
}: {
  trade: CloseableTrade;
  timeZone: string;
  onClosed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [datetime, setDatetime] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pricing, setPricing] = useState(false);
  const [priceNote, setPriceNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const exitSide = trade.direction === "long" ? "Sell" : "Buy";

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuantity(String(trade.openQuantity));
      setPrice("");
      setFee("");
      setDatetime(nowZonedInput(timeZone));
      setTouched(false);
      setError("");
      setPriceNote(null);
    }
  };

  /** Fill the exit price with the latest traded price for this symbol. */
  const fillCurrentPrice = async () => {
    setPricing(true);
    setPriceNote(null);
    try {
      const response = await fetch(`/api/quote?symbol=${encodeURIComponent(trade.symbol.trim())}`);
      const body = (await response.json()) as { price?: number; provider?: string; error?: string };
      if (!response.ok || typeof body.price !== "number" || !(body.price > 0))
        throw new Error(body.error ?? "Could not get a price.");
      setPrice(String(body.price));
      setPriceNote({ text: `Latest ${body.provider} price filled in.` });
    } catch (cause) {
      setPriceNote({
        text: cause instanceof Error ? cause.message : "Could not get a price.",
        bad: true,
      });
    } finally {
      setPricing(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    setError("");
    const qty = Number(quantity);
    const exitPrice = Number(price);
    const exitFee = fee === "" ? 0 : Number(fee);
    const executedAt = touched ? zonedInputToIso(datetime, timeZone) : new Date().toISOString();
    if (!(qty > 0) || price.trim() === "" || !Number.isFinite(exitPrice) || !Number.isFinite(exitFee) || !executedAt) {
      setError("Enter the quantity, the exit price, and a valid date and time.");
      return;
    }
    if (qty > trade.openQuantity + 1e-9) {
      setError(`The open position is ${fmtNumber(trade.openQuantity, 4)}.`);
      return;
    }
    setBusy(true);
    try {
      await postJson(`/api/trades/${encodeURIComponent(trade.key)}/close`, {
        quantity: qty,
        price: exitPrice,
        fee: exitFee,
        executedAt,
      });
      setOpen(false);
      onClosed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t close the trade.");
    } finally {
      setBusy(false);
    }
  };

  return (
    // Events from the dialog bubble through React to the table row, which opens the trade.
    <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
            <Check className="h-3 w-3" />
            Close
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Close {trade.symbol} {trade.direction}
            </DialogTitle>
            <DialogDescription>
              {exitSide} {fmtNumber(trade.openQuantity, 4)} to exit. Lower the quantity to scale
              out and keep the rest open.
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={busy} className="grid gap-3">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Date & time ({timeZone})
              <DateTimePicker
                seconds
                label={`Date and time (${timeZone})`}
                value={datetime}
                getNow={() => nowZonedInput(timeZone)}
                onValueChange={(value) => {
                  setDatetime(value);
                  setTouched(true);
                }}
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="grid gap-1 text-xs text-muted-foreground">
                Quantity
                <Input
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Exit price
                <div className="relative">
                  <MonetaryField>
                    <Input
                      autoFocus
                      inputMode="decimal"
                      className="pr-9"
                      value={price}
                      onChange={(event) => setPrice(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void submit();
                      }}
                    />
                  </MonetaryField>
                  <button
                    type="button"
                    title="Fill in the current market price"
                    aria-label="Use current price for the exit"
                    disabled={pricing}
                    onClick={() => void fillCurrentPrice()}
                    className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                  >
                    <Zap className={`size-3.5 ${pricing ? "animate-pulse" : ""}`} />
                  </button>
                </div>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                Fee (optional)
                <MonetaryField>
                  <Input
                    inputMode="decimal"
                    value={fee}
                    onChange={(event) => setFee(event.target.value)}
                  />
                </MonetaryField>
              </label>
            </div>
            {priceNote && (
              <p
                role={priceNote.bad ? "alert" : "status"}
                className={`text-xs ${priceNote.bad ? "text-destructive" : "text-muted-foreground"}`}
              >
                {priceNote.text}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void submit()} disabled={busy}>
                {busy ? "Closing…" : "Close trade"}
              </Button>
            </div>
          </fieldset>
        </DialogContent>
      </Dialog>
    </span>
  );
}
