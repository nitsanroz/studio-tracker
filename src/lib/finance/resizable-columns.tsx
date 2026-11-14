"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drag-to-resize column widths for a plain `<table>`. Widths persist per
 * `storageKey` in localStorage so each table remembers its own layout across
 * reloads. Render a `<colgroup>` from `widths` and put `startResize(col)` on
 * a handle inside each resizable `<th>`.
 */
export function useResizableColumns(storageKey: string, defaults: Record<string, number>) {
  const [widths, setWidths] = useState<Record<string, number>>(defaults);
  const defaultsRef = useRef(defaults);
  // Only read inside the drag handler, so syncing after render is enough.
  useEffect(() => {
    defaultsRef.current = defaults;
  }, [defaults]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`colwidths.${storageKey}`);
      if (raw) setWidths((w) => ({ ...w, ...JSON.parse(raw) }));
    } catch {
      // ignore — falls back to defaults
    }
  }, [storageKey]);

  const dragging = useRef<{ col: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    function move(e: MouseEvent) {
      const d = dragging.current;
      if (!d) return;
      const next = Math.max(36, Math.round(d.startW + (e.clientX - d.startX)));
      setWidths((w) => ({ ...w, [d.col]: next }));
    }
    function up() {
      if (!dragging.current) return;
      dragging.current = null;
      setWidths((w) => {
        try {
          localStorage.setItem(`colwidths.${storageKey}`, JSON.stringify(w));
        } catch {
          // ignore
        }
        return w;
      });
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [storageKey]);

  const startResize = useCallback(
    (col: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setWidths((w) => {
        dragging.current = { col, startX: e.clientX, startW: w[col] ?? defaultsRef.current[col] ?? 120 };
        return w;
      });
    },
    [],
  );

  const merged = { ...defaults, ...widths };
  const changed = Object.keys(defaults).some((k) => merged[k] !== defaults[k]);
  const reset = useCallback(() => {
    setWidths(defaultsRef.current);
    try {
      localStorage.removeItem(`colwidths.${storageKey}`);
    } catch {
      // ignore
    }
  }, [storageKey]);

  return { widths: merged, startResize, changed, reset };
}

/** Drag handle for the right edge of a resizable `<th>` — the `<th>` needs `relative`. */
export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <span
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      className="absolute right-0 top-0 z-10 h-full w-2 -mr-1 cursor-col-resize select-none hover:bg-brand/30 active:bg-brand/50"
    />
  );
}
