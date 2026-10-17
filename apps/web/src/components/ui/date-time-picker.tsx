"use client";

import { useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as Popover from "@radix-ui/react-popover";
import { CalendarClock } from "lucide-react";
import { Input } from "./input";
import { Button } from "./button";
import { formatDateInput, parseDateInput } from "@/lib/date-input";
import { useDialogModal } from "@/lib/use-dialog-modal";
import { nowDeviceInput } from "@/lib/datetime-input";

const Calendar = dynamic(() => import("./calendar").then((module) => module.Calendar), {
  loading: () => <div role="status" aria-label="Loading calendar" className="h-[300px]" />,
});

const pad = (value: number) => String(value).padStart(2, "0");

interface Parts {
  date: string;
  hour: number;
  minute: number;
  second: number;
}

/** Reads "YYYY-MM-DDTHH:mm[:ss]" (or with a space). Null when it isn't a real date and time. */
function parse(value: string): Parts | null {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match || !parseDateInput(match[1]!)) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { date: match[1]!, hour, minute, second };
}

function compose(parts: Parts, seconds: boolean): string {
  const base = `${parts.date}T${pad(parts.hour)}:${pad(parts.minute)}`;
  return seconds ? `${base}:${pad(parts.second)}` : base;
}

const display = (parts: Parts, seconds: boolean) => compose(parts, seconds).replace("T", " ");

/**
 * A scrollable list of every value (1-12, or 00-59) so any time is one click. It starts at the
 * selected value and never wraps. Up/Down arrows move the selection when a value is focused.
 */
