"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** The small gradient mark that stands for the AI in every message. */
export function AiAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ai-avatar flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
        className,
      )}
    >
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}

/** Markdown styled from the theme tokens. Raw HTML in a reply is never rendered. */
export function AiMarkdown({ children }: { children: string }) {
  return (
    <div className="ai-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children: rows }) => (
            <div className="my-2 max-w-full overflow-x-auto">
              <table>{rows}</table>
            </div>
          ),
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function UserMessage({ children }: { children: ReactNode }) {
  return (
    <div className="ai-rise flex justify-end">
      <div className="ai-user-bubble max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md px-3.5 py-2.5 text-sm leading-relaxed">
        {children}
      </div>
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy answer"}
      title={copied ? "Copied" : "Copy"}
      className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be blocked (for example on plain http); nothing to recover.
        }
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function AssistantMessage({
  content,
  scopeLabel,
}: {
  content: string;
  scopeLabel?: string | null;
}) {
  return (
    <div className="ai-rise flex items-start gap-2.5">
      <AiAvatar className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="ai-assistant rounded-2xl rounded-tl-md px-4 py-3">
          <AiMarkdown>{content}</AiMarkdown>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1">
          <CopyButton text={content} />
          {scopeLabel && (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {scopeLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ThinkingMessage() {
  return (
    <div role="status" className="ai-rise flex items-center gap-2.5">
      <AiAvatar />
      <div className="ai-assistant inline-flex items-center gap-1.5 rounded-2xl rounded-tl-md px-4 py-3">
        <span className="sr-only">Thinking…</span>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            aria-hidden="true"
            className="ai-dot h-1.5 w-1.5 rounded-full bg-muted-foreground"
            style={{ animationDelay: `${index * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}
