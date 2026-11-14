"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

/**
 * Small always-visible (i) badge shown whenever a cell carries a comment.
 * Hovering it shows the comment in an immediate custom tooltip (the native
 * `title` attribute has an inconsistent hover delay and some browsers never
 * show it at all); clicking opens the editor so it can be changed.
 */
export function CommentBadge({ comment, onOpen }: { comment: string; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    // data-no-explain: hovering the badge shows the comment alone, never the cell's explain card over it.
    <span data-no-explain className="absolute left-0.5 top-0.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label="Comment"
        className="text-brand hover:text-brand-dark"
      >
        <Info size={10} />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 w-48 whitespace-pre-wrap rounded-lg border border-border bg-surface p-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-foreground shadow-card"
        >
          {comment}
        </div>
      )}
    </span>
  );
}

/** Centered modal for adding/editing a cell's comment (right-click, or the (i) badge, opens this). */
export function CommentEditorDialog({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-lg">
        <h3 className="text-sm font-semibold text-foreground">Comment</h3>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          placeholder="Add a note about this figure…"
          className="bidi-auto mt-2 w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-border-strong px-3 py-1.5 text-sm hover:bg-background">
            Cancel
          </button>
          <button
            onClick={() => onSave(value)}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Local open/close state for one cell's comment editor — kept tiny and
 * per-cell so many cells on a grid don't share a single editor instance. */
export function useCommentEditor() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

/**
 * A grid cell's whole comment hook-up — the right-click that opens the editor,
 * and the (i) badge plus the editor itself, to render inside the cell's `<td>`.
 * Both are undefined when the cell takes no comment (`onSaveComment` unset).
 * Shared by LockableCell and the Plan's two income cells.
 */
export function useCellComment(comment: string | undefined, onSaveComment: ((v: string) => void) | undefined) {
  const editor = useCommentEditor();
  const contextMenu = onSaveComment
    ? (e: React.MouseEvent) => {
        e.preventDefault();
        editor.show();
      }
    : undefined;
  const commentUi = onSaveComment && (
    <>
      {comment && <CommentBadge comment={comment} onOpen={editor.show} />}
      {editor.open && (
        <CommentEditorDialog
          initial={comment ?? ""}
          onSave={(v) => {
            onSaveComment(v);
            editor.hide();
          }}
          onCancel={editor.hide}
        />
      )}
    </>
  );
  return { contextMenu, commentUi };
}
