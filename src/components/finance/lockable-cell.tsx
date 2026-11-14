"use client";

import { useRef } from "react";
import { cellStateClass, type FinanceState } from "@/lib/finance/finance";
import { useCellComment } from "@/components/finance/cell-comment";
import { PaidMark } from "@/components/finance/ui";

/** Small icon-button overlay, only visible while its cell is hovered. */
export function CellIconButton({
  onClick,
  title,
  offset,
  children,
}: {
  onClick?: () => void;
  title: string;
  offset: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title={title}
      className={`absolute ${offset} top-1/2 -translate-y-1/2 text-faint opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-brand group-hover:opacity-70 group-hover:hover:opacity-100`}
    >
      {children}
    </button>
  );
}

/** Excel-style selection outline — drawn as an inset outline so it never
 * shifts the cell's own layout. */
export const SEL_CLS = "outline outline-1 -outline-offset-1 outline-foreground";

/**
 * A plain-text (locked or read-only) cell reachable from the keyboard: Tab
 * focuses it, Enter or Space selects it as a click would — a real mousedown,
 * so cell-selection.ts sees it exactly like the mouse's — and the step card
 * then takes focus (cell-state-card.tsx). Editable cells are inputs already.
 */
export function cellKeyProps(onCellMouseDown?: (e: React.MouseEvent) => void) {
  if (!onCellMouseDown) return {};
  return {
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if ((e.key !== "Enter" && e.key !== " ") || e.target !== e.currentTarget) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const at = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, shiftKey: e.shiftKey };
      e.currentTarget.dispatchEvent(new MouseEvent("mousedown", at));
      window.dispatchEvent(new MouseEvent("mouseup", at));
    },
  };
}
/** The keyboard focus ring for those cells — inset, so it never shifts layout or hides `SEL_CLS`. */
export const CELL_FOCUS = "outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--brand)]";

export interface CellSelectionProps {
  selected?: boolean;
  onCellMouseDown?: (e: React.MouseEvent) => void;
  onCellMouseEnter?: (e: React.MouseEvent) => void;
}

/**
 * Editable-amount cell for the Salaries and Freelance grids: unlocked cells
 * are an editable input; a "final" cell is bold-on-green plain text, a paid
 * one's amount dark green. No icons of its own (Nitsan, 2026-10-25): a cell's
 * step — Draft, Predicted, Final, Paid — is set from the card above a
 * selected cell (cell-state-card.tsx), as on the Plan. `CellIconButton` above
 * is now only the Expenses page's.
 */
export function LockableCell({
  editable,
  state,
  value,
  committedValue,
  display,
  onChange,
  onCommit,
  onPaste,
  title,
  comment,
  onSaveComment,
  selected,
  onCellMouseDown,
  onCellMouseEnter,
  future,
  dataCell,
  advice,
  paid,
  aside,
}: {
  editable: boolean;
  state: FinanceState | undefined;
  /** Raw editable text (what the input shows while unlocked). */
  value: string;
  /** The last-saved value, independent of `value` (which tracks live typing)
   * — onBlur compares against this, never against `value` itself, since by
   * blur time `value` already reflects whatever was just typed. */
  committedValue: string;
  /** Formatted text to show when locked or read-only; defaults to `value`. */
  display?: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  title?: string;
  /** Free-text note attached to this cell (right-click to add/edit). */
  comment?: string;
  onSaveComment?: (v: string) => void;
  /** Current/future month — draws a lighter background behind the value. */
  future?: boolean;
  /** Key for the hover explain card (see explain-card.tsx). */
  dataCell?: string;
  /** `data-advice` tokens — what an &advice card can point at (advice.tsx `Spotlight`). */
  advice?: string;
  /**
   * Paid, apart from final (reference/0011, Nitsan 2026-10-25): the amount in
   * dark green with a small tick (`PaidMark`), on its own stronger green
   * (`--state-paid-bg`) so it no longer shares final's background.
   * Marked from the step card (cell-state-card.tsx), or a whole month at once
   * from its header's ✓✓ button (month-amount-grid.tsx).
   */
  paid?: boolean;
  /** Live state beside the value, in brackets — this month's tracker hours and
   * what they come to, on Freelance ("(42h · ₪5.9K)"), like the Plan's "(13)". */
  aside?: { text: string; title: string };
} & CellSelectionProps) {
  const ref = useRef<HTMLInputElement>(null);
  const stateCls = cellStateClass(state);
  const futureCls = future && state !== "predicted" && state !== "final" ? "bg-surface" : "";
  const locked = state === "final";
  const shown = display ?? value;
  const { contextMenu, commentUi } = useCellComment(comment, onSaveComment);
  const selCls = selected ? SEL_CLS : "";
  const paidCls = paid ? "text-[var(--state-paid-fg)]! bg-[var(--state-paid-bg)]!" : "";
  const asideUi = aside && (
    <span title={aside.title} className="ml-1 whitespace-nowrap text-[11px] font-normal text-faint">
      ({aside.text})
    </span>
  );

  // Read-only and locked cells are the same plain text; only a locked (editable) one gets the cell cursor.
  if (!editable || locked) {
    return (
      <td
        data-cell={dataCell}
        data-advice={advice}
        className={`relative ${editable ? "cursor-cell p-0 select-none" : "select-none p-0"} ${futureCls} ${selCls} ${CELL_FOCUS}`}
        onContextMenu={contextMenu}
        onMouseDown={onCellMouseDown}
        {...cellKeyProps(onCellMouseDown)}
        onMouseEnter={onCellMouseEnter}
      >
        <div className={`px-2 py-1.5 text-right tabular-nums ${stateCls} ${paidCls}`} title={title}>
          {paid && <PaidMark />}
          {shown}
          {asideUi}
        </div>
        {commentUi}
      </td>
    );
  }

  return (
    <td
      data-cell={dataCell}
      data-advice={advice}
      className={`relative p-0 ${stateCls} ${paidCls} ${futureCls} ${selCls}`}
      onContextMenu={contextMenu}
      onMouseDown={onCellMouseDown}
      onMouseEnter={onCellMouseEnter}
    >
      {/* The bracket sits after the typed number, beside the field — never over it. */}
      <div className="flex items-center">
        <input
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => {
            if (e.target.value !== committedValue) onCommit(e.target.value);
          }}
          onPaste={onPaste}
          onKeyDown={(e) => e.key === "Enter" && ref.current?.blur()}
          inputMode="decimal"
          className={`min-w-0 flex-1 select-none bg-transparent py-1.5 text-right tabular-nums outline-none transition-shadow hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--border-strong)] focus:select-text focus:bg-brand-soft/40 focus:shadow-[inset_0_0_0_1.5px_var(--brand)] ${
            aside ? "pl-2 pr-0.5" : "px-2"
          }`}
        />
        {aside && <span className="pr-2">{asideUi}</span>}
      </div>
      {commentUi}
    </td>
  );
}
