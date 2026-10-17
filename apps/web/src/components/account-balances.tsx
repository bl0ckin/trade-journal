"use client";

import { useSearchParams } from "next/navigation";
import { useOnSynced } from "@/lib/sync-events";
import { useApi } from "@/lib/use-api";
import { fmtBalance, fmtMoney } from "@/lib/utils";
import { MonetaryValue } from "./privacy";

interface AccountBalance {
  id: string;
  name: string;
  archivedAt: string | null;
  currency: string;
  initialBalance: number;
  netPnl: number;
  balance: number;
}

/** A slim bar with the balance of the selected accounts: starting balance plus all-time net P&L. */
export function AccountBalances() {
  const params = useSearchParams();
  const { data, refresh } = useApi<{ accounts: AccountBalance[] }>("/api/accounts?summary=1");
  useOnSynced(refresh);
  const selected = params.get("accounts")?.split(",").filter(Boolean) ?? [];
  const accounts = (data?.accounts ?? []).filter((account) =>
    selected.length ? selected.includes(account.id) : !account.archivedAt,
  );
  if (accounts.length === 0) return null;

  const totals = new Map<string, { balance: number; start: number; pnl: number }>();
  for (const account of accounts) {
    const total = totals.get(account.currency) ?? { balance: 0, start: 0, pnl: 0 };
    total.balance += account.balance;
    total.start += account.initialBalance;
    total.pnl += account.netPnl;
    totals.set(account.currency, total);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
      {[...totals.entries()].map(([currency, total]) => (
        <div key={currency} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-xs text-muted-foreground">
            Balance{totals.size > 1 ? ` ${currency}` : ""}
          </span>
          <span className="text-base font-semibold tabular-nums">
            <MonetaryValue>{fmtBalance(total.balance, currency)}</MonetaryValue>
          </span>
          <span
            className={`text-xs tabular-nums ${
              total.pnl > 0 ? "text-profit" : total.pnl < 0 ? "text-loss" : "text-muted-foreground"
            }`}
            title={`All-time net P&L. Started at ${fmtBalance(total.start, currency)}.`}
          >
            <MonetaryValue>{fmtMoney(total.pnl, currency)}</MonetaryValue>
            <span className="text-muted-foreground"> all-time</span>
          </span>
        </div>
      ))}
      {accounts.length > 1 && (
        <ul className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
          {accounts.map((account) => (
            <li key={account.id} className="flex items-baseline gap-1.5">
              <span className="max-w-32 truncate text-muted-foreground">{account.name}</span>
              <span className="tabular-nums font-medium">
                <MonetaryValue>{fmtBalance(account.balance, account.currency)}</MonetaryValue>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
