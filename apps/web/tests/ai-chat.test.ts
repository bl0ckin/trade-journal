import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@/server/ai", () => ({ runAi: vi.fn(async () => "Controlled **AI** response") }));
const originalDir = process.env.JOURNAL_DATA_DIR;
const scratch = mkdtempSync(join(tmpdir(), "journal-ai-chat-"));
process.env.JOURNAL_DATA_DIR = scratch;
const { db, accounts, executions, trades, settings, aiChats, aiMessages } = await import(
  "../src/db"
);
const { insertExecutions } = await import("../src/server/executions");
const { setSetting } = await import("../src/server/settings");
const { runAi } = await import("../src/server/ai");
const { POST: chat } = await import("../src/app/api/ai/chat/route");
const { GET: listChats, DELETE: clearChats } = await import("../src/app/api/ai/chats/route");
const {
  GET: openChat,
  PATCH: renameChat,
  DELETE: deleteChat,
} = await import("../src/app/api/ai/chats/[id]/route");
const {
  GET: listPrompts,
  POST: addPrompt,
  DELETE: removePrompt,
} = await import("../src/app/api/ai/prompts/route");

const request = (body: unknown, method = "POST") =>
  new Request("http://localhost/api/ai/test", {
    method,
    headers: { "Content-Type": "application/json" },
    // A GET request cannot carry a body.
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const fills = (symbol: string, exit: number) => [
  { symbol, side: "buy" as const, quantity: 1, price: 100, fee: 0, executedAt: "2026-09-15T09:00:00Z" },
  { symbol, side: "sell" as const, quantity: 1, price: exit, fee: 0, executedAt: "2026-09-15T10:00:00Z" },
];
const lastMessages = () =>
  vi.mocked(runAi).mock.calls.at(-1)![0] as { role: string; content: string }[];
const ask = (body: Record<string, unknown>) =>
  chat(request({ filters: { accounts: "a" }, timeZone: "UTC", ...body }));

beforeEach(() => {
  vi.stubEnv("JOURNAL_PASSWORD", "");
  db.delete(aiChats).run();
  db.delete(trades).run();
  db.delete(executions).run();
  db.delete(accounts).run();
  db.delete(settings).run();
  db.insert(accounts)
    .values(
      ["a", "b"].map((id) => ({
        id,
        name: "Account " + id.toUpperCase(),
        kind: "manual" as const,
        createdAt: "2026-01-01",
      })),
    )
    .run();
  insertExecutions("a", fills("ONLY_A", 110), "manual");
  insertExecutions("b", fills("ONLY_B", 50), "manual");
  setSetting("timeZone", "UTC");
  vi.mocked(runAi).mockReset();
  vi.mocked(runAi).mockResolvedValue("Controlled **AI** response");
});
afterAll(() => {
  db.$client.close();
  vi.unstubAllEnvs();
  if (originalDir === undefined) delete process.env.JOURNAL_DATA_DIR;
  else process.env.JOURNAL_DATA_DIR = originalDir;
  rmSync(scratch, { recursive: true, force: true });
});

it("starts a chat, saves both messages and titles it from the question", async () => {
  const response = await ask({ question: "How did I do?" });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.title).toBe("How did I do?");
  expect(body.assistant.content).toBe("Controlled **AI** response");
  expect(body.assistant.scopeLabel).toContain("UTC");

  const saved = await (await openChat(request(null, "GET"), params(body.chatId))).json();
  expect(saved.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
  const list = await (await listChats()).json();
  expect(list.chats).toHaveLength(1);
});

it("sends earlier messages with a follow-up, and only the selected account's data", async () => {
  const first = await (await ask({ question: "How did I do?" })).json();
  await ask({ chatId: first.chatId, question: "And on Mondays?" });
  const messages = lastMessages();
  expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  expect(messages[0]!.content).toBe("How did I do?");
  expect(messages[2]!.content).toContain("And on Mondays?");
  expect(messages[2]!.content).toContain("ONLY_A");
  expect(messages[2]!.content).not.toContain("ONLY_B");
  expect(db.select().from(aiMessages).all()).toHaveLength(4);
  expect(db.select().from(aiChats).all()).toHaveLength(1);
});

it("saves nothing when the AI fails, and refuses unknown chats before calling it", async () => {
  vi.mocked(runAi).mockRejectedValueOnce(new Error("AI request failed. Check your provider."));
  expect((await ask({ question: "How did I do?" })).status).toBe(500);
  expect(db.select().from(aiChats).all()).toHaveLength(0);
  expect(db.select().from(aiMessages).all()).toHaveLength(0);

  vi.mocked(runAi).mockClear();
  expect((await ask({ chatId: "missing", question: "Hello?" })).status).toBe(404);
  expect(runAi).not.toHaveBeenCalled();
});

it("rejects malformed chat requests", async () => {
  for (const body of [
    { question: " ", filters: {} },
    { question: "How?", filters: {}, chatId: 7 },
    { question: "How?", filters: {}, accountIds: ["a"] },
  ])
    expect((await chat(request(body))).status).toBe(400);
  expect(runAi).not.toHaveBeenCalled();
});

it("renames and deletes a chat with its messages, and clears the history", async () => {
  const first = await (await ask({ question: "One" })).json();
  const second = await (await ask({ question: "Two" })).json();
  expect(
    (await renameChat(request({ title: "  Renamed  " }, "PATCH"), params(first.chatId))).status,
  ).toBe(200);
  expect(
    (await renameChat(request({ title: " " }, "PATCH"), params(first.chatId))).status,
  ).toBe(400);
  const list = await (await listChats()).json();
  expect(list.chats.map((c: { title: string }) => c.title).sort()).toEqual(["Renamed", "Two"]);

  expect((await deleteChat(request(null, "DELETE"), params(first.chatId))).status).toBe(200);
  expect((await deleteChat(request(null, "DELETE"), params(first.chatId))).status).toBe(404);
  expect(db.select().from(aiMessages).all()).toHaveLength(2);

  expect((await clearChats()).status).toBe(200);
  expect(db.select().from(aiChats).all()).toHaveLength(0);
  expect(db.select().from(aiMessages).all()).toHaveLength(0);
  expect((await openChat(request(null, "GET"), params(second.chatId))).status).toBe(404);
});

it("saves, lists and deletes prompts", async () => {
  const added = await (
    await addPrompt(request({ text: "  Which setups work best?  ", title: "Setups" }))
  ).json();
  expect(added.prompt).toMatchObject({ title: "Setups", text: "Which setups work best?" });
  const untitled = await (await addPrompt(request({ text: "A fairly long prompt without a title" }))).json();
  expect(untitled.prompt.title).toBe("A fairly long prompt without a title");
  expect((await addPrompt(request({ text: " " }))).status).toBe(400);

  const list = await (await listPrompts()).json();
  expect(list.prompts).toHaveLength(2);
  expect((await removePrompt(request({ id: added.prompt.id }, "DELETE"))).status).toBe(200);
  expect((await removePrompt(request({ id: added.prompt.id }, "DELETE"))).status).toBe(404);
  expect((await (await listPrompts()).json()).prompts).toHaveLength(1);
});
