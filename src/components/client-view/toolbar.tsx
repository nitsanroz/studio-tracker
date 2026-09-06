"use client";

// Two small controls that sit above the table: the column picker, and the
// Timeline tab's explanatory (i).
//
// ⚠️ The hint card is PORTALLED and `fixed`. The client page's header is
// `sticky` with a z-index, i.e. its own stacking context, so a panel positioned
// inside it can never paint above the Timeline's own sticky header. See the
// note on the component.

import { ALL_COLS, OPTIONAL_COLS } from "./shared";
import type { ColKey } from "./shared";
import { ChevronDown, Columns3, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";


export function ColumnsMenu({
  hidden,
  onToggle,
}: {
  hidden: Set<string>;
  onToggle: (key: ColKey, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Show or hide columns"
        aria-label="Show or hide columns"
        className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand"
      >
        <Columns3 size={14} />
        Columns
        {hidden.size > 0 && (
          <span className="text-xs tabular-nums text-faint">{ALL_COLS.length - hidden.size}</span>
        )}
        <ChevronDown size={13} className="text-faint" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex w-44 flex-col rounded-xl border border-border bg-surface p-1 shadow-xl pop-in">
          {OPTIONAL_COLS.map((c) => (
            <label
              key={c.key}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background"
            >
              <input
                type="checkbox"
                checked={!hidden.has(c.key)}
                onChange={(e) => onToggle(c.key, e.target.checked)}
                className="size-3.5 accent-[var(--brand)]"
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}


/**
 * The (i) beside the Timeline tab, and its help card.
 *
 * ⚠️ The card is PORTALLED to `document.body` and positioned `fixed`. As a
 * plain `absolute` child it was `z-40` inside the client page's sticky bar,
 * which is `sticky z-10` — and a positioned ancestor with a z-index is a
 * stacking context, so nothing inside it can paint above the Timeline's own
 * `z-20` sticky header no matter how high its z-index goes. It rendered
 * underneath the table. Same root cause as the weekly plan's search dropdown
 * (v1.1.0) and the Timeline's own `HoverTip`; the portal is the fix all three use.
 *
 * A button, not a decorated span: this is the only place the help lives, so it
 * has to be reachable by keyboard — hence opening on focus as well as hover.
 */
export function TimelineHintDot({ text }: { text: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const W = 288; // w-72
    setAt({
      left: Math.min(Math.max(8, r.left), window.innerWidth - W - 8),
      top: r.bottom + 6,
    });
  };

  return (
    <button
      ref={ref}
      type="button"
      aria-label={`How the Timeline works: ${text}`}
      // `text-muted`, matching `InfoDot`: `text-faint` is 2.6:1 on white, under
      // the 3:1 floor for a control. The two (i) affordances in the app should
      // also not be different greys.
      className="flex shrink-0 cursor-help text-muted hover:text-brand focus-visible:text-brand"
      onMouseEnter={open}
      onFocus={open}
      onMouseLeave={() => setAt(null)}
      onBlur={() => setAt(null)}
    >
      <Info size={15} aria-hidden />
      {at &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[70] w-72 rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs leading-relaxed text-muted shadow-xl"
            style={{ left: at.left, top: at.top }}
          >
            {text}
          </span>,
          document.body,
        )}
    </button>
  );
}
