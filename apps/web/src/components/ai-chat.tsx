"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Bookmark,
  Check,
  History,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PROMPT_GROUPS, STARTER_PROMPTS } from "@/lib/ai-prompts";
import { timeAgo } from "@/lib/time-ago";
import { postJson, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { AiAvatar, AssistantMessage, ThinkingMessage, UserMessage } from "./ai-message";
import { AiNotice } from "./ai-notice";
import { useFilters } from "./filter-bar";

interface ChatSummary {
  id: string;
  title: string;
  updatedAt: string;
}
interface SavedPrompt {
  id: string;
  title: string;
  text: string;
}
interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  scopeLabel: string | null;
}
interface ChatReply {
  chatId: string;
  title: string;
  user: UiMessage;
  assistant: UiMessage;
}

const errorText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

/** Chat, saved history and prompts for asking questions about your own journal. */
export function AiWorkspace() {
  const { values: filters, timeZone } = useFilters();
  const history = useApi<{ chats: ChatSummary[] }>("/api/ai/chats");
  const saved = useApi<{ prompts: SavedPrompt[] }>("/api/ai/prompts");

  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [sideError, setSideError] = useState("");

  // Bumped whenever the person opens another chat, so a late answer never lands in the wrong one.
  const epoch = useRef(0);
  const sending = useRef(false);
  const failedQuestion = useRef<{ id: string; text: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const chats = history.data?.chats ?? [];
  const title = chats.find((chat) => chat.id === chatId)?.title ?? "New chat";

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, error]);

  useEffect(() => {
    const el = composer.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const reset = () => {
    epoch.current += 1;
    sending.current = false;
    failedQuestion.current = null;
    setBusy(false);
    setError(null);
    setLoadError("");
    setLoadingChat(false);
  };

  const newChat = () => {
    reset();
    setChatId(null);
    setMessages([]);
    setInput("");
    setPanelOpen(false);
    composer.current?.focus();
  };

  const openChat = async (id: string) => {
    if (id === chatId) {
      setPanelOpen(false);
      return;
    }
    reset();
    setChatId(id);
    setMessages([]);
    setLoadingChat(true);
    setPanelOpen(false);
    const mine = epoch.current;
    try {
      const response = await fetch(`/api/ai/chats/${encodeURIComponent(id)}`);
      const body = (await response.json()) as { messages?: UiMessage[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Couldn’t open this chat.");
      if (epoch.current === mine) setMessages(body.messages ?? []);
    } catch (cause) {
      if (epoch.current === mine) setLoadError(errorText(cause, "Couldn’t open this chat."));
    } finally {
      if (epoch.current === mine) setLoadingChat(false);
    }
  };

  const send = async (raw: string, retry = false) => {
    const question = raw.trim();
    if (!question || sending.current) return;
    sending.current = true;
    const mine = epoch.current;
    setBusy(true);
    setError(null);
    // A retry reuses the question already on screen from the failed attempt.
    let pendingId = failedQuestion.current?.id ?? "";
    if (!(retry && pendingId)) {
      pendingId = `pending-${Date.now()}`;
      setMessages((current) => [
        ...current,
        { id: pendingId, role: "user", content: question, scopeLabel: null },
      ]);
      setInput("");
    }
    failedQuestion.current = null;
    try {
      const reply = await postJson<ChatReply>("/api/ai/chat", {
        chatId,
        question,
        filters,
        timeZone,
      });
      history.refresh();
      if (epoch.current !== mine) return;
      setChatId(reply.chatId);
      setMessages((current) => [
        ...current.filter((message) => message.id !== pendingId),
        reply.user,
        reply.assistant,
      ]);
    } catch (cause) {
      if (epoch.current === mine) {
        failedQuestion.current = { id: pendingId, text: question };
        setError(errorText(cause, "AI request failed"));
      }
    } finally {
      if (epoch.current === mine) {
        sending.current = false;
        setBusy(false);
      }
    }
  };

  const fillPrompt = (text: string) => {
    setInput(text);
    setPanelOpen(false);
    composer.current?.focus();
  };

  const sideAction = async (action: () => Promise<unknown>, failure: string) => {
    setSideError("");
    try {
      await action();
    } catch (cause) {
      setSideError(errorText(cause, failure));
    }
  };

  const removeChat = (chat: ChatSummary) => {
    if (!confirm(`Delete “${chat.title}”? This cannot be undone.`)) return;
    void sideAction(async () => {
      await postJson(`/api/ai/chats/${encodeURIComponent(chat.id)}`, undefined, "DELETE");
      if (chat.id === chatId) newChat();
      history.refresh();
    }, "Couldn’t delete the chat.");
  };

  const clearHistory = () => {
    if (!confirm("Delete every saved chat? This cannot be undone.")) return;
    void sideAction(async () => {
      await postJson("/api/ai/chats", undefined, "DELETE");
      newChat();
      history.refresh();
    }, "Couldn’t clear the history.");
  };

  const renameChat = (chat: ChatSummary, next: string) =>
    sideAction(async () => {
      if (next.trim() && next.trim() !== chat.title)
        await postJson(`/api/ai/chats/${encodeURIComponent(chat.id)}`, { title: next }, "PATCH");
      history.refresh();
    }, "Couldn’t rename the chat.");

  const savePrompt = (text: string, promptTitle?: string) =>
    sideAction(async () => {
      await postJson("/api/ai/prompts", { text, title: promptTitle });
      saved.refresh();
    }, "Couldn’t save the prompt.");

  const removePrompt = (id: string) =>
    sideAction(async () => {
      await postJson("/api/ai/prompts", { id }, "DELETE");
      saved.refresh();
    }, "Couldn’t delete the prompt.");

  const empty = messages.length === 0 && !loadingChat && !loadError;

  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className={cn("min-w-0", panelOpen ? "block" : "hidden lg:block")}>
        <Card className="flex max-h-[28rem] flex-col overflow-hidden lg:h-[calc(100dvh-11rem)] lg:max-h-none lg:min-h-[30rem]">
          <Tabs defaultValue="history" className="flex min-h-0 flex-1 flex-col">
            <div className="p-3 pb-0">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="history">History</TabsTrigger>
                <TabsTrigger value="prompts">Prompts</TabsTrigger>
              </TabsList>
            </div>
            {sideError && (
              <p role="alert" className="px-3 pt-2 text-xs text-destructive">
                {sideError}
              </p>
            )}
            <TabsContent value="history" className="mt-0 flex min-h-0 flex-1 flex-col">
              <HistoryList
                chats={chats}
                activeId={chatId}
                loading={history.loading && !history.data}
                error={history.error}
                onNew={newChat}
                onOpen={(id) => void openChat(id)}
                onDelete={removeChat}
                onRename={(chat, next) => void renameChat(chat, next)}
                onClear={clearHistory}
              />
            </TabsContent>
            <TabsContent value="prompts" className="mt-0 min-h-0 flex-1 overflow-y-auto">
              <PromptLibrary
                saved={saved.data?.prompts ?? []}
                error={saved.error}
                onUse={fillPrompt}
                onSave={(text, promptTitle) => void savePrompt(text, promptTitle)}
                onDelete={(id) => void removePrompt(id)}
              />
            </TabsContent>
          </Tabs>
        </Card>
      </aside>

      <section className="min-w-0">
        <Card className="ai-stage flex h-[calc(100dvh-11rem)] min-h-[30rem] flex-col overflow-hidden">
          <header className="flex items-center gap-2.5 border-b px-4 py-2.5">
            <AiAvatar />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-medium">{title}</h2>
              <p className="truncate text-[11px] text-muted-foreground">
                Answers come from your own journal data
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="lg:hidden"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen(!panelOpen)}
            >
              <History />
              History
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={newChat}>
              <Plus />
              New chat
            </Button>
          </header>

          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 px-4 py-5">
              {loadingChat && (
                <p role="status" className="py-10 text-center text-sm text-muted-foreground">
                  Opening chat…
                </p>
              )}
              {loadError && (
                <p role="alert" className="py-10 text-center text-sm text-destructive">
                  {loadError}
                </p>
              )}
              {empty && <EmptyChat onPick={(text) => void send(text)} />}
              {messages.map((message) =>
                message.role === "user" ? (
                  <UserMessage key={message.id}>{message.content}</UserMessage>
                ) : (
                  <AssistantMessage
                    key={message.id}
                    content={message.content}
                    scopeLabel={message.scopeLabel}
                  />
                ),
              )}
              {busy && <ThinkingMessage />}
              {error && (
                <AiNotice
                  error={error}
                  onRetry={() => void send(failedQuestion.current?.text ?? "", true)}
                  onDismiss={() => setError(null)}
                />
              )}
            </div>
          </div>

          <form
            className="border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <div className="mx-auto w-full max-w-3xl">
              <div className="flex items-end gap-1.5 rounded-2xl border bg-background/60 p-1.5 transition-colors focus-within:border-ring">
                <textarea
                  ref={composer}
                  rows={1}
                  value={input}
                  maxLength={10000}
                  aria-label="Ask your journal a question"
                  placeholder="Ask about your trades, mistakes or habits…"
                  className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground"
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void send(input);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 text-muted-foreground"
                  aria-label="Save as prompt"
                  title="Save as prompt"
                  disabled={!input.trim()}
                  onClick={() => void savePrompt(input)}
                >
                  <Bookmark />
                </Button>
                <Button
                  type="submit"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full"
                  aria-label="Send"
                  disabled={busy || !input.trim()}
                >
                  <ArrowUp />
                </Button>
              </div>
              <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
                Uses the accounts and filters selected above. Enter to send, Shift+Enter for a new
                line.
              </p>
            </div>
          </form>
        </Card>
      </section>
    </div>
  );
}

function EmptyChat({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="ai-rise m-auto flex w-full flex-col items-center py-6 text-center">
      <AiAvatar className="h-11 w-11 rounded-2xl [&_svg]:h-5 [&_svg]:w-5" />
      <h3 className="mt-4 text-lg font-semibold tracking-tight">Ask your journal anything</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Get answers grounded in your own numbers: results by symbol, weekday, hour, tag, mistake
        and playbook.
      </p>
      <div className="mt-5 grid w-full max-w-xl gap-2 sm:grid-cols-2">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="rounded-xl border bg-card/60 px-3.5 py-3 text-left text-sm transition-colors hover:border-ring/50 hover:bg-accent"
            onClick={() => onPick(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryList({
  chats,
  activeId,
  loading,
  error,
  onNew,
  onOpen,
  onDelete,
  onRename,
  onClear,
}: {
  chats: ChatSummary[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (chat: ChatSummary) => void;
  onRename: (chat: ChatSummary, title: string) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const finish = (chat: ChatSummary) => {
    setEditing(null);
    onRename(chat, draft);
  };
  return (
    <>
      <div className="p-3">
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onNew}>
          <Plus />
          New chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {loading && <p className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>}
        {error && (
          <p role="alert" className="px-2 py-3 text-xs text-destructive">
            Couldn’t load your chats: {error}
          </p>
        )}
        {!loading && !error && chats.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Your conversations are saved here.
          </p>
        )}
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={cn(
              "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
              chat.id === activeId ? "bg-accent" : "hover:bg-accent/60",
            )}
          >
            {editing === chat.id ? (
              <>
                <Input
                  autoFocus
                  className="m-1 h-8"
                  aria-label="Chat title"
                  value={draft}
                  maxLength={120}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") finish(chat);
                    if (event.key === "Escape") setEditing(null);
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  aria-label="Save title"
                  onClick={() => finish(chat)}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  aria-label="Cancel rename"
                  onClick={() => setEditing(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left"
                  aria-current={chat.id === activeId ? "true" : undefined}
                  onClick={() => onOpen(chat.id)}
                >
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{chat.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {timeAgo(chat.updatedAt)}
                    </span>
                  </span>
                </button>
                <div className="flex shrink-0 opacity-100 transition-opacity lg:opacity-0 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground"
                    aria-label={`Rename ${chat.title}`}
                    onClick={() => {
                      setEditing(chat.id);
                      setDraft(chat.title);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${chat.title}`}
                    onClick={() => onDelete(chat)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      {chats.length > 0 && (
        <div className="border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground hover:text-destructive"
            onClick={onClear}
          >
            <Trash2 />
            Clear history
          </Button>
        </div>
      )}
    </>
  );
}

function PromptLibrary({
  saved,
  error,
  onUse,
  onSave,
  onDelete,
}: {
  saved: SavedPrompt[];
  error: string | null;
  onUse: (text: string) => void;
  onSave: (text: string, title?: string) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-4 p-3">
      <p className="text-xs text-muted-foreground">
        Pick a prompt to put it in the message box, then edit it or send it as is.
      </p>
      <section className="space-y-1.5">
        <h3 className="px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Your prompts
        </h3>
        {error && (
          <p role="alert" className="px-1 text-xs text-destructive">
            Couldn’t load your prompts: {error}
          </p>
        )}
        {saved.length === 0 && !error && (
          <p className="px-1 text-xs text-muted-foreground">
            Nothing saved yet. Write one below, or press the bookmark in the message box.
          </p>
        )}
        {saved.map((prompt) => (
          <div key={prompt.id} className="group flex items-start gap-1 rounded-lg hover:bg-accent/60">
            <button
              type="button"
              className="min-w-0 flex-1 px-2 py-1.5 text-left"
              onClick={() => onUse(prompt.text)}
            >
              <span className="block truncate text-[13px] font-medium">{prompt.title}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{prompt.text}</span>
            </button>
            <Button
              size="icon"
              variant="ghost"
              className="mt-0.5 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`Delete prompt ${prompt.title}`}
              onClick={() => onDelete(prompt.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <form
          className="space-y-1.5 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            onSave(draft);
            setDraft("");
          }}
        >
          <textarea
            value={draft}
            rows={2}
            maxLength={2000}
            aria-label="New prompt"
            placeholder="Write a prompt to keep…"
            className="w-full resize-none rounded-lg border bg-transparent px-2.5 py-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" disabled={!draft.trim()}>
            <Bookmark />
            Save prompt
          </Button>
        </form>
      </section>
      {PROMPT_GROUPS.map((group) => (
        <section key={group.title} className="space-y-1">
          <h3 className="px-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {group.title}
          </h3>
          {group.prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] leading-snug transition-colors hover:bg-accent/60"
              onClick={() => onUse(prompt)}
            >
              {prompt}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
