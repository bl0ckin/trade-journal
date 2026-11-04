"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postJson } from "@/lib/use-api";
import type { RestoreSummary } from "@/server/restore";

const LABELS: Array<[keyof RestoreSummary, string]> = [
  ["accountsAdded", "accounts"],
  ["executionsAdded", "fills"],
  ["tradesAnnotated", "trades with notes, tags, mistakes or ratings"],
  ["journalDays", "daily journal notes"],
  ["notes", "notebook notes"],
  ["folders", "notebook folders"],
  ["playbooks", "playbooks"],
  ["noteTemplates", "note templates"],
  ["ruleChecks", "playbook rule checks"],
  ["progress", "progress rules and checks"],
  ["missedTrades", "missed trades"],
  ["propAccounts", "prop accounts"],
  ["propEntries", "prop expenses and payouts"],
  ["propReceipts", "prop receipts"],
  ["propAudit", "prop history entries"],
  ["importRecords", "import records"],
  ["libraryValues", "saved tags and mistakes"],
  ["aiChats", "AI chats"],
  ["settings", "settings, saved AI prompts and prop firm templates"],
];

/** Settings → Restore from a Full backup (JSON): preview first, then merge. */
export function RestoreBackup() {
  const input = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<RestoreSummary | null>(null);
  const [done, setDone] = useState<RestoreSummary | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (data: unknown, mode: "preview" | "commit", replace: boolean) => {
    setBusy(true);
    setError("");
    try {
      const result = await postJson<{ summary: RestoreSummary }>("/api/restore", {
        backup: data,
        mode,
        overwrite: replace,
      });
      if (mode === "preview") setPreview(result.summary);
      else {
        setDone(result.summary);
        setPreview(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the backup.");
    } finally {
      setBusy(false);
    }
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setDone(null);
    setPreview(null);
    setError("");
    setFileName(file.name);
    try {
      const data: unknown = JSON.parse(await file.text());
      setBackup(data);
      await run(data, "preview", overwrite);
    } catch {
      setBackup(null);
      setError("That file is not valid JSON. Pick the file saved by Full backup (JSON).");
    }
  };

  const lines = (summary: RestoreSummary) =>
    LABELS.filter(([key]) => summary[key] > 0).map(([key, label]) => `${summary[key]} ${label}`);
  const found = preview ? lines(preview) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Restore from a backup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Load a file saved with Full backup (JSON). It only adds what is missing: your fills,
          notes, tags, mistakes, confidence, emotions, quality ratings, playbooks, journal and prop
          firm records, AI chats and your saved settings. Nothing is deleted, and broker logins are never part of a backup, so
          reconnect broker accounts afterwards. Attachment files are not in the backup.
        </p>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Choose a backup file"
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          <Upload aria-hidden="true" />
          Choose backup file
        </Button>
        {fileName && <span className="ml-3 text-sm text-muted-foreground">{fileName}</span>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {preview && (
          <div className="space-y-3 rounded-lg border p-4 text-sm">
            {found.length ? (
              <>
                <p className="font-medium">This backup would add:</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {found.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                Nothing new. Everything in this backup is already here
                {overwrite ? "" : ", and existing notes and ratings would be kept"}.
              </p>
            )}
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={overwrite}
                onChange={(event) => {
                  setOverwrite(event.target.checked);
                  void run(backup, "preview", event.target.checked);
                }}
              />
              <span>
                Replace notes, tags, mistakes and ratings on trades that already have them with the
                backup’s version. Off by default, so only blanks are filled.
              </span>
            </label>
            <Button disabled={busy || !found.length} onClick={() => void run(backup, "commit", overwrite)}>
              {busy ? "Restoring…" : "Restore"}
            </Button>
          </div>
        )}
        {done && (
          <div role="status" className="space-y-2 rounded-lg border border-profit/40 p-4 text-sm">
            <p className="font-medium">Restore finished.</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {lines(done).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              Reload the app
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
