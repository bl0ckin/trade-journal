import { bad, handler, ok, requireValue } from "@/server/api";
import { chatMessages, chatExists, deleteChat, renameChat } from "@/server/ai-chats";

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  if (!chatExists(id)) return bad("Chat not found", 404);
  return ok({ messages: chatMessages(id) });
});

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const body = (await request.json()) as { title?: unknown };
  requireValue(
    typeof body.title === "string" && body.title.trim().length > 0 && body.title.trim().length <= 120,
    "Enter a title up to 120 characters.",
  );
  if (!renameChat(id, (body.title as string).trim())) return bad("Chat not found", 404);
  return ok({ renamed: true });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  if (!deleteChat(id)) return bad("Chat not found", 404);
  return ok({ deleted: true });
});
