"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";

/**
 * Asana-style inline-editable cells: the cell itself is the editor.
 * Hover shows a subtle inset outline ("this is editable"), click starts
 * editing in place with a brand focus ring, Enter/blur commits, Esc cancels.
 */

// hover affordance on the resting cell
const HOVER =
  "rounded-md cursor-text hover:shadow-[inset_0_0_0_1px_var(--color-border-strong)] hover:bg-surface transition-shadow";
// focus look while editing/typing
const FOCUS =
  "rounded-md border border-brand bg-surface shadow-[0_0_0_2px_var(--color-brand-soft)] outline-none";

export function EditableTextCell({
  value,
  onCommit,
  placeholder = "–",
  className = "",
  inputClassName = "",
  bidi = true,
  stopClick = true,
  startEditing = false,
  onExit,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  bidi?: boolean;
  stopClick?: boolean;
  /**
   * Mount straight into the input. For callers whose OWN control is the edit
   * affordance — a rename pencil, say. Without it a pencil handed you a second
   * "Click to edit" target for the intent you had just declared.
   */
  startEditing?: boolean;
  /** Editing ended, by commit OR by Escape. Lets a `startEditing` caller reset. */
  onExit?: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);
  const cancelled = useRef(false);

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={value}
        onClick={(e) => {
          if (stopClick) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={(e) => {
          if (!cancelled.current) {
            const v = e.target.value.trim();
            if (v !== value) onCommit(v);
          }
          cancelled.current = false;
          setEditing(false);
          // Escape does NOT call onCommit, so a caller that gates this on its own
          // `renaming` state would be stuck showing an editor it can't dismiss.
          onExit?.();
        }}
        className={`${FOCUS} w-full min-w-0 px-1.5 py-0.5 text-inherit ${bidi ? "bidi-auto" : ""} ${inputClassName}`}
      />
    );
  }
  return (
    <span
      onClick={(e) => {
        if (stopClick) {
          e.stopPropagation();
          e.preventDefault();
        }
        setEditing(true);
      }}
      title="Click to edit"
      className={`${HOVER} block w-full truncate px-1.5 py-0.5 ${bidi ? "bidi-auto" : ""} ${value ? "" : "text-faint"} ${className}`}
    >
      {value || placeholder}
    </span>
  );
}

/** Numeric cell (e.g. budget hours). Empty input commits null. */
export function EditableNumberCell({
  value,
  onCommit,
  format = (v) => `${v}h`,
  placeholder = "–",
  className = "",
  display,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  format?: (v: number) => string;
  placeholder?: string;
  className?: string;
  display?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  if (editing) {
    return (
      <input
        autoFocus
        // A TEXT field, not type=number: the spinner arrows ate a third of a
        // 56px budget cell and nobody nudges a budget by half an hour at a
        // time — they type the number they agreed. inputMode keeps the numeric
        // keypad on a phone.
        type="text"
        inputMode="decimal"
        defaultValue={value ?? ""}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={(e) => {
          if (!cancelled.current) {
            // accept "12", "12h", "12,5" — a comma is the decimal mark on the
            // studio's keyboards
            const raw = e.target.value.trim().replace(",", ".").replace(/h$/i, "");
            const num = raw === "" ? null : Number(raw);
            if (num !== value && (num == null || (!Number.isNaN(num) && num >= 0))) onCommit(num);
          }
          cancelled.current = false;
          setEditing(false);
        }}
        className={`${FOCUS} w-full min-w-0 px-1.5 py-0.5 text-inherit tabular-nums`}
      />
    );
  }
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setEditing(true);
      }}
      title="Click to edit"
      className={`${HOVER} block w-full truncate px-1.5 py-0.5 tabular-nums ${value == null && !display ? "text-faint" : ""} ${className}`}
    >
      {display ?? (value != null ? format(value) : placeholder)}
    </span>
  );
}

/** Size of the date popout, for the flip-up decision. */
const PANEL_W = 200;
const PANEL_H = 40;

/**
 * Date cell — click to type a date, or use the calendar button to pick one.
 *
 * ⚠️ **There is deliberately no `onBlur` here.** The previous version closed the
 * editor on blur, which is what made the native picker vanish the moment you
 * clicked its month name or its ‹ › arrows: the browser's calendar is separate
 * chrome, interacting with it blurs the input, and unmounting the input takes
 * the picker down with it. Instead the editor closes on Escape, on a committed
 * change, or on a pointerdown somewhere else in the DOCUMENT — and clicks inside
 * the native picker never reach the document, which is exactly why that test is
 * safe where blur was not.
 *
 * The picker is not opened automatically either, so clicking the cell leaves you
 * typing (`14/08/2026` straight off the keyboard). The calendar is opt-in via the
 * button, which appears on hover so a table of dates isn't a wall of icons.
 */
