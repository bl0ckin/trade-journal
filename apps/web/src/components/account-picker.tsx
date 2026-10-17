"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/lib/use-api";
import { AccountCreateForm } from "./account-create-form";

interface AccountRow {
  id: string;
  name: string;
  kind: string;
  archivedAt: string | null;
}

/** Account picker used by every method; offers creating a new one inline. */
export function AccountPicker({
  value,
  onChange,
  kind,
}: {
  value: string;
  onChange: (id: string) => void;
  kind: "import" | "manual";
}) {
  const {
    data,
    refresh,
    error: accountError,
  } = useApi<{ accounts: AccountRow[]; primaryAccountId?: string | null }>("/api/accounts");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<AccountRow[]>([]);
  const fieldId = useId();
  const accounts = [
    ...(data?.accounts ?? []),
    ...created.filter((item) => !data?.accounts.some((row) => row.id === item.id)),
  ].filter((account) => !account.archivedAt);

  // Preselect the primary account so it doesn't have to be picked every time.
  const primaryId = data?.primaryAccountId ?? null;
  useEffect(() => {
    if (value || !primaryId) return;
    const primary = data?.accounts.find((account) => account.id === primaryId);
    if (primary && !primary.archivedAt && primary.kind !== "sync") onChange(primary.id);
  }, [value, primaryId, data, onChange]);

  return (
    <div className="flex min-w-0 flex-wrap items-end gap-2">
      <div className="min-w-0 flex-[1_1_180px]">
        <Label htmlFor={`${fieldId}-account`} className="mb-1 block text-xs text-muted-foreground">
          Into account
        </Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={`${fieldId}-account`}>
            <SelectValue placeholder="Choose an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        aria-expanded={creating}
        disabled={saving}
        onClick={() => setCreating(!creating)}
      >
        {creating ? "Cancel new account" : "New account"}
      </Button>
      {accountError && (
        <p role="alert" className="w-full text-sm text-destructive">
          {accountError}
        </p>
      )}
      {creating && (
        <AccountCreateForm
          kind={kind}
          onSavingChange={setSaving}
          className="w-full space-y-3 rounded-lg border p-4"
          onCreated={(account) => {
            setCreated((current) => [...current, account]);
            onChange(account.id);
            refresh();
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
