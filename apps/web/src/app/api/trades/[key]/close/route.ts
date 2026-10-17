import { bad, handler, ok } from "@/server/api";
import { closeTradePosition } from "@/server/executions";

type Params = { params: Promise<{ key: string }> };

/** Close an open trade (fully or partly) with one opposite-side fill. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { key } = await params;
  const body = (await request.json()) as {
    quantity?: number;
    price?: number;
    fee?: number;
    executedAt?: string;
  };
  if (typeof body?.price !== "number") return bad("Enter the exit price.");
  return ok(
    closeTradePosition(key, {
      quantity: body.quantity,
      price: body.price,
      fee: body.fee,
      executedAt: body.executedAt,
    }),
  );
});
