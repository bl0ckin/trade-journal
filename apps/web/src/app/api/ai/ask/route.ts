import { bad, handler, ok } from "@/server/api";
import { runAi } from "@/server/ai";
import { readAiRequest } from "@/server/ai-scope";
import { buildJournalContext } from "@/server/ai-context";

/**
 * "Ask your journal" — natural-language questions answered from the trader's
 * own aggregates. The same questions an agent can ask through the MCP tools.
 */
export const POST = handler(async (request: Request) => {
  const scope = readAiRequest(await request.json(), "question");
  const context = buildJournalContext(scope);
  if (!context) return bad("No trades match the selected accounts and filters");

  const answer = await runAi(
    `Answer the trader's question using ONLY these aggregates from their journal. If the data
can't answer it, say exactly what's missing (e.g. "tag your trades' stops to get R stats").
Cite the numbers you used. Under 200 words.

${context}

Question: ${scope.question}`,
  );

  return ok({ answer, scope: scope.scope });
});
