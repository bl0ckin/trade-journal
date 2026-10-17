"use client";

/** A 1 to 10 slider that can also be left unset. */
export function ScoreSlider({
  label,
  value,
  onChange,
  lowLabel,
  highLabel,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  lowLabel: string;
  highLabel: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs text-muted-foreground">{label}</label>
        <span className="flex items-center gap-2 text-xs">
          <span className="tnum font-semibold">{value === null ? "Not set" : `${value} / 10`}</span>
          {value !== null && (
            <button
              type="button"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => onChange(null)}
            >
              Clear
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={1}
        max={10}
        step={1}
        aria-label={label}
        value={value ?? 5}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`h-2 w-full cursor-pointer accent-[var(--brand)] ${value === null ? "opacity-50" : ""}`}
      />
      <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
        <span>1 · {lowLabel}</span>
        <span>
          {highLabel} · 10
        </span>
      </div>
    </div>
  );
}
