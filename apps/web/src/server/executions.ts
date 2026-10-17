import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  positionFillProblem,
  storedImportMetadata,
  type ImportedExecution,
} from "@luxalgo/journal-importers";
import { db, executions, accounts, trades, notes as notesTable, attachments, tradeRuleChecks } from "@/db";
import { executionHash, newId, nowIso } from "./ids";
import { rebuildAccount } from "./rebuild";
import { getJournalDefaults } from "./settings";
import { defaultFee } from "@/lib/journal-defaults";
import { requireValue } from "./api";
import { deleteTradeReferences } from "./trade-references";
import { positionImportErrors } from "./position-import";

export interface InsertResult {
  inserted: number;
  duplicates: number;
  /** Rows dropped because a broker or file record was unusable (sync/import only). */
  skipped: number;
  /** A few plain-language reasons for skipped rows, capped so payloads stay small. */
  skippedReasons: string[];
}

export type ExecutionSource = "sync" | "import" | "manual";

const MAX_SKIP_REASONS = 5;

const isFiniteNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Plain-language reason a row can't be journaled, or null when the row is valid. */
export const executionProblem = (row: unknown, source: ExecutionSource): string | null => {
  if (!row || typeof row !== "object") return "Execution is missing.";
  const r = row as Partial<ImportedExecution>;
  const label = typeof r.symbol === "string" && r.symbol.trim() ? r.symbol.trim() : "execution";
  if (typeof r.symbol !== "string" || !r.symbol.trim()) return "An execution has no symbol.";
  if (!["buy", "sell"].includes(r.side as string)) return `${label}: side must be buy or sell.`;
  if (!isFiniteNumber(r.quantity) || r.quantity <= 0)
    return `${label}: quantity must be a finite positive number.`;
  if (!isFiniteNumber(r.price)) return `${label}: price must be a finite number.`;
  if (!isFiniteNumber(r.fee ?? 0)) return `${label}: fee must be a finite number.`;
  if (typeof r.executedAt !== "string" || !Number.isFinite(Date.parse(r.executedAt)))
    return `${label}: timestamp is missing or invalid.`;
  const meta = r.importMetadata;
  const factsOk = (facts: NonNullable<ImportedExecution["reconstruction"]>) =>
    (facts.group === undefined ||
      (typeof facts.group === "string" && facts.group.length > 0 && facts.group.length <= 2000)) &&
    Number.isSafeInteger(facts.order) &&
    facts.order >= 0 &&
    (facts.reportedGrossPnl === undefined || Number.isFinite(facts.reportedGrossPnl)) &&
    (facts.preserveFee === undefined || typeof facts.preserveFee === "boolean");
  const metaOk =
    !meta ||
    (source === "import" &&
      typeof meta.id === "string" &&
      meta.id.length > 0 &&
      meta.id.length <= 2000 &&
      factsOk(meta));
  // Reconstruction facts and earlier readings belong to file imports; other
  // sources ignore them.
  const facts = source === "import" ? r.reconstruction : undefined;
  const factsValid = !facts || (typeof facts === "object" && factsOk(facts));
  const legacy = source === "import" ? r.legacy : undefined;
  const legacyOk =
    !legacy ||
    (typeof legacy === "object" &&
      (legacy.symbol === undefined || (typeof legacy.symbol === "string" && !!legacy.symbol)) &&
      (legacy.quantity === undefined || isFiniteNumber(legacy.quantity)) &&
      (legacy.price === undefined || isFiniteNumber(legacy.price)) &&
      (legacy.executedAt === undefined || typeof legacy.executedAt === "string"));
  if (!metaOk || !factsValid || !legacyOk) return `${label}: invalid imported execution metadata.`;
  const positionProblem = positionFillProblem(r as ImportedExecution);
  if (positionProblem) return positionProblem;
  return null;
};

/**
 * Split a batch into usable rows and skip reasons. Manual entry is strict: the
 * whole batch is rejected on the first bad row. Broker syncs and file imports
 * are lenient: one odd record must not fail the entire batch, so bad rows are
 * dropped and counted for the caller to report. Position-labelled histories are
 * atomic: dropping a bad fill could change which position the remaining fills close.
 */
