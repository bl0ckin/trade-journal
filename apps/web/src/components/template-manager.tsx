"use client";

import { useState } from "react";
import { FilePlus2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { NoteTemplate } from "@/lib/note-templates";
import { postJson, useApi } from "@/lib/use-api";

type Selection = { kind: "new" } | { kind: "custom"; id: string };

/** Create, edit and delete the note templates used by every notes editor. */
export function TemplateManager({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { data, refresh } = useApi<{ templates: NoteTemplate[] }>(open ? "/api/workspace/templates" : null);
  const templates = data?.templates ?? [];
  const [selection, setSelection] = useState<Selection>({ kind: "new" });
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const select = (next: Selection, template?: NoteTemplate) => {
    setSelection(next);
    setName(template?.name ?? "");
    setContent(template?.content ?? "");
    setError("");
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      refresh();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t save the template.");
    } finally {
      setBusy(false);
    }
  };

  const canSave = name.trim().length > 0 && content.trim().length > 0 && !busy;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Note templates</DialogTitle>
          <DialogDescription>
            Templates appear in the Insert template menu of every notes editor: trades, daily
            journal, notebook and missed trades.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <div className="space-y-1">
            <Button
              size="sm"
              variant={selection.kind === "new" ? "default" : "outline"}
              className="w-full justify-start gap-2"
              onClick={() => select({ kind: "new" })}
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              New template
            </Button>
            <div className="max-h-72 space-y-0.5 overflow-y-auto pt-1">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => select({ kind: "custom", id: template.id }, template)}
                  className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${
                    selection.kind === "custom" && selection.id === template.id ? "bg-accent" : ""
                  }`}
                >
                  {template.name}
                </button>
              ))}
              {templates.length === 0 && (
                <p className="px-2 py-3 text-xs text-muted-foreground">No templates yet.</p>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Template name"
            />
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder={"## Headings and checklists\n- [ ] Markdown works here"}
              className="min-h-56 font-mono text-[13px]"
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!canSave}
                  onClick={() =>
                    void run(async () => {
                      if (selection.kind === "custom") {
                        await postJson(
                          "/api/workspace/templates",
                          { id: selection.id, name, content },
                          "PATCH",
                        );
                      } else {
                        const created = await postJson<{ id: string }>("/api/workspace/templates", {
                          name,
                          content,
                        });
                        setSelection({ kind: "custom", id: created.id });
                      }
                    })
                  }
                >
                  {selection.kind === "custom" ? "Save changes" : "Save template"}
                </Button>
              {selection.kind === "custom" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5 text-muted-foreground hover:text-destructive"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Delete the template “${name}”?`)) return;
                    void run(async () => {
                      await postJson("/api/workspace/templates", { id: selection.id }, "DELETE");
                      select({ kind: "new" });
                    });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
