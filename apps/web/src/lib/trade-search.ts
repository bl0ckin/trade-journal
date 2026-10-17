/** Text search over a trade's symbol, tags, mistakes, emotions and notes. */
export interface SearchableTrade {
  symbol: string;
  direction?: string | null;
  notes?: string | null;
  emotionalState?: string | null;
  tags?: readonly string[];
  mistakes?: readonly string[];
}

/** Notes are stored as rich-editor HTML; search the visible text only. */
export const htmlToText = (html: string): string =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#39;/gi, "'")
    .replace(/\s+/g, " ");

/** Every whitespace-separated term must appear somewhere (case-insensitive). */
export const matchesTradeSearch = (trade: SearchableTrade, query: string): boolean => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    trade.symbol,
    trade.direction ?? "",
    trade.emotionalState ?? "",
    ...(trade.tags ?? []),
    ...(trade.mistakes ?? []),
    trade.notes ? htmlToText(trade.notes) : "",
  ]
    .join("\n")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
};
