import { asc, desc, eq } from "drizzle-orm";
import { dayKeyOf } from "@luxalgo/journal-core";
import { db, folders, journalDays, notes, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { newId, nowIso } from "@/server/ids";
import { getTimeZone } from "@/server/settings";

type NoteOut = typeof notes.$inferSelect & {
  /** Notes that live on a trade or a journal day are shown here and edited in place. */
  source?: "trade" | "day";
  refId?: string;
  href?: string;
};

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const folderId = url.searchParams.get("folder");
  const search = url.searchParams.get("q")?.toLowerCase();
  const tag = url.searchParams.get("tag");
  const sort = url.searchParams.get("sort") ?? "updated";
  const everything = !folderId || folderId === "all";
  const timeZone = getTimeZone();

  let rows: NoteOut[] =
    folderId && folderId !== "all"
      ? db.select().from(notes).where(eq(notes.folderId, folderId)).all()
      : db.select().from(notes).all();

  // The notes written on trades and on the daily journal are the same notes: show them in
  // their folders instead of keeping a second copy.
  if (everything || folderId === "trade-notes") {
    for (const trade of db
      .select({
        key: trades.key,
        symbol: trades.symbol,
        direction: trades.direction,
        openedAt: trades.openedAt,
        closedAt: trades.closedAt,
        notes: trades.notes,
        tagsJson: trades.tagsJson,
      })
      .from(trades)
      .all()) {
      if (!trade.notes?.trim()) continue;
      const when = trade.closedAt ?? trade.openedAt;
      rows.push({
        id: `trade:${trade.key}`,
        folderId: "trade-notes",
        title: `${trade.symbol} ${trade.direction} · ${dayKeyOf(when, timeZone)}`,
        content: trade.notes,
        tagsJson: trade.tagsJson,
        tradeKey: trade.key,
        dayDate: null,
        createdAt: trade.openedAt,
        updatedAt: when,
        source: "trade",
        refId: trade.key,
        href: `/trades/${encodeURIComponent(trade.key)}`,
      });
    }
  }
  if (everything || folderId === "daily-journal") {
    for (const day of db.select().from(journalDays).all()) {
      if (!day.note.trim()) continue;
      rows.push({
        id: `day:${day.date}`,
        folderId: "daily-journal",
        title: `Daily journal · ${day.date}`,
        content: day.note,
        tagsJson: null,
        tradeKey: null,
        dayDate: day.date,
        createdAt: day.updatedAt,
        updatedAt: day.updatedAt,
        source: "day",
        refId: day.date,
        href: `/journal/${day.date}`,
      });
    }
  }

  if (search) {
    rows = rows.filter(
      (row) =>
        row.title.toLowerCase().includes(search) || row.content.toLowerCase().includes(search),
    );
  }
  if (tag) {
    rows = rows.filter((row) => {
      try {
        return ((JSON.parse(row.tagsJson ?? "[]") as string[]) ?? []).includes(tag);
      } catch {
        return false;
      }
    });
  }
  rows.sort((a, b) =>
    sort === "created"
      ? b.createdAt.localeCompare(a.createdAt)
      : sort === "title"
        ? a.title.localeCompare(b.title)
        : b.updatedAt.localeCompare(a.updatedAt),
  );

  const folderRows = db.select().from(folders).orderBy(asc(folders.createdAt)).all();

  // How many notes each folder holds, so the folder list can show it.
  const counts: Record<string, number> = {};
  for (const row of db.select({ folderId: notes.folderId }).from(notes).all())
    counts[row.folderId] = (counts[row.folderId] ?? 0) + 1;
  counts["trade-notes"] = db
    .select({ notes: trades.notes })
    .from(trades)
    .all()
    .filter((trade) => trade.notes?.trim()).length;
  counts["daily-journal"] = db
    .select({ note: journalDays.note })
    .from(journalDays)
    .all()
    .filter((day) => day.note.trim()).length;
  counts["all"] = Object.entries(counts).reduce((sum, [, count]) => sum + count, 0);
  return ok({ notes: rows, folders: folderRows, counts });
});

interface CreateNoteBody {
  folderId?: string;
  title?: string;
  content?: string;
  tags?: string[];
  tradeKey?: string;
  dayDate?: string;
}

export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as CreateNoteBody;
  const id = newId();
  const now = nowIso();
  db.insert(notes)
    .values({
      id,
      folderId: body.folderId ?? "my-notes",
      title: body.title ?? "",
      content: body.content ?? "",
      tagsJson: body.tags ? JSON.stringify(body.tags) : null,
      tradeKey: body.tradeKey ?? null,
      dayDate: body.dayDate ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return ok({ id });
});
