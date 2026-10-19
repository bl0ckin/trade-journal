"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChipSelect } from "@/components/chip-select";
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
  const [manage, setManage] = useState(false);
  const items = data?.items ?? [];
  // Anything already on the trade stays visible even if it is not in the saved list.
  const options = [
    ...items.map((item) => item.name),
    ...value.filter((name) => !items.some((item) => item.name === name)),
  ];

  const create = async (typed: string) => {
    const existing = items.find((item) => item.name.toLowerCase() === typed.toLowerCase());
    const name = existing?.name ?? typed;
    if (!value.includes(name)) onChange([...value, name]);
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
  };

  return (
    <div className="space-y-2">
      <ChipSelect
        options={options}
        value={value}
        onChange={onChange}
        addLabel={`Add ${noun}`}
        emptyLabel="None yet"
        createPlaceholder={`New ${noun}`}
        emptyOptionsLabel={`Your saved ${noun}s will appear here. Type a name below to create the first one.`}
        optionTitle={(name) => {
          const item = items.find((entry) => entry.name === name);
          return item ? `${item.count} ${item.count === 1 ? "trade" : "trades"}` : undefined;
        }}
        onCreate={create}
        footer={
          items.length > 0 ? (
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
          ) : null
        }
      />
      {(error || notice) && (
        <p role="alert" className="text-xs text-destructive">
          {error ? `Couldn’t load your saved ${noun}s: ${error}` : notice}
        </p>
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
