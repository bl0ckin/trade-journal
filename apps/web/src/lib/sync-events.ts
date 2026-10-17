"use client";

import { useEffect, useRef } from "react";

const SYNC_EVENT = "journal:synced";

/** Tell other widgets on the page that broker data changed (manual or background sync). */
export const announceSynced = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SYNC_EVENT));
};

/** Run `callback` whenever a sync finished, e.g. to reload balances. */
export const useOnSynced = (callback: () => void) => {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    const handler = () => latest.current();
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, []);
};