export const partitionExecutions = (
  rows: ImportedExecution[],
  source: ExecutionSource,
): { usable: ImportedExecution[]; skipped: number; skippedReasons: string[] } => {
  const usable: ImportedExecution[] = [];
  const skippedReasons: string[] = [];
  let skipped = 0;
  for (const row of rows) {
    const problem = executionProblem(row, source);
    if (
      problem &&
      (row?.importMetadata?.position ||
        (typeof row?.importMetadata?.group === "string" &&
          row.importMetadata.group.startsWith("csv-position:")))
    )
      requireValue(false, problem);
    if (problem === null) {
      usable.push(row);
      continue;
    }
    if (source === "manual") {
      requireValue(
        false,
        "Every execution needs a symbol, buy/sell side, finite positive quantity, price, fee and valid timestamp.",
      );
    }
    skipped++;
    if (skippedReasons.length < MAX_SKIP_REASONS) skippedReasons.push(problem);
  }
  return { usable, skipped, skippedReasons };
};

/** Insert fills, rebuild trades, and attach optional manual notes in one transaction. */
export const insertExecutions = (
  accountId: string,
  rows: ImportedExecution[],
  source: ExecutionSource,
  manualNotes?: string,
  options: { preserveFees?: boolean } = {},
): InsertResult => {
  requireValue(
    manualNotes === undefined ||
      (source === "manual" && typeof manualNotes === "string" && manualNotes.length <= 100000),
    "Manual trade notes must be at most 100,000 characters.",
  );
  requireValue(
    db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId)).get(),
    "Account not found.",
  );
  const { usable, skipped, skippedReasons } = partitionExecutions(rows, source);
  requireValue(
    !usable.some((row) => row.ninjaTrader || row.importMetadata?.group?.startsWith("ninjatrader")),
    "NinjaTrader fills require the reviewed import endpoint.",
  );
  let inserted = 0;
  let duplicates = 0;
  const createdAt = nowIso();
  const defaults = getJournalDefaults();
  const note = manualNotes?.trim() ? manualNotes : undefined;

  db.transaction((tx) => {
    const positionErrors = positionImportErrors(accountId, usable);
    requireValue(positionErrors.length === 0, positionErrors.join(" "));
    if (source === "import") {
      const existingHashes = new Set(
        tx
          .select({ hash: executions.contentHash })
          .from(executions)
          .where(and(eq(executions.accountId, accountId), eq(executions.source, "import")))
          .all()
          .map((row) => row.hash),
      );
      for (const row of usable) {
        if (existingHashes.has(executionHash(row))) continue;
        // How older parsers may have saved this fill: a changed timestamp, a
        // rounded fraction, or other identity fields a parsing fix corrected.
        const candidates = [
          row.legacyExecutedAt ? { executedAt: row.legacyExecutedAt } : undefined,
          { executedAt: row.executedAt.replace(/\.\d{3}Z$/, ".000Z") },
          row.legacy,
        ];
        requireValue(
          !candidates.some((earlier) => {
            if (!earlier) return false;
            const candidate = { ...row, ...earlier };
            const hash = executionHash(candidate);
            return hash !== executionHash(row) && existingHashes.has(hash);
          }),
          "Matching imported fills have timestamps from an older parser or indistinguishable whole-second executions. Import the complete corrected history into a new journal account and compare it before retiring the old account; nothing was saved.",
        );
      }
    }
    const noteExecutionIds = new Set<string>();
    // Every manual entry is kept apart from all other fills, so a trade is never merged
    // into (or changed by) another trade on the same symbol, whatever their times are.
    // The group is derived from the batch's contents (not random), so submitting the
    // exact same fills again lands in the same group and is deduplicated as a retry.
    const manualGroup =
      source === "manual"
        ? `manual:${createHash("sha256")
            .update(
              usable
                .map((row) => executionHash(row))
                .sort()
                .join("|"),
            )
            .digest("hex")
            .slice(0, 16)}`
        : undefined;
    for (const [index, usableRow] of usable.entries()) {
      const row: ImportedExecution = manualGroup
        ? {
            ...usableRow,
            importMetadata: {
              id: `${manualGroup}:${index}`,
              group: manualGroup,
              order: index,
            },
          }
        : usableRow;
      const id = newId();
      const contentHash = executionHash(row);
      const metadata = source === "import" ? storedImportMetadata(row) : row.importMetadata;
      const result = tx
        .insert(executions)
        .values({
          id,
          accountId,
          symbol: row.symbol,
          side: row.side,
          quantity: row.quantity,
          price: row.price,
          fee:
            metadata?.preserveFee || options.preserveFees
              ? row.fee
              : defaultFee(row.fee, row.quantity, accountId, row.symbol, defaults),
          executedAt: row.executedAt,
          assetClass: row.assetClass ?? null,
          source,
          importMetadataJson: metadata ? JSON.stringify(metadata) : null,
          contentHash,
          createdAt,
        })
        .onConflictDoNothing()
        .run();
      if (result.changes > 0) {
        inserted++;
        if (note) noteExecutionIds.add(id);
      } else {
        duplicates++;
        if (note) {
          const existing = tx
            .select({ id: executions.id })
            .from(executions)
            .where(
              and(eq(executions.accountId, accountId), eq(executions.contentHash, contentHash)),
            )
            .get();
          if (existing) noteExecutionIds.add(existing.id);
        }
      }
    }
    if (inserted > 0) rebuildAccount(accountId);
    if (note) {
      const affected = tx
        .select({
          key: trades.key,
          notes: trades.notes,
          executionIdsJson: trades.executionIdsJson,
        })
        .from(trades)
        .where(eq(trades.accountId, accountId))
        .all();
      for (const trade of affected) {
        const ids = JSON.parse(trade.executionIdsJson) as string[];
        if (!ids.some((id) => noteExecutionIds.has(id))) continue;
        // Keep prior annotations when these fills extend or close an existing position.
        // Retrying the same submission must not append the note a second time.
        if (trade.notes === note || trade.notes?.endsWith(`\n\n${note}`)) continue;
        const notes = trade.notes?.trim() ? `${trade.notes}\n\n${note}` : note;
        requireValue(
          notes.length <= 100000,
          "Combined trade notes must be at most 100,000 characters.",
        );
        tx.update(trades).set({ notes }).where(eq(trades.key, trade.key)).run();
      }
    }
  });

  return { inserted, duplicates, skipped, skippedReasons };
};

