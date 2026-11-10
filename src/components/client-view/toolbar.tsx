"use client";

// The Timeline tab's explanatory (i), which sits above the table. (The column
// picker beside it is the shared `ColumnsMenu`, components/columns-menu.tsx.)
//
// ⚠️ The hint card is PORTALLED and `fixed`. The client page's header is
// `sticky` with a z-index, i.e. its own stacking context, so a panel positioned
// inside it can never paint above the Timeline's own sticky header. See the
// note on the component.

import { Info } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";


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