function TimeColumn({
  label,
  heading,
  values,
  selected,
  onSelect,
}: {
  label: string;
  heading: string;
  values: number[];
  selected: number | null;
  onSelect: (value: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const items = useRef(new Map<number, HTMLButtonElement>());

  // Keep the selected value in view (centred the first time the picker opens).
  useEffect(() => {
    const el = selected === null ? null : items.current.get(selected);
    const container = box.current;
    if (!el || !container) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = top - (container.clientHeight - el.offsetHeight) / 2;
    }
  }, [selected]);

  const move = (from: number, delta: number) => {
    const next = values[Math.min(values.length - 1, Math.max(0, values.indexOf(from) + delta))]!;
    onSelect(next);
    items.current.get(next)?.focus();
  };

  return (
    <div className="flex w-[52px] shrink-0 flex-col items-center gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {heading}
      </span>
      <div
        ref={box}
        role="listbox"
        aria-label={label}
        className="time-column relative h-[288px] w-full snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl bg-muted/40 px-1 py-3.5"
      >
        <div className="flex flex-col gap-0.5">
          {values.map((value, index) => {
            const active = value === selected;
            return (
              <button
                key={value}
                ref={(node) => {
                  if (node) items.current.set(value, node);
                  else items.current.delete(value);
                }}
                type="button"
                role="option"
                aria-selected={active}
                tabIndex={active || (selected === null && index === 0) ? 0 : -1}
                onClick={() => onSelect(value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    move(value, 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    move(value, -1);
                  }
                }}
                className={`h-9 w-full shrink-0 snap-center rounded-lg text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? "bg-primary font-semibold text-primary-foreground shadow-sm"
                    : "text-foreground/80 hover:bg-accent"
                }`}
              >
                {pad(value)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const SIXTY = Array.from({ length: 60 }, (_, i) => i);

/**
 * Date and time in one control. Same value format as `<input type="datetime-local">`
 * ("YYYY-MM-DDTHH:mm" or "...:ss"), so it drops in where that input was used.
 * Pick the day on a calendar, type or step the time, or type the whole thing.
 */
export function DateTimePicker({
  value,
  onValueChange,
  label,
  seconds = false,
  disabled,
  className,
  getNow = nowDeviceInput,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  /** Include a seconds field and output ":ss". */
  seconds?: boolean;
  disabled?: boolean;
  className?: string;
  /** "Now" in the zone this value is read in. Defaults to the device's clock. */
  getNow?: () => string;
}) {
  const [open, setOpen] = useState(false);
  const { anchor, modal, sync } = useDialogModal<HTMLSpanElement>();
  const changeOpen = (next: boolean) => {
    if (next) sync();
    setOpen(next);
  };
  const [draft, setDraft] = useState(() => {
    const parts = parse(value);
    return parts ? display(parts, seconds) : value;
  });
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const typing = useRef(false);
  const parts = parse(value);

  useEffect(() => {
    if (typing.current) return;
    const next = parse(value);
    setDraft(next ? display(next, seconds) : value);
    setInvalid(false);
  }, [value, seconds]);

  const base = (): Parts => parts ?? parse(getNow()) ?? { date: formatDateInput(new Date()), hour: 0, minute: 0, second: 0 };
  const emit = (next: Parts) => {
    typing.current = false;
    onValueChange(compose(next, seconds));
  };
  const hour12 = (parts?.hour ?? 0) % 12 || 12;
  const pm = (parts?.hour ?? 0) >= 12;
  const summary = (() => {
    if (!parts) return "Select a date and time";
    const day = parseDateInput(parts.date);
    const dayText = day
      ? day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
      : parts.date;
    const clock = `${hour12}:${pad(parts.minute)}${seconds ? `:${pad(parts.second)}` : ""} ${pm ? "PM" : "AM"}`;
    return `${dayText} · ${clock}`;
  })();

  return (
    <Popover.Root open={open} onOpenChange={changeOpen} modal={modal}>
      <Popover.Anchor asChild>
        <span ref={anchor} className={`relative block min-w-0 ${className ?? ""}`}>
          <Input
            value={draft}
            aria-label={label}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? errorId : undefined}
            placeholder={seconds ? "YYYY-MM-DD HH:MM:SS" : "YYYY-MM-DD HH:MM"}
            disabled={disabled}
            className="pr-10 tabular-nums"
            onFocus={() => {
              typing.current = true;
            }}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              setInvalid(false);
              const typed = parse(next);
              if (typed) onValueChange(compose(typed, seconds));
            }}
            onBlur={() => {
              typing.current = false;
              const typed = parse(draft);
              if (typed) setDraft(display(typed, seconds));
              setInvalid(Boolean(draft && !typed));
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && event.altKey) {
                event.preventDefault();
                changeOpen(true);
              }
              if (event.key === "Escape" && !open) {
                typing.current = false;
                setDraft(parts ? display(parts, seconds) : value);
                setInvalid(false);
              }
            }}
          />
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Choose ${label.toLowerCase()}`}
              className="absolute top-0 right-0 flex size-9 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <CalendarClock aria-hidden="true" className="size-4" />
            </button>
          </Popover.Trigger>
          {invalid && (
            <span id={errorId} role="alert" className="mt-1 block text-xs text-destructive">
              Enter a valid date and time ({seconds ? "YYYY-MM-DD HH:MM:SS" : "YYYY-MM-DD HH:MM"}).
            </span>
          )}
        </span>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          aria-label={`${label} picker`}
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="journal-popup journal-menu-surface z-[70] w-fit max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-2xl border bg-popover p-4 text-popover-foreground outline-none"
        >
          <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
            <p className="text-sm font-semibold tracking-tight">{summary}</p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="mx-auto w-[272px] shrink-0 sm:mx-0">
              <Calendar
                mode="single"
                autoFocus
                selected={parts ? parseDateInput(parts.date) : undefined}
                defaultMonth={parts ? parseDateInput(parts.date) : new Date()}
                onSelect={(date) => date && emit({ ...base(), date: formatDateInput(date) })}
              />
            </div>
            <div className="flex justify-center gap-1.5 border-t pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
              <TimeColumn
                label="Hour"
                heading="Hour"
                values={HOURS}
                selected={parts ? hour12 : null}
                onSelect={(next) => emit({ ...base(), hour: (next % 12) + (pm ? 12 : 0) })}
              />
              <TimeColumn
                label="Minute"
                heading="Min"
                values={SIXTY}
                selected={parts ? parts.minute : null}
                onSelect={(next) => emit({ ...base(), minute: next })}
              />
              {seconds && (
                <TimeColumn
                  label="Second"
                  heading="Sec"
                  values={SIXTY}
                  selected={parts ? parts.second : null}
                  onSelect={(next) => emit({ ...base(), second: next })}
                />
              )}
              <div className="flex w-[52px] shrink-0 flex-col items-center gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  &nbsp;
                </span>
                <div role="group" aria-label="AM or PM" className="flex w-full flex-col gap-1">
                  {(["AM", "PM"] as const).map((half) => {
                    const active = parts !== null && (half === "PM") === pm;
                    return (
                      <button
                        key={half}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          const current = base();
                          emit({ ...current, hour: (current.hour % 12) + (half === "PM" ? 12 : 0) });
                        }}
                        className={`h-9 w-full rounded-lg text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                          active
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-muted/40 text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        {half}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const now = parse(getNow());
                if (now) emit(now);
              }}
            >
              Now
            </Button>
            <Button size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