/**
 * Delete fills and rebuild their account. Trades that no longer exist afterwards take
 * their rule checks, files and notebook anchors with them.
 */
export const deleteExecutionsForTrades = (accountId: string, executionIds: string[]): void => {
  if (executionIds.length === 0) return;
  db.transaction((tx) => {
    const keysOf = () =>
      tx
        .select({ key: trades.key })
        .from(trades)
        .where(eq(trades.accountId, accountId))
        .all()
        .map((row) => row.key);
    const before = keysOf();
    for (let i = 0; i < executionIds.length; i += 500)
      tx.delete(executions)
        .where(
          and(
            eq(executions.accountId, accountId),
            inArray(executions.id, executionIds.slice(i, i + 500)),
          ),
        )
        .run();
    rebuildAccount(accountId);
    const after = new Set(keysOf());
    deleteTradeReferences(before.filter((key) => !after.has(key)));
  });
};

/**
 * An account's fills: all of them when `ids` is left out, only those listed otherwise (an
 * empty list is no fills, never the whole account).
 */
export const listExecutions = (accountId: string, ids?: readonly string[]) => {
  if (ids === undefined)
    return db.select().from(executions).where(eq(executions.accountId, accountId)).all();
  const unique = [...new Set(ids)];
  const rows: (typeof executions.$inferSelect)[] = [];
  for (let i = 0; i < unique.length; i += 500)
    rows.push(
      ...db
        .select()
        .from(executions)
        .where(
          and(
            eq(executions.accountId, accountId),
            inArray(executions.id, unique.slice(i, i + 500)),
          ),
        )
        .all(),
    );
  return rows;
};

export interface TradeExecutionEdit {
  /** Existing execution id; omit to add a new fill to the trade's symbol. */
  id?: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee?: number;
  executedAt: string;
}

const ANNOTATION_COLUMNS = [
  "notes",
  "tagsJson",
  "mistakesJson",
  "playbookId",
  "rating",
  "stopLoss",
  "profitTarget",
  "reviewedAt",
  "tradeQuality",
  "confidence",
  "emotionalState",
] as const;

/**
 * Edit, add and delete the fills behind one trade, then rebuild the account.
 * Rows with an id update that fill, rows without one are added, and fills of the
 * trade that are missing from `rows` are deleted. Because a trade's key contains
 * its open time, an edit can give the trade a new key; the journal annotations
 * and linked notes/attachments/rule checks are carried over to the new trade.
 */