export function EditableDateCell({
  value,
  onCommit,
  format,
  placeholder = "–",
  className = "",
  fallback = null,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  format: (iso: string) => string;
  placeholder?: string;
  className?: string;
  /**
   * What an EMPTY field opens on — for a start date, the task's due date.
   * Setting a start "somewhere near the deadline" is the normal case, and an
   * empty picker opens on today's month, which for a task due in October is
   * two months of clicking away. It is a starting point only: nothing is saved
   * until the value actually changes.
   */
  fallback?: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  /** set when the calendar button (rather than the text) started the edit */
  const openPicker = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    if (openPicker.current) {
      openPicker.current = false;
      ref.current?.showPicker?.();
    }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !panel.current?.contains(t)) setEditing(false);
    };
    // capture: a row handler that stops propagation would otherwise strand the
    // editor open for the rest of the session
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [editing]);

  function start(withPicker: boolean) {
    const r = wrap.current?.getBoundingClientRect();
    if (r) {
      // `fixed`, measured from the cell — these tables live in
      // `overflow-x-auto` wrappers, and a scroll container clips BOTH axes, so
      // an absolutely-positioned panel is cut off on the last rows. Flip above
      // the cell when the window runs out below.
      const below = window.innerHeight - r.bottom;
      setPos({
        left: Math.min(r.left - 4, window.innerWidth - PANEL_W - 8),
        top: below < PANEL_H + 12 ? Math.max(8, r.top - PANEL_H - 4) : r.top - 4,
      });
    }
    openPicker.current = withPicker;
    setEditing(true);
  }

  return (
    <span
      ref={wrap}
      onClick={(e) => {
        if (editing) return;
        e.stopPropagation();
        e.preventDefault();
        start(false);
      }}
      title={editing ? undefined : "Click to type a date"}
      // min-h-[22px] and a full-width block: an EMPTY date used to be a
      // zero-width sliver you had to hunt for. The placeholder plus the row's
      // own height now give it the same target as any other cell.
      className={`${HOVER} group/date relative flex min-h-[22px] w-full items-center gap-1 px-1.5 py-0.5 ${value ? "" : "text-faint"} ${className}`}
    >
      <span className="min-w-0 flex-1 truncate">{value ? format(value) : placeholder}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          start(true);
        }}
        title="Open the calendar"
        aria-label="Open the calendar"
        className="shrink-0 text-faint opacity-0 transition-opacity hover:text-brand group-hover/date:opacity-100"
      >
        <CalendarDays size={13} />
      </button>

      {editing && (
        /*
          The editor is a POPOUT, not the cell.
          A `<input type="date">` needs ~120px for dd/mm/yyyy plus its own glyph;
          these cells are 72px, so editing in place clipped the field and the
          calendar button landed on top of the text. Anchored over the cell and
          given real width, both fit — and the calendar button sits OUTSIDE the
          field rather than being the browser's glyph inside it.
        */
        <span
          ref={panel}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-xl"
          style={{ left: pos.left, top: pos.top }}
        >
          <input
            ref={ref}
            type="date"
            defaultValue={value ?? fallback ?? ""}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
              if (e.key === "Enter") {
                onCommit((e.target as HTMLInputElement).value || null);
                setEditing(false);
              }
            }}
            onChange={(e) => onCommit(e.target.value || null)}
            // the browser's own glyph is hidden: the button beside it is the picker
            className="w-[124px] rounded-md border border-border bg-surface px-1.5 py-1 text-xs tabular-nums text-foreground outline-none focus:border-brand [&::-webkit-calendar-picker-indicator]:hidden"
          />
          <button
            onClick={() => ref.current?.showPicker?.()}
            title="Open the calendar"
            aria-label="Open the calendar"
            className="shrink-0 rounded-md border border-border p-1 text-muted hover:border-brand hover:text-brand"
          >
            <CalendarDays size={13} />
          </button>
          {value && (
            <button
              onClick={() => {
                onCommit(null);
                setEditing(false);
              }}
              title="Clear the date"
              aria-label="Clear the date"
              className="shrink-0 rounded-md border border-border p-1 text-muted hover:border-danger hover:text-danger"
            >
              <X size={13} />
            </button>
          )}
        </span>
      )}
    </span>
  );
}

/** Select cell — resting state renders `display`; click swaps to a native select. */
export function EditableSelectCell({
  value,
  options,
  onCommit,
  display,
  className = "",
  allowEmpty = true,
  emptyLabel = "None",
}: {
  value: string;
  options: { value: string; label: string }[];
  onCommit: (v: string) => void;
  display: React.ReactNode;
  className?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <select
        autoFocus
        defaultValue={value}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        onChange={(e) => {
          if (e.target.value !== value) onCommit(e.target.value);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className={`${FOCUS} w-full min-w-0 px-1 py-0.5 text-xs`}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        setEditing(true);
      }}
      title="Click to edit"
      className={`${HOVER} block w-full cursor-pointer truncate px-1.5 py-0.5 ${className}`}
    >
      {display ?? <span className="text-faint">–</span>}
    </span>
  );
}
