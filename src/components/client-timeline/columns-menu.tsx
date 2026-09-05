"use client";

// The left table's column picker.

import { TL_COLS } from "./shared";
import type { TlCol } from "./shared";
import { ChevronDown, Columns3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";


export function TimelineColumnsMenu({
  hidden,
  onToggle,
}: {
  hidden: Set<string>;
  onToggle: (key: TlCol, on: boolean) => void;
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
        // Identical to the Tasks tab's Columns button, down to the padding and
        // the count: two buttons that do the same thing on two tabs of one page
        // had no business looking like different controls.
        className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-medium text-muted transition-colors hover:border-brand hover:text-brand"
      >
        <Columns3 size={14} />
        Columns
        {hidden.size > 0 && (
          <span className="text-xs tabular-nums text-faint">{TL_COLS.length - hidden.size}</span>
        )}
        <ChevronDown size={13} className="text-faint" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 flex w-40 flex-col rounded-xl border border-border bg-surface p-1 shadow-xl pop-in">
          {TL_COLS.map((c) => (
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
