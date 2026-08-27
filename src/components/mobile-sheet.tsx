"use client";

// A bottom sheet — the phone equivalent of this app's anchored popovers.
//
// Not built on the shared `Modal`, deliberately: that one centres a width-capped
// card, and a sheet is the opposite geometry (full width, pinned to the bottom
// edge, growing upward). Reskinning `Modal` would have meant fighting its
// `align` and `width` props on every call, and ⚠️ its `p-4` cannot be removed
// without `p-0!` — Tailwind orders `p-4` after `p-0`, so class order never
// decides it. A sheet that wants to bleed to its own edges would hit that on day
// one. (Logged in v1.9.0; it cost several rounds there.)
//
// ⚠️ `pb-[env(safe-area-inset-bottom)]` is why `layout.tsx` sets
// `viewportFit: "cover"` — without that the inset resolves to 0 and the last
// control sits under an iPhone's home indicator.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEnterTransition } from "@/lib/use-enter-transition";

/**
 * ⚠️ MUST EQUAL THE CSS DURATION BELOW. A JS timer shorter than the transition
 * yanks the sheet off screen mid-slide; longer leaves it mounted and invisible,
 * swallowing the next tap. Same constraint as `PANE_MS` in `task-panel.tsx`.
 */
const SHEET_MS = 220;
/**
 * ⚠️⚠️ THE UNMOUNT TIMER IS DELIBERATELY LONGER THAN THE CSS, AND THE GAP WAS
 * MEASURED RATHER THAN GUESSED. `setLeaving(true)` and `setTimeout` start in the
 * same tick, but the transition cannot begin until React has committed the new
 * transform — a frame or two later — so a timer equal to `SHEET_MS` fires while
 * the sheet is still travelling. Measured frame by frame: the sheet was at
 * top 637 of 812 when it disappeared, i.e. it popped out of existence about 80%
 * of the way down. 40ms covers the commit with headroom to spare.
 *
 * ⚠️ Erring the other way is the safe direction here: a few idle ms of an
 * already-invisible sheet costs nothing, while too short is a visible glitch.
 */
const SHEET_EXIT_MS = SHEET_MS + 40;

export function MobileSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // The sheet exists only while open, so the enter is simply "one frame after
  // mount" — see `useEnterTransition` for why that has to cross a paint.
  const entered = useEnterTransition(true);
  const [leaving, setLeaving] = useState(false);
  const shown = entered && !leaving;

  /**
   * ⚠️⚠️ THIS SHEET OWNS ITS EXIT, WHICH `useEnterTransition` DELIBERATELY DOES
   * NOT — and the difference is worth stating, because that hook's own doc warns
   * against exactly what looks like this. The task pane could not do it: it
   * derives ~15 values from a `task` that is null the instant it closes, so
   * holding the outgoing value meant reading a ref during render. A sheet has no
   * such problem — its `children` belong to the CALLER, which has not cleared
   * anything yet because `onClose` has not fired. So the animation runs first and
   * the caller unmounts after, with real data on screen the whole time.
   *
   * ⚠️ A bottom sheet earns an exit in a way a 110ms popover does not: it covers
   * half a phone screen, and half a screen disappearing between two frames reads
   * as a crash rather than a dismissal.
   */
  function requestClose() {
    if (leaving) return; // a second tap must not queue a second timer
    setLeaving(true);
    setTimeout(onClose, SHEET_EXIT_MS);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, leaving]);

  // z-[60]/[70] is the shared "raised" layer — the same rank `Modal` uses for a
  // popup opened from inside the task drawer, which is itself 40/50. A sheet can
  // be opened from the drawer (Phase 3's add-time), so it has to outrank it.
  return createPortal(
    <>
      {/* ⚠️ The backdrop fades WITH the sheet on the same curve — a backdrop that
          snaps while the panel travels is the thing that reads as a glitch (the
          task pane's note says the same). `pointer-events` drop the moment it
          starts leaving, or a closing sheet swallows the next tap for 220ms. */}
      <div
        className="fixed inset-0 z-[60] bg-black/40"
        style={{
          opacity: shown ? 1 : 0,
          transition: `opacity ${SHEET_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          pointerEvents: shown ? "auto" : "none",
        }}
        onClick={requestClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl"
        // ⚠️ `transform`, never `bottom` or `height`: this sheet hosts the
        // log-time form and a day's entry list, so a layout-property slide would
        // re-flow all of it every frame — the rule the whole motion block follows.
        style={{
          transform: shown ? "none" : "translateY(100%)",
          transition: `transform ${SHEET_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        }}
      >
        {/* The grabber is decoration, not a control — the sheet is dismissed by
            the backdrop, Escape, or finishing what it was opened for. Drawing a
            draggable-looking handle that isn't draggable would be a lie, so it
            is `aria-hidden` and deliberately small. */}
        <div className="flex justify-center pb-1 pt-2.5" aria-hidden>
          <span className="h-1 w-9 rounded-full bg-border-strong" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </div>
    </>,
    document.body,
  );
}