export const replaceTradeExecutions = (
  tradeKey: string,
  rows: TradeExecutionEdit[],
): { key: string } => {
  const trade = db.select().from(trades).where(eq(trades.key, tradeKey)).get();
  requireValue(trade, "Trade not found.");
  requireValue(
    Array.isArray(rows) && rows.length >= 1,
    "A trade needs at least one execution. Delete the trade instead to remove it entirely.",
  );
  requireValue(rows.length <= 500, "Too many executions.");

  const accountId = trade.accountId;
  const existingIds = JSON.parse(trade.executionIdsJson) as string[];
  const existing = listExecutions(accountId, existingIds);
  const byId = new Map(existing.map((row) => [row.id, row]));
  requireValue(
    !existing.some((row) => row.source === "sync"),
    "Executions from broker sync can't be edited. They would be restored on the next sync.",
  );
  requireValue(
    !existing.some((row) => {
      if (!row.importMetadataJson) return false;
      const meta = JSON.parse(row.importMetadataJson) as { position?: unknown; group?: string };
      return Boolean(meta.position) || meta.group?.startsWith("csv-position:");
    }),
    "This trade came from a position-based statement import and can't be edited fill by fill.",
  );

  // Keep this trade's fills in one isolated group. Older manual trades have none yet,
  // so the first edit pins them to their own group and they stop mixing with others.
  type Meta = { id: string; group?: string; order?: number } & Record<string, unknown>;
  const parseMeta = (row?: { importMetadataJson: string | null }): Meta | undefined =>
    row?.importMetadataJson ? (JSON.parse(row.importMetadataJson) as Meta) : undefined;
  const tradeGroup =
    existing.map((row) => parseMeta(row)?.group).find((group) => Boolean(group)) ??
    (existing.every((row) => row.source === "manual") ? `manual:${newId()}` : undefined);
  let nextOrder =
    existing.reduce((max, row) => Math.max(max, parseMeta(row)?.order ?? -1), -1) + 1;
  const metaFor = (prior?: { id: string; importMetadataJson: string | null }): Meta | undefined => {
    const base = parseMeta(prior);
    if (!tradeGroup) return base;
    return { ...base, id: base?.id ?? newId(), group: tradeGroup, order: base?.order ?? nextOrder++ };
  };

  const sentIds = rows.flatMap((row) => (row.id !== undefined ? [row.id] : []));
  requireValue(new Set(sentIds).size === sentIds.length, "Duplicate execution in request.");
  for (const row of rows) {
    if (row.id !== undefined)
      requireValue(byId.has(row.id), "An execution does not belong to this trade.");
    const problem = executionProblem(
      {
        symbol: trade.symbol,
        side: row.side,
        quantity: row.quantity,
        price: row.price,
        fee: row.fee ?? 0,
        executedAt: row.executedAt,
      },
      "manual",
    );
    requireValue(
      problem === null,
      "Every execution needs a buy/sell side, positive quantity, price, fee and valid date and time.",
    );
  }

  const keysBefore = new Set(
    db
      .select({ key: trades.key })
      .from(trades)
      .where(eq(trades.accountId, accountId))
      .all()
      .map((row) => row.key),
  );
  const snapshot = Object.fromEntries(
    ANNOTATION_COLUMNS.map((column) => [column, trade[column]]),
  ) as Partial<typeof trades.$inferInsert>;
  const keptIds = new Set(rows.flatMap((row) => (row.id ? [row.id] : [])));
  const finalIds: string[] = [];
  const createdAt = nowIso();
  const journalDefaults = getJournalDefaults();
  let newKey = tradeKey;

  db.transaction((tx) => {
    const removed = existingIds.filter((id) => !keptIds.has(id));
    if (removed.length)
      tx.delete(executions)
        .where(and(eq(executions.accountId, accountId), inArray(executions.id, removed)))
        .run();
    // Free the dedup hashes first so two fills can swap values without a transient clash.
    for (const id of keptIds)
      tx.update(executions)
        .set({ contentHash: `pending:${id}` })
        .where(eq(executions.id, id))
        .run();
    try {
      for (const row of rows) {
        const prior = row.id ? byId.get(row.id) : undefined;
        const meta = metaFor(prior);
        const values = {
          side: row.side,
          quantity: row.quantity,
          price: row.price,
          // Existing fills keep exactly the fee that was typed; new fills get the journal's
          // default fee rule when left at zero, like any other manually added fill.
          fee: prior
            ? (row.fee ?? 0)
            : defaultFee(row.fee ?? 0, row.quantity, accountId, trade.symbol, journalDefaults),
          executedAt: new Date(row.executedAt).toISOString(),
        };
        const contentHash = executionHash({
          symbol: trade.symbol,
          ...values,
          importMetadata: meta,
        });
        if (prior) {
          tx.update(executions)
            .set({
              ...values,
              contentHash,
              importMetadataJson: meta ? JSON.stringify(meta) : prior.importMetadataJson,
            })
            .where(eq(executions.id, prior.id))
            .run();
          finalIds.push(prior.id);
        } else {
          const id = newId();
          tx.insert(executions)
            .values({
              id,
              accountId,
              symbol: trade.symbol,
              ...values,
              assetClass: trade.assetClass ?? null,
              source: "manual",
              importMetadataJson: meta ? JSON.stringify(meta) : null,
              contentHash,
              createdAt,
            })
            .run();
          finalIds.push(id);
        }
      }
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message))
        requireValue(
          false,
          "Two executions have the same time, side, quantity and price. Change one of them.",
        );
      throw error;
    }

    rebuildAccount(accountId);

    const current = tx.select().from(trades).where(eq(trades.accountId, accountId)).all();
    if (current.some((row) => row.key === tradeKey)) return;
    // The key moved (its open time or direction changed). Find the successor trade.
    const finalSet = new Set(finalIds);
    const scored = current
      .map((row) => ({
        row,
        overlap: (JSON.parse(row.executionIdsJson) as string[]).filter((id) => finalSet.has(id))
          .length,
      }))
      .filter((entry) => entry.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);
    const successor = scored.find((entry) => !keysBefore.has(entry.row.key)) ?? scored[0];
    if (!successor) return;
    newKey = successor.row.key;
    if (keysBefore.has(newKey)) return; // merged into a trade that already had its own notes
    tx.update(trades).set(snapshot).where(eq(trades.key, newKey)).run();
    tx.update(notesTable)
      .set({ tradeKey: newKey })
      .where(eq(notesTable.tradeKey, tradeKey))
      .run();
    tx.update(attachments)
      .set({ ownerId: newKey })
      .where(and(eq(attachments.ownerType, "trade"), eq(attachments.ownerId, tradeKey)))
      .run();
    tx.update(tradeRuleChecks)
      .set({ tradeKey: newKey })
      .where(eq(tradeRuleChecks.tradeKey, tradeKey))
      .run();
  });

  return { key: newKey };
};

