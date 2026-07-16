"use client";

// Drag-to-resize table columns. Widths persist per table in localStorage.
// The drag handle is only visible while hovering the header row (group/thead).

import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";

export function useColWidths(tableKey: string, defaults: Record<string, number>) {
  const [widths, setWidths] = useState<Record<string, number>>(defaults);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`colw.${tableKey}`);
      if (raw) setWidths((prev) => ({ ...prev, ...JSON.parse(raw) }));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey]);

  const startResize = useCallback(
    (col: string) => (e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = widths[col] ?? 100;
      const move = (ev: MouseEvent) => {
        const w = Math.max(40, startW + ev.clientX - startX);
        setWidths((prev) => ({ ...prev, [col]: w }));
      };
      const up = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        const w = Math.max(40, startW + ev.clientX - startX);
        setWidths((prev) => {
          const next = { ...prev, [col]: w };
          try {
            localStorage.setItem(`colw.${tableKey}`, JSON.stringify(next));
          } catch {}
          return next;
        });
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [tableKey, widths],
  );

  return { widths, startResize };
}

/** Put inside a `relative` header cell; header row needs `group/thead`. */
export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: ReactMouseEvent) => void }) {
  return (
    <span
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      className="absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize items-stretch justify-center opacity-0 group-hover/thead:opacity-100"
      title="Drag to resize column"
    >
      <span className="w-0.5 rounded bg-brand/60" />
    </span>
  );
}
