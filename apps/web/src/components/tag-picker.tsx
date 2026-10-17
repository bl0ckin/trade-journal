"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { postJson, useApi } from "@/lib/use-api";

interface LibraryItem {
  name: string;
  count: number;
}

/**
 * Pick tags or mistakes from the ones you have used before, add new ones, and manage the
 * saved list (rename or delete everywhere).
 */
export function TagPicker({
  kind,
  value,
  onChange,
  noun,
}: {
  kind: "tag" | "mistake";
  value: string[];
  onChange: (next: string[]) => void;
  /** Lowercase singular word for the UI, such as "tag" or "mistake". */
  noun: string;
}) {
  const { data, error, refresh } = useApi<{ items: LibraryItem[] }>(
    `/api/tag-library?kind=${kind}`,
  );
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [manage, setManage] = useState(false);
  const items = data?.items ?? [];
  const selected = new Set(value);
  const term = query.trim();
  const shown = items.filter((item) => item.name.toLowerCase().includes(term.toLowerCase()));
  const exists = items.some((item) => item.name.toLowerCase() === term.toLowerCase());

  const toggle = (name: string) =>
    onChange(selected.has(name) ? value.filter((item) => item !== name) : [...value, name]);

  const create = async () => {
    if (!term) return;
    const existing = items.find((item) => item.name.toLowerCase() === term.toLowerCase());
    const name = existing?.name ?? term;
    if (!selected.has(name)) onChange([...value, name]);
    if (!existing) {
      try {
        await postJson("/api/tag-library", { kind, name });
        setNotice("");
        refresh();
      } catch (cause) {
        setNotice(
          `“${name}” was added to this trade but couldn’t be saved to your list: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
        );
      }
    }
    setQuery("");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 && <span className="text-xs text-muted-foreground">None yet</span>}
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
          {open ? "Done" : `Add ${noun}`}
        </Button>
      </div>

      {open && (
        <div className="space-y-2 rounded-lg border bg-card p-2">
          <Input
            autoFocus
            value={query}
            placeholder={`Search or type a new ${noun}`}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
            }}
          />
          {(error || notice) && (
            <p role="alert" className="text-xs text-destructive">
              {error ? `Couldn’t load your saved ${noun}s: ${error}` : notice}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Click to select several. The list stays open until you press Done.
          </p>
          <div className="max-h-44 space-y-0.5 overflow-y-auto">
            {term && !exists && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => void create()}
              >
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                Create “{term}”
              </button>
            )}
            {shown.map((item) => (
              <button
                key={item.name}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => toggle(item.name)}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {selected.has(item.name) && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {item.count} {item.count === 1 ? "trade" : "trades"}
                </span>
              </button>
            ))}
            {items.length === 0 && !term && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                Your saved {noun}s will appear here. Type a name above to create the first one.
              </p>
            )}
          </div>
          {items.length > 0 && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setManage(true)}
              >
                <Pencil className="h-3 w-3" />
                Edit saved {noun}s
              </Button>
            </div>
          )}
        </div>
      )}

      <ManageDialog
        kind={kind}
        noun={noun}
        open={manage}
        onOpenChange={setManage}
        items={items}
        onChanged={refresh}
        onRenamed={(from, to) =>
          onChange([...new Set(value.map((item) => (item === from ? to : item)))])
        }
        onDeleted={(name) => onChange(value.filter((item) => item !== name))}
      />
    </div>
  );
}

function ManageDialog({
  kind,
  noun,
  open,
  onOpenChange,
  items,
  onChanged,
  onRenamed,
  onDeleted,
}: {
  kind: "tag" | "mistake";
  noun: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: LibraryItem[];
  onChanged: () => void;
  onRenamed: (from: string, to: string) => void;
  onDeleted: (name: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t save the change.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Saved {noun}s</DialogTitle>
          <DialogDescription>
            Renaming or deleting a {noun} changes it on every trade that uses it.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {items.map((item) => (
            <li key={item.name} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
              {editing === item.name ? (
                <>
                  <Input
                    autoFocus
                    className="h-8"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setEditing(null);
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={busy || !draft.trim()}
                    onClick={() =>
                      void run(async () => {
                        const to = draft.trim();
                        if (to !== item.name) {
                          await postJson("/api/tag-library", { kind, from: item.name, to }, "PATCH");
                          onRenamed(item.name, to);
                        }
                        setEditing(null);
                      })
                    }
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.count} {item.count === 1 ? "trade" : "trades"}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Rename ${item.name}`}
                    onClick={() => {
                      setEditing(item.name);
                      setDraft(item.name);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${item.name}`}
                    disabled={busy}
                    onClick={() => {
                      const used =
                        item.count > 0
                          ? ` It will be removed from ${item.count} trade${item.count === 1 ? "" : "s"}.`
                          : "";
                      if (!confirm(`Delete “${item.name}”?${used}`)) return;
                      void run(async () => {
                        await postJson("/api/tag-library", { kind, name: item.name }, "DELETE");
                        onDeleted(item.name);
                      });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </li>
          ))}
          {items.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">Nothing saved yet.</li>
          )}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
