"use client";

import { useEffect, useState } from "react";
import { Field, fieldClass } from "@/components/filter-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MonetaryField } from "./privacy";
import { postJson, useApi } from "@/lib/use-api";
import type { RiskLimits } from "@/lib/risk-limits";

const toText = (value: number | null) => (value === null ? "" : String(value));
const toNumber = (text: string) => (text.trim() === "" ? null : Number(text));

export function RiskLimitSettings() {
  const { data, error, refresh } = useApi<{ limits: RiskLimits }>("/api/risk-limits");
  const [loss, setLoss] = useState("");
  const [count, setCount] = useState("");
  const [streak, setStreak] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data) return;
    setLoss(toText(data.limits.maxDailyLoss));
    setCount(toText(data.limits.maxTradesPerDay));
    setStreak(toText(data.limits.maxConsecutiveLosses ?? null));
  }, [data]);
  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      await postJson(
        "/api/risk-limits",
        { maxDailyLoss: toNumber(loss), maxTradesPerDay: toNumber(count),
          maxConsecutiveLosses: toNumber(streak),
        },
        "PUT",
      );
      setStatus("Saved.");
      refresh();
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Couldn’t save the limits.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily risk limits</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Max daily loss">
            <MonetaryField sensitive>
              <input
                type="number"
                min="0"
                step="any"
                className={fieldClass}
                value={loss}
                placeholder="No limit"
                onChange={(event) => setLoss(event.target.value)}
              />
            </MonetaryField>
          </Field>
          <Field label="Max trades per day">
            <input
              type="number"
              min="1"
              step="1"
              className={fieldClass}
              value={count}
              placeholder="No limit"
              onChange={(event) => setCount(event.target.value)}
            />
          </Field>
          <Field label="Max consecutive losses">
            <input
              type="number"
              min="1"
              step="1"
              className={fieldClass}
              value={streak}
              placeholder="No limit"
              onChange={(event) => setStreak(event.target.value)}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          A warning appears on the dashboard and when you add a trade once you are close to, or past,
          either limit. Each account is checked separately, in its own currency, for the current day
          in your journal timezone. The loss counts realised P&L from trades closed today; the trade
          count includes trades opened today; the streak is the run of losing trades at the end of today’s closed trades. Leave a field empty for no limit. Warnings only
          remind you — they never block a trade.
        </p>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save limits"}
          </Button>
          {status && (
            <span role="status" className="text-xs text-muted-foreground">
              {status}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
