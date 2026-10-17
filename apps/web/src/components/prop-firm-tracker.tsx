"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownLeft, Landmark, Plus, Download, Upload } from "lucide-react";
import { FilterBar } from "./filter-bar";
import { Field } from "./filter-fields";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { OptionSelect } from "./ui/option-select";
import { DatePicker } from "./ui/date-picker";
import { EquityArea } from "./charts/equity-area";
import { usePrivacy } from "./privacy";
import { useApi } from "@/lib/use-api";
import { PropCashSummary, PropCashComparison } from "./prop-cash-overview";
import {
  PayoutMeter,
  PropAttention,
  PropFirmScorecards,
  PropPayoutPulse,
  PropPipeline,
} from "./prop-insights";
import {
  accountPipeline,
  attentionItems,
  daysBetween,
  firmCards,
  isChallenge,
  isFunded,
  payoutPulse,
} from "@/lib/prop-insights";
import { PropFirmModal, type PropModal } from "./prop-firm-forms";
import {
  cashMovements,
  cashSummary,
  cashTimeline,
  payoutProgress,
  propMoney,
  currencyDigits,
  fromMinor,
  label,
  type PropData,
  type PropAccount,
  type PropEntry,
  type CashMovement,
  type PropReceipt,
} from "@/lib/prop-firms";
const PAGE_SIZE = 40;
const inDates = (day: string, from: string, to: string) =>
  (!from || day >= from) && (!to || day <= to);
