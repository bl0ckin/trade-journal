"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, FolderOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

type OwnerType = "trade" | "day" | "note" | "missed" | "prop-account" | "prop-entry";

/** Upload files to an item that now exists. Stops and throws on the first failure. */
export async function uploadAttachments(type: OwnerType, id: string, files: File[]) {
  for (const file of files) {
    const body = new FormData();
    body.append("type", type);
    body.append("id", id);
    body.append("file", file);
    const response = await fetch("/api/attachments", { method: "POST", body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Upload failed.");
  }
}

/**
 * Collect images and PDFs for something that has not been saved yet. Paste a screenshot, drop
 * files, or choose them. The caller uploads them with `uploadAttachments` once it has an id.
 */
export function AttachmentQueue({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(files);
  latest.current = files;

  const add = (incoming: File[]) => {
    const accepted: File[] = [];
    let rejected = "";
    for (const file of incoming) {
      if (!ALLOWED.includes(file.type)) rejected = `${file.name || "A file"} isn't a PNG, JPEG, WebP or PDF.`;
      else if (file.size > MAX_BYTES) rejected = `${file.name || "A file"} is over 8 MB.`;
      else
        accepted.push(
          !file.name || /^image\.\w+$/i.test(file.name)
            ? new File([file], `pasted-${Date.now()}-${accepted.length + 1}.${file.type.split("/")[1]}`, {
                type: file.type,
              })
            : file,
        );
    }
    setError(rejected);
    if (accepted.length) onChange([...latest.current, ...accepted]);
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (pasted.length === 0) return;
      event.preventDefault();
      add(pasted);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  return (
    <div className="space-y-2">
      <div
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
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-sm transition-colors ${
          dragging ? "border-foreground bg-accent/40" : "border-border"
        }`}
      >
        <span className="text-muted-foreground">
          Paste a screenshot (Ctrl+V), drop files here, or
        </span>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => input.current?.click()}>
          <FolderOpen className="h-3.5 w-3.5" />
          Choose from computer
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        aria-label="Choose files to attach"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        multiple
        onChange={(event) => {
          add(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {files.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="relative rounded-md border p-1.5">
              {file.type.startsWith("image/") ? (
                <Thumb file={file} />
              ) : (
                <div className="flex h-16 items-center justify-center text-muted-foreground">
                  <FileText className="h-7 w-7" />
                </div>
              )}
              <p className="mt-1 truncate text-[11px]" title={file.name}>
                {file.name}
              </p>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5 shadow hover:bg-accent"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt={file.name} className="h-16 w-full rounded object-contain" /> : null;
}
