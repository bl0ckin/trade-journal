import { desc } from "drizzle-orm";
import { db, executions } from "@/db";
import { handler, ok } from "@/server/api";

/** Symbols you have traded, most recent first, with the last quantity used for each. */
export const GET = handler(() => {
  const rows = db
    .select({
      symbol: executions.symbol,
      quantity: executions.quantity,
      executedAt: executions.executedAt,
    })
    .from(executions)
    .orderBy(desc(executions.executedAt))
    .limit(3000)
    .all();
  const seen = new Map<string, { symbol: string; lastQuantity: number }>();
  for (const row of rows)
    if (!seen.has(row.symbol.toUpperCase()))
      seen.set(row.symbol.toUpperCase(), { symbol: row.symbol, lastQuantity: row.quantity });
  return ok({ symbols: [...seen.values()].slice(0, 200) });
});
