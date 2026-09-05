"use client";

// The bars' hover card.
//
// Portalled and `fixed` for the reason that recurs throughout this view: the
// chart lives in a scroller that clips BOTH axes, so anything anchored inside a
// row is cut off on the first and last of them.

import { createPortal } from "react-dom";


/** Rough tooltip box, used only to decide which way it flips near an edge.
 *  Named apart from the section bar's TIP_W/TIP_H, which are its end points. */
export const TOOLTIP_W = 244;

/** Measured at its tallest — a typed task with a span, hours and the hint: 176. */
export const TOOLTIP_H = 180;


/**
 * The bars' tooltip, on the spot.
 *
 * These were `title` attributes, and the browser sits on one for about a second
 * before showing it — long enough that you give up and click the bar instead,
 * which is a write. It is `fixed` and portalled to `document.body` for the usual
 * reason in this file: the chart is in a scroller that clips BOTH axes, so
 * anything anchored inside a row is cut off on the first and last of them.
 *
 * It takes NODES, not a string. As five `\n`-joined lines everything in it —
 * the task's name, its type, its dates, its hours, and a line of instructions
 * that never changes — arrived at the same size, weight and colour, so there was
 * nothing to read first. See `TipRow` and the callers for the three bands.
 */
export function HoverTip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const left = Math.min(Math.max(8, x + 12), window.innerWidth - TOOLTIP_W - 8);
  const below = y + 18;
  const flip = below + TOOLTIP_H > window.innerHeight;
  return createPortal(
    <div
      role="tooltip"
      // `overflow-hidden`, and no padding of its own: the heading band is a
      // full-bleed tint that has to reach the rounded corners.
      className="pointer-events-none fixed z-[70] w-[244px] overflow-hidden rounded-xl border border-border bg-surface text-[11px] leading-normal shadow-xl"
      style={{ left, top: flip ? y - 12 : below, transform: flip ? "translateY(-100%)" : undefined }}
    >
      {children}
    </div>,
    document.body,
  );
}


/** Weak tint for the heading band — enough to read as the type's colour. */
export const TIP_TINT = "29";


/**
 * The heading band: what this is, on a wash of its own colour.
 *
 * The colour used to be a dot beside the type's name, which spent a line on
 * saying what the band now says by being that colour. Dividers went with it —
 * the tint already ends where the facts begin, so a rule on top of that was one
 * boundary drawn twice.
 */
export function TipHead({
  title,
  subtitle,
  color,
}: {
  title: string;
  subtitle?: string | null;
  color: string;
}) {
  return (
    // Tight: `py-1.5` and `leading-tight` on both lines. The band is an
    // identifier, not a paragraph — at py-2.5 with default leading it was
    // taller than the four fact rows underneath it put together.
    <div className="px-3 py-1.5" style={{ backgroundColor: `${color}${TIP_TINT}` }}>
      {/* 13/570 against the type's 11/380: two steps clear of it, and the same
          rule the section headers follow — +2px and the heavier of the two
          weights this type system has. */}
      <div className="text-[13px] font-semibold leading-tight text-foreground">{title}</div>
      {subtitle && <div className="leading-tight text-muted">{subtitle}</div>}
    </div>
  );
}


/** One fact: a faint label on the left, the value right-aligned against it. */
export function TipRow({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-faint">{label}</span>
      <span
        className={`truncate tabular-nums ${danger ? "font-semibold text-danger" : "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}
