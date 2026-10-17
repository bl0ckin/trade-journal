import { useCallback, useRef, useState } from "react";

/**
 * A Radix Dialog blocks wheel scrolling for everything outside its own DOM, and a Popover
 * is portalled to <body>, so a popover opened from inside a dialog can't be scrolled with
 * the mouse wheel. Making that popover `modal` gives it its own scroll handling.
 *
 * Attach `anchor` to an element of the picker and call `sync()` just before opening: `modal`
 * is true only when the picker sits inside a dialog, so popovers elsewhere are unchanged.
 */
export function useDialogModal<T extends HTMLElement = HTMLElement>() {
  const anchor = useRef<T>(null);
  const [modal, setModal] = useState(false);
  const sync = useCallback(
    () => setModal(Boolean(anchor.current?.closest('[role="dialog"]'))),
    [],
  );
  return { anchor, modal, sync };
}
