"use client";

import { useState, type ReactNode } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Choose any number of options from a list. The list stays open while you choose.
 * Pass `onCreate` to let people type a new option (used by tags and mistakes).
 */
export function ChipSelect({
  options,
  value,
  onChange,
  addLabel,
  emptyLabel = "None selected",
  onCreate,
  createPlaceholder = "New option",
  emptyOptionsLabel,
  optionTitle,
  footer,
}: {
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
  emptyLabel?: string;
  /** Show a field in the open list for typing a new option. Receives the trimmed name. */
  onCreate?: (name: string) => void | Promise<void>;
  createPlaceholder?: string;
  /** Shown instead of the options when the list is empty. */
  emptyOptionsLabel?: string;
  /** Optional hover text for an option, such as how often it was used. */
  optionTitle?: (name: string) => string | undefined;
  /** Extra controls under the options, such as an edit-list button. */
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name]);
  const create = async () => {
    const name = draft.trim();
    if (!name || !onCreate) return;
    setDraft("");
    await onCreate(name);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 && <span className="text-xs text-muted-foreground">{emptyLabel}</span>}
        {value.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pl-2.5 pr-1 text-xs"
          >
            {name}
            <button
              type="button"
              aria-label={`Remove ${name}`}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => toggle(name)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 gap-1 rounded-full px-2 text-xs"
          onClick={() => setOpen(!open)}
        >
          <Plus className="h-3 w-3" />
          {open ? "Done" : addLabel}
        </Button>
      </div>
      {open && (
        <div className="space-y-2 rounded-lg border bg-card p-2">
          {options.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {options.map((name) => {
                const on = value.includes(name);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    title={optionTitle?.(name)}
                    onClick={() => toggle(name)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      on ? "border-foreground bg-accent font-medium" : "hover:bg-accent/60"
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                    {name}
                  </button>
                );
              })}
            </div>
          ) : (
            emptyOptionsLabel && (
              <p className="px-1 py-1 text-xs text-muted-foreground">{emptyOptionsLabel}</p>
            )
          )}
          {onCreate && (
            <div className="flex items-center gap-1.5">
              <input
                value={draft}
                maxLength={60}
                aria-label={createPlaceholder}
                placeholder={createPlaceholder}
                className="h-7 min-w-0 flex-1 rounded-full border bg-transparent px-3 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void create();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 rounded-full px-2.5 text-xs"
                disabled={!draft.trim()}
                onClick={() => void create()}
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
