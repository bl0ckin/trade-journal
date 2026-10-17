/** Remembers the Trades table's sort order and visible columns between visits. */
export const TRADES_VIEW_KEY = "journal.trades.view.v1";

export interface TradesView {
  sorting: { id: string; desc: boolean }[];
  columnVisibility: Record<string, boolean>;
}

/** Defensive parse: storage can be empty, stale or hand-edited. */
export const parseTradesView = (raw: string | null | undefined): TradesView | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TradesView> | null;
    if (!value || typeof value !== "object") return null;
    const sorting = Array.isArray(value.sorting)
      ? value.sorting
          .filter(
            (item): item is { id: string; desc: boolean } =>
              Boolean(item) && typeof item.id === "string" && typeof item.desc === "boolean",
          )
          .slice(0, 3)
      : [];
    const columnVisibility: Record<string, boolean> = {};
    if (value.columnVisibility && typeof value.columnVisibility === "object") {
      for (const [id, visible] of Object.entries(value.columnVisibility)) {
        if (typeof visible === "boolean") columnVisibility[id] = visible;
      }
    }
    return { sorting, columnVisibility };
  } catch {
    return null;
  }
};

export const loadTradesView = (): TradesView | null => {
  try {
    return typeof window === "undefined"
      ? null
      : parseTradesView(window.localStorage.getItem(TRADES_VIEW_KEY));
  } catch {
    return null;
  }
};

export const saveTradesView = (serialized: string) => {
  try {
    window.localStorage.setItem(TRADES_VIEW_KEY, serialized);
  } catch {
    // Private mode or quota: the view simply isn't remembered.
  }
};