function downloadCsv(rows: CashMovement[]) {
  const cell = (value: string) => {
    const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const header = "id,entry_id,account_id,firm,currency,date,kind,amount,category,reference";
  const csv = [
    header,
    ...rows.map((row) =>
      [
        row.id,
        row.entryId,
        row.accountId ?? "",
        row.firm,
        row.currency,
        row.date,
        row.kind,
        fromMinor(row.amountMinor, row.currency),
        row.category,
        row.reference,
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "prop-cash-flows.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
export function PropFirmTracker() {
  const { data: savedData, error, loading, refresh } = useApi<PropData>("/api/prop-firms");
  const [showBreakdowns, setShowBreakdowns] = useState(false);
  const data = savedData;
  const privacy = usePrivacy();
  const [tab, setTab] = useState("overview"),
    [firm, setFirm] = useState(""),
    [accountId, setAccountId] = useState(""),
    [currency, setCurrency] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [search, setSearch] = useState(""),
    [showArchived, setShowArchived] = useState(false),
    [showClosed, setShowClosed] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [showVoided, setShowVoided] = useState(false),
    [program, setProgram] = useState<"all" | "challenge" | "funded">("all"),
    [page, setPage] = useState(0),
    [modal, setModal] = useState<PropModal | null>(null);
  useEffect(
    () => setPage(0),
    [tab, firm, accountId, currency, from, to, search, showArchived, showClosed, showVoided, program],
  );
  useEffect(() => {
    if (privacy) setModal(null);
  }, [privacy]);
  const readOnly = privacy;
  const allCash = useMemo(() => (data ? cashMovements(data.entries, data.receipts) : []), [data]);
  const payouts = useMemo(
    () => (data ? payoutProgress(data.entries, data.receipts, data.today) : []),
    [data],
  );
  const payoutById = useMemo(() => new Map(payouts.map((row) => [row.entry.id, row])), [payouts]);
  const receiptsById = useMemo(() => {
    const map = new Map<string, PropReceipt[]>();
    for (const row of data?.receipts ?? []) {
      const list = map.get(row.payoutId) ?? [];
      list.push(row);
      map.set(row.payoutId, list);
    }
    return map;
  }, [data]);
  const firms = useMemo(
    () =>
      [
        ...new Set([
          ...(data?.accounts.map((a) => a.firm) ?? []),
          ...(data?.entries.map((e) => e.firm) ?? []),
        ]),
      ].sort(),
    [data],
  );
  const currencies = useMemo(
    () =>
      [
        ...new Set([
          ...(data?.accounts.map((a) => a.currency) ?? []),
          ...(data?.entries.map((e) => e.currency) ?? []),
        ]),
      ].sort(),
    [data],
  );
  const selectedCurrency = currency || (currencies.length === 1 ? currencies[0]! : "");
  const matches = (row: { firm: string; accountId: string | null; currency: string }) =>
    (!firm || row.firm === firm) &&
    (!accountId || row.accountId === accountId) &&
    (!currency || row.currency === currency);
  const cash = useMemo(
    () => allCash.filter((row) => matches(row) && inDates(row.date, from, to)),
    [allCash, firm, accountId, currency, from, to],
  );
  const summaryCash = useMemo(
    () => cash.filter((row) => row.currency === selectedCurrency),
    [cash, selectedCurrency],
  );
  const summary = useMemo(() => cashSummary(summaryCash), [summaryCash]);
  const selectedPayouts = payouts.filter((row) => matches(row.entry));
  const outstanding = selectedPayouts
    .filter((row) => row.entry.currency === selectedCurrency)
    .reduce((sum, row) => sum + row.remaining, 0);
  const overdue = selectedPayouts.filter((row) => row.overdue);
  const accountRows = (data?.accounts ?? []).filter((a) => matches({ ...a, accountId: a.id }));
  const active = accountRows.filter((a) => a.status === "active" && !a.archived);
  const resolved = accountRows.filter(
    (a) =>
      ["evaluation", "verification"].includes(a.program) &&
      ["passed", "breached"].includes(a.status),
  );
  const passed = resolved.filter((a) => a.status === "passed").length;
  const renewals = active
    .filter(
      (a) =>
        a.renewalOn &&
        a.renewalOn <=
          new Date(Date.parse(`${data?.today}T12:00:00Z`) + 30 * 86_400_000)
            .toISOString()
            .slice(0, 10),
    )
    .sort((a, b) => a.renewalOn!.localeCompare(b.renewalOn!));
  const money = (amount: number, code = selectedCurrency) =>
    privacy ? "••••" : code ? propMoney(amount, code) : "—";
  const name = (id: string | null) =>
    data?.accounts.find((a) => a.id === id)?.name ?? "Shared firm cost";
  const query = search.toLowerCase().trim();
  const entries = (data?.entries ?? [])
    .filter(
      (e) =>
        matches(e) &&
        (showVoided || !e.voided) &&
        inDates(e.occurredOn, from, to) &&
        (!query ||
          `${e.firm} ${name(e.accountId)} ${e.kind} ${e.category} ${e.reference}`
            .toLowerCase()
            .includes(query)),
    )
    .sort(
      (a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt),
    );
  const listedPayouts = selectedPayouts
    .filter(
      (row) =>
        (row.entry.status === "requested" ||
          row.entry.status === "approved" ||
          inDates(row.entry.occurredOn, from, to)) &&
        (!query ||
          `${row.entry.firm} ${name(row.entry.accountId)} ${row.entry.status} ${row.entry.reference}`
            .toLowerCase()
            .includes(query)),
    )
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        b.entry.occurredOn.localeCompare(a.entry.occurredOn),
    );
  const pipeline = accountPipeline(accountRows);
  const scorecards = selectedCurrency
    ? firmCards(
        accountRows.filter((a) => a.currency === selectedCurrency),
        summaryCash,
      )
    : [];
  const pulse = payoutPulse(selectedPayouts, data?.receipts ?? [], selectedCurrency);
  const attention = data ? attentionItems(accountRows, selectedPayouts, data.today) : [];
  const programCounts = {
    all: accountRows.filter((a) => !a.archived && (showClosed || a.status === "active")).length,
    challenge: accountRows.filter((a) => !a.archived && (showClosed || a.status === "active") && isChallenge(a)).length,
    funded: accountRows.filter((a) => !a.archived && (showClosed || a.status === "active") && isFunded(a)).length,
  };
  const closedCount = accountRows.filter((a) => a.status !== "active" && !a.archived).length;
  // Active accounts first, then newest; numbered duplicates (#2, #10) sort naturally.
  const listedAccounts = accountRows
    .filter(
      (a) =>
        (showArchived || !a.archived) &&
        (showClosed || a.status === "active" || a.archived) &&
        (program === "all" || (program === "challenge" ? isChallenge(a) : isFunded(a))) &&
        (!query || `${a.firm} ${a.name} ${a.program} ${a.status}`.toLowerCase().includes(query)),
    )
    .sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        b.openedOn.localeCompare(a.openedOn) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  // Drop selections for accounts that are no longer listed (resolved, deleted or filtered out).
  const listedKey = listedAccounts.map((a) => a.id).join(",");
  useEffect(() => {
    const ids = new Set(listedKey.split(","));
    setSelected((prev) =>
      prev.every((id) => ids.has(id)) ? prev : prev.filter((id) => ids.has(id)),
    );
  }, [listedKey]);
  const picked = listedAccounts.filter((a) => selected.includes(a.id));
  const canPass = (a: (typeof picked)[number]) =>
    a.status === "active" && !a.archived && ["evaluation", "verification"].includes(a.program);
  const canFail = (a: (typeof picked)[number]) => a.status === "active" && !a.archived;
  const bulk = (op: "pass" | "fail" | "delete") => {
    const eligible = picked.filter(op === "pass" ? canPass : op === "fail" ? canFail : () => true);
    setModal({
      kind: "bulk",
      op,
      ids: eligible.map((a) => a.id),
      eligible: eligible.length,
      skipped: picked.length - eligible.length,
    });
  };
  const cashByAccount = useMemo(() => {
    const groups = new Map<string, CashMovement[]>();
    for (const row of cash) {
      const key = row.accountId ?? "";
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    return groups;
  }, [cash]);
  // Earlier phases (an evaluation before its funded account, or a previous attempt) add their
  // net spend to the account that follows them, so a funded card shows the full cost to get it.
  const carriedSpend = (a: PropAccount) => {
    let total = 0;
    const seen = new Set([a.id]);
    let parent = a.parentId ? data?.accounts.find((x) => x.id === a.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      total += cashSummary(
        (cashByAccount.get(parent.id) ?? []).filter((row) => row.currency === parent!.currency),
      ).netSpend;
      parent = parent.parentId ? data?.accounts.find((x) => x.id === parent!.parentId) : undefined;
    }
    return total;
  };
  const byFirm = [...new Set(summaryCash.map((row) => row.firm))]
    .map((value) => ({
      firm: value,
      ...cashSummary(summaryCash.filter((row) => row.firm === value)),
    }))
    .sort((a, b) => b.net - a.net);
  const byCategory = EXPENSE_ROWS(summaryCash);
  const months = [...new Set(summaryCash.map((row) => row.date.slice(0, 7)))]
    .sort()
    .reverse()
    .map((month) => ({
      month,
      ...cashSummary(summaryCash.filter((row) => row.date.startsWith(month))),
    }));
  const rowCount =
    tab === "accounts"
      ? listedAccounts.length
      : tab === "payouts"
        ? listedPayouts.length
        : entries.length;
  const safePage = Math.min(page, Math.max(0, Math.ceil(rowCount / PAGE_SIZE) - 1));
  const slice = <T,>(rows: T[]) => rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const entryActions = (entry: PropEntry) => (
    <div className="flex flex-wrap gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={readOnly}
        onClick={() => setModal({ kind: "detail", type: "entry", id: entry.id })}
      >
        Details
      </Button>
      {!entry.voided && (
        <Button
          size="sm"
          variant="ghost"
          disabled={readOnly}
          onClick={() => setModal({ kind: "entry", entry, type: entry.kind })}
        >
          Edit
        </Button>
      )}
      {!entry.voided && entry.kind === "expense" && (
        <Button
          size="sm"
          variant="ghost"
          disabled={readOnly}
          onClick={() => setModal({ kind: "entry", type: "refund", expense: entry })}
        >
          Refund
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={readOnly}
        onClick={() =>
          setModal({
            kind: "change",
            action: "entry.void",
            id: entry.id,
            revision: entry.revision,
            value: !entry.voided,
            name: entry.voided ? "Restore entry" : "Void entry",
          })
        }
      >
        {entry.voided ? "Restore" : "Void"}
      </Button>
    </div>
  );
  return (
    <div>
      <FilterBar
        title="Prop firms"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!data || readOnly}
              onClick={() => setModal({ kind: "account" })}
            >
              <Plus className="h-4 w-4" />
              Add account
            </Button>

            <Button
              size="sm"
              disabled={!data || readOnly}
              onClick={() => setModal({ kind: "entry", type: "payout" })}
            >
              <ArrowDownLeft className="h-4 w-4" />
              Log payout
            </Button>
          </div>
        }
      />
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Spending & payouts</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              See what you paid, what came back, and your net result.
              {data && selectedCurrency && !privacy && summary.spent > 0 ? (
                <>
                  {" "}
                  So far you have recovered{" "}
                  <strong className="text-foreground">
                    {Math.round(((summary.refunds + summary.received) / summary.spent) * 100)}%
                  </strong>{" "}
                  of what you spent.
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!data || readOnly}
              onClick={() => setModal({ kind: "templates" })}
            >
              Templates
            </Button>
            <details className="relative">
              <summary className="cursor-pointer rounded-md border px-3 py-2 text-xs font-medium">
                Data tools
              </summary>
              <div className="absolute right-0 z-20 mt-2 flex w-48 flex-col gap-1 rounded-lg border bg-card p-2 shadow-lg">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!data || readOnly}
                  onClick={() => setModal({ kind: "import" })}
                >
                  <Upload className="h-4 w-4" />
                  Import CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!cash.length || readOnly}
                  onClick={() => downloadCsv(cash)}
                >
                  <Download className="h-4 w-4" />
                  Export cash CSV
                </Button>
              </div>
            </details>
          </div>
        </div>
        {privacy && (
          <p className="rounded-lg border p-3 text-sm text-muted-foreground">
            Privacy mode hides amounts, charts and financial details. Turn it off to edit records or
            export cash data.
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive p-3 text-sm text-destructive"
          >
            {error}{" "}
            <Button variant="ghost" onClick={refresh}>
              Retry
            </Button>
          </p>
        )}
        {loading && !data && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading your prop cash records…
          </p>
        )}
        {data && (
          <>
            {!data.accounts.length && !data.entries.length && (
              <Card>
                <CardContent className="flex flex-wrap items-center gap-5 py-7">
                  <Landmark className="h-10 w-10 text-muted-foreground" />
                  <div className="max-w-2xl">
                    <h3 className="font-semibold">Start by adding an account</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add the firm and attempt you want to track, then record fees and actual
                      payouts. You can also log shared firm costs before linking an account. No
                      firm, fee schedule or payout rules are preloaded.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" disabled={readOnly} onClick={() => setModal({ kind: "account" })}>
                        <Plus className="h-4 w-4" />
                        Add your first account
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={readOnly}
                        onClick={() => setModal({ kind: "import" })}
                      >
                        <Upload className="h-4 w-4" />
                        Import CSV
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            <details className="rounded-xl border bg-card">
              <summary className="cursor-pointer px-4 py-3 text-sm">
                <span className="font-medium">Filters</span>
                <span className="ml-3 text-xs text-muted-foreground">
                  {firm || "All firms"} · {accountId ? name(accountId) : "All accounts"} ·{" "}
                  {from || to ? `${from || "Start"} to ${to || "Today"}` : "All dates"}
                  {selectedCurrency ? ` · ${selectedCurrency}` : " · Choose currency"}
                </span>
              </summary>
              <div className="grid gap-3 border-t p-4 sm:grid-cols-2 xl:grid-cols-5">
                <Field label="Firm">
                  <OptionSelect
                    value={firm}
                    onValueChange={(value) => {
                      setFirm(value);
                      setAccountId("");
                    }}
                  >
                    <option value="">All firms</option>
                    {firms.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </OptionSelect>
                </Field>
                <Field label="Prop account">
                  <OptionSelect value={accountId} onValueChange={setAccountId}>
                    <option value="">All accounts & shared costs</option>
                    {data.accounts
                      .filter((a) => !firm || a.firm === firm)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.archived ? " (archived)" : ""}
                        </option>
                      ))}
                  </OptionSelect>
                </Field>
                <Field label="Currency">
                  <OptionSelect value={currency} onValueChange={setCurrency}>
                    <option value="">
                      {currencies.length > 1 ? "Choose currency for totals" : "All currencies"}
                    </option>
                    {currencies.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </OptionSelect>
                </Field>
                <Field label="Cash from">
                  <DatePicker
                    label="Cash from date"
                    value={from}
                    max={to || data.today}
                    onValueChange={setFrom}
                  />
                </Field>
                <Field label="Cash through">
                  <DatePicker
                    label="Cash through date"
                    value={to}
                    min={from}
                    max={data.today}
                    onValueChange={setTo}
                  />
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 xl:col-span-5">
                  <p className="text-xs text-muted-foreground">
                    Dates apply to cash received or paid. Account history and pending requests cover
                    all dates.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFirm("");
                      setAccountId("");
                      setCurrency("");
                      setFrom("");
                      setTo("");
                      setSearch("");
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              </div>
            </details>
            {from && to && from > to && (
              <p role="alert" className="text-sm text-destructive">
                The start date must be on or before the end date.
              </p>
            )}
            {currencies.length > 1 && !selectedCurrency && (
              <Card>
                <CardContent className="py-4">
                  <p className="mb-3 text-sm">
                    Currencies are never added together. Choose one above for charts and detailed
                    totals.
                  </p>
                  <div className="flex flex-wrap gap-4">
                    {currencies.map((c) => (
                      <p key={c} className="text-sm">
                        <strong>{c}</strong> · Net cash{" "}
                        {money(cashSummary(cash.filter((r) => r.currency === c)).net, c)}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            <PropCashSummary summary={summary} currency={selectedCurrency} privacy={privacy} />
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground">Awaiting payout</span>
                <strong className="tabular-nums">{money(outstanding)}</strong>
                <span className="text-xs text-muted-foreground">
                  {overdue.length ? `${overdue.length} overdue · ` : ""}All dates · Excluded from
                  received cash
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTab("payouts")}>
                View payout requests →
              </Button>
            </div>
            {!privacy && (
              <PropAttention
                items={attention}
                onAction={(action) => {
                  if (action === "payouts") setTab("payouts");
                  else {
                    setTab("overview");
                    setShowBreakdowns(true);
                  }
                }}
              />
            )}
            {accountRows.length > 0 && <PropPipeline pipeline={pipeline} />}
            <div
              role="tablist"
              aria-label="Prop tracker sections"
              className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border bg-muted/40 p-1"
            >
              {[
                ["overview", "Overview", null],
                ["accounts", "Accounts", programCounts.all],
                ["payouts", "Payouts", pulse.waiting || null],
                ["ledger", "Transactions", entries.length],
              ].map(([v, text, count]) => (
                <Button
                  key={v as string}
                  role="tab"
                  size="sm"
                  aria-selected={tab === v}
                  variant={tab === v ? "default" : "ghost"}
                  className="h-8 shrink-0"
                  onClick={() => setTab(v as string)}
                >
                  {text}
                  {count !== null && (
                    <span
                      className={`rounded-full px-1.5 text-[10px] tabular-nums ${tab === v ? "bg-primary-foreground/20" : "bg-muted"}`}
                    >
                      {count}
                    </span>
                  )}
                </Button>
              ))}
            </div>
            {tab === "overview" ? (
              <div className="space-y-4">
                <PropCashComparison months={months} currency={selectedCurrency} privacy={privacy} />
                <div className="grid gap-4 xl:grid-cols-3">
                  <div className="xl:col-span-2">
                    <PropFirmScorecards cards={scorecards} currency={selectedCurrency} privacy={privacy} />
                  </div>
                  <PropPayoutPulse pulse={pulse} currency={selectedCurrency} privacy={privacy} />
                </div>
                <details
                  className="rounded-xl border bg-card"
                  open={showBreakdowns}
                  onToggle={(event) => setShowBreakdowns(event.currentTarget.open)}
                >
                  <summary className="cursor-pointer p-4">
                    <span className="text-sm font-medium">Detailed breakdowns</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Net cash trend, firm returns, expense categories, account progress, renewals
                      and monthly records
                    </span>
                  </summary>
                  {showBreakdowns && (
                    <div className="space-y-4 border-t p-3 sm:p-4">
                      <div className="grid gap-4 xl:grid-cols-3">
                        <Card className="xl:col-span-2">
                          <CardHeader>
                            <CardTitle>
                              Net cash over time{selectedCurrency ? ` · ${selectedCurrency}` : ""}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {privacy ? (
                              <Empty>Chart hidden in privacy mode.</Empty>
                            ) : !selectedCurrency ? (
                              <Empty>Choose a currency to plot cash returns.</Empty>
                            ) : summaryCash.length ? (
                              <EquityArea
                                curve="stepAfter"
                                currency={selectedCurrency}
                                valueLabel="Net cash in selected period"
                                data={cashTimeline(summaryCash).map((p) => ({
                                  t: p.date,
                                  cumNetPnl: p.net / 10 ** currencyDigits(selectedCurrency),
                                }))}
                              />
                            ) : (
                              <Empty>
                                Record spending or a payout receipt to build your cash history.
                              </Empty>
                            )}
                            <p className="mt-3 text-xs text-muted-foreground">
                              Starts at zero for the selected period. Payouts + refunds − expenses −
                              reversals.
                            </p>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle>Account progress · all dates</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="flex justify-between text-sm">
                              <span>Active evaluations / verifications</span>
                              <strong>
                                {
                                  active.filter((a) =>
                                    ["evaluation", "verification"].includes(a.program),
                                  ).length
                                }
                              </strong>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span>Active funded / live</span>
                              <strong>
                                {
                                  active.filter((a) =>
                                    ["funded", "instant_funded", "live"].includes(a.program),
                                  ).length
                                }
                              </strong>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span>Resolved-phase pass rate</span>
                              <strong>
                                {resolved.length
                                  ? `${Math.round((passed / resolved.length) * 100)}%`
                                  : "—"}
                              </strong>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {passed} passed / {resolved.length} passed or breached evaluation
                              phases. Active and voluntarily closed phases are excluded; this is not
                              a whole-challenge success rate.
                            </p>
                            <p className="border-t pt-4 text-xs text-muted-foreground">
                              Link accounts to journal trades from account details. Funding sizes
                              are descriptive and never counted as your cash investment.
                            </p>
                          </CardContent>
                        </Card>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <Card>
                          <CardHeader>
                            <CardTitle>
                              Returns by firm{selectedCurrency ? ` · ${selectedCurrency}` : ""}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            {byFirm.length ? (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                  <thead>
                                    <tr className="border-b text-xs text-muted-foreground">
                                      <th className="py-2">Firm</th>
                                      <th>Net spend</th>
                                      <th>Payout cash</th>
                                      <th>Net return</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {byFirm.map((row) => (
                                      <tr key={row.firm} className="border-b last:border-0">
                                        <td className="py-3 pr-3">{row.firm}</td>
                                        <td className="pr-3">{money(row.netSpend)}</td>
                                        <td className="pr-3">{money(row.received)}</td>
                                        <td>{money(row.net)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <Empty>No cash movements in this selection.</Empty>
                            )}
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle>Spending breakdown</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {byCategory.length ? (
                              byCategory.map((row) => (
                                <div key={row.category}>
                                  <div className="flex justify-between gap-3 text-sm">
                                    <span>{label(row.category)}</span>
                                    <span>{money(row.amount)}</span>
                                  </div>
                                  {!privacy && (
                                    <div className="mt-1 h-1.5 rounded-full bg-muted">
                                      <div
                                        className="h-full rounded-full bg-foreground/60"
                                        style={{
                                          width: `${summary.spent ? (row.amount / summary.spent) * 100 : 0}%`,
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              ))
                            ) : (
                              <Empty>No recorded expenses in this selection.</Empty>
                            )}
                            <p className="text-xs text-muted-foreground">
                              Gross spending by category. Refunds appear separately in the summary.
                            </p>
                          </CardContent>
                        </Card>
                      </div>
                      <Card>
                        <CardHeader>
                          <CardTitle>Upcoming renewals · next 30 days & overdue</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {renewals.length ? (
                            <div className="space-y-3">
                              {renewals.map((a) => (
                                <div
                                  key={a.id}
                                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                                >
                                  <div>
                                    <p className="text-sm font-medium">
                                      {a.firm} · {a.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {a.renewalOn} ·{" "}
                                      {a.renewalMinor === null
                                        ? "Amount not set"
                                        : money(a.renewalMinor, a.currency)}
                                      {a.renewalOn! < data.today ? " · Review overdue renewal" : ""}
                                    </p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={readOnly}
                                    onClick={() =>
                                      setModal({
                                        kind: "entry",
                                        type: "expense",
                                        accountId: a.id,
                                        category: "subscription",
                                      })
                                    }
                                  >
                                    Record charge
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <Empty>No renewals scheduled.</Empty>
                          )}
                          <p className="mt-3 text-xs text-muted-foreground">
                            Reminders do not create expenses or charge your card. Update the next
                            date after reviewing a renewal.
                          </p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Monthly cash review</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {months.length ? (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="border-b text-xs text-muted-foreground">
                                    <th className="py-2">Month</th>
                                    <th>Spent</th>
                                    <th>Refunded</th>
                                    <th>Payout cash</th>
                                    <th>Net</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {months.map((row) => (
                                    <tr key={row.month} className="border-b last:border-0">
                                      <td className="py-3">{row.month}</td>
                                      <td>{money(row.spent)}</td>
                                      <td>{money(row.refunds)}</td>
                                      <td>{money(row.received)}</td>
                                      <td>{money(row.net)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <Empty>No settled cash yet.</Empty>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </details>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    aria-label="Search prop records"
                    className="max-w-sm"
                    placeholder="Search firm, account, reference or status"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {tab === "accounts" && (
                    <>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={showClosed}
                          onChange={(e) => setShowClosed(e.target.checked)}
                        />
                        Show passed / failed accounts ({closedCount})
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={showArchived}
                          onChange={(e) => setShowArchived(e.target.checked)}
                        />
                        Show archived accounts
                      </label>
                    </>
                  )}
                  {tab === "ledger" && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={showVoided}
                        onChange={(e) => setShowVoided(e.target.checked)}
                      />
                      Show voided records
                    </label>
                  )}
                  {tab === "ledger" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={readOnly}
                      onClick={() => setModal({ kind: "entry", type: "expense" })}
                    >
                      Add expense
                    </Button>
                  )}
                  <p className="ml-auto text-xs text-muted-foreground">{rowCount} records</p>
                </div>
                {tab === "accounts" && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Account type">
                    {(
                      [
                        ["all", "All"],
                        ["challenge", "Challenges"],
                        ["funded", "Funded & live"],
                      ] as const
                    ).map(([v, text]) => (
                      <Button
                        key={v}
                        size="sm"
                        aria-pressed={program === v}
                        variant={program === v ? "secondary" : "outline"}
                        className="h-7 rounded-full px-3"
                        onClick={() => setProgram(v)}
                      >
                        {text} · {programCounts[v]}
                      </Button>
                    ))}
                  </div>
                )}
                {tab === "accounts" && listedAccounts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={picked.length === listedAccounts.length}
                        onChange={(e) =>
                          setSelected(e.target.checked ? listedAccounts.map((a) => a.id) : [])
                        }
                      />
                      {picked.length ? `${picked.length} selected` : "Select all"}
                    </label>
                    {picked.length > 0 && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={readOnly || !picked.some(canPass)}
                          onClick={() => bulk("pass")}
                        >
                          Passed
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={readOnly || !picked.some(canFail)}
                          onClick={() => bulk("fail")}
                        >
                          Failed
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={readOnly}
                          onClick={() => bulk("delete")}
                        >
                          Delete
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                          Clear
                        </Button>
                      </>
                    )}
                  </div>
                )}
                {tab === "accounts" && (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {slice(listedAccounts).map((a) => {
                      const own = cashSummary(
                        (cashByAccount.get(a.id) ?? []).filter(
                          (row) => row.currency === a.currency,
                        ),
                      );
                      const carried = carriedSpend(a);
                      const accountSummary = {
                        ...own,
                        netSpend: own.netSpend + carried,
                        net: own.net - carried,
                      };
                      return (
                        <Card key={a.id}>
                          <CardContent className="space-y-4 py-5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${a.name}`}
                                  checked={selected.includes(a.id)}
                                  onChange={(e) =>
                                    setSelected(
                                      e.target.checked
                                        ? [...selected, a.id]
                                        : selected.filter((id) => id !== a.id),
                                    )
                                  }
                                />
                                <div>
                                  <h3 className="font-semibold">{a.name}</h3>
                                  <p className="text-xs text-muted-foreground">
                                    {a.firm} · {label(a.program)}
                                    {a.sizeMinor !== null
                                      ? ` · ${money(a.sizeMinor, a.currency)} nominal`
                                      : ""}
                                  </p>
                                </div>
                              </div>
                              <span
                                className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${
                                  a.status === "passed"
                                    ? "bg-profit/15 text-profit"
                                    : a.status === "breached"
                                      ? "bg-loss/15 text-loss"
                                      : a.status === "active"
                                        ? "bg-primary/10 text-primary"
                                        : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {a.archived ? "Archived · " : ""}
                                {label(a.status)}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-sm">
                              <div>
                                <p className="text-xs text-muted-foreground">Net spend</p>
                                <span className="text-loss">
                                  {money(accountSummary.netSpend, a.currency)}
                                </span>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Payout cash</p>
                                <span className="text-profit">
                                  {money(accountSummary.received, a.currency)}
                                </span>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Net return</p>
                                <span
                                  className={
                                    accountSummary.net < 0
                                      ? "text-loss"
                                      : accountSummary.net > 0
                                        ? "text-profit"
                                        : ""
                                  }
                                >
                                  {money(accountSummary.net, a.currency)}
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 text-[11px]">
                              <span className="rounded-full bg-muted px-2 py-0.5">
                                {a.closedOn
                                  ? `Ran ${Math.max(0, daysBetween(a.openedOn, a.closedOn))} days`
                                  : `Day ${Math.max(1, daysBetween(a.openedOn, data.today) + 1)}`}
                              </span>
                              {a.status === "active" && !a.archived && a.renewalOn && (
                                <span
                                  className={`rounded-full px-2 py-0.5 ${
                                    daysBetween(data.today, a.renewalOn) <= 7
                                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                      : "bg-muted"
                                  }`}
                                >
                                  {daysBetween(data.today, a.renewalOn) < 0
                                    ? "Renewal overdue"
                                    : `Renews in ${daysBetween(data.today, a.renewalOn)}d`}
                                </span>
                              )}
                              {accountSummary.received > 0 && accountSummary.net > 0 && (
                                <span className="rounded-full bg-profit/15 px-2 py-0.5 text-profit">
                                  Paid for itself
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Opened {a.openedOn}
                              {a.closedOn ? ` · Resolved ${a.closedOn}` : ""}
                              {a.parentId ? ` · Follows ${name(a.parentId)}` : ""}. Cash follows the
                              selected dates.
                              {carried > 0
                                ? ` Net spend includes ${money(carried, a.currency)} from earlier phases.`
                                : ""}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={readOnly}
                                onClick={() =>
                                  setModal({ kind: "detail", type: "account", id: a.id })
                                }
                              >
                                Details & receipts
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={readOnly}
                                onClick={() => setModal({ kind: "account", account: a })}
                              >
                                Edit
                              </Button>
                              {a.status === "active" &&
                                !a.archived &&
                                ["evaluation", "verification"].includes(a.program) && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={readOnly}
                                    onClick={() =>
                                      setModal({
                                        kind: "change",
                                        action: "account.pass",
                                        id: a.id,
                                        revision: a.revision,
                                        value: true,
                                        name: `Mark ${a.name} as passed`,
                                        warning: `Marks this ${label(a.program).toLowerCase()} as passed today and creates a new active funded account, "${a.name} (Funded)", linked to it. You can rename or edit the funded account afterwards.`,
                                      })
                                    }
                                  >
                                    Passed
                                  </Button>
                                )}
                              {a.status === "active" && !a.archived && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={readOnly}
                                  onClick={() =>
                                    setModal({
                                      kind: "change",
                                      action: "account.fail",
                                      id: a.id,
                                      revision: a.revision,
                                      value: true,
                                      name: `Mark ${a.name} as failed`,
                                      warning: `Marks this account as failed (breached) today. It stays in your cash history and returns, and it can no longer be chosen when adding payouts or expenses. You can still edit it later.`,
                                    })
                                  }
                                >
                                  Failed
                                </Button>
                              )}
                              {a.status === "active" && !a.archived && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={readOnly}
                                  onClick={() =>
                                    setModal({ kind: "entry", type: "expense", accountId: a.id })
                                  }
                                >
                                  Add expense
                                </Button>
                              )}
                              <details className="relative">
                                <summary className="inline-flex h-8 cursor-pointer items-center rounded-md px-3 text-xs font-medium hover:bg-accent">
                                  More ▾
                                </summary>
                                <div className="absolute left-0 z-20 mt-1 flex w-36 flex-col gap-1 rounded-lg border bg-card p-1 shadow-lg">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="justify-start"
                                    disabled={readOnly}
                                    onClick={(e) => {
                                      e.currentTarget.closest("details")?.removeAttribute("open");
                                      setModal({
                                        kind: "change",
                                        action: "account.archive",
                                        id: a.id,
                                        revision: a.revision,
                                        value: !a.archived,
                                        name: a.archived ? "Restore account" : "Archive account",
                                      });
                                    }}
                                  >
                                    {a.archived ? "Restore" : "Archive"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="justify-start text-destructive hover:text-destructive"
                                    disabled={readOnly}
                                    onClick={(e) => {
                                      e.currentTarget.closest("details")?.removeAttribute("open");
                                      const rows = data.entries.filter((x) => x.accountId === a.id);
                                      const cashRows = data.receipts.filter((r) =>
                                        rows.some((x) => x.id === r.payoutId),
                                      );
                                      setModal({
                                        kind: "change",
                                        action: "account.delete",
                                        id: a.id,
                                        revision: a.revision,
                                        value: true,
                                        name: `Delete ${a.name}`,
                                        warning: `This permanently deletes "${a.name}" together with its ${rows.length} cash record${rows.length === 1 ? "" : "s"} (expenses, refunds, payouts), ${cashRows.length} payment${cashRows.length === 1 ? "" : "s"}, attachments and edit history. It cannot be undone. To keep the history, use Archive instead.`,
                                      });
                                    }}
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </details>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
                {tab === "payouts" && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Open requests always remain visible. Completed, rejected and cancelled
                      requests use the request-date filter. Expected amounts are after your share
                      and withheld fees; actual amounts come only from receipts.
                    </p>
                    {slice(listedPayouts).map((row) => (
                      <Card key={row.entry.id}>
                        <CardContent className="space-y-4 py-5">
                          <div className="flex flex-wrap justify-between gap-3">
                            <div>
                              <h3 className="font-medium">
                                {row.entry.firm} · {name(row.entry.accountId)}
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                Requested {row.entry.occurredOn}
                                {row.entry.dueOn ? ` · Expected ${row.entry.dueOn}` : ""}
                              </p>
                            </div>
                            <span
                              className={`rounded-md px-2 py-1 text-xs font-medium ${
                                row.overdue
                                  ? "bg-loss/15 text-loss"
                                  : row.entry.status === "completed"
                                    ? "bg-profit/15 text-profit"
                                    : ["rejected", "cancelled"].includes(row.entry.status)
                                      ? "bg-muted text-muted-foreground"
                                      : "bg-primary/10 text-primary"
                              }`}
                            >
                              {row.overdue
                                ? "Overdue · "
                                : row.partial
                                  ? "Partially received · "
                                  : ""}
                              {label(row.entry.status)}
                            </span>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-4">
                            <div>
                              <p className="text-xs text-muted-foreground">Expected net</p>
                              {money(row.expected, row.entry.currency)}
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Actual received</p>
                              {money(row.actual, row.entry.currency)}
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Outstanding</p>
                              {money(row.remaining, row.entry.currency)}
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Actual − expected</p>
                              {money(row.variance, row.entry.currency)}
                            </div>
                          </div>
                          <PayoutMeter actual={row.actual} expected={row.expected} />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={
                                readOnly || ["rejected", "cancelled"].includes(row.entry.status)
                              }
                              onClick={() => setModal({ kind: "receipt", payout: row.entry })}
                            >
                              Record receipt / reversal
                            </Button>
                            {entryActions(row.entry)}
                          </div>
                          <details>
                            <summary className="cursor-pointer text-xs">
                              Cash movements · {(receiptsById.get(row.entry.id) ?? []).length}
                            </summary>
                            <div className="mt-2 space-y-2">
                              {(receiptsById.get(row.entry.id) ?? []).map((r) => (
                                <div
                                  key={r.id}
                                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-xs"
                                >
                                  <span>
                                    {r.occurredOn} · {label(r.kind)} ·{" "}
                                    {money(r.amountMinor, row.entry.currency)}
                                    {r.voided ? " · Voided" : ""}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={readOnly || row.entry.voided}
                                    onClick={() =>
                                      setModal({
                                        kind: "change",
                                        action: "receipt.void",
                                        id: r.id,
                                        payoutId: r.payoutId,
                                        revision: row.entry.revision,
                                        value: !r.voided,
                                        name: r.voided
                                          ? "Restore cash movement"
                                          : "Void cash movement",
                                      })
                                    }
                                  >
                                    {r.voided ? "Restore" : "Void"}
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </details>
                        </CardContent>
                      </Card>
                    ))}
                  </>
                )}
                {tab === "ledger" && (
                  <Card>
                    <CardContent className="overflow-x-auto pt-4">
                      <p className="mb-3 text-xs text-muted-foreground">
                        Expenses and refunds use cash dates; payout rows use request dates. Export
                        cash CSV for individual settlement dates. Payout requests do not count as
                        income.
                      </p>
                      <table className="w-full min-w-[740px] text-left text-sm">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="py-2">Date</th>
                            <th>Firm / account</th>
                            <th>Entry</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slice(entries).map((entry) => (
                            <tr
                              key={entry.id}
                              className={`border-b last:border-0 ${entry.voided ? "opacity-60" : ""}`}
                            >
                              <td className="py-3 pr-3">{entry.occurredOn}</td>
                              <td className="pr-3">
                                {entry.firm}
                                <p className="text-xs text-muted-foreground">
                                  {name(entry.accountId)}
                                </p>
                              </td>
                              <td className="pr-3">
                                {label(entry.kind)}
                                <p className="text-xs text-muted-foreground">
                                  {entry.kind === "expense"
                                    ? label(entry.category)
                                    : entry.reference}
                                </p>
                              </td>
                              <td className="pr-3 tabular-nums">
                                {money(
                                  entry.kind === "payout"
                                    ? (payoutById.get(entry.id)?.expected ?? 0)
                                    : entry.amountMinor,
                                  entry.currency,
                                )}
                                {entry.kind === "payout" && (
                                  <p className="text-xs text-muted-foreground">Expected net</p>
                                )}
                              </td>
                              <td>{entry.voided ? "Voided" : label(entry.status)}</td>
                              <td>{entryActions(entry)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                )}
                {!rowCount && <Empty>No records match this view.</Empty>}
                {rowCount > PAGE_SIZE && (
                  <div className="flex items-center justify-between">
                    <Button
                      variant="outline"
                      disabled={safePage === 0}
                      onClick={() => setPage(safePage - 1)}
                    >
                      Previous
                    </Button>
                    <span className="text-xs">
                      Page {safePage + 1} of {Math.ceil(rowCount / PAGE_SIZE)}
                    </span>
                    <Button
                      variant="outline"
                      disabled={(safePage + 1) * PAGE_SIZE >= rowCount}
                      onClick={() => setPage(safePage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            )}
            <details className="rounded-xl border p-4 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium">How these numbers work</summary>
              <div className="mt-3 space-y-2">
                <p>
                  Net cash return = actual payout receipts − payout reversals + expense refunds −
                  spending. Net spend = spending − refunds. ROI = net cash return ÷ net spend; it is
                  unavailable when net spend is zero or negative.
                </p>
                <p>
                  Amounts use each currency’s minor units. Currencies are never converted or
                  combined automatically. Your firm’s actual approval, payout rules and bank
                  statement remain authoritative.
                </p>
                <p>
                  Past attempts, breached accounts and archived accounts stay in cash returns.
                  Shared firm costs are included in firm totals but are not silently allocated to
                  individual accounts.
                </p>
                <p>
                  Requests and reminders never move money. This tracker does not place trades,
                  connect banks, infer payout eligibility, or change journal trading P&L. JSON
                  exports in Settings include these records and their audit history; copy the data
                  directory to preserve attachment files too.
                </p>
              </div>
            </details>
          </>
        )}
        {modal && data && !readOnly && (
          <PropFirmModal
            modal={modal}
            data={data}
            close={() => setModal(null)}
            refresh={refresh}
            open={setModal}
          />
        )}
      </div>
    </div>
  );
}
function EXPENSE_ROWS(rows: CashMovement[]) {
  const groups = new Map<string, number>();
  for (const row of rows)
    if (row.kind === "expense")
      groups.set(row.category, (groups.get(row.category) ?? 0) + row.amountMinor);
  return [...groups]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}
