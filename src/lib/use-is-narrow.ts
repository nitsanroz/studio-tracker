"use client";

import { useEffect, useState } from "react";

/** Tailwind's `md`. Everything below this is "a phone" as far as this app cares. */
export const NARROW_MAX = 767;

/**
 * True on a phone-width screen.
 *
 * ⚠️ USE THIS SPARINGLY. Chrome that merely LOOKS different belongs in
 * `md:hidden` / `hidden md:block` — CSS has no hydration risk and no flash of the
 * wrong shape. This hook is for the cases where BEHAVIOUR differs and rendering
 * both would be wrong: gating the `colw.*` column widths, choosing a bottom
 * sheet over an anchored popover, and `DesktopOnly` (which must not mount a
 * 2,000-line Gantt just to hide it with CSS).
 *
 * ⚠️ Built on `matchMedia` and its `change` event, NOT a `resize` listener. Two
 * reasons: the media query is the same source of truth as the `md:` classes, so
 * the two can't disagree at the boundary; and the browser tool used to check
 * this app does not dispatch `resize` when it resizes the window, so a resize
 * listener LOOKS broken under test when it is fine (logged twice — v1.9.2 and
 * v1.9.5). `matchMedia` fires correctly there.
 *
 * ⚠️ It returns FALSE on the server and on the first client render, always.
 * A phone therefore paints the desktop shape for one frame. That is the safe
 * direction: guessing "narrow" would hide real content on a desktop for a frame,
 * and `DesktopOnly` would flash a "use a bigger screen" card at someone who is
 * already on one.
 */
export function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW_MAX}px)`);
    setNarrow(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
