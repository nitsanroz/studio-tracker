"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isSettled, type Step } from "@/lib/finance/finance";

export { stepOf, type Step } from "@/lib/finance/finance";

/** The five steps' names and meanings — the one source for this card and the grids' legend (ui.tsx StateLegend). */
export const STEPS: { step: Step; label: string; hint: string }[] = [
  { step: "actual", label: "Draft", hint: "A rough placeholder, not reviewed yet" },
  { step: "predicted", label: "Predicted", hint: "Your considered estimate" },
  { step: "final", label: "Final", hint: "Checked and locked, not paid yet" },
  { step: "invoiced", label: "Invoiced", hint: "Final, and the invoice is out — waiting for the money; a ↗ before the amount" },
  { step: "paid", label: "Paid", hint: "Final, and the money has moved — a ✓ before the amount" },
];

/** The steps most grids offer; the Plan's income cells add Invoiced (`PLAN_STEPS`). */
const BASIC_STEPS: Step[] = ["actual", "predicted", "final", "paid"];
export const PLAN_STEPS: Step[] = ["actual", "predicted", "final", "invoiced", "paid"];

/**
 * The selected cell's step, above it: one cell selected → a small card with
 * every step, the current one in black; a click on another moves it there.
 * Replaces the cells' small hover icons (Nitsan, 2026-10-25). Sits above the
 * cell because the hover explain card opens beside it from its top down
 * (explain-card.tsx); below only where there's no room above. Follows the cell
 * as the page or the grid scrolls.
 *
 * `anchor` = a selector for the cell. `canEdit` false (a locked month, a past
 * year — `why`) leaves only final ↔ paid, which doesn't change the amount; the
 * reason shows under the steps, not only in a tooltip (touch has none).
 *
 * Keyboard: a cell selected with Enter (`cellKeyProps`) moves focus here, to
 * the current step; ←/→ move between steps, Enter picks one, Esc closes the
 * card (cell-selection.ts) and focus goes back to the cell.
 */
export function CellStateCard({
  anchor,
  step,
  canEdit,
  why = "month",
  steps = BASIC_STEPS,
  busy,
  onStep,
}: {
  anchor: string;
  step: Step;
  canEdit: boolean;
  /** what stops a full edit when `canEdit` is false */
  why?: "month" | "year";
  /** which steps this cell offers, in order */
  steps?: Step[];
  busy: boolean;
  onStep: (step: Step) => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // Whether focus is in the card — read on close, when the card has already left the page.
  const focusIn = useRef(false);
  useLayoutEffect(() => {
    // Looked up on every placement: a reload (a step saved, a month locked or
    // reopened) can replace the cell's node, and the old one measures as nowhere.
    const place = () => {
      const td = document.querySelector(anchor);
      if (!td) return setPos(null);
      const r = td.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 40;
      const w = ref.current?.offsetWidth ?? 300;
      const left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)));
      const top = Math.round(r.top - 8 - h >= 8 ? r.top - 8 - h : r.bottom + 6);
      // Same place → same object, so React skips the render.
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    // Scroll fires for every scroller on the page: place once a frame at most.
    let frame = 0;
    const onMove = () => {
      if (!frame) frame = requestAnimationFrame(() => ((frame = 0), place()));
    };
    place();
    window.addEventListener("scroll", onMove, { capture: true, passive: true });
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, { capture: true });
      window.removeEventListener("resize", onMove);
    };
    // step / busy: a save just finished and the grid may have redrawn — place again.
  }, [anchor, step, busy]);

  // Opened from the keyboard (focus is on the cell) → focus the current step;
  // closing with focus inside hands it back to the cell.
  useEffect(() => {
    const card = ref.current;
    // A frame later: on mount the card is still hidden until it's placed, and a hidden button can't take focus.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement?.closest(anchor)) (card?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)') ?? card?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (focusIn.current) document.querySelector<HTMLElement>(anchor)?.focus();
    };
  }, [anchor]);

  const allowed = (s: Step) => canEdit || (isSettled(s) && isSettled(step));
  const reason =
    why === "year"
      ? `A past year is kept as booked — only ${steps.filter(isSettled).map((s) => STEPS.find((x) => x.step === s)?.label).join(" ↔ ")} can change.`
      : "This month is locked — reopen it to go back to Draft or Predicted.";
  const arrows = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };
  return (
    // Its own presses must not count as "clicking away" from the selection (cell-selection.ts).
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      onFocus={() => (focusIn.current = true)}
      onBlur={(e) => (focusIn.current = !!ref.current?.contains(e.relatedTarget as Node | null))}
      style={pos ?? { visibility: "hidden", left: 0, top: 0 }}
      className="fixed z-40 rounded-xl border border-border bg-surface p-1 shadow-[0_12px_30px_-8px_rgba(6,17,47,0.35)]"
    >
      {/* Busy greys the steps rather than disabling them: a disabled button drops the keyboard's focus. */}
      <div role="radiogroup" aria-label="Cell state" aria-busy={busy} onKeyDown={arrows} className={`flex gap-0.5 ${busy ? "opacity-60" : ""}`}>
        {STEPS.filter((x) => steps.includes(x.step)).map((x) => (
          <button
            key={x.step}
            role="radio"
            aria-checked={step === x.step}
            tabIndex={step === x.step ? 0 : -1}
            disabled={!allowed(x.step)}
            onClick={() => !busy && step !== x.step && onStep(x.step)}
            title={allowed(x.step) ? x.hint : reason}
            className={`rounded-lg px-3 py-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed md:py-1.5 ${
              step === x.step
                ? "bg-foreground text-background"
                : "text-muted hover:bg-surface-2 hover:text-foreground disabled:text-faint disabled:line-through disabled:hover:bg-transparent"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {!canEdit && <p className="max-w-[18rem] px-2 pb-1 pt-1.5 text-[11px] leading-snug text-faint">{reason}</p>}
      <span className="sr-only" aria-live="polite">
        {busy ? "Saving…" : `${STEPS.find((x) => x.step === step)?.label}`}
      </span>
    </div>
  );
}
