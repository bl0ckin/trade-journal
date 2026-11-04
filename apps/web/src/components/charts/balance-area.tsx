"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoney } from "@/lib/utils";
import { usePrivacy } from "../privacy";
import { tooltipStyle, useVizTokens } from "./tokens";
import { ChartFrame } from "./chart-frame";

export interface BalancePoint {
  t: string;
  balance: number;
}

/**
 * Account balance over time. Unlike the P&L area, the axis follows the balance itself
 * (it does not start at zero) so a small gain on a large account stays readable, and a
 * dashed line marks the starting balance.
 */
export function BalanceArea({
  data,
  startBalance,
  height = 240,
  currency = "USD",
}: {
  data: BalancePoint[];
  startBalance: number;
  height?: number | `${number}%`;
  currency?: string;
}) {
  const t = useVizTokens();
  const id = useId().replace(/:/g, "");
  const privacy = usePrivacy();
  if (!t) return <div style={{ height }} />;
  const values = data.map((point) => point.balance);
  const low = Math.min(startBalance, ...values);
  const high = Math.max(startBalance, ...values);
  const pad = (high - low) * 0.12 || Math.max(Math.abs(high) * 0.01, 1);
  const last = data.at(-1)?.balance ?? startBalance;
  const line = last >= startBalance ? t.brand : t.loss;
  const format = (value: number) => fmtMoney(value, currency).replace(".00", "");
  return (
    <ChartFrame height={height}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart key={String(privacy)} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={line} stopOpacity={0.3} />
              <stop offset="100%" stopColor={line} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={t.gridline} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="t"
            tick={{ fill: t.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: t.baseline }}
            minTickGap={48}
            tickFormatter={(value: string) => value.slice(0, 10)}
          />
          <YAxis
            tick={{ fill: t.inkMuted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={70}
            domain={[low - pad, high + pad]}
            tickFormatter={(value: number) => (privacy ? "••••" : format(value))}
          />
          <ReferenceLine y={startBalance} stroke={t.baseline} strokeDasharray="4 4" />
          <Tooltip
            contentStyle={tooltipStyle(t)}
            labelFormatter={(value) => String(value).slice(0, 10)}
            formatter={(value) => [privacy ? "Hidden" : fmtMoney(Number(value), currency), "Balance"]}
            cursor={{ stroke: t.inkMuted, strokeDasharray: "3 3" }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke={line}
            strokeWidth={2}
            fill={`url(#${id}-fill)`}
            baseValue={low - pad}
            dot={data.length === 1 ? { r: 3 } : false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
