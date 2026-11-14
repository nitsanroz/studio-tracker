"use client";

import { useCallback, useRef } from "react";

/** Grid column a cell starts at, counting the colSpans before it. */
function columnOf(cell: HTMLTableCellElement): number {
  let col = 0;
  for (let c = cell.previousElementSibling; c; c = c.previousElementSibling) col += (c as HTMLTableCellElement).colSpan || 1;
  return col;
}

/** The single-column cell of `row` at grid column `col`, if any. */
function cellAt(row: HTMLTableRowElement, col: number): HTMLTableCellElement | null {
  let at = 0;
  for (const c of Array.from(row.cells)) {
    if (at === col) return c.colSpan === 1 ? c : null;
    at += c.colSpan || 1;
    if (at > col) return null;
  }
  return null;
}

/**
 * A light crosshair on a grid: hovering a cell tints its row and its column, so
 * you can follow a month down and a line across. Put the handlers on the
 * <table>; the tint is the `.xhair` class (an overlay, so cell colours show
 * through). Spanning cells (section headers) are left alone.
 */
export function useTableCrosshair() {
  const lit = useRef<HTMLElement[]>([]);
  const at = useRef("");

  const clear = useCallback(() => {
    for (const el of lit.current) el.classList.remove("xhair");
    lit.current = [];
    at.current = "";
  }, []);

  const onMouseOver = useCallback(
    (e: React.MouseEvent<HTMLTableElement>) => {
      const table = e.currentTarget;
      const cell = (e.target as HTMLElement).closest("td, th") as HTMLTableCellElement | null;
      if (!cell || !table.contains(cell)) return clear();
      const row = cell.parentElement as HTMLTableRowElement;
      const col = columnOf(cell);
      const key = `${row.rowIndex}|${col}`;
      if (key === at.current) return;
      clear();
      at.current = key;
      const mark = (el: HTMLElement | null) => {
        if (!el) return;
        el.classList.add("xhair");
        lit.current.push(el);
      };
      // The row, unless it's a header row or the cell spans columns (a section title).
      if (row.parentElement?.tagName === "TBODY" && cell.colSpan === 1) for (const c of Array.from(row.cells)) mark(c);
      // The column, down every row that has a cell of its own there.
      if (cell.colSpan === 1 && col > 0) for (const r of Array.from(table.rows)) if (r !== row) mark(cellAt(r, col));
    },
    [clear],
  );

  return { onMouseOver, onMouseLeave: clear };
}
