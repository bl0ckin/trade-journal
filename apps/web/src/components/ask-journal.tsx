"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/use-api";
import { AiNotice } from "./ai-notice";
import { AssistantMessage, ThinkingMessage, UserMessage } from "./ai-message";
import { useFilters } from "./filter-bar";
import { useAiRequest, type AiScope } from "@/lib/use-ai-request";
import type { AnalysisFilters } from "@luxalgo/journal-core";

const SUGGESTIONS = [
  "What's my most expensive mistake?",
  "Which weekday should I stop trading?",
  "Am I better at longs or shorts?",
];

/**
 * Quick one-off questions against your own aggregates, using your own AI provider key.
 * Longer conversations with saved history live on the AI page.
 */
export function AskJournal() {
  const { values, query, timeZone } = useFilters();
  return <ScopedAskJournal key={`${timeZone}:${query}`} filters={values} timeZone={timeZone} />;
}

function ScopedAskJournal({ filters, timeZone }: { filters: AnalysisFilters; timeZone: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; scope: AiScope } | null>(null);
  const { run, busy, error, dismiss } = useAiRequest();
  const [lastQuestion, setLastQuestion] = useState("");

  const ask = async (q: string) => {
    if (busy || !q.trim()) return;
    q = q.trim();
    setLastQuestion(q);
    setAnswer(null);
    await run(
      () =>
        postJson<{ answer: string; scope: AiScope }>("/api/ai/ask", {
          question: q,
          filters,
          timeZone,
        }),
      setAnswer,
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <CardTitle>Ask your journal</CardTitle>
        <Link
          href={`/ai?${new URLSearchParams(filters).toString()}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Open full chat
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Uses the selected accounts and journal filters. Changing filters clears the answer.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (question.trim()) void ask(question);
          }}
        >
          <Input
            aria-label="Ask your journal a question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Why do my Monday shorts keep failing?"
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            <Sparkles />
            {busy ? "Thinking…" : "Ask"}
          </Button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              disabled={busy}
              className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-50"
              onClick={() => {
                setQuestion(suggestion);
                void ask(suggestion);
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
        {error && (
          <AiNotice error={error} onRetry={() => void ask(lastQuestion)} onDismiss={dismiss} />
        )}
        {(busy || answer) && (
          <div className="space-y-3 pt-1" aria-live="polite">
            <UserMessage>{lastQuestion}</UserMessage>
            {busy ? (
              <ThinkingMessage />
            ) : (
              answer && <AssistantMessage content={answer.answer} scopeLabel={answer.scope.label} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
