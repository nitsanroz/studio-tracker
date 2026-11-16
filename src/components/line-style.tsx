"use client";

import { useId } from "react";
import { areaPath, smoothPath, type Pt } from "@/lib/smooth-line";

/**
 * ONE look for every line graph in the app (Nitsan, 2026-11-16, from a
 * reference picture: "gradient fill, fluid line, much cleaner — so all graphs
 * styles are similar across"). His choices, asked:
 *  · each chart keeps its OWN colour; the fill is that colour fading to clear;
 *  · no dots on the points — one dot where you hover;
 *  · only the main series is filled; a comparison (last year, grey) and a
 *    forecast (dashed) stay smooth lines with no fill;
 *  · the tiny sparklines get the same treatment.
 * Gridlines are faint, dashed and horizontal only.
 *
 * Use these inside an <svg>. A new line graph should be built from them rather
 * than drawing its own polyline.
 */

export const LINE_WIDTH = 2;

/** The main series: gradient fill under a smooth line. */
export function FilledLine({
  pts,
  baseY,
  color,
  width = LINE_WIDTH,
  fill = true,
  strength = 0.22,
  dashed = false,
  fixedWidth = false,
}: {
  pts: Pt[];
  fixedWidth?: boolean;
  /** the y of the axis the fill falls to */
  baseY: number;
  color: string;
  width?: number;
  fill?: boolean;
  /** opacity at the top of the fill */
  strength?: number;
  dashed?: boolean;
}) {
  const id = `lf${useId().replace(/:/g, "")}`;
  if (pts.length === 0) return null;
  return (
    <g>
      {fill && pts.length > 1 && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={strength} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath(pts, baseY)} fill={`url(#${id})`} stroke="none" pointerEvents="none" />
        </>
      )}
      <SmoothLine pts={pts} color={color} width={width} dashed={dashed} fixedWidth={fixedWidth} />
    </g>
  );
}

/** A line with no fill — last year (grey), a forecast (dashed), a second series. */
export function SmoothLine({
  pts,
  color,
  width = LINE_WIDTH,
  dashed = false,
  opacity,
  fixedWidth = false,
}: {
  pts: Pt[];
  color: string;
  width?: number;
  dashed?: boolean;
  opacity?: number;
  /** keep the stroke's width when the svg is stretched (sparklines) */
  fixedWidth?: boolean;
}) {
  if (pts.length < 2) return null;
  return (
    <path
      d={smoothPath(pts)}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeDasharray={dashed ? "4 3" : undefined}
      strokeLinejoin="round"
      strokeLinecap="round"
      opacity={opacity}
      pointerEvents="none"
      vectorEffect={fixedWidth ? "non-scaling-stroke" : undefined}
    />
  );
}

/** A faint dashed horizontal gridline. */
export function GridLine({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <line
      x1={x1}
      x2={x2}
      y1={y}
      y2={y}
      stroke="var(--border)"
      strokeWidth={0.75}
      strokeDasharray="3 4"
      pointerEvents="none"
    />
  );
}

/** The one dot a line shows — where the pointer is. */
export function HoverDot({ x, y, color, r = 3.5 }: { x: number; y: number; color: string; r?: number }) {
  return (
    <circle cx={x} cy={y} r={r} fill={color} stroke="var(--surface)" strokeWidth={1.5} pointerEvents="none" />
  );
}

/** The dashed vertical guide at the hovered point. */
export function HoverGuide({ x, y1, y2 }: { x: number; y1: number; y2: number }) {
  return (
    <line
      x1={x}
      x2={x}
      y1={y1}
      y2={y2}
      stroke="var(--border-strong)"
      strokeWidth={0.8}
      strokeDasharray="3 3"
      pointerEvents="none"
    />
  );
}

/**
 * A tiny trend under a figure (&advice's tiles) — the same fluid line and
 * gradient, stretched to its box. No axis, no hover: it is a shape, not a chart.
 */
export function Sparkline({ series, color, className = "mt-1 h-7 w-full" }: { series: number[]; color: string; className?: string }) {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const pts = series.map((v, i) => ({ x: (i / (series.length - 1)) * 100, y: 28 - ((v - min) / (max - min || 1)) * 24 }));
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} aria-hidden>
      <FilledLine pts={pts} baseY={30} color={color} fixedWidth />
    </svg>
  );
}
