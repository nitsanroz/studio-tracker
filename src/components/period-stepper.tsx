"use client";

// The range pills + ◀ label ▶ + "Now" cluster, lifted out of the admin home so
// reports and the team page can step through periods the same way.
//
// Generic over the range list on purpose: the home page offers four, the team
// page five (it has quarters), reports three.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Tabs } from "./ui";

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
    // ⚠️ SCROLLS ITSELF below md — it must not depend on its host doing it.
    // Four range pills plus the stepper need ~500px, so at 375px this wrapped
    // onto three rows on the home page, /reports AND /team. The first fix made
    // it `flex-nowrap` and leaned on the home page's scrolling filter strip,
    // which promptly pushed /team's document to 637px wide: the other two hosts
    // have no scroller. Owning the overflow here fixes all three at once and
    // can't be broken by a future caller.
    <div
      className={`-mx-4 flex flex-nowrap items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 ${className}`}
    >
      <Tabs
        variant="segmented"
        size="sm"
        ariaLabel="Period"
        className="shrink-0"
        items={ranges.map((r) => ({ value: r, label: r }))}
        value={value}
        onChange={(r) => {
          onChange(r);
          onOffset(0); // a new unit with the old offset would mean a period nobody picked
        }}
      />
      {/* Always rendered. These used to vanish when stepping made no sense and
          the "Now" reset only appeared once you had already moved, so the row
          reflowed as you used it. Disabled + dimmed instead, so the controls stay
          where the hand left them. */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => onOffset(offset - 1)}
          disabled={!canStep}
          title={canStep ? "Previous period" : disabledReason}
          className="rounded-lg bg-surface p-2 text-muted shadow-card hover:text-foreground disabled:opacity-30 disabled:shadow-none disabled:hover:text-muted"
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
          className="rounded-lg bg-surface p-2 text-muted shadow-card hover:text-foreground disabled:opacity-30 disabled:shadow-none disabled:hover:text-muted"
        >
          <ChevronRight size={15} />
        </button>
        <button
          onClick={() => onOffset(0)}
          disabled={!canStep || offset === 0}
          title="Back to the current period"
          className="rounded-lg px-2 py-1 text-xs text-muted hover:bg-surface hover:text-brand disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
        >
          Now
        </button>
      </div>
      {right}
    </div>
  );
}