/** Close (or scale out of) an open trade by adding the opposite-side fill. */
export const closeTradePosition = (
  tradeKey: string,
  input: { quantity?: number; price: number; fee?: number; executedAt?: string },
): { key: string } => {
  const trade = db.select().from(trades).where(eq(trades.key, tradeKey)).get();
  requireValue(trade, "Trade not found.");
  const existing = listExecutions(trade.accountId, JSON.parse(trade.executionIdsJson) as string[]);
  const openQty = Number(
    Math.abs(
      existing.reduce((sum, row) => sum + (row.side === "buy" ? row.quantity : -row.quantity), 0),
    ).toFixed(8),
  );
  requireValue(openQty > 0, "This trade is already closed.");
  const quantity = input.quantity ?? openQty;
  requireValue(
    Number.isFinite(quantity) && quantity > 0 && quantity <= openQty + 1e-9,
    `Enter a quantity above 0 and up to the open position (${openQty}).`,
  );
  requireValue(Number.isFinite(input.price), "Enter the exit price.");
  return replaceTradeExecutions(tradeKey, [
    ...existing.map((row) => ({
      id: row.id,
      side: row.side as "buy" | "sell",
      quantity: row.quantity,
      price: row.price,
      fee: row.fee,
      executedAt: row.executedAt,
    })),
    {
      side: trade.direction === "long" ? "sell" : "buy",
      quantity,
      price: input.price,
      fee: input.fee ?? 0,
      executedAt: input.executedAt ?? nowIso(),
    },
  ]);
};

/**
 * Set (or clear, with null) the market of the given trades by updating the fills they are
 * built from, then rebuild so every view agrees. Notes, tags and scores are kept.
 */
export const setTradesMarket = (
  rows: Array<{ accountId: string; executionIdsJson: string }>,
  market: string | null,
): void => {
  const byAccount = new Map<string, string[]>();
  for (const row of rows)
    byAccount.set(row.accountId, [
      ...(byAccount.get(row.accountId) ?? []),
      ...(JSON.parse(row.executionIdsJson) as string[]),
    ]);
  db.transaction((tx) => {
    for (const [accountId, ids] of byAccount)
      for (let i = 0; i < ids.length; i += 500)
        tx.update(executions)
          .set({ assetClass: market })
          .where(and(eq(executions.accountId, accountId), inArray(executions.id, ids.slice(i, i + 500))))
          .run();
    for (const accountId of byAccount.keys()) rebuildAccount(accountId);
  });
};
