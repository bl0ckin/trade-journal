"use client";

import { useId } from "react";
import { usePrivacy } from "../privacy";

/**
 * A tiny trend line for summary cards. It carries no numbers, only shape, and is hidden in
 * privacy mode. Colour follows the last value against the first (green up, red down).
 */
export function Sparkline({
  values,
  className = "",
  background = false,
}: {
  values: number[];
  className?: string;
  /** Draws the line as a faded purple layer behind the card content, taking no layout space. */
  background?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const privacy = usePrivacy();
  if (privacy || values.length < 2) return null;
  const width = 120;
  const height = 32;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const range = high - low || 1;
  const points = values.map((value, index) => [
    (index / (values.length - 1)) * width,
    height - 3 - ((value - low) / range) * (height - 6),
  ]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x!.toFixed(1)} ${y!.toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const up = values.at(-1)! >= values[0]!;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={
        background
          ? {
              WebkitMaskImage: "linear-gradient(to right, rgba(0,0,0,0.3) 0%, #000 65%)",
              maskImage: "linear-gradient(to right, rgba(0,0,0,0.3) 0%, #000 65%)",
            }
          : undefined
      }
      className={
        background
          ? `pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-20 w-full text-chart-accent opacity-65 dark:opacity-45 ${className}`
          : `h-8 w-full ${up ? "text-profit" : "text-loss"} ${className}`
      }
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id}-fill)`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
