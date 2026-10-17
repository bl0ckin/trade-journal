"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Choose any number of options from a fixed list. The list stays open while you choose. */
export function ChipSelect({
  options,
  value,
  onChange,
  addLabel,
  emptyLabel = "None selected",
}: {
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name]);

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
        <div className="flex flex-wrap gap-1.5 rounded-lg border bg-card p-2">
          {options.map((name) => {
            const on = value.includes(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
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
      )}
    </div>
  );
}
