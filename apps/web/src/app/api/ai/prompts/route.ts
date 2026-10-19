import { bad, handler, ok, requireValue } from "@/server/api";
import { newId } from "@/server/ids";
import { MAX_SAVED_PROMPTS, readPrompts, writePrompts } from "@/server/ai-chats";

/** Prompts the trader saved to reuse. The built-in suggestions ship with the page. */
export const GET = handler(() => ok({ prompts: readPrompts() }));

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as { title?: unknown; text?: unknown };
  requireValue(
    typeof body.text === "string" && body.text.trim().length > 0 && body.text.length <= 2000,
    "Enter a prompt up to 2000 characters.",
  );
  const text = (body.text as string).trim();
  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 60)
      : text.replace(/\s+/g, " ").slice(0, 40);
  const prompts = readPrompts();
  if (prompts.length >= MAX_SAVED_PROMPTS)
    return bad(`You can save up to ${MAX_SAVED_PROMPTS} prompts. Delete one first.`);
  const prompt = { id: newId(), title, text };
  writePrompts([...prompts, prompt]);
  return ok({ prompt });
});

export const DELETE = handler(async (request: Request) => {
  const body = (await request.json()) as { id?: unknown };
  requireValue(typeof body.id === "string", "Prompt id is required.");
  const prompts = readPrompts();
  const next = prompts.filter((prompt) => prompt.id !== body.id);
  if (next.length === prompts.length) return bad("Prompt not found", 404);
  writePrompts(next);
  return ok({ deleted: true });
});
