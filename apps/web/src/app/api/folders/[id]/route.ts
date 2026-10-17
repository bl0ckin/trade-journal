import { eq } from "drizzle-orm";
import { db, folders, notes } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { nowIso } from "@/server/ids";

type Params = { params: Promise<{ id: string }> };

/** Delete a folder you created. Its notes are kept and moved to My notes. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const folder = db.select().from(folders).where(eq(folders.id, id)).get();
  if (!folder) return bad("Folder not found", 404);
  if (folder.kind !== "user") return bad("Built-in folders can't be deleted.");
  let moved = 0;
  db.transaction((tx) => {
    moved = tx.select({ id: notes.id }).from(notes).where(eq(notes.folderId, id)).all().length;
    tx.update(notes).set({ folderId: "my-notes", updatedAt: nowIso() }).where(eq(notes.folderId, id)).run();
    tx.delete(folders).where(eq(folders.id, id)).run();
  });
  return ok({ deleted: true, moved });
});
