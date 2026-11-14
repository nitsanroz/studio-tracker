"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Drag-to-reorder table columns (Nitsan, 2026-11-08: "the table should have
 * an option to rearrange columns"). The order persists per `storageKey` in
 * localStorage, like the widths in resizable-columns.tsx. Put `drag(key)` on
 * each reorderable `<th>` and render header, `<col>`s and cells in `order`.
 */

/** A saved order against today's columns: unknown keys dropped, new ones put after their default neighbour. */
export function mergeOrder(saved: readonly string[] | null, defaults: readonly string[]): string[] {
  if (!saved) return [...defaults];
  const out = saved.filter((k, i) => defaults.includes(k) && saved.indexOf(k) === i);
  defaults.forEach((k, i) => {
    if (out.includes(k)) return;
    // after the nearest earlier default column that's already placed, else first
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = out.indexOf(defaults[j]);
      if (p !== -1) {
        at = p + 1;
        break;
      }
    }
    out.splice(at, 0, k);
  });
  return out;
}

/** `from` dropped on `to`: it takes `to`'s place, the rest shift toward where it came from. */
export function moveKey(order: readonly string[], from: string, to: string): string[] {
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (a === -1 || b === -1 || a === b) return [...order];
  const out = order.filter((k) => k !== from);
  out.splice(b, 0, from);
  return out;
}

export interface DragProps {
  draggable: boolean;
  "data-drop": "before" | "after" | undefined;
  onMouseDown: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

/** Classes for a draggable `<th>`: a grab cursor and a brand line where it would land. */
export const DRAG_TH =
  "cursor-grab active:cursor-grabbing data-[drop=before]:shadow-[inset_2px_0_0_var(--brand)] data-[drop=after]:shadow-[inset_-2px_0_0_var(--brand)]";

export function useColumnOrder(storageKey: string, defaults: readonly string[]) {
  const [saved, setSaved] = useState<string[] | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`colorder.${storageKey}`);
      setSaved(raw ? (JSON.parse(raw) as string[]) : null);
    } catch {
      // storage unavailable — default order
    }
  }, [storageKey]);
  const order = useMemo(() => mergeOrder(saved, defaults), [saved, defaults]);

  const dragged = useRef<string | null>(null);
  // Set by a mousedown on the header itself — the resize handle stops that
  // event, so dragging from the handle resizes instead of moving the column.
  const armed = useRef(false);
  const [over, setOver] = useState<string | null>(null);

  const save = useCallback(
    (next: string[] | null) => {
      setSaved(next);
      try {
        if (next) localStorage.setItem(`colorder.${storageKey}`, JSON.stringify(next));
        else localStorage.removeItem(`colorder.${storageKey}`);
      } catch {
        // the order just won't be remembered
      }
    },
    [storageKey],
  );

  const drag = useCallback(
    (key: string): DragProps => {
      const from = dragged.current;
      const side = over === key && from && from !== key ? (order.indexOf(from) < order.indexOf(key) ? "after" : "before") : undefined;
      return {
        draggable: true,
        "data-drop": side,
        onMouseDown: () => {
          armed.current = true;
        },
        onDragStart: (e) => {
          if (!armed.current) return e.preventDefault();
          dragged.current = key;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", key);
        },
        onDragOver: (e) => {
          if (!dragged.current) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (over !== key) setOver(key);
        },
        onDragLeave: () => setOver((o) => (o === key ? null : o)),
        onDrop: (e) => {
          e.preventDefault();
          const f = dragged.current;
          dragged.current = null;
          armed.current = false;
          setOver(null);
          if (f && f !== key) save(moveKey(order, f, key));
        },
        onDragEnd: () => {
          dragged.current = null;
          armed.current = false;
          setOver(null);
        },
      };
    },
    [order, over, save],
  );

  const changed = saved != null && order.join() !== defaults.join();
  return { order, drag, changed, reset: () => save(null) };
}
