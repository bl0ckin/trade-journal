import { db, accounts, playbooks, tradeRuleChecks } from "@/db";
import { getMultipliers, getTimeZone } from "./settings";
import { queryTrades, type TradeRow } from "./trades-query";
import { parseEmotions } from "@/lib/emotions";
import { resolveMarket } from "@/lib/markets";
import { formatTimestamp } from "@/lib/timezone";

/**
 * One row per trade, with everything the journal knows about it: results, the plan (stop and
 * target), process scores, mistakes, emotions, playbook-rule compliance, and context about what
 * came before it. Meant to be uploaded to an AI assistant (or opened in a spreadsheet) for analysis.
 */
export const TRADE_CSV_COLUMNS = [
  // Identity
  "key",
  "account_id",
  "account_name",
  "symbol",
  "market",
  "direction",
  "status",
  // When
  "opened_at_utc",
  "closed_at_utc",
  "opened_local",
  "closed_local",
  "weekday",
  "hour_of_day",
  "duration_minutes",
  // Result
  "quantity",
  "avg_entry",
  "avg_exit",
  "gross_pnl",
  "fees",
  "net_pnl",
  "currency",
  // The plan
  "planned_stop_loss",
  "planned_profit_target",
  "planned_risk_amount",
  "planned_reward_to_risk",
  "realized_r",
  // Process and psychology
  "trade_quality_1_10",
  "confidence_1_10",
  "star_rating",
  "emotional_state",
  "mistakes",
  "mistake_count",
  "tags",
  "reviewed",
  // Playbook and rule compliance
  "playbook",
  "rules_followed",
  "rules_total",
  "rule_compliance_pct",
  "rules_followed_list",
  "rules_broken_list",
  // Context (what came before)
  "trade_number_in_day",
  "minutes_since_previous_trade",
  "losses_in_a_row_before",
  "cumulative_net_pnl",
  // Free text
  "notes",
] as const;

const parseList = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/** Quote for CSV, collapse line breaks, and defuse spreadsheet formulas in free text. */
const cell = (value: unknown, text = false): string => {
  if (value === null || value === undefined) return "";
  let out = String(value);
  if (text) {
    out = out.replace(/\r?\n+/g, " / ").trim();
    if (/^[=+@\t\r]|^-\S/.test(out)) out = `'${out}`;
  }
  return /[",\n\r]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
};

const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();
const weekdayOf = (iso: string, timeZone: string): string => {
  let formatter = weekdayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" });
    weekdayFormatters.set(timeZone, formatter);
  }
  return formatter.format(new Date(iso));
};

/** Planned risk and reward from the entry, stop and target, or null when the plan doesn't make sense. */
const planOf = (row: TradeRow, multiplier: number | undefined) => {
  const { avgEntry: entry, stopLoss: stop, profitTarget: target, direction } = row;
  const sign = direction === "long" ? 1 : -1;
  const riskPerUnit = stop === null ? null : (entry - stop) * sign;
  const rewardPerUnit = target === null ? null : (target - entry) * sign;
  const validRisk = riskPerUnit !== null && riskPerUnit > 0 ? riskPerUnit : null;
  const validReward = rewardPerUnit !== null && rewardPerUnit > 0 ? rewardPerUnit : null;
  const needsMultiplier = ["futures", "option", "forex", "cfd"].includes(row.assetClass ?? "");
  const riskAmount =
    validRisk === null || (needsMultiplier && multiplier == null)
      ? null
      : validRisk * row.quantity * (multiplier ?? 1);
  return {
    riskAmount,
    rewardToRisk: validRisk !== null && validReward !== null ? validReward / validRisk : null,
  };
};

