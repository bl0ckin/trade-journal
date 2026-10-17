"use client";
import "./notebook.css";
import { OptionSelect } from "@/components/ui/option-select";

import { Suspense, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  FileText,
  Folder,
  FolderPlus,
  ChevronDown,
  Copy,
  Download,
  Library,
  LineChart,
  ListChecks,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { VoiceNote } from "@/components/voice-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Attachments } from "@/components/attachments";
import { ReviewExport } from "@/components/review-export";
import { useAutosave } from "@/lib/use-autosave";
import { postJson, useApi } from "@/lib/use-api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NOTE_TEMPLATES, stripMarkdown, taskProgress, type NoteTemplate } from "@/lib/note-tools";
import { cn } from "@/lib/utils";

interface NoteRow {
  id: string;
  folderId: string;
  title: string;
  content: string;
  tagsJson?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Set for notes that live on a trade or a journal day. */
  source?: "trade" | "day";
  refId?: string;
  href?: string;
}

interface FolderRow {
  id: string;
  name: string;
  kind: string;
}

/** Folders that are filled from trades and journal days, so notes can't be dropped into them. */
const VIRTUAL_FOLDERS = ["all", "trade-notes", "daily-journal"];

const folderIcon = (id: string) => {
  const className = "h-4 w-4 shrink-0";
  if (id === "all") return <Library className={className} />;
  if (id === "trade-notes") return <LineChart className={className} />;
  if (id === "daily-journal") return <CalendarDays className={className} />;
  if (id === "session-recaps") return <Sparkles className={className} />;
  if (id === "my-notes") return <StickyNote className={className} />;
  return <Folder className={className} />;
};

const DEFAULT_LIST_WIDTH = 240;
const MIN_LIST_WIDTH = 180;
const MAX_LIST_WIDTH = 520;

const snippet = (content: string) => stripMarkdown(content).slice(0, 140);

/** Group label for a timestamp, relative to today in the viewer's timezone. */
const ageLabel = (iso: string) => {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Earlier";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(then)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Earlier";
};

export default function NotebookPage() {
  return (
    <Suspense>
      <Notebook />
    </Suspense>
  );
}

function Notebook() {
  const [folder, setFolder] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [sort, setSort] = useState("updated");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const { data, refresh } = useApi<{
    notes: NoteRow[];
    folders: FolderRow[];
    counts: Record<string, number>;
  }>(`/api/notes?folder=${folder}&q=${encodeURIComponent(search)}&sort=${sort}`);
  const selected = data?.notes.find((note) => note.id === selectedId) ?? null;
  const folders = data?.folders.filter((item) => item.id !== "all") ?? [];
  const folderNameOf = (id: string) => data?.folders.find((item) => item.id === id)?.name ?? "Notes";

  // Remember the folder rail and list width between visits.
  useEffect(() => {
    try {
      setRailCollapsed(localStorage.getItem("notebook:railCollapsed") === "1");
      const stored = Number(localStorage.getItem("notebook:listWidth"));
      if (stored >= MIN_LIST_WIDTH && stored <= MAX_LIST_WIDTH) setListWidth(stored);
      const savedPins: unknown = JSON.parse(localStorage.getItem("notebook:pinned") ?? "[]");
      if (Array.isArray(savedPins)) setPinned(savedPins.filter((id): id is string => typeof id === "string"));
    } catch {
      /* Storage can be unavailable; the defaults still work. */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("notebook:railCollapsed", railCollapsed ? "1" : "0");
      localStorage.setItem("notebook:listWidth", String(listWidth));
      localStorage.setItem("notebook:pinned", JSON.stringify(pinned));
    } catch {
      /* ignore */
    }
  }, [railCollapsed, listWidth, pinned]);

  // "/" jumps to search, like most note apps.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']"))
        return;
      if (document.querySelector("[role='dialog']")) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const togglePin = (id: string) =>
    setPinned((current) => (current.includes(id) ? current.filter((item) => item !== id) : [id, ...current]));

  const startResize = (event: React.PointerEvent) => {
    event.preventDefault();
    const left = listRef.current?.getBoundingClientRect().left ?? 0;
    const move = (e: PointerEvent) =>
      setListWidth(Math.min(MAX_LIST_WIDTH, Math.max(MIN_LIST_WIDTH, Math.round(e.clientX - left))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Escape leaves the full-width editor.
  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  const createNote = async (template?: NoteTemplate) => {
    // Trade notes and the daily journal are written on their own pages; new notes go to My notes.
    const target = VIRTUAL_FOLDERS.includes(folder) ? "my-notes" : folder;
    const result = await postJson<{ id: string }>("/api/notes", {
      folderId: target,
      title: template ? template.title(new Date().toLocaleDateString("en-CA")) : "Untitled",
      content: template?.content,
    });
    if (target !== folder && folder !== "all") setFolder(target);
    refresh();
    setSelectedId(result.id);
  };

  const duplicateNote = async (note: NoteRow) => {
    setNotice("");
    try {
      const result = await postJson<{ id: string }>("/api/notes", {
        folderId: note.folderId,
        title: `${note.title || "Untitled"} copy`,
        content: note.content,
      });
      refresh();
      setSelectedId(result.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn’t duplicate the note.");
    }
  };

  const createFolder = async () => {
    if (creatingFolder || !folderName.trim()) return;
    setCreatingFolder(true);
    setFolderError("");
    try {
      const result = await postJson<{ id: string }>("/api/folders", { name: folderName });
      setFolder(result.id);
      setSelectedId(null);
      setSearch("");
      refresh();
      setFolderOpen(false);
      setFolderName("");
    } catch (error) {
      setFolderError(
        error instanceof Error ? error.message : "Could not create the folder. Try again.",
      );
    } finally {
      setCreatingFolder(false);
    }
  };

  const deleteFolder = async (item: FolderRow) => {
    const count = data?.counts[item.id] ?? 0;
    const message = count
      ? `Delete the folder “${item.name}”? Its ${count} note${count === 1 ? "" : "s"} will be moved to My notes.`
      : `Delete the empty folder “${item.name}”?`;
    if (!confirm(message)) return;
    setNotice("");
    try {
      await postJson(`/api/folders/${item.id}`, undefined, "DELETE");
      if (folder === item.id) setFolder("all");
      setSelectedId(null);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn’t delete the folder.");
    }
  };

  const moveNote = async (noteId: string, destination: string) => {
    setNotice("");
    try {
      await postJson(`/api/notes/${noteId}`, { folderId: destination }, "PATCH");
      // Follow the note to its new folder so it doesn't seem to vanish.
      if (noteId === selectedId && folder !== "all") setFolder(destination);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Couldn’t move the note.");
    }
  };

  const listTitle = folder === "all" ? "All notes" : folderNameOf(folder);

  // Pinned notes first, then (when sorted by date) grouped by how recent they are.
  const noteSections = (() => {
    const notes = data?.notes ?? [];
    const pins = notes.filter((note) => pinned.includes(note.id));
    const rest = notes.filter((note) => !pinned.includes(note.id));
    const sections: { label: string; notes: NoteRow[] }[] = [];
    if (pins.length) sections.push({ label: "Pinned", notes: pins });
    if (sort === "title") {
      if (rest.length) sections.push({ label: pins.length ? "Other notes" : "Notes", notes: rest });
      return sections;
    }
    for (const note of rest) {
      const label = ageLabel(sort === "created" ? note.createdAt : note.updatedAt);
      const last = sections[sections.length - 1];
      if (last && last.label === label) last.notes.push(note);
      else sections.push({ label, notes: [note] });
    }
    return sections;
  })();

  return (
    <div>
      <Dialog open={folderOpen} onOpenChange={(open) => !creatingFolder && setFolderOpen(open)}>
        <DialogContent>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>Organize your notes in a named folder.</DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createFolder();
            }}
          >
            <label className="block space-y-2 text-sm">
              <span>Folder name</span>
              <Input
                autoFocus
                value={folderName}
                maxLength={100}
                required
                disabled={creatingFolder}
                onChange={(event) => {
                  setFolderName(event.target.value);
                  setFolderError("");
                }}
              />
            </label>
            {folderError && (
              <p role="alert" className="text-sm text-destructive">
                {folderError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={creatingFolder}
                onClick={() => setFolderOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creatingFolder || !folderName.trim()}>
                {creatingFolder ? "Creating…" : "Create folder"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <FilterBar
        title="Notebook"
        actions={
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => void createNote()}>
              <Plus />
              New note
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label="New note from a template">
                  Templates
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {NOTE_TEMPLATES.map((template) => (
                  <DropdownMenuItem
                    key={template.id}
                    className="flex-col items-start gap-0"
                    onSelect={() => void createNote(template)}
                  >
                    <span className="font-medium">{template.name}</span>
                    <span className="text-xs text-muted-foreground">{template.description}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      <div
        className="notebook-workspace nb"
        data-note-open={Boolean(selected)}
        data-focus={focus}
        style={
          {
            "--nb-folders": railCollapsed ? "56px" : "210px",
            "--nb-list": `${listWidth}px`,
          } as CSSProperties
        }
      >
        {/* Folders */}
        <nav
          aria-label="Folders"
          className={cn(
            "notebook-folders min-w-0 space-y-0.5 overflow-y-auto overflow-x-hidden border-r bg-muted/20",
            railCollapsed ? "p-1.5" : "p-3",
          )}
        >
          <div className={cn("flex items-center pb-1", railCollapsed ? "justify-center" : "justify-between")}>
            {!railCollapsed && (
              <p className="px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Folders
              </p>
            )}
            <button
              type="button"
              aria-label={railCollapsed ? "Expand folders" : "Minimize folders"}
              title={railCollapsed ? "Expand folders" : "Minimize folders"}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => setRailCollapsed(!railCollapsed)}
            >
              {railCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
          {[{ id: "all", name: "All notes", kind: "system" }, ...folders].map((f) => {
            const canDrop = !VIRTUAL_FOLDERS.includes(f.id);
            return (
              <div
                key={f.id}
                onDragOver={(event) => {
                  if (!canDrop) return;
                  event.preventDefault();
                  setDropTarget(f.id);
                }}
                onDragLeave={() => setDropTarget((current) => (current === f.id ? null : current))}
                onDrop={(event) => {
                  setDropTarget(null);
                  const noteId = event.dataTransfer.getData("text/note-id");
                  if (canDrop && noteId) {
                    event.preventDefault();
                    void moveNote(noteId, f.id);
                  }
                }}
                className={cn(
                  "group flex items-center rounded-lg transition-colors",
                  folder === f.id ? "bg-accent" : "hover:bg-accent/60",
                  dropTarget === f.id && "ring-2 ring-foreground/40",
                )}
              >
                <button
                  title={railCollapsed ? f.name : undefined}
                  aria-label={f.name}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-left text-sm",
                    railCollapsed && "justify-center px-0",
                    folder === f.id ? "font-medium" : "text-muted-foreground",
                  )}
                  onClick={() => {
                    setFolder(f.id);
                    setSelectedId(null);
                  }}
                >
                  {folderIcon(f.id)}
                  {!railCollapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {data?.counts[f.id] ?? ""}
                      </span>
                    </>
                  )}
                </button>
                {f.kind === "user" && !railCollapsed && (
                  <button
                    type="button"
                    aria-label={`Delete folder ${f.name}`}
                    title="Delete folder"
                    className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:bg-background hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                    onClick={() => void deleteFolder(f)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "mt-1 w-full gap-2.5 text-muted-foreground",
              railCollapsed ? "justify-center px-0" : "justify-start px-2.5",
            )}
            aria-label="New folder"
            title="New folder"
            onClick={() => {
              setFolderError("");
              setFolderOpen(true);
            }}
          >
            <FolderPlus className="h-4 w-4" />
            {!railCollapsed && "New folder"}
          </Button>
          {!railCollapsed && (
            <p className="px-2 pt-3 text-[11px] leading-relaxed text-muted-foreground">
              Drag a note onto a folder to move it. Trade and daily notes are edited in place.
            </p>
          )}
        </nav>

        {/* Note list */}
        <div ref={listRef} className="notebook-list relative min-w-0 border-r">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize note list"
            title="Drag to resize. Double-click to reset."
            onPointerDown={startResize}
            onDoubleClick={() => setListWidth(DEFAULT_LIST_WIDTH)}
            className="absolute inset-y-0 right-0 z-[3] w-1.5 cursor-col-resize hover:bg-foreground/20 active:bg-foreground/30"
          />
          <div className="absolute inset-0 overflow-y-auto">
          <div className="sticky top-0 z-[1] space-y-2 border-b bg-background/95 p-3 backdrop-blur">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="truncate text-sm font-semibold">{listTitle}</h2>
              <span className="text-xs text-muted-foreground">
                {data?.notes.length ?? 0} {(data?.notes.length ?? 0) === 1 ? "note" : "notes"}
              </span>
            </div>
            <OptionSelect
              aria-label="Sort notes"
              value={sort}
              onValueChange={setSort}
              className="h-8 w-full rounded-lg border bg-card px-2 text-xs"
            >
              <option value="updated">Recently updated</option>
              <option value="created">Newest first</option>
              <option value="title">Title A to Z</option>
            </OptionSelect>
            <div className="flex min-w-0 items-center gap-2 lg:hidden">
              <OptionSelect
                aria-label="Note folder"
                value={folder}
                onValueChange={(next) => {
                  setFolder(next);
                  setSelectedId(null);
                }}
                className="h-9 min-w-0 flex-1 rounded-lg border bg-card px-2 text-sm"
              >
                <option value="all">All notes</option>
                {folders.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </OptionSelect>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label="New folder"
                onClick={() => {
                  setFolderError("");
                  setFolderOpen(true);
                }}
              >
                <FolderPlus />
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearch("");
                    event.currentTarget.blur();
                  }
                }}
                placeholder="Search notes  ( / )"
                aria-keyshortcuts="/"
                className="pl-8"
              />
            </div>
            {notice && (
              <p role="alert" className="text-xs text-destructive">
                {notice}
              </p>
            )}
          </div>
          {data?.notes.length === 0 && (
            <div className="px-6 py-16 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
              <p className="text-sm font-medium">Nothing here yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {search ? "No notes match your search." : "Create a note, or write one on a trade or a day."}
              </p>
            </div>
          )}
          {noteSections.map((section) => (
            <section key={section.label} aria-label={section.label}>
              <h3 className="bg-muted/30 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {section.label}
              </h3>
              <ul className="divide-y">
                {section.notes.map((note) => {
                  const isPinned = pinned.includes(note.id);
                  const progress = taskProgress(note.content);
                  return (
                    <li key={note.id} className="group relative">
                      <button
                        draggable={!note.source}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/note-id", note.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        className={cn(
                          "relative block w-full px-4 py-3 pr-9 text-left transition-colors hover:bg-accent/40",
                          selectedId === note.id && "bg-accent/60",
                        )}
                        onClick={() => setSelectedId(note.id)}
                      >
                        {selectedId === note.id && (
                          <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
                        )}
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "flex size-5 shrink-0 items-center justify-center rounded-md",
                              note.source === "trade"
                                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                                : note.source === "day"
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  : "bg-primary/10 text-primary",
                            )}
                          >
                            {note.source === "trade" ? (
                              <LineChart className="h-3 w-3" />
                            ) : note.source === "day" ? (
                              <CalendarDays className="h-3 w-3" />
                            ) : (
                              <FileText className="h-3 w-3" />
                            )}
                          </span>
                          <span className="truncate pb-px text-sm font-medium leading-snug">
                            {note.title || "Untitled"}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {snippet(note.content) || "Empty note"}
                        </p>
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground/80">
                          <span>
                            {note.updatedAt.slice(0, 10)}
                            {folder === "all" && ` · ${folderNameOf(note.folderId)}`}
                          </span>
                          {progress.total > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <ListChecks className="size-3" aria-hidden />
                              {progress.done}/{progress.total}
                            </span>
                          )}
                        </p>
                      </button>
                      <button
                        type="button"
                        aria-label={isPinned ? "Unpin note" : "Pin note"}
                        aria-pressed={isPinned}
                        title={isPinned ? "Unpin" : "Pin to top"}
                        onClick={() => togglePin(note.id)}
                        className={cn(
                          "absolute right-2 top-2.5 rounded p-1 text-muted-foreground transition-opacity hover:bg-background hover:text-foreground focus:opacity-100",
                          isPinned ? "opacity-100 text-primary" : "opacity-0 group-hover:opacity-100",
                        )}
                      >
                        {isPinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          </div>
        </div>

        {/* Editor */}
        <div className="notebook-editor min-w-0 overflow-y-auto">
          {selected ? (
            <NoteEditor
              key={selected.id}
              note={selected}
              folders={folders}
              folderName={folderNameOf(selected.folderId)}
              focus={focus}
              onToggleFocus={() => setFocus(!focus)}
              onBack={() => setSelectedId(null)}
              onMove={(destination) => void moveNote(selected.id, destination)}
              pinned={pinned.includes(selected.id)}
              onTogglePin={() => togglePin(selected.id)}
              onDuplicate={() => void duplicateNote(selected)}
              onChanged={refresh}
              onDeleted={() => {
                setSelectedId(null);
                refresh();
              }}
            />
          ) : (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
              <div className="rounded-2xl border bg-muted/40 p-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="text-base font-medium">Select a note to read or write</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Or start from a template. Your trade and daily journal notes live here too.
                </p>
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-2">
                {NOTE_TEMPLATES.slice(0, 4).map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => void createNote(template)}
                    className="rounded-xl border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/50"
                  >
                    <span className="block text-sm font-medium">{template.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{template.description}</span>
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => void createNote()}>
                <Plus />
                Blank note
              </Button>
              <p className="text-xs text-muted-foreground">
                Press <kbd className="rounded border bg-muted px-1">/</kbd> to search.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NoteEditor({
  note,
  folders,
  folderName,
  focus,
  onToggleFocus,
  onBack,
  onMove,
  pinned,
  onTogglePin,
  onDuplicate,
  onChanged,
  onDeleted,
}: {
  note: NoteRow;
  folders: FolderRow[];
  folderName: string;
  focus: boolean;
  onToggleFocus: () => void;
  onBack: () => void;
  onMove: (destination: string) => void;
  pinned: boolean;
  onTogglePin: () => void;
  onDuplicate: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [mode, setMode] = useState<"edit" | "preview">(note.content.trim() ? "preview" : "edit");
  const editor = useRef<RichEditorHandle>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);
  const linked = note.source !== undefined;
  const [copied, setCopied] = useState(false);
  const progress = taskProgress(content);
  const asMarkdown = () => `${title.trim() ? `# ${title.trim()}\n\n` : ""}${content}`;
  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(asMarkdown());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard access can be blocked on plain http. */
    }
  };
  const downloadMarkdown = () => {
    const slug =
      (title || "note")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "note";
    const url = URL.createObjectURL(new Blob([asMarkdown()], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${slug}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const {
    save: queueSave,
    status,
    flush,
  } = useAutosave(
    note.source === "trade"
      ? `/api/trades/${encodeURIComponent(note.refId ?? "")}`
      : note.source === "day"
        ? `/api/journal/${note.refId}`
        : `/api/notes/${note.id}`,
    note.source === "day" ? "PUT" : "PATCH",
    onChanged,
  );
  const save = (title: string, content: string) =>
    queueSave(
      note.source === "trade"
        ? { notes: content }
        : note.source === "day"
          ? { note: content }
          : { title, content },
    );

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const readMinutes = Math.max(1, Math.round(words / 200));
  const updated = new Date(note.updatedAt);
  const updatedLabel = Number.isNaN(updated.getTime())
    ? note.updatedAt.slice(0, 10)
    : updated.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const tags = (() => {
    try {
      return (JSON.parse(note.tagsJson ?? "[]") as string[]) ?? [];
    } catch {
      return [];
    }
  })();
  const moveTargets = folders.filter((item) => !VIRTUAL_FOLDERS.includes(item.id) && item.id !== note.folderId);

  return (
    <div className="flex min-h-full flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur sm:px-6">
        <Button type="button" variant="ghost" size="sm" className="md:hidden" onClick={onBack}>
          <ArrowLeft />
          Notes
        </Button>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{folderName}</span>
          <span aria-hidden>/</span>
          <span role="status" className="shrink-0">
            {status || "Saved"}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
            {(["preview", "edit"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  mode === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "preview" ? "Read" : "Write"}
              </button>
            ))}
          </div>
          <VoiceNote
            onPrepare={() => {
              setMode("edit");
              editor.current?.focus();
            }}
            onText={(text) => {
              const next = content ? `${content} ${text}` : text;
              setContent(next);
              save(title, next);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", pinned ? "text-primary" : "text-muted-foreground")}
            aria-label={pinned ? "Unpin note" : "Pin note"}
            aria-pressed={pinned}
            title={pinned ? "Unpin" : "Pin to top of the list"}
            onClick={onTogglePin}
          >
            {pinned ? <Pin /> : <PinOff />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                aria-label="More note actions"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void copyMarkdown()}>
                <Copy className="size-4" />
                {copied ? "Copied" : "Copy as Markdown"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={downloadMarkdown}>
                <Download className="size-4" />
                Download .md
              </DropdownMenuItem>
              {!linked && (
                <DropdownMenuItem onSelect={onDuplicate}>
                  <FileText className="size-4" />
                  Duplicate
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {!linked && moveTargets.length > 0 && (
            <OptionSelect
              aria-label="Move note to folder"
              value=""
              onValueChange={(destination) => destination && onMove(destination)}
              className="h-8 rounded-lg border bg-card px-2 text-xs"
            >
              <option value="">Move to…</option>
              {moveTargets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </OptionSelect>
          )}
          {note.href && (
            <Button asChild variant="outline" size="sm">
              <Link href={note.href}>
                <ExternalLink />
                Open {note.source === "trade" ? "trade" : "day"}
              </Link>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden h-8 w-8 md:inline-flex"
            aria-label={focus ? "Show folders and notes" : "Expand editor to full width"}
            title={focus ? "Show folders and notes (Esc)" : "Expand to full width"}
            onClick={onToggleFocus}
          >
            {focus ? <Minimize2 /> : <Maximize2 />}
          </Button>
          {!linked && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              aria-label="Delete note"
              title="Delete note"
              onClick={async () => {
                if (confirm("Delete this note?")) {
                  await postJson(`/api/notes/${note.id}`, undefined, "DELETE");
                  onDeleted();
                }
              }}
            >
              <Trash2 />
            </Button>
          )}
        </div>
      </header>

      {/* Page */}
      <div className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:px-10 sm:py-10">
        <textarea
          ref={titleRef}
          rows={1}
          value={title}
          readOnly={linked}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          onChange={(event) => {
            const next = event.target.value.replace(/\n/g, " ");
            setTitle(next);
            save(next, content);
          }}
          placeholder="Untitled"
          aria-label="Note title"
          className="block w-full resize-none overflow-hidden bg-transparent py-1 text-3xl font-semibold leading-[1.3] tracking-tight outline-none placeholder:text-muted-foreground/50 sm:text-4xl"
        />
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span>Updated {updatedLabel}</span>
          <span>
            {words} {words === 1 ? "word" : "words"} · {readMinutes} min read
          </span>
          {progress.total > 0 && (
            <span className="inline-flex items-center gap-2" aria-label={`${progress.done} of ${progress.total} tasks done`}>
              <ListChecks className="size-3.5" aria-hidden />
              {progress.done}/{progress.total} tasks
              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-full rounded-full bg-profit"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </span>
            </span>
          )}
          {linked && (
            <span className="rounded-full border px-2 py-0.5">
              {note.source === "trade" ? "From a trade" : "From the daily journal"}
            </span>
          )}
          {tags.map((tag) => (
            <span key={tag} className="rounded-full border bg-muted/50 px-2 py-0.5">
              {tag}
            </span>
          ))}
        </div>

        <div className="nb-prose mt-8 rounded-2xl border bg-card p-4 shadow-sm sm:p-8">
          <RichEditor
            editorRef={editor}
            mode={mode}
            onModeChange={setMode}
            showModeToggle={false}
            value={content}
            onChange={(value) => {
              setContent(value);
              save(title, value);
            }}
          />
        </div>

        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{mode === "edit" ? "Changes save automatically." : "Switch to Write to edit."}</span>
            <Button variant="ghost" size="sm" onClick={() => void flush()}>
              Save now
            </Button>
          </div>
          <Attachments
            type={note.source ?? "note"}
            id={note.refId ?? note.id}
            editable={mode === "edit"}
          />
          <ReviewExport document={{ title: title || "Journal note", lines: [content] }} />
        </div>
      </div>
    </div>
  );
}
