"use client";

// The range pills + ◀ label ▶ + "Now" cluster, lifted out of the admin home so
// reports and the team page can step through periods the same way.
//
// Generic over the range list on purpose: the home page offers four, the team
// page five (it has quarters), reports three.

import { ChevronLeft, ChevronRight } from "lucide-react";

export function PeriodStepper<K extends string>({
  ranges,
  value,
  offset,
  label,
  canStep,
  onChange,
  onOffset,
  disabledReason = "This range has no previous period",
  right,
  className = "",
}: {
  ranges: readonly K[];
  value: K;
  /** 0 = current, negative = further back */
  offset: number;
  /** from rangeLabel() — the stepper never computes dates itself */
  label: string;
  /** false for "All time"/"Custom": arrows and Now dim rather than disappear */
  canStep: boolean;
  onChange: (v: K) => void;
  onOffset: (next: number) => void;
  disabledReason?: string;
  /** trailing content on the same row (e.g. the team page's "+ Add user") */
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {ranges.map((r) => (
        <button
          key={r}
          onClick={() => {
            onChange(r);
            onOffset(0); // a new unit with the old offset would mean a period nobody picked
          }}
          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
            value === r
              ? "border-brand bg-brand-soft text-brand-dark"
              : "border-border bg-surface text-muted hover:border-border-strong"
          }`}
        >
          {r}
        </button>
      ))}
      {/* Always rendered. These used to vanish when stepping made no sense and
          the "Now" reset only appeared once you had already moved, so the row
          reflowed as you used it. Disabled + dimmed instead, so the controls stay
          where the hand left them. */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onOffset(offset - 1)}
          disabled={!canStep}
          title={canStep ? "Previous period" : disabledReason}
          className="rounded-md border border-border bg-surface p-1.5 text-muted hover:border-border-strong hover:text-foreground disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted"
        >
          <ChevronLeft size={15} />
        </button>
        <span
          className="min-w-[72px] text-center text-xs font-medium tabular-nums"
          title="Selected period"
        >
          {label}
        </span>
        <button
          onClick={() => onOffset(Math.min(0, offset + 1))}
          disabled={!canStep || offset >= 0}
          title={canStep ? "Next period" : disabledReason}
          className="rounded-md border border-border bg-surface p-1.5 text-muted hover:border-border-strong hover:text-foreground disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted"
        >
          <ChevronRight size={15} />
        </button>
        <button
          onClick={() => onOffset(0)}
          disabled={!canStep || offset === 0}
          title="Back to the current period"
          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted hover:border-brand hover:text-brand disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted"
        >
          Now
        </button>
      </div>
      {right}
    </div>
  );
}
