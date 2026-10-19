import { handler, ok } from "@/server/api";
import { deleteAllChats, listChats } from "@/server/ai-chats";

/** Saved conversations, newest first. */
export const GET = handler(() => ok({ chats: listChats() }));

/** Clear the whole history. */
export const DELETE = handler(() => ok({ deleted: deleteAllChats() }));