export const buildTradeCsv = (rows: TradeRow[]): string => {
  const timeZone = getTimeZone();
  const multipliers = getMultipliers();
  const accountById = new Map(
    db
      .select()
      .from(accounts)
      .all()
      .map((account) => [account.id, account]),
  );
  const playbookById = new Map(
    db
      .select()
      .from(playbooks)
      .all()
      .map((playbook) => [playbook.id, playbook.name]),
  );
  const checksByTrade = new Map<string, { rule: string; followed: boolean }[]>();
  for (const check of db.select().from(tradeRuleChecks).all()) {
    const list = checksByTrade.get(check.tradeKey) ?? [];
    list.push({ rule: check.rule, followed: check.followed });
    checksByTrade.set(check.tradeKey, list);
  }

  const sorted = [...rows].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const perDay = new Map<string, number>();
  let lossStreak = 0;
  let cumulative = 0;
  let previousClose: string | null = null;

  const lines = sorted.map((row) => {
    const openedLocal = formatTimestamp(row.openedAt, timeZone);
    const day = openedLocal.slice(0, 10);
    const numberInDay = (perDay.get(day) ?? 0) + 1;
    perDay.set(day, numberInDay);

    const minutesSincePrevious =
      previousClose === null
        ? null
        : Math.max(0, round((Date.parse(row.openedAt) - Date.parse(previousClose)) / 60_000, 1));
    const streakBefore = lossStreak;
    if (row.status === "loss") lossStreak += 1;
    else if (row.status === "win") lossStreak = 0;
    if (row.status !== "open") cumulative += row.netPnl;
    previousClose = row.closedAt ?? null;

    const plan = planOf(row, multipliers[row.symbol]);
    const realizedR =
      plan.riskAmount !== null && row.status !== "open" ? row.netPnl / plan.riskAmount : null;

    const checks = checksByTrade.get(row.key) ?? [];
    const followed = checks.filter((check) => check.followed);
    const broken = checks.filter((check) => !check.followed);
    const mistakes = parseList(row.mistakesJson);

    const values: Record<(typeof TRADE_CSV_COLUMNS)[number], string> = {
      key: cell(row.key),
      account_id: cell(row.accountId),
      account_name: cell(accountById.get(row.accountId)?.name, true),
      symbol: cell(row.symbol, true),
      market: cell(resolveMarket(row.assetClass, row.symbol) ?? ""),
      direction: cell(row.direction),
      status: cell(row.status),
      opened_at_utc: cell(row.openedAt),
      closed_at_utc: cell(row.closedAt),
      opened_local: cell(openedLocal),
      closed_local: cell(row.closedAt ? formatTimestamp(row.closedAt, timeZone) : ""),
      weekday: cell(weekdayOf(row.openedAt, timeZone)),
      hour_of_day: cell(Number(openedLocal.slice(11, 13))),
      duration_minutes: cell(row.durationMs == null ? "" : round(row.durationMs / 60_000, 1)),
      quantity: cell(row.quantity),
      avg_entry: cell(row.avgEntry),
      avg_exit: cell(row.avgExit),
      gross_pnl: cell(round(row.grossPnl, 2)),
      fees: cell(round(row.fees, 2)),
      net_pnl: cell(round(row.netPnl, 2)),
      currency: cell(accountById.get(row.accountId)?.currency),
      planned_stop_loss: cell(row.stopLoss),
      planned_profit_target: cell(row.profitTarget),
      planned_risk_amount: cell(plan.riskAmount === null ? "" : round(plan.riskAmount, 2)),
      planned_reward_to_risk: cell(plan.rewardToRisk === null ? "" : round(plan.rewardToRisk, 2)),
      realized_r: cell(realizedR === null ? "" : round(realizedR, 2)),
      trade_quality_1_10: cell(row.tradeQuality),
      confidence_1_10: cell(row.confidence),
      star_rating: cell(row.rating),
      emotional_state: cell(parseEmotions(row.emotionalState).join("; "), true),
      mistakes: cell(mistakes.join("; "), true),
      mistake_count: cell(mistakes.length),
      tags: cell(parseList(row.tagsJson).join("; "), true),
      reviewed: cell(row.reviewedAt ? "yes" : "no"),
      playbook: cell(row.playbookId ? (playbookById.get(row.playbookId) ?? "") : "", true),
      rules_followed: cell(checks.length ? followed.length : ""),
      rules_total: cell(checks.length ? checks.length : ""),
      rule_compliance_pct: cell(checks.length ? round((followed.length / checks.length) * 100, 1) : ""),
      rules_followed_list: cell(followed.map((check) => check.rule).join("; "), true),
      rules_broken_list: cell(broken.map((check) => check.rule).join("; "), true),
      trade_number_in_day: cell(numberInDay),
      minutes_since_previous_trade: cell(minutesSincePrevious),
      losses_in_a_row_before: cell(streakBefore),
      cumulative_net_pnl: cell(round(cumulative, 2)),
      notes: cell(row.notes, true),
    };
    return TRADE_CSV_COLUMNS.map((column) => values[column]).join(",");
  });

  return [TRADE_CSV_COLUMNS.join(","), ...lines].join("\n");
};
