import { bad, handler, ok } from "@/server/api";
import { isBackup, restoreBackup } from "@/server/restore";

/**
 * POST /api/restore  { backup, mode: "preview" | "commit", overwrite?: boolean }
 * Merges a Settings → Full backup (JSON) file into this journal. Preview reports what would
 * be added and then undoes it; commit keeps it. Nothing is ever deleted.
 */
export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as {
    backup?: unknown;
    mode?: string;
    overwrite?: unknown;
  };
  if (body.mode !== "preview" && body.mode !== "commit") return bad("mode must be preview or commit");
  if (!isBackup(body.backup))
    return bad("This does not look like a journal backup. Use the file from Full backup (JSON).");
  try {
    const summary = restoreBackup(body.backup, {
      overwrite: body.overwrite === true,
      dryRun: body.mode === "preview",
    });
    return ok({ summary, dryRun: body.mode === "preview" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return bad(`The backup could not be restored, and nothing was changed (${reason}).`);
  }
});
