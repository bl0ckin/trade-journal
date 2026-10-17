"use client";

import { OctagonAlert, TriangleAlert } from "lucide-react";
import { useApi } from "@/lib/use-api";
import { evaluateDay, type RiskLimits } from "@/lib/risk-limits";
import { usePrivacy } from "@/components/privacy";
import { cn } from "@/lib/utils";

interface RiskStatus {
  limits: RiskLimits;
  statuses: {
    accountId: string;
    accountName: string;
    currency: string;
    realizedPnl: number;
    tradesOpened: number;
    consecutiveLosses: number;
  }[];
}

/**
 * Shows today's daily-limit warnings (max loss / max trades). Renders nothing when
 * no limits are set or none is close. Pass `accountId` when adding a trade to one
 * account, or `accounts` (comma-separated ids) to scope the dashboard.
 */
export function DailyLimitWarning({
  accountId,
  accounts,
  refreshKey,
  className,
}: {
  accountId?: string;
  accounts?: string | null;
  refreshKey?: string | number;
  className?: string;
}) {
  const adding = accountId !== undefined;
  const scope = adding ? accountId : (accounts ?? "");
  const { data } = useApi<RiskStatus>(
    adding && !accountId
      ? null
      : `/api/risk-limits?accounts=${encodeURIComponent(scope)}${refreshKey === undefined ? "" : `&v=${refreshKey}`}`,
  );
  const privacy = usePrivacy();
  const money = (amount: number, currency: string) => {
    if (privacy) return "••••";
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
  };
  const rows = (data?.statuses ?? [])
    .map((status) => ({
      ...status,
      warnings: data
        ? evaluateDay(data.limits, status, (amount) => money(amount, status.currency))
        : [],
    }))
    .filter((status) => status.warnings.length > 0);
  if (rows.length === 0) return null;
  const multiple = (data?.statuses.length ?? 0) > 1;
  return (
    <div className={cn("space-y-2", className)} role="alert" data-testid="daily-limit-warning">
      {rows.flatMap((row) =>
        row.warnings.map((warning) => {
          const reached = warning.level === "reached";
          const Icon = reached ? OctagonAlert : TriangleAlert;
          return (
            <div
              key={`${row.accountId}-${warning.kind}`}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                reached
                  ? "border-loss/40 bg-loss/10 text-loss"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
              )}
            >
              <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {multiple && <span className="font-medium">{row.accountName}: </span>}
                {warning.message}
                {adding && reached && " Adding this trade goes past your limit."}
              </p>
            </div>
          );
        }),
      )}
    </div>
  );
}
