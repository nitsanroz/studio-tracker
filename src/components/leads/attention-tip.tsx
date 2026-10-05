"use client";

// The attention tip: a short dark bubble floating above whatever needs doing —
// a card on the board, a tab on the lead page. × dismisses it; once the pointer
// moves off, it shrinks to a dot in the tip's colour, and hovering the dot
// opens the bubble again. Rules and wording: `src/lib/leads/nudges.ts`.
//
// ⚠️ THE BUBBLE IS PORTALLED AND `position: fixed`. The board's columns scroll
// (overflow), which would clip a bubble standing above the first card; fixed
// on <body> it floats free, follows scrolling, and hides when its anchor is
// scrolled out of its column.
//
// ⚠️ DISMISSALS ARE PER BROWSER (localStorage) AND PER SITUATION — the nudge's
// `key`. A new overdue date or a newer estimate is a new key, so it comes back.

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Nudge } from "@/lib/leads/nudges";

const STORE_KEY = "leads.tips.dismissed";
const listeners = new Set<() => void>();
let cache: Set<string> | null = null;

function read(): Set<string> {
  if (cache) return cache;
  try {
    cache = new Set(JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as string[]);
  } catch {
    cache = new Set();
  }
  return cache;
}
function dismiss(id: string) {
  const next = new Set(read());
  next.add(id);
  // Keep the newest 400: old situations never come back, so they are dead weight.
  cache = new Set([...next].slice(-400));
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...cache]));
  } catch {
    // private window — the dismissal lasts this visit
  }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const EMPTY = new Set<string>();

/** Nearest ancestors that clip (overflow other than visible), so a hidden anchor hides its bubble. */
function visibleIn(el: HTMLElement, r: DOMRect): boolean {
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) return false;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const b = p.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    if (r.top < b.top - 2 || r.top > b.bottom || cx < b.left || cx > b.right) return false;
  }
  return true;
}

export function AttentionTip({
  nudge,
  leadId,
  children,
  className = "",
  dot = "-right-1 -top-1",
  place = "above",
}: {
  nudge: Nudge | null | undefined;
  leadId: string;
  children: React.ReactNode;
  className?: string;
  /** Where the dot sits on the anchor (Tailwind position classes). */
  dot?: string;
  /**
   * "above" (a tab): the bubble points down at the anchor, and only a dismissed
   * tip leaves a dot. "dot" (a board card): the dot is always there, on the
   * card's edge, and the bubble points at the DOT — so the card above it is
   * barely covered and the tip reads as belonging to that one mark.
   */
  place?: "above" | "dot";
}) {
  const dismissed = useSyncExternalStore(subscribe, read, () => EMPTY);
  const id = nudge ? `${leadId}|${nudge.key}` : "";
  const gone = Boolean(nudge) && dismissed.has(id);
  /** Just dismissed, pointer still on the bubble: it stays until the pointer leaves. */
  const [lingering, setLingering] = useState(false);
  const [hover, setHover] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = Boolean(nudge) && (!gone || lingering || hover);
  const dotShown = Boolean(nudge) && (place === "dot" || (gone && !lingering));

  useLayoutEffect(() => {
    if (!show) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = place === "dot" ? dotRef.current : anchor.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (!visibleIn(el, r)) setPos(null);
        else setPos({ x: r.left + r.width / 2, y: r.top });
      });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    if (anchor.current) ro.observe(anchor.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      ro.disconnect();
    };
  }, [show, place]);

  // In "dot" mode the bubble starts just left of the dot so its arrow, ARROW_X
  // in, lands on the dot's centre; in "above" mode it is centred on the anchor.
  const ARROW_X = 14;
  // ⚠️ Light on the board, dark elsewhere: the board card's crown is navy, and a
  // dark bubble pointing at it merged into it. The page around a tab is white,
  // where the dark bubble is the one that stands out.
  const light = place === "dot";

  return (
    <span ref={anchor} className={`relative ${className}`}>
      {children}
      {dotShown && nudge && (
        <span
          ref={dotRef}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          aria-label={nudge.text}
          className={`absolute z-10 size-2.5 cursor-help rounded-full ring-2 ring-surface ${dot}`}
          style={{ backgroundColor: nudge.color }}
        />
      )}
      {show &&
        pos &&
        nudge &&
        createPortal(
          <div
            role="status"
            onMouseLeave={() => setLingering(false)}
            className={`pointer-events-auto fixed z-40 -translate-y-full pb-2 ${place === "above" ? "-translate-x-1/2" : ""}`}
            style={{ left: place === "dot" ? pos.x - ARROW_X : pos.x, top: pos.y - (place === "dot" ? 2 : 0) }}
          >
            <div
              className={`flex max-w-64 items-center gap-2 whitespace-nowrap rounded-lg py-1.5 pl-2.5 pr-1.5 text-[12px] font-medium shadow-lg ${
                light ? "border border-[#06112f]/20 bg-white text-[#06112f]" : "bg-[#1d1d1f] text-white"
              }`}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: nudge.color }} />
              <span className="bidi-auto truncate">{nudge.text}</span>
              {!gone ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setLingering(true);
                    dismiss(id);
                  }}
                  aria-label="Dismiss"
                  className={`rounded p-0.5 ${light ? "text-[#06112f]/45 hover:bg-[#06112f]/5 hover:text-[#06112f]" : "text-white/50 hover:bg-white/10 hover:text-white"}`}
                >
                  <X size={12} strokeWidth={2.25} />
                </button>
              ) : (
                <span className="w-0.5" />
              )}
            </div>
            <span
              className={`absolute bottom-[3px] size-2.5 -translate-x-1/2 rotate-45 ${
                light ? "border-b border-r border-[#06112f]/20 bg-white" : "bg-[#1d1d1f]"
              }`}
              style={{ left: place === "dot" ? ARROW_X : "50%" }}
            />
          </div>,
          document.body,
        )}
    </span>
  );
}
