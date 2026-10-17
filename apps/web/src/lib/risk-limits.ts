/** Daily guard-rails: stop-trading thresholds that are checked per account, per journal day. */
export interface RiskLimits {
  /** Largest realised loss for the day, in the account's currency. Null = no limit. */
  maxDailyLoss: number | null;
  /** Most trades that may be opened in a day. Null = no limit. */
  maxTradesPerDay: number | null;
  /** Losing trades in a row (closed today) that should make you stop. Null = no limit. */
  maxConsecutiveLosses: number | null;
}

export const NO_RISK_LIMITS: RiskLimits = {
  maxDailyLoss: null,
  maxTradesPerDay: null,
  maxConsecutiveLosses: null,
};

export const hasRiskLimits = (limits: RiskLimits) =>
  limits.maxDailyLoss !== null ||
  limits.maxTradesPerDay !== null ||
  limits.maxConsecutiveLosses !== null;

export const parseRiskLimits = (
  raw: unknown,
): { limits: RiskLimits; error?: undefined } | { error: string; limits?: undefined } => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return { error: "Enter valid risk limits." };
  const body = raw as Record<string, unknown>;
  const loss = body.maxDailyLoss ?? null;
  const count = body.maxTradesPerDay ?? null;
  const streak = body.maxConsecutiveLosses ?? null;
  if (loss !== null && !(typeof loss === "number" && Number.isFinite(loss) && loss > 0))
    return { error: "Max daily loss must be a number above 0, or empty for no limit." };
  if (count !== null && !(typeof count === "number" && Number.isInteger(count) && count >= 1))
    return { error: "Max trades per day must be a whole number of 1 or more, or empty." };
  if (streak !== null && !(typeof streak === "number" && Number.isInteger(streak) && streak >= 1))
    return { error: "Max consecutive losses must be a whole number of 1 or more, or empty." };
  return { limits: { maxDailyLoss: loss, maxTradesPerDay: count, maxConsecutiveLosses: streak } };
};

export type LimitLevel = "warning" | "reached";
export interface LimitWarning {
  kind: "loss" | "trades" | "streak";
  level: LimitLevel;
  message: string;
}

/** Share of the loss limit at which an early warning starts. */
const LOSS_WARN_RATIO = 0.8;

export interface DayActivity {
  /** Net P&L of trades closed today (negative = loss). */
  realizedPnl: number;
  /** Trades opened today, open or closed. */
  tradesOpened: number;
  /** Losing trades in a row at the end of today's closed trades. */
  consecutiveLosses?: number;
}

export const evaluateDay = (
  limits: RiskLimits,
  day: DayActivity,
  money: (amount: number) => string,
): LimitWarning[] => {
  const warnings: LimitWarning[] = [];
  const { maxDailyLoss, maxTradesPerDay, maxConsecutiveLosses } = limits;
  if (maxDailyLoss !== null) {
    const loss = Math.max(0, -day.realizedPnl);
    if (loss >= maxDailyLoss)
      warnings.push({
        kind: "loss",
        level: "reached",
        message: `Daily loss limit reached: down ${money(loss)} today (limit ${money(maxDailyLoss)}).`,
      });
    else if (loss >= maxDailyLoss * LOSS_WARN_RATIO)
      warnings.push({
        kind: "loss",
        level: "warning",
        message: `Approaching your daily loss limit: down ${money(loss)} of ${money(maxDailyLoss)}.`,
      });
  }
  if (maxTradesPerDay !== null) {
    if (day.tradesOpened >= maxTradesPerDay)
      warnings.push({
        kind: "trades",
        level: "reached",
        message: `Daily trade limit reached: ${day.tradesOpened} of ${maxTradesPerDay} trades taken today.`,
      });
    else if (maxTradesPerDay > 1 && day.tradesOpened === maxTradesPerDay - 1)
      warnings.push({
        kind: "trades",
        level: "warning",
        message: `One trade left today: ${day.tradesOpened} of ${maxTradesPerDay} taken.`,
      });
  }
  if (maxConsecutiveLosses !== null) {
    const streak = day.consecutiveLosses ?? 0;
    if (streak >= maxConsecutiveLosses)
      warnings.push({
        kind: "streak",
        level: "reached",
        message: `Losing streak limit reached: ${streak} losses in a row today. Consider stepping away.`,
      });
    else if (maxConsecutiveLosses > 1 && streak === maxConsecutiveLosses - 1)
      warnings.push({
        kind: "streak",
        level: "warning",
        message: `${streak} losses in a row today. One more hits your streak limit of ${maxConsecutiveLosses}.`,
      });
  }
  return warnings;
};
