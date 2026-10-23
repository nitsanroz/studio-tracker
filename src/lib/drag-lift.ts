/**
 * "Lift + make room" (motion round 2, 2026-10-23): a card picked up off a board
 * rides under the pointer tilted and raised, and the place it left stays open
 * as a soft gap (`.drag-gap` in globals.css) until it lands.
 *
 * Call from a card's `onDragStart` with the event; it does its own cleanup on
 * `dragend`. Purely visual — the boards' own drop logic is untouched.
 *
 * The browser photographs the drag image during dragstart, so the tilted copy
 * only has to exist for that instant. ⚠️ It is placed EXACTLY OVER THE CARD,
 * not parked off-screen: Safari photographs an off-screen node as a blank, and
 * on the card's own spot the one frame it is visible reads as the lift itself.
 * It sits in a padded wrapper so the shadow is part of the picture rather than
 * cut off at the card's edge, and leaves on the next frame.
 */
import type { DragEvent } from "react";
import { prefersReducedMotion } from "./reduced-motion";

export function liftDrag(e: DragEvent<HTMLElement>) {
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();
  const pad = 24;

  if (!prefersReducedMotion()) {
    const wrap = document.createElement("div");
    wrap.style.cssText = `position:fixed;top:${rect.top - pad}px;left:${rect.left - pad}px;padding:${pad}px;pointer-events:none;z-index:100`;
    const copy = card.cloneNode(true) as HTMLElement;
    copy.classList.remove("drag-gap");
    copy.style.cssText = `width:${rect.width}px;margin:0;transform:rotate(2deg);background:var(--surface);border-radius:14px;box-shadow:0 14px 30px -10px rgba(6,17,47,.35),0 2px 6px rgba(6,17,47,.08)`;
    wrap.appendChild(copy);
    document.body.appendChild(wrap);
    e.dataTransfer.setDragImage(wrap, e.clientX - rect.left + pad, e.clientY - rect.top + pad);
    requestAnimationFrame(() => wrap.remove());
  }

  // Next frame: hiding the source in the same tick would photograph the gap.
  // ⚠️ Not if the drag is already over — a flick, or a drag the browser
  // cancels at once, can end before that frame, and the gap would then stay.
  let ended = false;
  card.addEventListener(
    "dragend",
    () => {
      ended = true;
      card.classList.remove("drag-gap");
    },
    { once: true },
  );
  requestAnimationFrame(() => {
    if (!ended) card.classList.add("drag-gap");
  });
}
