"use client";

// Edit on one side, see the result on the other (Nitsan, 2026-11-11). On a wide
// screen the results pane is sticky; a grip in the gap between the columns —
// centred in the screen, always visible — drags its width, and the pane folds
// to a thin rail. Width and fold are kept per browser. On a phone it's simply
// the next block down.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useT } from "@/components/finance/scenarios/lang";

const W_KEY = "scenarios.pane.w";
const F_KEY = "scenarios.pane.folded";
const MIN = 380;
const MAX = 960;

export function usePane() {
  const [width, setWidth] = useState(520);
  const [folded, setFolded] = useState(false);
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem(W_KEY));
      if (w >= MIN && w <= MAX) setWidth(w);
      setFolded(localStorage.getItem(F_KEY) === "1");
    } catch {
      /* defaults */
    }
  }, []);
  const keep = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* not kept */
    }
  };
  return {
    width,
    folded,
    setWidth: (w: number) => {
      const c = Math.round(Math.min(MAX, Math.max(MIN, w)));
      setWidth(c);
      keep(W_KEY, String(c));
    },
    setFolded: (f: boolean) => {
      setFolded(f);
      keep(F_KEY, f ? "1" : "0");
    },
  };
}

export function SplitLayout({ left, right, railSummary, pane }: { left: ReactNode; right: ReactNode; railSummary: ReactNode; pane: ReturnType<typeof usePane> }) {
  const { t, lang } = useT();
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x;
      // Towards the content widens the pane (the content is on the other side in Hebrew).
      pane.setWidth(drag.current.w + (lang === "he" ? dx : -dx));
    };
    const up = () => {
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging, lang, pane]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-0">
      <div className="min-w-0 flex-1">{left}</div>

      {pane.folded ? (
        <aside className="hidden lg:sticky lg:top-4 lg:ms-4 lg:flex lg:w-14 lg:shrink-0 lg:flex-col lg:items-center lg:gap-3 lg:rounded-3xl lg:bg-surface lg:py-4 lg:shadow-card">
          <button
            onClick={() => pane.setFolded(false)}
            title={t("Show the results")}
            aria-label={t("Show the results")}
            aria-expanded={false}
            className="flex size-10 items-center justify-center rounded-full bg-brand text-white shadow-card hover:bg-brand-dark"
          >
            <PanelRightOpen size={20} strokeWidth={1.9} className="rtl:-scale-x-100" />
          </button>
          <div className="text-[14px] font-medium text-brand [writing-mode:vertical-rl]">{railSummary}</div>
        </aside>
      ) : (
        <>
          {/* The grip, in the gap between the columns, centred in the screen. */}
          <div className="group/grip hidden lg:sticky lg:top-4 lg:flex lg:h-[calc(100vh-2rem)] lg:w-5 lg:shrink-0 lg:items-center lg:justify-center">
            <button
              type="button"
              role="separator"
              aria-orientation="vertical"
              aria-label={t("Drag to resize")}
              onMouseDown={(e) => {
                drag.current = { x: e.clientX, w: pane.width };
                setDragging(true);
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 60 : 20;
                const wider = lang === "he" ? "ArrowRight" : "ArrowLeft";
                const narrower = lang === "he" ? "ArrowLeft" : "ArrowRight";
                if (e.key === wider) pane.setWidth(pane.width + step);
                if (e.key === narrower) pane.setWidth(pane.width - step);
              }}
              className={`relative flex h-20 w-4 cursor-col-resize items-center justify-center rounded-full transition-colors ${
                dragging ? "bg-brand text-white" : "bg-surface text-brand shadow-card ring-1 ring-border hover:bg-brand hover:text-white"
              }`}
            >
              <GripVertical size={16} />
              {/* The cue: what the grip does, on hover. */}
              <span className="pointer-events-none absolute top-full mt-2 whitespace-nowrap rounded-lg bg-foreground px-2 py-1 text-[13px] text-white opacity-0 shadow transition-opacity group-hover/grip:opacity-100">
                ⟷ {t("Drag to resize")}
              </span>
            </button>
          </div>
          <aside className="min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:shrink-0 lg:overflow-y-auto" style={{ ["--pane-w" as string]: `${pane.width}px` }}>
            <div className="lg:w-[var(--pane-w)]">{right}</div>
          </aside>
        </>
      )}
    </div>
  );
}

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** A count beside the label (tips waiting, decisions on). */
  badge?: number;
  tone?: "warning";
}

/** Tabs in a card's header strip — the offer page's Light White strip, the
 * active tab white with a brand-blue label. */
export function TabStrip<T extends string>({ value, tabs, onChange, end }: { value: T; tabs: TabDef<T>[]; onChange: (v: T) => void; end?: ReactNode }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto bg-[#e3e8f2] px-2 pt-2" role="tablist">
      {tabs.map((tab) => {
        const on = value === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-t-2xl px-4 pb-2.5 pt-2 text-[15px] font-medium transition-colors ${
              on ? "bg-surface font-semibold text-brand" : "text-[#4a5266] hover:bg-white/50 hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className={`rounded-full px-1.5 text-[12px] leading-5 ${tab.tone === "warning" ? "bg-amber-100 text-amber-800" : "bg-brand-soft text-brand"}`}>{tab.badge}</span>
            )}
          </button>
        );
      })}
      {end && <span className="ms-auto shrink-0 pb-1">{end}</span>}
    </div>
  );
}

/** A card whose top is a tab strip. */
export function TabbedCard<T extends string>({ value, tabs, onChange, end, children }: { value: T; tabs: TabDef<T>[]; onChange: (v: T) => void; end?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-[#dfe4ee]">
      <TabStrip value={value} tabs={tabs} onChange={onChange} end={end} />
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

/** The fold button, for the results pane's tab strip. */
export function FoldButton({ onFold }: { onFold: () => void }) {
  const { t } = useT();
  return (
    <button
      onClick={onFold}
      aria-expanded
      className="hidden shrink-0 items-center gap-2 rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-medium text-white shadow-card hover:bg-brand-dark lg:inline-flex"
    >
      <PanelRightClose size={16} strokeWidth={1.9} className="rtl:-scale-x-100" />
      {t("Hide results")}
    </button>
  );
}
