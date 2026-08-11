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
 * ⚠️ Built on `matchMedia` and its `change` event, NOT a `resize` listener,
 * because the media query is the same source of truth as the `md:` classes and
 * so the two cannot disagree at the boundary.
 *
 * ⚠️ TESTING: the browser tool's `resize_window` dispatches NEITHER `resize` NOR
 * a `matchMedia` `change` event — `mq.matches` flips but nothing fires, so a
 * component gated on this hook keeps its old shape while the `md:` classes
 * around it have already switched. Measured directly (v1.12.1): an armed
 * `change` listener took 0 hits across a 375 → 1440 resize. **Reload after
 * resizing** before believing this hook is broken. (An earlier version of this
 * note claimed `matchMedia` fires there. It does not.)
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
