import { parseEmotions } from "./emotions";

/** Extra per-trade statistics for the Reports overview. Pure and framework-free. */

export interface StatTrade {
  key?: string;
  symbol?: string;
  direction?: string;
  status: string;
  netPnl: number;
  grossPnl: number;
  fees: number;
  openedAt: string;
  closedAt?: string | null;
  durationMs?: number | null;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface TopTrade {
  key: string;
  symbol: string;
  direction: string;
  closedAt: string | null;
  netPnl: number;
}

export interface ExtendedStats {
  /** Trade P&L distribution in bins aligned to zero. */
  histogram: HistogramBin[];
  topWins: TopTrade[];
  topLosses: TopTrade[];
  grossProfit: number;
  grossLoss: number;
  avgTrade: number | null;
  medianTrade: number | null;
  stdDev: number | null;
  /** Mean trade P&L divided by its standard deviation. Not annualized. */
  sharpePerTrade: number | null;
  /** Mean trade P&L divided by downside deviation (losses only). Not annualized. */
  sortinoPerTrade: number | null;
  /** Average win divided by the size of the average loss. */
  payoffRatio: number | null;
  /** Win rate needed to break even at the current payoff ratio. */
  breakEvenWinRate: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  avgFeePerTrade: number | null;
  avgWinHoldMs: number | null;
  avgLossHoldMs: number | null;
  longestHoldMs: number | null;
  shortestHoldMs: number | null;
}

const mean = (values: number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const holdMs = (trade: StatTrade): number | null => {
  if (typeof trade.durationMs === "number" && Number.isFinite(trade.durationMs))
    return trade.durationMs;
  if (!trade.closedAt) return null;
  const ms = Date.parse(trade.closedAt) - Date.parse(trade.openedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
};

const niceStep = (raw: number): number => {
  if (!(raw > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
};

/** Bin trade P&L so zero is always a bin edge (wins and losses never share a bar). */
const buildHistogram = (values: number[]): HistogramBin[] => {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ from: min, to: max, count: values.length }];
  const target = Math.min(16, Math.max(5, Math.round(Math.sqrt(values.length) * 1.6)));
  const step = niceStep((max - min) / target);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const count = Math.max(1, Math.round((end - start) / step));
  const bins: HistogramBin[] = Array.from({ length: count }, (_, i) => ({
    from: start + i * step,
    to: start + (i + 1) * step,
    count: 0,
  }));
  for (const value of values) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((value - start) / step)));
    bins[index]!.count += 1;
  }
  return bins;
};

const asTop = (trade: StatTrade): TopTrade => ({
  key: trade.key ?? "",
  symbol: trade.symbol ?? "",
  direction: trade.direction ?? "",
  closedAt: trade.closedAt ?? null,
  netPnl: trade.netPnl,
});

export const computeExtendedStats = (trades: StatTrade[]): ExtendedStats => {
  const closed = trades.filter((trade) => trade.status !== "open");
  const pnl = closed.map((trade) => trade.netPnl);
  const wins = closed.filter((trade) => trade.status === "win");
  const losses = closed.filter((trade) => trade.status === "loss");
  const avgTrade = mean(pnl);

  const sorted = [...pnl].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianTrade = sorted.length
    ? sorted.length % 2
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2
    : null;

  let stdDev: number | null = null;
  let sharpe: number | null = null;
  let sortino: number | null = null;
  if (avgTrade !== null && pnl.length >= 2) {
    stdDev = Math.sqrt(pnl.reduce((sum, v) => sum + (v - avgTrade) ** 2, 0) / (pnl.length - 1));
    if (stdDev > 0) sharpe = avgTrade / stdDev;
    const downside = Math.sqrt(pnl.reduce((sum, v) => sum + Math.min(0, v) ** 2, 0) / pnl.length);
    if (downside > 0) sortino = avgTrade / downside;
  }

  const avgWin = mean(wins.map((trade) => trade.netPnl));
  const avgLoss = mean(losses.map((trade) => trade.netPnl));
  const payoff = avgWin !== null && avgLoss !== null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null;

  const winHolds = wins.map(holdMs).filter((v): v is number => v !== null);
  const lossHolds = losses.map(holdMs).filter((v): v is number => v !== null);
  const allHolds = closed.map(holdMs).filter((v): v is number => v !== null);

  const ranked = [...closed].filter((trade) => trade.key).sort((a, b) => b.netPnl - a.netPnl);
  return {
    histogram: buildHistogram(pnl),
    topWins: ranked.filter((trade) => trade.netPnl > 0).slice(0, 5).map(asTop),
    topLosses: ranked
      .filter((trade) => trade.netPnl < 0)
      .slice(-5)
      .reverse()
      .map(asTop),
    grossProfit: closed.reduce((sum, trade) => sum + Math.max(0, trade.netPnl), 0),
    grossLoss: closed.reduce((sum, trade) => sum + Math.min(0, trade.netPnl), 0),
    avgTrade,
    medianTrade,
    stdDev,
    sharpePerTrade: sharpe,
    sortinoPerTrade: sortino,
    payoffRatio: payoff,
    breakEvenWinRate: payoff !== null ? 1 / (1 + payoff) : null,
    largestWin: wins.length ? Math.max(...wins.map((trade) => trade.netPnl)) : null,
    largestLoss: losses.length ? Math.min(...losses.map((trade) => trade.netPnl)) : null,
    avgFeePerTrade: mean(closed.map((trade) => trade.fees)),
    avgWinHoldMs: mean(winHolds),
    avgLossHoldMs: mean(lossHolds),
    longestHoldMs: allHolds.length ? Math.max(...allHolds) : null,
    shortestHoldMs: allHolds.length ? Math.min(...allHolds) : null,
  };
};

