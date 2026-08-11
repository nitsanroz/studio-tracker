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

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function MobileSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // z-[60]/[70] is the shared "raised" layer — the same rank `Modal` uses for a
  // popup opened from inside the task drawer, which is itself 40/50. A sheet can
  // be opened from the drawer (Phase 3's add-time), so it has to outrank it.
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-xl"
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
