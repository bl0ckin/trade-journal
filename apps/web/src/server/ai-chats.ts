import { asc, desc, eq } from "drizzle-orm";
import { aiChats, aiMessages, db } from "@/db";
import { RequestError } from "./api";
import { newId, nowIso } from "./ids";
import { getSetting, setSetting } from "./settings";

export interface ChatMessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  scopeLabel: string | null;
  createdAt: string;
}

const TITLE_LENGTH = 60;
export const chatTitle = (question: string): string => {
  const flat = question.replace(/\s+/g, " ").trim();
  return flat.length > TITLE_LENGTH ? `${flat.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : flat;
};

export const listChats = () =>
  db
    .select({ id: aiChats.id, title: aiChats.title, updatedAt: aiChats.updatedAt })
    .from(aiChats)
    .orderBy(desc(aiChats.updatedAt))
    .limit(200)
    .all();

export const chatExists = (id: string): boolean =>
  Boolean(db.select({ id: aiChats.id }).from(aiChats).where(eq(aiChats.id, id)).get());

export const chatMessages = (id: string): ChatMessageRow[] =>
  db
    .select({
      id: aiMessages.id,
      role: aiMessages.role,
      content: aiMessages.content,
      scopeLabel: aiMessages.scopeLabel,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.chatId, id))
    .orderBy(asc(aiMessages.createdAt), asc(aiMessages.id))
    .all();

/**
 * Save one exchange. A new chat is created when `chatId` is null. Both messages are written
 * together, so a failed AI call never leaves a question without an answer in the history.
 */
export function saveExchange(input: {
  chatId: string | null;
  question: string;
  answer: string;
  scopeLabel: string;
}): { chatId: string; title: string; user: ChatMessageRow; assistant: ChatMessageRow } {
  const now = Date.now();
  // Distinct, ordered timestamps keep the pair in the right order when read back.
  const userAt = new Date(now).toISOString();
  const assistantAt = new Date(now + 1).toISOString();
  const user: ChatMessageRow = {
    id: newId(),
    role: "user",
    content: input.question,
    scopeLabel: null,
    createdAt: userAt,
  };
  const assistant: ChatMessageRow = {
    id: newId(),
    role: "assistant",
    content: input.answer,
    scopeLabel: input.scopeLabel,
    createdAt: assistantAt,
  };
  const chatId = input.chatId ?? newId();
  let title = chatTitle(input.question);
  db.transaction((tx) => {
    if (input.chatId) {
      const chat = tx.select().from(aiChats).where(eq(aiChats.id, chatId)).get();
      if (!chat) throw new RequestError("This chat no longer exists. Start a new one.");
      title = chat.title;
      tx.update(aiChats).set({ updatedAt: assistantAt }).where(eq(aiChats.id, chatId)).run();
    } else {
      tx.insert(aiChats)
        .values({ id: chatId, title, createdAt: userAt, updatedAt: assistantAt })
        .run();
    }
    for (const message of [user, assistant])
      tx.insert(aiMessages)
        .values({
          id: message.id,
          chatId,
          role: message.role,
          content: message.content,
          scopeLabel: message.scopeLabel,
          createdAt: message.createdAt,
        })
        .run();
  });
  return { chatId, title, user, assistant };
}

export const renameChat = (id: string, title: string): boolean =>
  db
    .update(aiChats)
    .set({ title })
    .where(eq(aiChats.id, id))
    .run().changes > 0;

export const deleteChat = (id: string): boolean =>
  db.delete(aiChats).where(eq(aiChats.id, id)).run().changes > 0;

export const deleteAllChats = (): number => db.delete(aiChats).run().changes;

/** Saved prompts live in the settings table, like the tag library. */
export interface SavedPrompt {
  id: string;
  title: string;
  text: string;
}
const PROMPTS_KEY = "aiPrompts";
export const MAX_SAVED_PROMPTS = 50;

export const readPrompts = (): SavedPrompt[] => {
  try {
    const value = JSON.parse(getSetting(PROMPTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is SavedPrompt =>
        Boolean(item) &&
        typeof (item as SavedPrompt).id === "string" &&
        typeof (item as SavedPrompt).title === "string" &&
        typeof (item as SavedPrompt).text === "string",
    );
  } catch {
    return [];
  }
};
export const writePrompts = (prompts: SavedPrompt[]): void =>
  setSetting(PROMPTS_KEY, JSON.stringify(prompts));
