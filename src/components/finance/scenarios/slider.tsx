"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Hover } from "@/components/finance/scenarios/hover";

/** A lever: a slider with the exact figure beside it, typed or dragged. */
export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  hint,
  marks,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Shown after the figure: "%", "h", or a currency mark before it ("₪"). */
  unit?: "₪" | "%" | "h" | "/h" | "€" | "$";
  hint?: ReactNode;
  /** Reference marks under the track (the past, never an input). */
  marks?: { label: string; value: number }[];
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const lo = Math.min(min, value);
  const hi = Math.max(max, value);
  const commit = (s: string) => {
    const n = Number(s.replace(/[,₪%h\s]/g, ""));
    if (Number.isFinite(n)) onChange(n);
    else setText(String(value));
  };
  const before = unit === "₪" || unit === "€" || unit === "$";
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-sm leading-6 text-muted">
        <span className="flex items-center gap-1">
          {label}
          {hint && <Hover size={14}>{hint}</Hover>}
        </span>
        <span dir="ltr" className="flex items-center gap-0.5 rounded-md border border-transparent px-1 tabular-nums text-foreground focus-within:border-border-strong hover:border-border">
          {before && <span className="text-faint">{unit}</span>}
          <input
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
            className="w-24 bg-transparent text-right text-sm font-medium outline-none"
          />
          {!before && unit && <span className="text-faint">{unit}</span>}
        </span>
      </span>
      <input
        type="range"
        dir="ltr"
        min={lo}
        max={hi}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--brand)]"
      />
      {marks && marks.length > 0 && (
        <span className="relative mt-0.5 block h-4">
          {marks.map((m) => {
            const left = ((Math.min(hi, Math.max(lo, m.value)) - lo) / (hi - lo || 1)) * 100;
            return (
              <span
                key={m.label}
                title={`${m.label}: ${Math.round(m.value)}`}
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[9px] text-faint"
                style={{ left: `${left}%` }}
              >
                ▲
              </span>
            );
          })}
        </span>
      )}
    </label>
  );
}
