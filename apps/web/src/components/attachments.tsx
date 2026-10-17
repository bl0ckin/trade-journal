"use client";
import { HoverHint } from "./ui/tooltip";
import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen, Paperclip, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { postJson, useApi } from "@/lib/use-api";
import { ImageViewer } from "./image-viewer";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

interface Pending {
  id: string;
  file: File;
  preview: string | null;
}

export function Attachments({
  type,
  id,
  editable = false,
}: {
  type: "trade" | "day" | "note" | "missed" | "prop-account" | "prop-entry";
  id: string;
  /** Show the add and remove controls. Leave off for finished, read-only notes. */
  editable?: boolean;
}) {
  const { data, error, refresh } = useApi<{
    attachments: { id: string; name: string; mime: string; size: number }[];
  }>(`/api/attachments?type=${type}&id=${encodeURIComponent(id)}`);
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const images = (data?.attachments ?? [])
    .filter((a) => a.mime.startsWith("image/"))
    .map((a) => ({ id: a.id, name: a.name, src: `/api/attachments/${a.id}` }));

  const discard = (items: Pending[]) =>
    items.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));

  const add = (files: File[]) => {
    const accepted: Pending[] = [];
    let rejected = "";
    for (const file of files) {
      if (!ALLOWED.includes(file.type)) rejected = `${file.name || "A file"} isn't a PNG, JPEG, WebP or PDF.`;
      else if (file.size > MAX_BYTES) rejected = `${file.name || "A file"} is over 8 MB.`;
      else {
        // Pasted screenshots all arrive as "image.png"; give them a unique readable name.
        const named =
          !file.name || /^image\.\w+$/i.test(file.name)
            ? new File([file], `pasted-${Date.now()}-${accepted.length + 1}.${file.type.split("/")[1]}`, {
                type: file.type,
              })
            : file;
        accepted.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file: named,
          preview: named.type.startsWith("image/") ? URL.createObjectURL(named) : null,
        });
      }
    }
    setFailure(rejected);
    if (accepted.length) setQueue((current) => [...current, ...accepted]);
  };

  // While the popout is open, a paste anywhere in it adds the clipboard's images.
  useEffect(() => {
    if (!open) return;
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      add(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      discard(queue);
      setQueue([]);
      setFailure("");
      setDragging(false);
    }
  };

  const upload = async () => {
    if (!queue.length || busy) return;
    setBusy(true);
    setFailure("");
    try {
      for (const item of queue) {
        const body = new FormData();
        body.append("type", type);
        body.append("id", id);
        body.append("file", item.file);
        const response = await fetch("/api/attachments", { method: "POST", body });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
      }
      discard(queue);
      setQueue([]);
      setOpen(false);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className={`space-y-3 ${editable || data?.attachments.length ? "border-t pt-3" : ""}`}>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Paperclip />
            Add attachment
          </Button>
          <span className="text-xs text-muted-foreground">Images or PDF · up to 8 MB each</span>
        </div>
      )}

      <Dialog open={editable && open} onOpenChange={close}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add attachments</DialogTitle>
            <DialogDescription>
              Paste a screenshot, drop files here, or pick them from your computer.
            </DialogDescription>
          </DialogHeader>

          <div
            tabIndex={0}
            role="button"
            aria-label="Paste or drop files here"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              add(Array.from(event.dataTransfer.files));
            }}
            className={`flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center outline-none transition-colors focus-visible:border-foreground ${
              dragging ? "border-foreground bg-accent/40" : "border-border"
            }`}
          >
            <p className="text-sm font-medium">Paste an image with Ctrl+V (⌘V on Mac)</p>
            <p className="text-xs text-muted-foreground">or drag and drop files here</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-1 gap-1.5"
              onClick={() => input.current?.click()}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Choose from computer
            </Button>
          </div>
          <input
            ref={input}
            aria-label="Choose files to attach"
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="hidden"
            multiple
            onChange={(event) => {
              add(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />

          {queue.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {queue.map((item) => (
                <li key={item.id} className="relative rounded-md border p-1.5">
                  {item.preview ? (
                    <img
                      src={item.preview}
                      alt={item.file.name}
                      className="h-20 w-full rounded object-contain"
                    />
                  ) : (
                    <div className="flex h-20 items-center justify-center text-muted-foreground">
                      <FileText className="h-8 w-8" />
                    </div>
                  )}
                  <p className="mt-1 truncate text-[11px]" title={item.file.name}>
                    {item.file.name}
                  </p>
                  <button
                    type="button"
                    aria-label={`Remove ${item.file.name}`}
                    className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 shadow hover:bg-accent"
                    onClick={() => {
                      discard([item]);
                      setQueue((current) => current.filter((entry) => entry.id !== item.id));
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => close(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void upload()} disabled={busy || queue.length === 0}>
              {busy ? "Uploading…" : queue.length ? `Add ${queue.length} file${queue.length === 1 ? "" : "s"}` : "Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {!open && (failure || error) && (
        <p role="alert" className="text-xs text-destructive">
          {failure || error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {data?.attachments.map((a) => (
          <div
            key={a.id}
            className="group min-w-0 rounded-xl border bg-card p-2 transition-shadow hover:shadow-md"
          >
            <HoverHint content={a.name}>
              {a.mime.startsWith("image/") ? (
                <button
                  type="button"
                  aria-label={`View ${a.name}`}
                  className="block w-full cursor-zoom-in text-left"
                  onClick={() => setViewing(images.findIndex((image) => image.id === a.id))}
                >
                  <img
                    src={`/api/attachments/${a.id}`}
                    alt={a.name}
                    className="mb-2 h-28 w-full rounded-lg bg-muted/40 object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                  <span className="block truncate text-xs underline">{a.name}</span>
                </button>
              ) : (
                <a href={`/api/attachments/${a.id}`} download className="block">
                  <span className="block truncate text-xs underline">{a.name}</span>
                </a>
              )}
            </HoverHint>
            <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{Math.round(a.size / 1024)} KB</span>
              {editable &&
                (removing === a.id ? (
                  <span className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="h-6 px-2"
                      onClick={async () => {
                        setRemoving(null);
                        try {
                          await postJson(`/api/attachments/${a.id}`, undefined, "DELETE");
                          refresh();
                        } catch (e) {
                          setFailure(e instanceof Error ? e.message : "Couldn't remove that file.");
                        }
                      }}
                    >
                      Remove
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2"
                      onClick={() => setRemoving(null)}
                    >
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => setRemoving(a.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                ))}
            </div>
          </div>
        ))}
      </div>
      <ImageViewer
        images={images}
        index={viewing}
        onIndexChange={setViewing}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}
