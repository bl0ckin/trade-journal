import { eq } from "drizzle-orm";
import { db, trades } from "@/db";
import { handler, ok, requireValue } from "@/server/api";
import { getSetting, setSetting } from "@/server/settings";

type Kind = "tag" | "mistake";

const kindOf = (value: unknown): Kind => {
  requireValue(value === "tag" || value === "mistake", "Unknown kind.");
  return value as Kind;
};
const cleanName = (value: unknown): string => {
  requireValue(
    typeof value === "string" && value.trim().length > 0 && value.trim().length <= 60,
    "Enter a name up to 60 characters.",
  );
  return (value as string).trim();
};
const parseList = (json: string | null): string[] => {
  try {
    const value = JSON.parse(json ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};
const settingKey = (kind: Kind) => `${kind}Library`;
const readSaved = (kind: Kind) => parseList(getSetting(settingKey(kind)));
const writeSaved = (kind: Kind, names: string[]) =>
  setSetting(settingKey(kind), JSON.stringify([...new Set(names)]));
const listOf = (row: { tagsJson: string | null; mistakesJson: string | null }, kind: Kind) =>
  parseList(kind === "tag" ? row.tagsJson : row.mistakesJson);

const allTrades = () =>
  db
    .select({ key: trades.key, tagsJson: trades.tagsJson, mistakesJson: trades.mistakesJson })
    .from(trades)
    .all();

const writeList = (key: string, kind: Kind, list: string[]) => {
  const json = JSON.stringify(list);
  if (kind === "tag") db.update(trades).set({ tagsJson: json }).where(eq(trades.key, key)).run();
  else db.update(trades).set({ mistakesJson: json }).where(eq(trades.key, key)).run();
};

/** Saved names plus every name already used on a trade, with how many trades use each. */
export const GET = handler((request: Request) => {
  const kind = kindOf(new URL(request.url).searchParams.get("kind"));
  const counts = new Map<string, number>();
  for (const row of allTrades())
    for (const name of new Set(listOf(row, kind))) counts.set(name, (counts.get(name) ?? 0) + 1);
  for (const name of readSaved(kind)) if (!counts.has(name)) counts.set(name, 0);
  const items = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return ok({ items });
});

/** Remember a name so it shows up in the dropdown even when no trade uses it yet. */
export const POST = handler(async (request: Request) => {
  const body = (await request.json()) as { kind?: unknown; name?: unknown };
  const kind = kindOf(body.kind);
  const name = cleanName(body.name);
  writeSaved(kind, [...readSaved(kind), name]);
  return ok({ saved: true });
});

/** Rename a name everywhere it is used. Renaming onto an existing name merges them. */
export const PATCH = handler(async (request: Request) => {
  const body = (await request.json()) as { kind?: unknown; from?: unknown; to?: unknown };
  const kind = kindOf(body.kind);
  const from = cleanName(body.from);
  const to = cleanName(body.to);
  let changed = 0;
  db.transaction(() => {
    for (const row of allTrades()) {
      const list = listOf(row, kind);
      if (!list.includes(from)) continue;
      writeList(row.key, kind, [...new Set(list.map((item) => (item === from ? to : item)))]);
      changed += 1;
    }
    writeSaved(kind, [...readSaved(kind).filter((item) => item !== from), to]);
  });
  return ok({ changed });
});

/** Delete a name from every trade and from the saved list. */
export const DELETE = handler(async (request: Request) => {
  const body = (await request.json()) as { kind?: unknown; name?: unknown };
  const kind = kindOf(body.kind);
  const name = cleanName(body.name);
  let changed = 0;
  db.transaction(() => {
    for (const row of allTrades()) {
      const list = listOf(row, kind);
      if (!list.includes(name)) continue;
      writeList(row.key, kind, list.filter((item) => item !== name));
      changed += 1;
    }
    writeSaved(kind, readSaved(kind).filter((item) => item !== name));
  });
  return ok({ changed });
});
