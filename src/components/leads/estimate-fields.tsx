"use client";

// The estimate editor's quiet inline fields — chrome only on hover/focus, commit
// on blur. Shared by the Scope and Overview tabs.

export const QUIET =
  "rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-border focus:border-border focus:bg-surface focus:outline-none disabled:hover:border-transparent";

/** A number field that commits on blur; empty → null. */
export function NumField({
  value,
  onCommit,
  disabled,
  className = "",
  step = 1,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  disabled?: boolean;
  className?: string;
  step?: number;
}) {
  return (
    <input
      type="number"
      min={0}
      step={step}
      key={String(value)}
      defaultValue={value ?? ""}
      disabled={disabled}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const v = raw === "" ? null : Number(raw);
        if (v !== value && (v === null || Number.isFinite(v))) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={`${QUIET} text-right tabular-nums ${className}`}
    />
  );
}

export function TextField({
  value,
  onCommit,
  disabled,
  className = "",
  placeholder,
  multiline,
  rows = 2,
}: {
  value: string | null;
  onCommit: (v: string | null) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const common = {
    defaultValue: value ?? "",
    disabled,
    placeholder,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value.trim() || null;
      if (v !== (value ?? null)) onCommit(v);
    },
    className: `bidi-auto ${QUIET} ${className}`,
  };
  return multiline ? (
    <textarea key={value ?? ""} rows={rows} {...common} />
  ) : (
    <input
      key={value ?? ""}
      {...common}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
