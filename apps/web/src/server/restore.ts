import { getTableColumns, inArray } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import {
  db,
  accounts,
  aiChats,
  aiMessages,
  executions,
  folders,
  importBatches,
  importSourceAliases,
  importSources,
  journalDays,
  missedTrades,
  noteTemplates,
  notes,
  playbooks,
  progressChecks,
  progressRules,
  propAccounts,
  propAudit,
  propEntries,
  propReceipts,
  tradeRuleChecks,
  trades,
} from "@/db";
import { rebuildAccount } from "./rebuild";
import { getSetting, setSetting } from "./settings";
import { MAX_SAVED_PROMPTS } from "./ai-chats";
import { isAiProvider } from "@/lib/ai-settings";
import { parseCurrencyConversion } from "@/lib/currencies";

type Row = Record<string, unknown>;

export interface RestoreSummary {
  accountsAdded: number;
  executionsAdded: number;
  executionsSkipped: number;
  tradesAnnotated: number;
  journalDays: number;
  notes: number;
  folders: number;
  playbooks: number;
  noteTemplates: number;
  ruleChecks: number;
  progress: number;
  missedTrades: number;
  propAccounts: number;
  propEntries: number;
  propReceipts: number;
  propAudit: number;
  importRecords: number;
  libraryValues: number;
  aiChats: number;
  aiMessages: number;
  /** Saved settings, AI prompts and prop firm templates brought back. */
  settings: number;
}

export interface RestoreOptions {
  /** Replace annotations on trades that already have them, instead of only filling blanks. */
  overwrite: boolean;
  /** Do everything, report the counts, then undo it. */
  dryRun: boolean;
}

class DryRun extends Error {
  constructor(readonly summary: RestoreSummary) {
    super("dry run");
  }
}

const isRow = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The array stored under `key` in the backup, ignoring anything that is not a plain object. */
const list = (backup: Row, key: string): Row[] =>
  Array.isArray(backup[key]) ? (backup[key] as unknown[]).filter(isRow) : [];

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** True when a value carries nothing worth protecting from being replaced. */
const blank = (value: unknown): boolean =>
  value === null || value === undefined || value === "" || value === "[]";

/** Insert rows whose primary key (or unique key) is not there yet. Returns how many were added. */
function insertMissing(table: SQLiteTable, rows: Row[]): number {
  const names = Object.keys(getTableColumns(table));
  let added = 0;
  for (const row of rows) {
    const values: Row = {};
    for (const name of names) if (name in row) values[name] = row[name];
    added += db
      .insert(table)
      .values(values as never)
      .onConflictDoNothing()
      .run().changes;
  }
  return added;
}

/** Parents before children, so self-referencing foreign keys are satisfied. */
function parentsFirst(rows: Row[]): Row[] {
  const ids = new Set(rows.map((row) => text(row.id)).filter((id): id is string => Boolean(id)));
  const placed = new Set<string>();
  const ordered: Row[] = [];
  let pending = rows;
  while (pending.length) {
    const next: Row[] = [];
    for (const row of pending) {
      const parent = text(row.parentId);
      if (!parent || !ids.has(parent) || placed.has(parent)) {
        ordered.push(row);
        const id = text(row.id);
        if (id) placed.add(id);
      } else next.push(row);
    }
    if (next.length === pending.length) {
      ordered.push(...next); // a cycle or missing parent; let the database decide
      break;
    }
    pending = next;
  }
  return ordered;
}

const ANNOTATIONS = [
  "notes",
  "tagsJson",
  "mistakesJson",
  "playbookId",
  "rating",
  "reviewedAt",
  "tradeQuality",
  "confidence",
  "emotionalState",
] as const;
/** Planned stop and target: the app fills defaults into new trades, so they follow `fresh`. */
const PLAN = ["stopLoss", "profitTarget"] as const;

