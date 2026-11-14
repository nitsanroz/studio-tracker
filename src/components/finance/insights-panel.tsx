"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight, Lightbulb } from "lucide-react";
import type { Insight } from "./overview-insights";

const TONE: Record<Insight["tone"], string> = {
  good: "bg-success",
  bad: "bg-danger",
  neutral: "bg-brand",
};

/** A row of insight cards to scroll through, one finding per card. */
export function InsightsPanel({ insights, period }: { insights: Insight[]; period: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  if (!insights.length) return null;
  const page = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * (scroller.current.clientWidth * 0.8), behavior: "smooth" });
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
          <Lightbulb size={13} />
          Insights · {period}
          <span className="normal-case tracking-normal text-faint/70">({insights.length})</span>
        </h2>
        <div className="flex gap-1">
          <button onClick={() => page(-1)} title="Previous insights" className="rounded-md border border-border p-1 text-muted hover:bg-surface hover:text-foreground">
            <ChevronLeft size={14} />
          </button>
          <button onClick={() => page(1)} title="More insights" className="rounded-md border border-border p-1 text-muted hover:bg-surface hover:text-foreground">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      <div ref={scroller} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {insights.map((i) => (
          <article
            key={i.id}
            className="relative flex w-[280px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border border-border bg-surface p-3.5 pl-4"
          >
            <span className={`absolute inset-y-0 left-0 w-1 ${TONE[i.tone]}`} />
            <span className="mb-1.5 self-start rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
              {i.tag}
            </span>
            <h3 className="text-sm font-semibold leading-snug">{i.title}</h3>
            <p className="mt-1 text-[12.5px] leading-snug text-muted">{i.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
