"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Lightbulb, Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { Tip } from "@/components/advice-tip";
import type { Insight } from "./overview-insights";

/** &all (Nitsan, 2026-11-16: "too textual and boring"): a tone is an icon
 *  tile, not a coloured edge — read before a word of the card is. */
const TONE: Record<Insight["tone"], { tile: string; Icon: typeof TrendingUp }> = {
  good: { tile: "bg-success/10 text-success", Icon: TrendingUp },
  bad: { tile: "bg-danger/10 text-danger", Icon: TrendingDown },
  neutral: { tile: "bg-brand-soft text-brand", Icon: Minus },
};

/**
 * Dismissed insights (Nitsan, 2026-11-16: "dismiss insights that I read or
 * feel not relevant anymore to clean it a bit"). Kept per browser — a viewer's
 * own tidying, not shared state. Keyed by id and a HASH of the title: the
 * title carries the figures, so when they change the insight is news again and
 * comes back — and no amount is written to storage. Read through
 * `useSyncExternalStore`, so a dismissed card never paints first and vanishes.
 */
const DISMISSED = "overview.insights.dismissed";
const EVENT = "insights:dismissed";
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const keyOf = (i: Insight) => `${i.id}|${hash(i.title)}`;
function subscribe(on: () => void) {
  window.addEventListener(EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener("storage", on);
  };
}
function readRaw(): string {
  try {
    return window.localStorage.getItem(DISMISSED) ?? "[]";
  } catch {
    return "[]";
  }
}
function parse(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeDismissed(keys: string[]) {
  try {
    window.localStorage.setItem(DISMISSED, JSON.stringify(keys.slice(-200)));
  } catch {
    /* not kept */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** A row of insight cards to scroll through, one finding per card. */
export function InsightsPanel({ insights: all, period }: { insights: Insight[]; period: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const dismissed = useMemo(() => parse(raw), [raw]);
  const [showAll, setShowAll] = useState(false);
  const goneKeys = useMemo(() => {
    const set = new Set(dismissed);
    return new Set(all.map(keyOf).filter((k) => set.has(k)));
  }, [all, dismissed]);
  const isGone = (i: Insight) => goneKeys.has(keyOf(i));
  const hiddenCount = goneKeys.size;
  const insights = showAll ? all : all.filter((i) => !isGone(i));
  const dismiss = (i: Insight) => writeDismissed([...dismissed.filter((k) => k !== keyOf(i)), keyOf(i)]);
  const restore = (i: Insight) => writeDismissed(dismissed.filter((k) => k !== keyOf(i)));
  if (!all.length) return null;
  const page = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * (scroller.current.clientWidth * 0.8), behavior: "smooth" });
  if (!insights.length)
    return (
      <p className="mt-4 text-xs text-faint">
        All {all.length} insights dismissed ·{" "}
        <button onClick={() => setShowAll(true)} className="text-brand hover:underline">
          show them
        </button>
      </p>
    );
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
          <Lightbulb size={13} />
          Insights · {period}
          <span className="normal-case tracking-normal text-faint/70">({insights.length})</span>
          {hiddenCount > 0 && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="ml-1 normal-case tracking-normal text-brand hover:underline"
            >
              {showAll ? "hide dismissed" : `show ${hiddenCount} dismissed`}
            </button>
          )}
        </h2>
        <div className="flex gap-1">
          <button onClick={() => page(-1)} title="Previous insights" className="flex size-7 items-center justify-center rounded-full bg-surface text-muted shadow-card hover:text-foreground">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => page(1)} title="More insights" className="flex size-7 items-center justify-center rounded-full bg-surface text-muted shadow-card hover:text-foreground">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div ref={scroller} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {insights.map((i) => {
          const { tile, Icon } = TONE[i.tone];
          const gone = isGone(i);
          return (
            <article
              key={i.id}
              className={`group flex w-[264px] shrink-0 snap-start flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-card ${gone ? "opacity-50" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${tile}`}>
                  <Icon size={17} strokeWidth={2} />
                </span>
                <span className="text-[11px] uppercase tracking-wide text-muted">{i.tag}</span>
                <button
                  onClick={() => (gone ? restore(i) : dismiss(i))}
                  title={gone ? "Bring it back" : "Dismiss — read, or no longer relevant"}
                  aria-label={gone ? "Bring this insight back" : "Dismiss this insight"}
                  className="ml-auto flex size-6 items-center justify-center rounded-full text-faint opacity-0 transition-opacity hover:bg-background hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                >
                  {gone ? <span className="text-[11px]">↺</span> : <X size={14} />}
                </button>
              </div>
              <h3 className="text-base font-medium leading-snug">{i.title}</h3>
              {/* three lines; the whole of it on hover */}
              <Tip as="p" body={i.body} className="line-clamp-3 text-[13px] leading-snug text-muted">
                {i.body}
              </Tip>
            </article>
          );
        })}
      </div>
    </section>
  );
}