const stringList = (json: unknown): string[] => {
  try {
    const value = JSON.parse(typeof json === "string" ? json : "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

/** Whether this looks like a file produced by Settings → Full backup (JSON). */
export function isBackup(value: unknown): value is Row {
  return (
    isRow(value) &&
    typeof value.exportedAt === "string" &&
    Array.isArray(value.accounts) &&
    Array.isArray(value.executions) &&
    Array.isArray(value.trades)
  );
}

/**
 * Merge a full JSON backup into this journal. It only adds: accounts, fills, notes and the rest
 * that are missing are created, nothing is deleted, and credentials are never part of a backup.
 * Fills rebuild the trades, then the backup's annotations (notes, tags, mistakes, rating,
 * confidence, trade quality, emotional state, playbook, reviewed) are put back by trade key.
 * Existing annotations are kept unless `overwrite` is set. Runs in one transaction.
 */
export function restoreBackup(backup: Row, options: RestoreOptions): RestoreSummary {
  const summary: RestoreSummary = {
    accountsAdded: 0,
    executionsAdded: 0,
    executionsSkipped: 0,
    tradesAnnotated: 0,
    journalDays: 0,
    notes: 0,
    folders: 0,
    playbooks: 0,
    noteTemplates: 0,
    ruleChecks: 0,
    progress: 0,
    missedTrades: 0,
    propAccounts: 0,
    propEntries: 0,
    propReceipts: 0,
    propAudit: 0,
    importRecords: 0,
    libraryValues: 0,
    aiChats: 0,
    aiMessages: 0,
    settings: 0,
  };

  try {
    db.transaction(() => {
      // ---- accounts (without credentials) -------------------------------------------------
      const have = new Set(db.select({ id: accounts.id }).from(accounts).all().map((row) => row.id));
      const accountNames = Object.keys(getTableColumns(accounts));
      for (const row of list(backup, "accounts")) {
        const id = text(row.id);
        if (!id || have.has(id)) continue;
        const values: Row = {};
        for (const name of accountNames) if (name in row) values[name] = row[name];
        values.credentialsEnc = null;
        values.autoSync = false;
        summary.accountsAdded += db
          .insert(accounts)
          .values(values as never)
          .onConflictDoNothing()
          .run().changes;
        have.add(id);
      }

      // ---- fills, then rebuild the trades they make ----------------------------------------
      const fills = list(backup, "executions");
      const usable = fills.filter((row) => have.has(text(row.accountId) ?? ""));
      summary.executionsSkipped = fills.length - usable.length;
      const touched = [...new Set(usable.map((row) => text(row.accountId)!))];
      const existingKeys = new Set<string>();
      for (let i = 0; i < touched.length; i += 400)
        for (const row of db
          .select({ key: trades.key })
          .from(trades)
          .where(inArray(trades.accountId, touched.slice(i, i + 400)))
          .all())
          existingKeys.add(row.key);
      const rebuild = new Set<string>();
      const executionColumns = Object.keys(getTableColumns(executions));
      for (const row of usable) {
        const values: Row = {};
        for (const name of executionColumns) if (name in row) values[name] = row[name];
        const added = db
          .insert(executions)
          .values(values as never)
          .onConflictDoNothing()
          .run().changes;
        if (added) {
          summary.executionsAdded += added;
          rebuild.add(text(row.accountId)!);
        }
      }
      for (const accountId of rebuild) rebuildAccount(accountId);

      // ---- trade annotations, matched by trade key -----------------------------------------
      const wanted = list(backup, "trades");
      for (let i = 0; i < wanted.length; i += 400) {
        const chunk = wanted.slice(i, i + 400);
        const keys = chunk.map((row) => text(row.key)).filter((key): key is string => Boolean(key));
        if (!keys.length) continue;
        const current = new Map(
          db.select().from(trades).where(inArray(trades.key, keys)).all().map((row) => [row.key, row]),
        );
        for (const row of chunk) {
          const key = text(row.key);
          const target = key ? current.get(key) : undefined;
          if (!key || !target) continue;
          const fresh = !existingKeys.has(key);
          const set: Row = {};
          for (const field of ANNOTATIONS) {
            const incoming = row[field];
            if (blank(incoming)) continue;
            if (fresh || options.overwrite || blank((target as unknown as Row)[field])) set[field] = incoming;
          }
          for (const field of PLAN) {
            const incoming = row[field];
            if (typeof incoming === "number" && (fresh || options.overwrite)) set[field] = incoming;
          }
          if (Object.keys(set).length) {
            db.update(trades)
              .set(set as never)
              .where(inArray(trades.key, [key]))
              .run();
            summary.tradesAnnotated += 1;
          }
        }
      }

      // ---- everything else, by id; existing rows are never touched -------------------------
      summary.folders = insertMissing(folders, list(backup, "folders"));
      summary.notes = insertMissing(notes, list(backup, "notes"));
      summary.playbooks = insertMissing(playbooks, list(backup, "playbooks"));
      summary.noteTemplates = insertMissing(noteTemplates, list(backup, "noteTemplates"));
      summary.ruleChecks = insertMissing(tradeRuleChecks, list(backup, "tradeRuleChecks"));
      summary.progress =
        insertMissing(progressRules, list(backup, "progressRules")) +
        insertMissing(progressChecks, list(backup, "progressChecks"));
      summary.missedTrades = insertMissing(missedTrades, list(backup, "missedTrades"));

      // Daily journal notes: add missing days; fill a day whose note is empty (or replace on overwrite).
      const days = new Map(db.select().from(journalDays).all().map((row) => [row.date, row]));
      for (const row of list(backup, "journalDays")) {
        const date = text(row.date);
        const note = text(row.note) ?? "";
        if (!date) continue;
        const existing = days.get(date);
        if (!existing) {
          summary.journalDays += insertMissing(journalDays, [row]);
        } else if (note && (options.overwrite || blank(existing.note))) {
          db.update(journalDays)
            .set({ note, updatedAt: text(row.updatedAt) ?? existing.updatedAt })
            .where(inArray(journalDays.date, [date]))
            .run();
          summary.journalDays += 1;
        }
      }

      // Import bookkeeping only for accounts that exist here.
      const known = (row: Row) => have.has(text(row.accountId) ?? "");
      summary.importRecords =
        insertMissing(importSources, list(backup, "importSources").filter(known)) +
        insertMissing(importSourceAliases, list(backup, "importSourceAliases").filter(known)) +
        insertMissing(importBatches, list(backup, "importBatches").filter(known));

      // ---- prop firm tracker ---------------------------------------------------------------
      const propHave = new Set(
        db.select({ id: propAccounts.id }).from(propAccounts).all().map((row) => row.id),
      );
      const incomingProp = parentsFirst(list(backup, "propAccounts")).map((row): Row => ({
        ...row,
        journalAccountId: have.has(text(row.journalAccountId) ?? "") ? row.journalAccountId : null,
      }));
      summary.propAccounts = insertMissing(propAccounts, incomingProp);
      for (const row of incomingProp) {
        const id = text(row.id);
        if (id) propHave.add(id);
      }
      const entries = parentsFirst(list(backup, "propEntries")).filter(
        (row) => !text(row.accountId) || propHave.has(text(row.accountId)!),
      );
      summary.propEntries = insertMissing(propEntries, entries);
      const entryIds = new Set(
        db.select({ id: propEntries.id }).from(propEntries).all().map((row) => row.id),
      );
      summary.propReceipts = insertMissing(
        propReceipts,
        list(backup, "propReceipts").filter((row) => entryIds.has(text(row.entryId) ?? "")),
      );
      summary.propAudit = insertMissing(propAudit, list(backup, "propAudit"));

      // ---- saved tag and mistake pick-lists: union with what is already here ----------------
      const backupSettings = isRow(backup.settings) ? backup.settings : {};
      for (const [name, setting] of [
        ["tagLibrary", "tagLibrary"],
        ["mistakeLibrary", "mistakeLibrary"],
      ] as const) {
        const incoming = stringList(JSON.stringify(backupSettings[name] ?? []));
        const saved = stringList(getSetting(setting));
        const merged = [...new Set([...saved, ...incoming])];
        if (merged.length > saved.length) {
          summary.libraryValues += merged.length - saved.length;
          setSetting(setting, JSON.stringify(merged));
        }
      }

      // ---- AI page: chats and their messages (chats first, messages need them) -------------
      summary.aiChats = insertMissing(aiChats, list(backup, "aiChats"));
      const chatIds = new Set(db.select({ id: aiChats.id }).from(aiChats).all().map((row) => row.id));
      summary.aiMessages = insertMissing(
        aiMessages,
        list(backup, "aiMessages").filter((row) => chatIds.has(text(row.chatId) ?? "")),
      );

      // ---- settings: fill what is unset here; "replace" also overwrites ---------------------
      const fill = (name: string, value: string | null) => {
        if (value === null) return;
        const current = getSetting(name);
        if (current === value || (current !== null && !options.overwrite)) return;
        setSetting(name, value);
        summary.settings += 1;
      };
      const asJson = (value: unknown): string | null =>
        value === undefined || value === null ? null : JSON.stringify(value);
      fill("timeZone", text(backupSettings.timeZone));
      fill("importTimeZone", text(backupSettings.importTimeZone));
      if (isRow(backup.journalDefaults)) fill("journalDefaults", asJson(backup.journalDefaults));

      // Contract multipliers: add symbols that are missing here.
      if (isRow(backupSettings.multipliers)) {
        let saved: Row = {};
        try {
          const parsed = JSON.parse(getSetting("multipliers") ?? "{}") as unknown;
          if (isRow(parsed)) saved = parsed;
        } catch {
          // an unreadable saved value is replaced by the merge below
        }
        const merged: Row = { ...saved };
        let changed = 0;
        for (const [symbol, value] of Object.entries(backupSettings.multipliers)) {
          if (typeof value !== "number" || !Number.isFinite(value)) continue;
          if (symbol in saved && !options.overwrite) continue;
          if (saved[symbol] !== value) changed += 1;
          merged[symbol] = value;
        }
        if (changed) {
          setSetting("multipliers", JSON.stringify(merged));
          summary.settings += changed;
        }
      }

      // Saved AI prompts and prop firm templates: add the ones whose id is not here yet.
      const mergeById = (name: string, incoming: unknown, limit: number) => {
        const items = (value: unknown): Row[] =>
          Array.isArray(value) ? value.filter((item): item is Row => isRow(item) && typeof item.id === "string") : [];
        let saved: Row[] = [];
        try {
          saved = items(JSON.parse(getSetting(name) ?? "[]"));
        } catch {
          // treated as empty
        }
        const ids = new Set(saved.map((item) => item.id));
        const extra = items(incoming).filter((item) => !ids.has(item.id));
        const merged = [...saved, ...extra].slice(0, limit);
        if (merged.length > saved.length) {
          setSetting(name, JSON.stringify(merged));
          summary.settings += merged.length - saved.length;
        }
      };
      mergeById("aiPrompts", backupSettings.aiPrompts, MAX_SAVED_PROMPTS);
      mergeById("propTemplates", backupSettings.propTemplates, 500);

      // Plain saved settings, each checked before it is accepted.
      const other = isRow(backupSettings.other) ? backupSettings.other : {};
      const valid: Record<string, (value: string) => boolean> = {
        riskLimits: (value) => isRow(JSON.parse(value)),
        currencyConversion: (value) => Boolean(parseCurrencyConversion(JSON.parse(value))),
        primaryAccountId: (value) => have.has(value),
        aiProvider: (value) => isAiProvider(value),
        aiModel: (value) => value.length > 0 && value.length <= 200,
        openaiModel: (value) => value.length > 0 && value.length <= 200,
        compatibleModel: (value) => value.length > 0 && value.length <= 200,
        compatibleBaseUrl: (value) => /^https?:\/\/[^\s?#]{1,2000}$/.test(value),
      };
      for (const [name, check] of Object.entries(valid)) {
        const value = text(other[name]);
        if (value === null) continue;
        try {
          if (check(value)) fill(name, value);
        } catch {
          // a malformed saved value is skipped, not restored
        }
      }

      if (options.dryRun) throw new DryRun({ ...summary });
    });
  } catch (error) {
    if (error instanceof DryRun) return error.summary;
    throw error;
  }
  return summary;
}
