/**
 * A small burst in the studio's colours — the "Playful" feedback picked
 * 2026-10-23, kept for the moments worth it (a deal won). Bits fly out from
 * the element that confirmed it (the dialog's "Mark as won" button), or from
 * the top third of the screen when there is none.
 *
 * Plain DOM, removed after it plays; nothing waits for it, and reduced motion
 * skips it entirely.
 */
import { prefersReducedMotion } from "./reduced-motion";

const COLORS = ["#74f3ef", "#0b43ed", "#0f9d58", "#6181e8"];

export function celebrate(from?: Element | null) {
  if (typeof window === "undefined" || prefersReducedMotion()) return;
  const r = from?.getBoundingClientRect();
  const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
  const y = r ? r.top + r.height / 2 : window.innerHeight / 3;
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:0;height:0;pointer-events:none;z-index:100`;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
    const d = 60 + Math.random() * 40;
    const bit = document.createElement("span");
    bit.className = "burst-bit";
    bit.style.cssText = `position:absolute;left:0;top:0;width:8px;height:8px;border-radius:2px;background:${COLORS[i % COLORS.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d * 0.75}px`;
    host.appendChild(bit);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 900);
}
