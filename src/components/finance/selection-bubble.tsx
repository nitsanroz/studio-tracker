"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** Clamp a floating tooltip's position (measured after render) so it never
 * spills past the viewport edge, flipping to the other side of the cursor
 * instead of just touching the boundary. */
function useClampedPosition(anchor: { x: number; y: number } | null, offset = 16, margin = 8) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const left =
      anchor.x + offset + w > window.innerWidth - margin ? anchor.x - offset - w : anchor.x + offset;
    const top =
      anchor.y + offset + h > window.innerHeight - margin ? anchor.y - offset - h : anchor.y + offset;
    setPos({
      left: Math.max(margin, Math.min(left, window.innerWidth - w - margin)),
      top: Math.max(margin, Math.min(top, window.innerHeight - h - margin)),
    });
  }, [anchor, offset, margin]);

  return { ref, pos };
}

/** Floating summary shown while dragging a cell selection (or right after a
 * copy) — mirrors a spreadsheet's own "sum of selected cells" readout. */
export function SelectionBubble({
  bubble,
  copied,
  total,
  cells,
  filled,
  formatValue,
  money = false,
}: {
  bubble: { x: number; y: number } | null;
  copied: boolean;
  total: number;
  cells: number;
  filled: number;
  formatValue: (n: number) => string;
  /** Its figures are amounts even without a ₪ — Hide numbers hides them. */
  money?: boolean;
}) {
  const { ref, pos } = useClampedPosition(bubble);
  if (!bubble) return null;
  const style = { left: pos?.left ?? bubble.x + 16, top: pos?.top ?? bubble.y + 16, visibility: pos ? undefined : ("hidden" as const) };
  if (copied) {
    return (
      <div
        ref={ref}
        className="pointer-events-none fixed z-50 rounded-lg bg-foreground px-2.5 py-1 text-xs font-medium text-white shadow-lg"
        style={style}
      >
        Copied
      </div>
    );
  }
  if (cells <= 1) return null;
  return (
    <div
      ref={ref}
      style={style}
      data-money={money || undefined}
      className="pointer-events-none fixed z-50 rounded-xl bg-foreground px-3 py-2 text-white shadow-xl"
    >
      <div className="text-2xl font-bold leading-none tabular-nums">{formatValue(total)}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-white/70">
        {filled} of {cells} cells
        {filled > 1 ? (
          <>
            {" · avg "}
            <span className="tabular-nums">{formatValue(total / filled)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
