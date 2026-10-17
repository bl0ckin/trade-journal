"use client";

import { AlertTriangle, BellRing, Clock3, Layers, Trophy, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { propMoney } from "@/lib/prop-firms";
import {
  type AttentionItem,
  type FirmCard,
  type accountPipeline,
  type payoutPulse,
} from "@/lib/prop-insights";

const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);
const days = (value: number | null) => (value === null ? "—" : `${Math.round(value)}d`);

/** Slim bar that is always paired with a printed number. */
function Bar({ value, tone }: { value: number | null; tone?: "good" | "bad" }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(1, Math.max(0, value ?? 0)) * 100}%`,
          background:
            tone === "bad"
              ? "var(--loss)"
              : tone === "good"
                ? "var(--profit-fill)"
                : "var(--brand)",
          transition: "width 400ms cubic-bezier(.2,.8,.2,1)",
        }}
      />
    </div>
  );
}

export function PropAttention({
  items,
  onAction,
}: {
  items: AttentionItem[];
  onAction: (action: AttentionItem["action"]) => void;
}) {
  if (!items.length) return null;
  return (
    <div
      role="status"
      className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3"
    >
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-amber-800 dark:text-amber-300">
        <BellRing className="h-3.5 w-3.5" />
        Needs attention
      </p>
      {items.map((item) => (
        <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            {item.tone === "danger" && <AlertTriangle className="h-3.5 w-3.5 text-loss" />}
            {item.text}
          </span>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onAction(item.action)}>
            {item.action === "payouts" ? "Review payouts →" : "See renewals →"}
          </Button>
        </div>
      ))}
    </div>
  );
}

export function PropPipeline({ pipeline }: { pipeline: ReturnType<typeof accountPipeline> }) {
  const cells = [
    { icon: <Layers />, label: "Active challenges", value: pipeline.challenges, hint: "Evaluation + verification" },
    { icon: <Trophy />, label: "Active funded", value: pipeline.funded, hint: "Funded, instant & live" },
    {
      icon: <TrendingUp />,
      label: "Passed / failed",
      value: `${pipeline.passed} / ${pipeline.failed}`,
      hint:
        pipeline.avgDaysToPass !== null
          ? `Passes take ~${days(pipeline.avgDaysToPass)} on average`
          : "Resolved challenge phases",
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cells.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-3.5">
                {c.icon}
              </span>
              {c.label}
            </div>
            <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">{c.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{c.hint}</p>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Challenge pass rate</p>
          <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
            {percent(pipeline.passRate)}
          </p>
          <div className="mt-2">
            <Bar value={pipeline.passRate} tone="good" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {pipeline.passed} of {pipeline.resolved} resolved phases
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function PropFirmScorecards({
  cards,
  currency,
  privacy,
}: {
  cards: FirmCard[];
  currency: string;
  privacy: boolean;
}) {
  const money = (value: number) => (privacy ? "••••" : currency ? propMoney(value, currency) : "—");
  const maxSpend = Math.max(1, ...cards.map((c) => c.spent));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Firm scorecard{currency ? ` · ${currency}` : ""}</CardTitle>
      </CardHeader>
      <CardContent>
        {!currency ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Choose a currency in Filters to compare firms.
          </p>
        ) : !cards.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Add an account or record a cost to compare firms.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <div key={c.firm} className="space-y-3 rounded-xl border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="truncate font-medium">{c.firm}</h4>
                    <p className="text-xs text-muted-foreground">
                      {c.accounts} account{c.accounts === 1 ? "" : "s"} · {c.active} active
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ${
                      c.net > 0 ? "bg-profit/15 text-profit" : c.net < 0 ? "bg-loss/15 text-loss" : "bg-muted"
                    }`}
                  >
                    {privacy ? "••••" : `${c.net > 0 ? "+" : ""}${money(c.net)}`}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Spent {money(c.spent)}</span>
                    <span>Paid out {money(c.received)}</span>
                  </div>
                  {!privacy && (
                    <div className="grid grid-cols-2 gap-1">
                      <Bar value={c.spent / maxSpend} tone="bad" />
                      <Bar value={c.received / maxSpend} tone="good" />
                    </div>
                  )}
                </div>
                <div className="flex justify-between border-t pt-2 text-xs text-muted-foreground">
                  <span>
                    Pass rate{" "}
                    <span className="text-foreground">
                      {c.passRate === null ? "—" : `${percent(c.passRate)} (${c.passed}/${c.passed + c.failed})`}
                    </span>
                  </span>
                  <span>
                    ROI{" "}
                    <span className="text-foreground">
                      {privacy ? "••••" : c.roi === null ? "—" : `${(c.roi * 100).toFixed(0)}%`}
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Bars share one scale so firms are comparable. Shared firm costs count towards the firm.
        </p>
      </CardContent>
    </Card>
  );
}

export function PropPayoutPulse({
  pulse,
  currency,
  privacy,
}: {
  pulse: ReturnType<typeof payoutPulse>;
  currency: string;
  privacy: boolean;
}) {
  const money = (value: number) => (privacy ? "••••" : currency ? propMoney(value, currency) : "—");
  const rows: [string, string][] = [
    ["Waiting on firms", String(pulse.waiting)],
    ["Overdue", String(pulse.overdue)],
    ["Outstanding", money(pulse.outstanding)],
    ["Next expected", pulse.nextDue ?? "—"],
    ["Average wait for cash", days(pulse.avgDaysToCash)],
    ["Largest payout received", money(pulse.largest)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock3 className="h-3.5 w-3.5" />
          Payout pulse
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 py-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className={`font-medium tabular-nums ${k === "Overdue" && pulse.overdue ? "text-loss" : ""}`}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Wait time is request date to first receipt, across all dates.
        </p>
      </CardContent>
    </Card>
  );
}

/** Small progress meter for received ÷ expected on payout cards. */
export function PayoutMeter({ actual, expected }: { actual: number; expected: number }) {
  const ratio = expected > 0 ? Math.min(1, actual / expected) : 0;
  return (
    <div>
      <Bar value={ratio} tone={ratio >= 1 ? "good" : undefined} />
      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
        {expected > 0 ? `${Math.round(ratio * 100)}% of expected received` : "No expected amount"}
      </p>
    </div>
  );
}

export { Bar as InsightBar };
