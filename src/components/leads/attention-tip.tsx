"use client";

// The attention tip: a short dark bubble floating above whatever needs doing
// — a tab on the lead page (board cards say it in their own line since
// 2026-10-23). × dismisses it; once the pointer moves off, it shrinks to a dot
// in the tip's colour, and hovering the dot opens the bubble again. Rules and
// wording: `src/lib/leads/nudges.ts`.
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
}: {
  nudge: Nudge | null | undefined;
  leadId: string;
  children: React.ReactNode;
  className?: string;
  /** Where a dismissed tip's dot sits on the anchor (Tailwind position classes). */
  dot?: string;
}) {
  const dismissed = useSyncExternalStore(subscribe, read, () => EMPTY);
  const id = nudge ? `${leadId}|${nudge.key}` : "";
  const gone = Boolean(nudge) && dismissed.has(id);
  /** Just dismissed, pointer still on the bubble: it stays until the pointer leaves. */
  const [lingering, setLingering] = useState(false);
  const [hover, setHover] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = Boolean(nudge) && (!gone || lingering || hover);
  const dotShown = Boolean(nudge) && gone && !lingering;

  useLayoutEffect(() => {
    if (!show) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = anchor.current;
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
  }, [show]);

  return (
    <span ref={anchor} className={`relative ${className}`}>
      {children}
      {dotShown && nudge && (
        <span
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
            className="pointer-events-auto fixed z-40 -translate-x-1/2 -translate-y-full pb-2"
            style={{ left: pos.x, top: pos.y }}
          >
            <div
              className="flex max-w-64 items-center gap-2 whitespace-nowrap rounded-lg bg-[#1d1d1f] py-1.5 pl-2.5 pr-1.5 text-[12px] font-medium text-white shadow-lg"
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
                  className="rounded p-0.5 text-white/50 hover:bg-white/10 hover:text-white"
                >
                  <X size={12} strokeWidth={2.25} />
                </button>
              ) : (
                <span className="w-0.5" />
              )}
            </div>
            <span className="absolute bottom-[3px] left-1/2 size-2.5 -translate-x-1/2 rotate-45 bg-[#1d1d1f]" />
          </div>,
          document.body,
        )}
    </span>
  );
}
