"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Eye } from "lucide-react";

/**
 * Stands in for `typeId === null` in the filter, which needs a key.
 *
 * Declared HERE, in the leaf: `client-view` imports `client-timeline`, so the
 * Timeline importing it back from the view would be a cycle.
 */
export const NO_TYPE = "__no_type";

export interface ShowMenuType {
  id: string;
  name: string;
  color: string;
}

/**
 * One control for every "what am I not seeing?" question on a client's tasks:
 * completed work, undated work, and which types of work.
 *
 * They used to be three things in three places — two pill buttons in the header
 * and the Timeline's colour legend — so a task that had gone missing meant
 * checking three of them.
 *
 * ⚠️ The trigger REPORTS state. Folding filters into a menu is how a filtered
 * chart comes to look like a quiet month: the whole risk is forgetting one is
 * on. So the button says "Show · 2 hidden" and turns brand-coloured whenever
 * anything is being held back, and goes quiet again when nothing is.
 */
export function ShowMenu({
  showDone,
  onShowDone,
  showUndated,
  onShowUndated,
  types,
  hiddenTypes,
  onToggleType,
  onClearTypes,
  plainBars,
  onPlainBars,
  summaries,
  onSummaries,
}: {
  showDone: boolean;
  onShowDone: (v: boolean) => void;
  showUndated: boolean;
  onShowUndated: (v: boolean) => void;
  types: ShowMenuType[];
  hiddenTypes: Set<string>;
  onToggleType: (id: string) => void;
  onClearTypes: () => void;
  /** Timeline only — omitted on the Tasks tab, where bars don't exist. */
  plainBars?: boolean;
  onPlainBars?: (v: boolean) => void;
  /** Rolled-up dates and hours on section and group headers (0027). */
  summaries?: boolean;
  onSummaries?: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  /**
   * Only the TYPE filter lights the trigger up.
   *
   * Completed and undated being off is the resting state of these views — a
   * badge that read "2 hidden" the moment you opened a client would be noise
   * that everyone learns to ignore, which is exactly how a real filter then
   * goes unnoticed. Types are the setting you turn on deliberately and forget.
   */
  const filtering = hiddenTypes.size > 0;

  const row =
    "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-background";

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Choose what this view shows"
        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${
          filtering
            ? "border-brand bg-brand-soft text-brand-dark"
            : "border-border bg-surface text-muted hover:border-brand hover:text-brand"
        }`}
      >
        <Eye size={14} />
        Show
        {filtering && (
          <span className="tabular-nums">
            · {hiddenTypes.size} type{hiddenTypes.size === 1 ? "" : "s"} hidden
          </span>
        )}
        <ChevronDown size={13} className={filtering ? "" : "text-faint"} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 flex w-56 flex-col rounded-xl border border-border bg-surface p-1 shadow-xl pop-in">
          {/* The three view switches read as settings — an emoji to find the
              row by and a switch to flip — while the types below stay
              checkboxes, because those are a LIST you tick items out of. */}
          <SwitchRow
            emoji="✅"
            label="Completed"
            checked={showDone}
            onChange={() => onShowDone(!showDone)}
          />
          <SwitchRow
            emoji="🗓️"
            label="Undated"
            checked={showUndated}
            onChange={() => onShowUndated(!showUndated)}
          />
          {onPlainBars && (
            <SwitchRow
              emoji="🎨"
              label="Color by type"
              checked={!plainBars}
              onChange={() => onPlainBars(!plainBars)}
            />
          )}
          {onSummaries && (
            // ⚠️ It must NOT light the trigger, unlike the type filter. The
            // trigger reports what you AREN'T SEEING, and a summary being off
            // hides nothing — every task is still on screen. See `filtering`.
            <SwitchRow
              emoji="🧮"
              label="Section totals"
              checked={summaries ?? false}
              onChange={() => onSummaries(!summaries)}
            />
          )}

          {types.length > 0 && (
            <>
              <div className="mt-1 flex items-center justify-between px-2 pb-1 pt-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                  Type
                </span>
                {hiddenTypes.size > 0 && (
                  <button
                    onClick={onClearTypes}
                    className="text-[11px] text-muted hover:text-brand"
                  >
                    Show all
                  </button>
                )}
              </div>
              {types.map((t) => (
                <Toggle
                  key={t.id}
                  className={row}
                  checked={!hiddenTypes.has(t.id)}
                  onChange={() => onToggleType(t.id)}
                  label={t.name}
                  swatch={t.color}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** An emoji to find the row by, its name, and a switch at the far end. */
function SwitchRow({
  emoji,
  label,
  checked,
  onChange,
}: {
  emoji: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      aria-pressed={checked}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-background"
    >
      <span className="w-4 shrink-0 text-center text-[13px] leading-none" aria-hidden>
        {emoji}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          checked ? "bg-brand" : "bg-border-strong"
        }`}
      >
        <span
          className={`absolute top-0.5 size-3 rounded-full bg-white shadow-sm transition-all ${
            checked ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

/** A tick you can hit anywhere along the row, rather than a 14px checkbox. */
function Toggle({
  checked,
  onChange,
  label,
  swatch,
  className,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  swatch?: string;
  className: string;
}) {
  return (
    <button onClick={onChange} className={className} aria-pressed={checked}>
      <span
        className={`flex size-4 shrink-0 items-center justify-center rounded border ${
          checked ? "border-brand bg-brand text-white" : "border-border-strong"
        }`}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </span>
      {swatch && (
        <span
          className="size-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: swatch }}
          aria-hidden
        />
      )}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