export interface PsychBucket {
  key: string;
  label: string;
  netPnl: number;
  trades: number;
  winRate: number | null;
}

export interface PsychologyStats {
  emotions: PsychBucket[];
  quality: PsychBucket[];
  confidence: PsychBucket[];
  /** Closed trades that have at least one of the three self-assessment fields. */
  tagged: number;
}

interface PsychSource {
  emotionalState: string | null;
  tradeQuality: number | null;
  confidence: number | null;
}

const BANDS: Array<[string, string, number, number]> = [
  ["1-3", "Low (1-3)", 1, 3],
  ["4-6", "Medium (4-6)", 4, 6],
  ["7-10", "High (7-10)", 7, 10],
];

/** How results differ by emotional state, trade quality and confidence. Closed trades only. */
export const computePsychology = (
  trades: Array<{ key: string; status: string; netPnl: number }>,
  rowByKey: Map<string, PsychSource>,
): PsychologyStats => {
  type Acc = { pnl: number; trades: number; wins: number };
  const add = (map: Map<string, Acc>, key: string, trade: { status: string; netPnl: number }) => {
    const acc = map.get(key) ?? { pnl: 0, trades: 0, wins: 0 };
    acc.pnl += trade.netPnl;
    acc.trades += 1;
    if (trade.status === "win") acc.wins += 1;
    map.set(key, acc);
  };
  const bucket = (key: string, label: string, acc: Acc): PsychBucket => ({
    key,
    label,
    netPnl: acc.pnl,
    trades: acc.trades,
    winRate: acc.trades ? acc.wins / acc.trades : null,
  });

  const emotions = new Map<string, Acc>();
  const quality = new Map<string, Acc>();
  const confidence = new Map<string, Acc>();
  let tagged = 0;
  for (const trade of trades) {
    if (trade.status === "open") continue;
    const row = rowByKey.get(trade.key);
    if (!row) continue;
    const states = parseEmotions(row.emotionalState);
    if (states.length || row.tradeQuality !== null || row.confidence !== null) tagged += 1;
    for (const state of states) add(emotions, state, trade);
    for (const [target, value] of [
      [quality, row.tradeQuality],
      [confidence, row.confidence],
    ] as const) {
      if (value === null) continue;
      const band = BANDS.find(([, , low, high]) => value >= low && value <= high);
      if (band) add(target, band[0], trade);
    }
  }
  const banded = (map: Map<string, Acc>) =>
    BANDS.filter(([key]) => map.has(key)).map(([key, label]) => bucket(key, label, map.get(key)!));
  return {
    emotions: [...emotions.entries()]
      .map(([key, acc]) => bucket(key, key, acc))
      .sort((a, b) => b.netPnl - a.netPnl),
    quality: banded(quality),
    confidence: banded(confidence),
    tagged,
  };
};
