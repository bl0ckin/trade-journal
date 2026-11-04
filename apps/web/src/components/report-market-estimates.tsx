"use client";

import { useEffect, useRef, useState } from "react";
import {
  RESOLUTIONS,
  type Resolution,
  type MarketConnection,
  type TradeMarketResult,
} from "@/lib/market-data";
import type { TradePoint } from "@/lib/trade-explorer";
import { providerInfo } from "@/lib/market-providers";
import { autoMarketTarget, pickResolution } from "@/lib/market-routing";
import { useApi } from "@/lib/use-api";
import { Button } from "./ui/button";
import { OptionSelect } from "./ui/option-select";

export function ReportMarketEstimates({
  points,
  currencies,
  onComplete,
}: {
  points: TradePoint[];
  currencies: string[];
  onComplete: () => void;
}) {
  const { data } = useApi<{ connections: MarketConnection[] }>("/api/market-data/connections");
  const available = data?.connections.filter((item) => item.configured) ?? [];
  // "auto" routes each trade by its own ticker: Binance/Coinbase for crypto, Alpaca for stocks.
  const [provider, setProvider] = useState("auto");
  const [dataset, setDataset] = useState("");
  const [resolution, setResolution] = useState<Resolution | "auto">("auto");
  const automatic = provider === "auto";
  const info = automatic ? undefined : providerInfo(provider);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const missing = points.filter((point) => point.mae === null || point.mfe === null);
  const calculate = async () => {
    if (
      !automatic &&
      (!available.some((item) => item.id === provider) || (info?.datasets && !dataset))
    )
      return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setIssues([]);
    let saved = 0,
      failed = 0,
      completed = 0,
      consecutiveFailures = 0;
    const problems = new Set<string>();
    try {
      for (const point of missing) {
        if (request.signal.aborted) break;
        setStatus(`Calculating ${completed + 1} of ${missing.length} · ${point.symbol}`);
        try {
          const opened = new Date(
            Date.parse(point.closedAt) - (point.durationMinutes ?? 0) * 60_000,
          ).toISOString();
          const target = automatic
            ? autoMarketTarget(
                point.symbol,
                null,
                available.map((item) => item.id),
              )
            : { provider, symbol: point.symbol, dataset };
          if (!target)
            throw new Error(
              "No connected provider covers this ticker automatically. Open the trade to load it by hand.",
            );
          const response = await fetch(`/api/trades/${encodeURIComponent(point.key)}/market-data`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: target.provider,
              symbol: target.symbol,
              resolution: resolution === "auto" ? pickResolution(opened, point.closedAt) : resolution,
              dataset: target.dataset,
              basisConfirmed: true,
              estimateOnly: true,
            }),
            signal: request.signal,
          });
          const body = (await response.json()) as TradeMarketResult & { error?: string };
          if (!response.ok) throw new Error(body.error ?? "History request failed.");
          if (body.estimate.mae === null || body.estimate.mfe === null)
            throw new Error(body.estimate.warnings[0] ?? "Estimate unavailable.");
          saved++;
          consecutiveFailures = 0;
        } catch (cause) {
          if (request.signal.aborted) break;
          failed++;
          consecutiveFailures++;
          problems.add(
            `${point.symbol}: ${cause instanceof Error ? cause.message : "History request failed."}`,
          );
          setIssues([...problems].slice(0, 3));
        }
        completed++;
        // Stop a systemic provider failure instead of repeating it across an entire account.
        if (consecutiveFailures >= 3) break;
      }
    } finally {
      setBusy(false);
      setStatus(
        `${request.signal.aborted ? "Stopped. " : ""}${saved} estimates saved · ${failed} unavailable · ${missing.length - completed} not processed.`,
      );
      onComplete();
    }
  };
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h3 className="text-sm font-medium">MAE & MFE estimates</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {points.length - missing.length} of {points.length} closed trades have saved estimates.
          Estimated gross excursions exclude fees; MAE is shown as a positive adverse amount.
          Missing values are excluded from plots, never counted as zero.
        </p>
      </div>
      {missing.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">Calculate missing estimates</summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              {automatic
                ? "Picks a connected provider for each trade from its ticker (Binance or Coinbase for crypto, Alpaca for stocks) and a candle size that fits the trade."
                : `Loads ${resolution === "auto" ? "automatically sized" : resolution} candles using each trade’s recorded symbol.`}{" "}
              This uses your provider allowance and may take several minutes. For custom symbols or a
              specific CSV dataset, load and save estimates from the individual trade.
            </p>
            {available.length ? (
              <>
                <OptionSelect
                  aria-label="Estimate data provider"
                  value={provider}
                  disabled={busy}
                  onValueChange={(value) => {
                    setProvider(value);
                    setDataset("");
                    setConfirmed(false);
                  }}
                >
                  <option value="auto">Automatic (by ticker)</option>
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </OptionSelect>
                <OptionSelect
                  aria-label="Estimate candle resolution"
                  disabled={busy}
                  value={resolution}
                  onValueChange={(value) => setResolution(value as Resolution | "auto")}
                >
                  <option value="auto">Automatic candle size</option>
                  {Object.keys(RESOLUTIONS).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </OptionSelect>
                {info?.datasets && (
                  <OptionSelect
                    aria-label="Estimate dataset"
                    value={dataset}
                    disabled={busy}
                    onValueChange={(value) => {
                      setDataset(value);
                      setConfirmed(false);
                    }}
                  >
                    {info.datasets.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </OptionSelect>
                )}
                {info && <p className="text-xs text-muted-foreground">{info.symbolHint}</p>}
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy || currencies.length !== 1}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  I confirm these symbols, price adjustments and quote currencies match the fills
                  and account currency ({currencies.join(", ") || "none"}).
                </label>
                {currencies.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    Select accounts with one currency to calculate estimates together.
                  </p>
                )}
                <Button
                  disabled={
                    busy ||
                    !confirmed ||
                    currencies.length !== 1 ||
                    (!automatic && !available.some((item) => item.id === provider)) ||
                    Boolean(info?.datasets && !dataset)
                  }
                  onClick={() => void calculate()}
                >
                  Calculate {missing.length} missing estimates
                </Button>
              </>
            ) : (
              <a className="text-sm underline" href="/settings#market-data">
                Connect a market data provider in Settings
              </a>
            )}
          </div>
        </details>
      )}
      {busy && (
        <Button variant="outline" onClick={() => controller.current?.abort()}>
          Stop calculation
        </Button>
      )}
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
      {issues.length > 0 && (
        <ul className="space-y-1 text-xs text-destructive">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
