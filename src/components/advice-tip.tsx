"use client";

// &all's ONE hover box (2026-11-16). Born as the /advice page's (Nitsan,
// 2026-11-15: "a hover box wherever a figure, a definition or a part of a chart
// needs more explanation or a breakdown"); since the &all pass every info dot
// (`components/ui.tsx` InfoDot, finance's, Scenarios' `Hover`/`HoverTip`)
// renders this. A new hover explanation uses `Tip` / `InfoTip`.
//
// The box is `fixed` and portalled to <body>, and opens above its anchor when
// there is no room below — a box inside the page would be clipped by the first
// card or scroller around it (CLAUDE.md, "Anchored popovers"). Being outside
// the page, it inherits neither the page's direction nor its "Hide numbers"
// smudge, so the page hands both down through `TipScope`.

import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

export const TipScope = createContext<{ rtl: boolean; hold: boolean }>({ rtl: false, hold: false });

const GAP = 8;

function TipBox({ anchor, title, children }: { anchor: HTMLElement; title?: ReactNode; children: ReactNode }) {
  const { rtl, hold } = useContext(TipScope);
  const box = useRef<HTMLDivElement>(null);
  // Placed by hand, not through state: it is measured once, where it was drawn hidden.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const below = a.bottom + GAP;
    const fitsAbove = a.top - GAP - b.height > GAP;
    const top = below + b.height > window.innerHeight - GAP && fitsAbove ? a.top - GAP - b.height : below;
    const left = Math.min(Math.max(GAP, a.left + a.width / 2 - b.width / 2), window.innerWidth - b.width - GAP);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    el.style.visibility = "visible";
  }, [anchor]);
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      dir={rtl ? "rtl" : "ltr"}
      style={{ top: 0, left: 0, visibility: "hidden" }}
      // Everything a parent might have set on the anchor is set back: the box is prose.
      className={`pointer-events-none fixed z-[90] w-72 max-w-[calc(100vw-16px)] whitespace-normal rounded-2xl bg-surface p-3.5 text-start text-[13px] font-normal normal-case leading-5 tracking-normal text-muted shadow-[0_12px_32px_rgba(6,17,47,0.18)] ${hold ? "advice-hold" : ""}`}
    >
      {title && <p className="mb-1 text-[13px] font-medium text-foreground">{title}</p>}
      <div>{children}</div>
    </div>,
    document.body,
  );
}

type Tag = "span" | "div" | "p" | "li";

/**
 * Wraps what it explains: hovering it, focusing it, or a tap on a phone opens
 * the box. `mark` underlines a word in dots so a plain sentence shows it has
 * more to say; a figure or a chart's part needs no mark beyond the cursor.
 */
export function Tip({
  children,
  title,
  body,
  as = "span",
  className = "",
  style,
  mark = false,
  focusable = true,
  label,
}: {
  children: ReactNode;
  title?: ReactNode;
  body: ReactNode;
  as?: Tag;
  className?: string;
  style?: CSSProperties;
  mark?: boolean;
  /** false when it wraps a link or a button, which takes the focus itself */
  focusable?: boolean;
  /** read out for an icon-only trigger, e.g. the (i) */
  label?: string;
}) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const T = as as "span";
  return (
    <T
      ref={setEl}
      tabIndex={focusable ? 0 : undefined}
      role={label ? "button" : undefined}
      aria-label={label}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      // An icon trigger (`label`) keeps its click: inside a <label> the click
      // would otherwise go to the label's input, taking the focus and closing
      // the box before it could be read — on a phone, every time.
      onClick={
        label
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(true);
            }
          : undefined
      }
      style={style}
      className={`cursor-help outline-none ${mark ? "underline decoration-dotted decoration-1 underline-offset-4 [text-decoration-color:var(--faint)]" : ""} ${className}`}
    >
      {children}
      {open && el && (
        <TipBox anchor={el} title={title}>
          {body}
        </TipBox>
      )}
    </T>
  );
}

/** The (i) beside a heading — THE info dot of &all: `components/ui.tsx`
 *  `InfoDot`, finance's and Scenarios' `Hover` all render this. */
export function InfoTip({ title, children, size = 14, label }: { title?: ReactNode; children: ReactNode; size?: number; /** read out — pass it translated */ label?: string }) {
  return (
    <Tip
      title={title}
      body={children}
      label={label ?? (typeof title === "string" ? `About ${title}` : "More about this")}
      className="inline-flex shrink-0 items-center align-middle text-faint hover:text-foreground focus:text-foreground"
    >
      <Info size={size} strokeWidth={2} aria-hidden />
    </Tip>
  );
}

/** A breakdown inside a box: a name and its figure on each line. */
export function TipRows({ rows }: { rows: (readonly [ReactNode, ReactNode])[] }) {
  if (!rows.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {rows.map(([name, figure], i) => (
        <div key={i} className="flex items-baseline justify-between gap-4">
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span dir="ltr" className="shrink-0 tabular-nums text-foreground">
            {figure}
          </span>
        </div>
      ))}
    </div>
  );
}
