"use client";

import { useEffect, useRef, useState } from "react";

interface SelRect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
  sig: string;
}
export interface NormRect {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

const norm = (x: SelRect): NormRect => ({
  r0: Math.min(x.r0, x.r1),
  r1: Math.max(x.r0, x.r1),
  c0: Math.min(x.c0, x.c1),
  c1: Math.max(x.c0, x.c1),
});

/**
 * Excel-style multi-rectangle cell selection for a money grid: click selects
 * one cell, drag extends it into a rectangle, Ctrl/Cmd+click starts a NEW
 * rectangle alongside the existing ones, Shift+click extends the last one.
 *
 * `sig` should change whenever the grid's row/column layout changes (a
 * filter, a fold, a sort, a year switch) — a stale signature reads as no
 * selection rather than addressing cells that have moved.
 */
export function useCellSelection(sig: string, valueAt?: (r: number, c: number) => number | null) {
  const [rects, setRects] = useState<SelRect[]>([]);
  const draggingIndex = useRef<number | null>(null);
  const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyRef = useRef<(() => void) | null>(null);
  /** Set synchronously by `cellMouseDown` so the window-level listener below
   * (which always fires AFTER a cell's own React handler, since it sits
   * further up the bubble path) can tell "this mousedown was one of my own
   * cells" from "this mousedown landed somewhere else entirely". */
  const clickedCellRef = useRef(false);

  useEffect(() => {
    const up = () => {
      draggingIndex.current = null;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setRects([]);
        setBubble(null);
        return;
      }
      // ⌘C / Ctrl+C copies the selection — but only when the browser has
      // nothing of its own to copy (a caret in a field, or real text
      // selected). Hijacking the shortcut there would steal a copy the user
      // meant to make some other way.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const el = document.activeElement as HTMLElement | null;
        const inField = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        const hasTextSelection = !!window.getSelection()?.toString();
        if (inField || hasTextSelection) return;
        copyRef.current?.();
      }
    };
    // A press anywhere that wasn't one of this grid's own cells clears the
    // selection — clicking away is how you deselect, same as a spreadsheet.
    const outside = () => {
      if (!clickedCellRef.current) {
        setRects([]);
        setBubble(null);
      }
      clickedCellRef.current = false;
    };
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", outside);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", outside);
    };
  }, []);

  const live = rects.filter((r) => r.sig === sig).map(norm);
  const isSelected = (r: number, c: number) => live.some((b) => r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1);

  function cellMouseDown(
    r: number,
    c: number,
    e: {
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
      clientX: number;
      clientY: number;
      target?: EventTarget | null;
      preventDefault?: () => void;
    },
  ) {
    // A drag across cells is a cell selection, not a text selection — without
    // this the browser also highlights the numbers' text in blue as you drag.
    // Left alone when the press starts in a field, so typing/caret still work.
    const t = e.target as HTMLElement | null;
    if (!t?.closest?.("input, textarea, select, button")) e.preventDefault?.();
    clickedCellRef.current = true;
    setCopied(false);
    setBubble({ x: e.clientX, y: e.clientY });
    if (e.ctrlKey || e.metaKey) {
      setRects((prev) => {
        const next = [...prev.filter((x) => x.sig === sig), { r0: r, c0: c, r1: r, c1: c, sig }];
        draggingIndex.current = next.length - 1;
        return next;
      });
    } else if (e.shiftKey && rects.some((x) => x.sig === sig)) {
      setRects((prev) => {
        const kept = prev.filter((x) => x.sig === sig);
        const idx = kept.length - 1;
        if (idx >= 0) kept[idx] = { ...kept[idx], r1: r, c1: c };
        draggingIndex.current = idx;
        return kept;
      });
    } else {
      draggingIndex.current = 0;
      setRects([{ r0: r, c0: c, r1: r, c1: c, sig }]);
    }
  }

  function cellMouseEnter(r: number, c: number, e: { clientX: number; clientY: number }) {
    if (draggingIndex.current == null) return;
    setBubble({ x: e.clientX, y: e.clientY });
    setRects((prev) => {
      const idx = draggingIndex.current;
      if (idx == null || !prev[idx]) return prev;
      const copy = [...prev];
      copy[idx] = { ...copy[idx], r1: r, c1: c };
      return copy;
    });
  }

  async function copyText(text: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  // Kept current every render (not just on mount) since `valueAt` closes over
  // whatever data the caller's grid currently holds — the ref itself is only
  // ever read from the ⌘C handler above, never during render.
  useEffect(() => {
    if (valueAt) copyRef.current = () => void copyText(selectionText(live, valueAt));
  });

  return { live, isSelected, cellMouseDown, cellMouseEnter, bubble, copied };
}

/** The one cell selected, when the selection is exactly one cell — what a step card acts on. */
export function singleCell(live: NormRect[]): { r: number; c: number } | null {
  const [b, ...more] = live;
  return b && !more.length && b.r0 === b.r1 && b.c0 === b.c1 ? { r: b.r0, c: b.c0 } : null;
}

/** Every cell of a (possibly overlapping) selection once, rectangle by rectangle, row by row. */
function* uniqueCells(live: NormRect[]): Generator<[number, number]> {
  const seen = new Set<string>();
  for (const b of live) {
    for (let r = b.r0; r <= b.r1; r++) {
      for (let c = b.c0; c <= b.c1; c++) {
        const key = `${r}|${c}`;
        if (seen.has(key)) continue;
        seen.add(key);
        yield [r, c];
      }
    }
  }
}

/** Sums a value across a (possibly overlapping, possibly multi-rectangle)
 * selection, counting each cell once. */
export function selectionSummary(
  live: NormRect[],
  valueAt: (r: number, c: number) => number | null,
): { total: number; cells: number; filled: number } {
  let total = 0;
  let cells = 0;
  let filled = 0;
  for (const [r, c] of uniqueCells(live)) {
    cells++;
    const v = valueAt(r, c);
    if (v != null) {
      total += v;
      if (v !== 0) filled++;
    }
  }
  return { total, cells, filled };
}

/** Tab-separated text for a selection, so it pastes as a grid of numbers into
 * a spreadsheet rather than one run-together string. Only rectangles that
 * span exactly ONE row×col box each are meaningful as a grid; for a
 * multi-rectangle (Ctrl-added) selection this falls back to one row per cell. */
export function selectionText(
  live: NormRect[],
  valueAt: (r: number, c: number) => number | null,
): string {
  if (live.length === 0) return "";
  if (live.length === 1) {
    const b = live[0];
    const lines: string[] = [];
    for (let r = b.r0; r <= b.r1; r++) {
      const cellsInRow: string[] = [];
      for (let c = b.c0; c <= b.c1; c++) {
        const v = valueAt(r, c);
        cellsInRow.push(v != null && v !== 0 ? String(v) : "");
      }
      lines.push(cellsInRow.join("\t"));
    }
    return lines.join("\n");
  }
  const out: string[] = [];
  for (const [r, c] of uniqueCells(live)) {
    const v = valueAt(r, c);
    if (v != null && v !== 0) out.push(String(v));
  }
  return out.join("\n");
}
