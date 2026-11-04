import {
  db,
  accounts,
  executions,
  journalDays,
  notes,
  playbooks,
  trades,
  attachments,
  noteTemplates,
  tradeRuleChecks,
  progressRules,
  progressChecks,
  missedTrades,
  folders,
  propAccounts,
  propEntries,
  propReceipts,
  propAudit,
  importSources,
  importSourceAliases,
  importBatches,
  aiChats,
  aiMessages,
} from "@/db";
import { queryTrades, readTradeFilters } from "@/server/trades-query";
import { buildTradeCsv } from "@/server/trade-csv";
import {
  getJournalDefaults,
  getMultipliers,
  getTimeZone,
  getImportTimeZone,
  getSetting,
} from "@/server/settings";
import { handler, ok } from "@/server/api";
import { attachmentExportRecord, EXPORT_ATTACHMENTS_NOTE } from "@/lib/export-format";

const parseNames = (json: string | null): string[] => {
  try {
    const value = JSON.parse(json ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const parseList = (json: string | null): unknown[] => {
  try {
    const value = JSON.parse(json ?? "[]") as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

/** Plain settings carried as saved text. API keys and their ciphertext are never in this list. */
const PLAIN_SETTINGS = [
  "riskLimits",
  "currencyConversion",
  "primaryAccountId",
  "aiProvider",
  "aiModel",
  "openaiModel",
  "compatibleModel",
  "compatibleBaseUrl",
] as const;

/**
 * Full data export: your journal is yours. Credentials are deliberately
 * excluded: an export must be safe to share or move between machines.
 */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "json";

  if (format === "csv") {
    const csv = buildTradeCsv(queryTrades(readTradeFilters(url.searchParams)).rows);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="trades-${stamp}.csv"`,
      },
    });
  }

  return ok({
    exportedAt: new Date().toISOString(),
    note: EXPORT_ATTACHMENTS_NOTE,
    accounts: db
      .select()
      .from(accounts)
      .all()
      .map(({ credentialsEnc: _omitted, ...safe }) => safe),
    executions: db.select().from(executions).all(),
    importSources: db.select().from(importSources).all(),
    importSourceAliases: db.select().from(importSourceAliases).all(),
    importBatches: db.select().from(importBatches).all(),
    trades: db.select().from(trades).all(),
    aiChats: db.select().from(aiChats).all(),
    aiMessages: db.select().from(aiMessages).all(),
    journalDays: db.select().from(journalDays).all(),
    notes: db.select().from(notes).all(),
    folders: db.select().from(folders).all(),
    playbooks: db.select().from(playbooks).all(),
    noteTemplates: db.select().from(noteTemplates).all(),
    tradeRuleChecks: db.select().from(tradeRuleChecks).all(),
    progressRules: db.select().from(progressRules).all(),
    progressChecks: db.select().from(progressChecks).all(),
    missedTrades: db.select().from(missedTrades).all(),
    propAccounts: db.select().from(propAccounts).all(),
    propEntries: db.select().from(propEntries).all(),
    propReceipts: db.select().from(propReceipts).all(),
    propAudit: db.select().from(propAudit).all(),
    journalDefaults: getJournalDefaults(),
    settings: {
      timeZone: getTimeZone(),
      importTimeZone: getImportTimeZone(),
      multipliers: getMultipliers(),
      // The saved tag and mistake pick-lists (the values on each trade are in `trades`).
      tagLibrary: parseNames(getSetting("tagLibrary")),
      mistakeLibrary: parseNames(getSetting("mistakeLibrary")),
      // AI page saved prompts and prop firm templates (no keys).
      aiPrompts: parseList(getSetting("aiPrompts")),
      propTemplates: parseList(getSetting("propTemplates")),
      other: Object.fromEntries(
        PLAIN_SETTINGS.flatMap((name) => {
          const value = getSetting(name);
          return value === null ? [] : [[name, value]];
        }),
      ),
    },
    // Metadata only: attachment binaries stay in the data directory.
    attachments: db
      .select({
        id: attachments.id,
        ownerType: attachments.ownerType,
        ownerId: attachments.ownerId,
        name: attachments.name,
        mime: attachments.mime,
        size: attachments.size,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .all()
      .map(attachmentExportRecord),
  });
});
