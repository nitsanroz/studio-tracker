"use client";

import { useEffect, useRef, useState } from "react";

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
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  bidi?: boolean;
  stopClick?: boolean;
}) {
  const [editing, setEditing] = useState(false);
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
        type="number"
        step="0.5"
        min="0"
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
            const raw = e.target.value.trim();
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

/** Date cell — click opens the native date picker in place. Clearing commits null. */
export function EditableDateCell({
  value,
  onCommit,
  format,
  placeholder = "–",
  className = "",
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  format: (iso: string) => string;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.showPicker?.();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={ref}
        type="date"
        defaultValue={value ?? ""}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        onChange={(e) => {
          onCommit(e.target.value || null);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className={`${FOCUS} w-full min-w-0 px-1 py-0.5 text-inherit`}
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
      className={`${HOVER} block w-full cursor-pointer truncate px-1.5 py-0.5 ${value ? "" : "text-faint"} ${className}`}
    >
      {value ? format(value) : placeholder}
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
