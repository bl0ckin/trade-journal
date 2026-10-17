/**
 * Filters the journal core does not know about: psychology (emotion, trade
 * quality, confidence). They travel in the URL next to the core filters and are
 * applied in `queryTrades`. Market reuses the core `assetClass` filter key.
 */
export const EXTRA_FILTER_KEYS = [
  "emotion",
  "qualityMin",
  "qualityMax",
  "confidenceMin",
  "confidenceMax",
] as const;

export type ExtraFilterKey = (typeof EXTRA_FILTER_KEYS)[number];
export type ExtraFilters = Partial<Record<ExtraFilterKey, string>>;

export const readExtraFilters = (params: URLSearchParams): ExtraFilters => {
  const out: ExtraFilters = {};
  for (const key of EXTRA_FILTER_KEYS) {
    const value = params.get(key)?.trim();
    if (value) out[key] = value;
  }
  return out;
};

export const EXTRA_FILTER_NAMES: Record<ExtraFilterKey, string> = {
  emotion: "Emotional state",
  qualityMin: "Minimum trade quality",
  qualityMax: "Maximum trade quality",
  confidenceMin: "Minimum confidence",
  confidenceMax: "Maximum confidence",
};
