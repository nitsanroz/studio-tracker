"use client";

// Drag-to-resize table columns. Widths persist per table in localStorage.
// The drag handle is only visible while hovering the header row (group/thead).

import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";

export interface ColResizeOpts {
  /** px floor (default 40) */
  min?: number;
  /** px ceiling (default none) */
  max?: number;
  /** handle sits on the element's LEFT edge, so dragging left grows it */
  invert?: boolean;
}

export function useColWidths(
  tableKey: string,
  defaults: Record<string, number>,
  opts: ColResizeOpts = {},
) {
  const [widths, setWidths] = useState<Record<string, number>>(defaults);
  const { min = 40, max = Number.POSITIVE_INFINITY, invert = false } = opts;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`colw.${tableKey}`);
      if (raw) setWidths((prev) => ({ ...prev, ...JSON.parse(raw) }));
    } catch {}
  }, [tableKey]);

  const startResize = useCallback(
    (col: string) => (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = widths[col] ?? 100;
      const widthAt = (clientX: number) =>
        Math.min(max, Math.max(min, startW + (invert ? startX - clientX : clientX - startX)));
      const move = (ev: MouseEvent) => {
        setWidths((prev) => ({ ...prev, [col]: widthAt(ev.clientX) }));
      };
      const up = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        setWidths((prev) => {
          const next = { ...prev, [col]: widthAt(ev.clientX) };
          try {
            localStorage.setItem(`colw.${tableKey}`, JSON.stringify(next));
          } catch {}
          return next;
        });
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [tableKey, widths, min, max, invert],
  );

  return { widths, startResize };
}

/**
 * Put inside a `relative` element. Visible while hovering a parent marked
 * `group/thead` (table headers) or `group/resize` (anything else, e.g. a pane).
 */
export function ResizeHandle({
  onMouseDown,
  side = "right",
  /**
   * `always` keeps a faint grip visible at rest. A table column edge is a
   * familiar affordance and can stay hidden until hover, but the edge of a
   * standalone pane isn't — nobody thinks to try dragging it.
   */
  visibility = "hover",
}: {
  onMouseDown: (e: ReactMouseEvent) => void;
  side?: "left" | "right";
  visibility?: "hover" | "always";
}) {
  const hidden =
    visibility === "always"
      ? "opacity-40 hover:opacity-100 group-hover/resize:opacity-100"
      : "opacity-0 group-hover/thead:opacity-100 group-hover/resize:opacity-100";
  return (
    <span
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      // A right-side handle straddles its column's edge (-right-1.5 + w-3 puts the
      // rule exactly on it). A LEFT-side one sits in a gap-4 flex gutter, so it is
      // pushed a further 8px out to land in the MIDDLE of that gap rather than
      // hard against the pane it belongs to.
      className={`absolute ${
        side === "right" ? "-right-1.5" : "-left-2 -translate-x-1/2"
      } top-0 z-10 flex h-full w-3 cursor-col-resize items-center justify-center transition-opacity ${hidden}`}
      title={side === "left" ? "Drag to resize" : "Drag to resize column"}
    >
      {visibility === "always" ? (
        // a short centred grip rather than a full-height rule: it reads as a
        // handle you can grab, not as a border
        <span className="h-10 w-1 rounded-full bg-border-strong" />
      ) : (
        <span className="h-full w-0.5 rounded bg-brand/60" />
      )}
    </span>
  );
}
