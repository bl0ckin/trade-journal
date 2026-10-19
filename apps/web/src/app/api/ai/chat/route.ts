import { bad, handler, ok, requireValue } from "@/server/api";
import { runAi, type AiChatMessage } from "@/server/ai";
import { readAiRequest } from "@/server/ai-scope";
import { buildJournalContext } from "@/server/ai-context";
import { chatExists, chatMessages, saveExchange } from "@/server/ai-chats";

/** How many earlier messages are sent back to the model for follow-up questions. */
const HISTORY_LIMIT = 12;

/**
 * One turn of a saved conversation. The journal aggregates are rebuilt from the filters sent
 * with every question, so a follow-up always sees the scope it was asked in. Nothing is saved
 * unless the AI answers, which keeps the history free of unanswered questions.
 */
export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as Record<string, unknown>;
  requireValue(body && typeof body === "object" && !Array.isArray(body), "Invalid AI request");
  const { chatId: rawChatId, ...rest } = body;
  requireValue(
    rawChatId === undefined || rawChatId === null || (typeof rawChatId === "string" && rawChatId.length <= 64),
    "Invalid chat",
  );
  const chatId = typeof rawChatId === "string" ? rawChatId : null;

  const scope = readAiRequest(rest, "question");
  if (chatId && !chatExists(chatId)) return bad("This chat no longer exists. Start a new one.", 404);
  const context = buildJournalContext(scope);
  if (!context) return bad("No trades match the selected accounts and filters");

  const history: AiChatMessage[] = chatId
    ? chatMessages(chatId)
        .slice(-HISTORY_LIMIT)
        .map(({ role, content }) => ({ role, content }))
    : [];
  // Keep the turns alternating and starting with the user, as providers require.
  while (history.length && history[0]!.role !== "user") history.shift();

  const answer = await runAi(
    [
      ...history,
      {
        role: "user",
        content: `Answer the trader's question using ONLY these aggregates from their journal. If the data
can't answer it, say exactly what's missing (e.g. "tag your trades' stops to get R stats").
Cite the numbers you used. Earlier messages in this chat may refer to a different filter scope;
the aggregates below are the current one. Format with Markdown: short paragraphs, bullet lists
where they help, and **bold** for the key numbers. Under 250 words.

${context}

Question: ${scope.question}`,
      },
    ],
    1400,
  );

  const saved = saveExchange({
    chatId,
    question: scope.question,
    answer,
    scopeLabel: scope.scope.label,
  });
  return ok({
    chatId: saved.chatId,
    title: saved.title,
    user: saved.user,
    assistant: saved.assistant,
    scope: scope.scope,
  });
});
