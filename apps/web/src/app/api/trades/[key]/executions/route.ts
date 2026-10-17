import { bad, handler, ok } from "@/server/api";
import { replaceTradeExecutions, type TradeExecutionEdit } from "@/server/executions";

type Params = { params: Promise<{ key: string }> };

/** Edit, add and delete the executions of one trade (open or closed). */
export const PUT = handler(async (request: Request, { params }: Params) => {
  const { key } = await params;
  const body = (await request.json()) as { executions?: TradeExecutionEdit[] };
  if (!Array.isArray(body?.executions) || body.executions.length === 0)
    return bad("A trade needs at least one execution.");
  return ok(replaceTradeExecutions(key, body.executions));
});
