"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Settings2, WalletCards } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
import { useOnSynced } from "@/lib/sync-events";
import { useApi } from "@/lib/use-api";
import { fmtBalance } from "@/lib/utils";
import { MonetaryValue } from "./privacy";

interface AccountOption {
  id: string;
  name: string;
  broker: string;
  archivedAt: string | null;
  currency: string;
  balance: number;
}

/** Quick account switching; the full Filters panel still supports multiple accounts. */
export function AccountSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data, error, refresh } = useApi<{ accounts: AccountOption[] }>("/api/accounts?summary=1");
  useOnSynced(refresh);
  const selected = params.get("accounts")?.split(",").filter(Boolean) ?? [];
  const accounts = data?.accounts.filter((a) => !a.archivedAt || selected.includes(a.id)) ?? [];
  const active = accounts.filter((account) => !account.archivedAt);
  const allBalance =
    active.length > 0 && active.every((account) => account.currency === active[0]!.currency)
      ? {
          value: active.reduce((sum, account) => sum + account.balance, 0),
          currency: active[0]!.currency,
        }
      : null;
  const value = selected.length > 1 ? "multiple" : (selected[0] ?? "all");
  const label =
    selected.length > 1
      ? `${selected.length} accounts`
      : (accounts.find((a) => a.id === selected[0])?.name ??
        (selected.length ? "Selected account" : "All accounts"));

  function selectAccount(id: string) {
    const next = new URLSearchParams(params.toString());
    if (id === "all") next.delete("accounts");
    else next.set("accounts", id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function select(value: string) {
    if (value === "account-settings") router.push("/accounts");
    else selectAccount(value);
  }

  return (
    <div className="relative min-w-0 max-w-full">
      <Select value={value} onValueChange={select}>
        <SelectTrigger
          aria-label="Select account"
          className="h-8 w-44 max-w-full rounded-lg text-xs"
        >
          <WalletCards className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">
            {label}
          </span>
        </SelectTrigger>
        <SelectContent className="rounded-2xl border-white/10 p-1 shadow-2xl" align="end">
          <SelectItem value="all" className="rounded-lg text-xs">
            <span className="flex w-full min-w-48 items-center justify-between gap-4">
              All accounts
              {allBalance !== null && (
                <span className="tnum text-muted-foreground">
                  <MonetaryValue>{fmtBalance(allBalance.value, allBalance.currency)}</MonetaryValue>
                </span>
              )}
            </span>
          </SelectItem>
          {selected.length > 1 && (
            <SelectItem value="multiple" disabled className="text-xs">
              {label}
            </SelectItem>
          )}
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id} className="rounded-lg text-xs">
              <span className="flex w-full min-w-48 items-center justify-between gap-4">
                <span className="max-w-48 truncate">
                  {account.name}
                  {account.archivedAt ? " (archived)" : ""}
                </span>
                <span className="tnum text-muted-foreground">
                  <MonetaryValue>{fmtBalance(account.balance, account.currency)}</MonetaryValue>
                </span>
              </span>
            </SelectItem>
          ))}
          <div className="my-1 border-t" />
          <SelectItem value="account-settings" className="rounded-lg text-xs">
            <span className="flex items-center gap-2">
              <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
              Account settings
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
      {error && (
        <p role="alert" className="max-w-64 pt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
