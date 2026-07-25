"use client";

import { useId, useState } from "react";
import { formatHoursShort } from "@/lib/format";

/** Horizontal bar with a label row. Values in minutes. */
export function HBar({
  label,
  right,
  minutes,
  maxMinutes,
  barClass = "bg-brand",
}: {
  label: React.ReactNode;
  right?: React.ReactNode;
  minutes: number;
  maxMinutes: number;
  barClass?: string;
}) {
  const pct = maxMinutes > 0 ? Math.min(100, (minutes / maxMinutes) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">{label}</span>
        {right && <span className="shrink-0 tabular-nums text-muted">{right}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Stacked billable/non-billable bar. Values in minutes. */
export function SplitBar({
  billable,
  nonBillable,
  maxMinutes,
}: {
  billable: number;
  nonBillable: number;
  maxMinutes: number;
}) {
  const pctA = maxMinutes > 0 ? (billable / maxMinutes) * 100 : 0;
  const pctB = maxMinutes > 0 ? (nonBillable / maxMinutes) * 100 : 0;
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-border">
      <div className="h-full bg-brand" style={{ width: `${pctA}%` }} title="Billable" />
      <div className="h-full bg-gray-400" style={{ width: `${pctB}%` }} title="Non-billable" />
    </div>
  );
}

/**
 * Column chart with the hour amount shown above each bar (omitted when 0).
 * When a point carries `billable`, the bar splits into a stacked
 * billable (solid) + non-billable (weak) pair — used for admins.
 * Values in minutes.
 */
export function MiniColumnsLabeled({
  points,
}: {
  points: { label: string; minutes: number; billable?: number }[];
}) {
  const max = Math.max(...points.map((p) => p.minutes), 1);
  return (
    <div className="flex items-end gap-1">
      {points.map((p) => {
        const split = p.billable !== undefined;
        const billable = p.billable ?? 0;
        const nonBillable = Math.max(0, p.minutes - billable);
        const title = split
          ? `${p.label}: ${formatHoursShort(p.minutes)} — billable ${formatHoursShort(billable)}, non-billable ${formatHoursShort(nonBillable)}`
          : `${p.label}: ${formatHoursShort(p.minutes)}`;
        return (
          <div key={p.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            {/* pt-4 leaves room for the value label above the tallest bar */}
            <div className="flex h-20 w-full items-end pt-4">
              <div
                className="relative w-full"
                style={{ height: `${Math.max(2, (p.minutes / max) * 100)}%` }}
                title={title}
              >
                {p.minutes > 0 &&
                  (!split && p.minutes / max >= 0.4 ? (
                    // tall solid bar: value sits inside the bar top (Figma round-trip)
                    <span className="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold tabular-nums text-white">
                      {formatHoursShort(p.minutes)}
                    </span>
                  ) : (
                    <span
                      className={`absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] tabular-nums ${
                        split ? "text-muted" : "font-semibold text-brand-dark"
                      }`}
                    >
                      {formatHoursShort(p.minutes)}
                    </span>
                  ))}
                <div className="flex h-full w-full flex-col justify-end overflow-hidden rounded-t">
                  {split ? (
                    <>
                      <div
                        className="w-full bg-brand/30"
                        style={{ height: `${p.minutes > 0 ? (nonBillable / p.minutes) * 100 : 0}%` }}
                      />
                      <div
                        className="w-full bg-brand"
                        style={{ height: `${p.minutes > 0 ? (billable / p.minutes) * 100 : 0}%` }}
                      />
                    </>
                  ) : (
                    <div className="h-full w-full rounded-t bg-brand" />
                  )}
                </div>
              </div>
            </div>
            <span className="truncate text-[9px] text-faint">{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Interactive donut: client legend with percentages on the LEFT, donut on the RIGHT.
 * Hours are hidden by default — only revealed in the hover tooltip. Hovering a slice
 * (or its legend row) enlarges the slice and shows a name + hours tooltip. Values in minutes.
 */
export function PieChart({
  slices,
}: {
  slices: { label: string; minutes: number; color: string }[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.minutes, 0);
  if (total <= 0) return null;

  const CX = 21;
  const CY = 21;
  const RO = 17.5; // outer radius
  const RI = 10.5; // inner radius (donut hole)
  const HOVER_RO = 19.2; // enlarged outer radius on hover
  const SIZE = 150; // rendered px
  const scale = SIZE / 42;

  const ang = (p: number) => -Math.PI / 2 + (p / 100) * 2 * Math.PI;
  const px = (p: number, radius: number) => ({
    x: (CX + radius * Math.cos(ang(p))) * scale,
    y: (CY + radius * Math.sin(ang(p))) * scale,
  });
  const arc = (p0: number, p1: number, ro: number, ri: number) => {
    const a0 = ang(p0);
    const a1 = ang(p1);
    const large = p1 - p0 > 50 ? 1 : 0;
    return [
      `M ${CX + ro * Math.cos(a0)} ${CY + ro * Math.sin(a0)}`,
      `A ${ro} ${ro} 0 ${large} 1 ${CX + ro * Math.cos(a1)} ${CY + ro * Math.sin(a1)}`,
      `L ${CX + ri * Math.cos(a1)} ${CY + ri * Math.sin(a1)}`,
      `A ${ri} ${ri} 0 ${large} 0 ${CX + ri * Math.cos(a0)} ${CY + ri * Math.sin(a0)}`,
      "Z",
    ].join(" ");
  };

  let acc = 0;
  const segs = slices
    .filter((s) => s.minutes > 0)
    .map((s, i) => {
      const pct = (s.minutes / total) * 100;
      const seg = { ...s, i, pct, start: acc, mid: acc + pct / 2 };
      acc += pct;
      return seg;
    });
  const single = segs.length === 1;
  // draw the hovered slice last so its enlarged edge sits above neighbours
  const drawOrder = hover == null ? segs : [...segs.filter((s) => s.i !== hover), segs[hover]];
  const tip = hover != null && segs[hover] ? px(segs[hover].mid, HOVER_RO) : null;

  return (
    <div className="flex items-center gap-4">
      {/* legend — left */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {segs.map((s) => (
          <div
            key={s.i}
            onMouseEnter={() => setHover(s.i)}
            onMouseLeave={() => setHover(null)}
            className={`flex cursor-default items-center justify-between gap-2 rounded px-1 py-0.5 text-xs transition-colors ${
              hover === s.i ? "bg-background" : ""
            }`}
          >
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="bidi-auto truncate">{s.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted">{s.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>

      {/* donut — right */}
      <div
        className="relative shrink-0"
        style={{ width: SIZE, height: SIZE }}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox="0 0 42 42" width={SIZE} height={SIZE} role="img" aria-label="Hours by client">
          {single ? (
            <circle
              cx={CX}
              cy={CY}
              r={(RO + RI) / 2}
              fill="none"
              stroke={segs[0].color}
              strokeWidth={(hover === segs[0].i ? HOVER_RO : RO) - RI}
              onMouseEnter={() => setHover(segs[0].i)}
            />
          ) : (
            drawOrder.map((s) => (
              <path
                key={s.i}
                d={arc(s.start, s.start + s.pct, hover === s.i ? HOVER_RO : RO, RI)}
                fill={s.color}
                stroke="var(--color-surface)"
                strokeWidth={0.7}
                style={{ cursor: "default" }}
                onMouseEnter={() => setHover(s.i)}
              />
            ))
          )}
          {segs
            .filter((s) => s.pct >= 9)
            .map((s) => {
              const a = ang(s.mid);
              return (
                <text
                  key={s.i}
                  x={CX + ((RO + RI) / 2) * Math.cos(a)}
                  y={CY + ((RO + RI) / 2) * Math.sin(a)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                  fontSize="2.8"
                  fontWeight="600"
                  style={{ pointerEvents: "none" }}
                >
                  {Math.round(s.pct)}%
                </text>
              );
            })}
        </svg>

        {tip && hover != null && segs[hover] && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[115%] whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-center shadow-lg"
            style={{ left: tip.x, top: tip.y }}
          >
            <div className="bidi-auto text-xs font-medium">{segs[hover].label}</div>
            <div className="text-sm font-bold tabular-nums text-brand-dark">
              {formatHoursShort(segs[hover].minutes)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Single-value progress ring (donut gauge). `pct` 0–100, drawn clockwise from
 * the top over a faint track, with the rounded percentage in the centre.
 * Used for the studio billable-share on the admin home.
 */
export function PercentRing({
  pct,
  size = 88,
  label,
}: {
  pct: number;
  size?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const R = 15.915; // 2πR ≈ 100 → dash values read directly as percentages
  return (
    <svg viewBox="0 0 42 42" width={size} height={size} role="img" aria-label={label ?? `${Math.round(clamped)}%`}>
      <circle cx="21" cy="21" r={R} fill="none" stroke="var(--color-border)" strokeWidth="3.5" />
      <circle
        cx="21"
        cy="21"
        r={R}
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={`${clamped} ${100 - clamped}`}
        strokeDashoffset="25" // start at 12 o'clock
      />
      {/* centre readout — figure in the serif accent, "%" smaller, like the big stats */}
      <text
        x="21"
        y="21"
        textAnchor="middle"
        dominantBaseline="central"
        className="font-serif-accent"
        fill="var(--color-foreground)"
      >
        <tspan fontSize="12">{Math.round(clamped)}</tspan>
        <tspan fontSize="6" fill="var(--color-faint)">%</tspan>
      </text>
    </svg>
  );
}

/**
 * Line chart. Values in minutes. A small circle marks each point with its value
 * label above it; when points are too dense to label cleanly, the value shows on
 * hover only. Used for "hours per month".
 */
export function LineChart({ points }: { points: { label: string; minutes: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.minutes), 1);
  const W = 280;
  const H = 104;
  const padX = 16;
  const padTop = 20;
  const padBottom = 18;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;
  const n = points.length;
  const x = (i: number) => (n === 1 ? W / 2 : padX + (i / (n - 1)) * innerW);
  const y = (m: number) => padTop + innerH - (m / max) * innerH;
  const alwaysLabel = n <= 6; // enough room to show every value; else hover-only

  const linePts = points.map((p, i) => `${x(i)},${y(p.minutes)}`).join(" ");
  const brand = "var(--color-brand)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Hours per month">
      <polyline
        points={linePts}
        fill="none"
        style={{ stroke: brand }}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <g key={`${p.label}-${i}`}>
          <circle
            cx={x(i)}
            cy={y(p.minutes)}
            r={hover === i ? 4 : 3}
            style={{ fill: "var(--color-surface)", stroke: brand }}
            strokeWidth={2}
          />
          {(alwaysLabel || hover === i) && (
            <text
              x={x(i)}
              y={y(p.minutes) - 7}
              textAnchor="middle"
              fontSize={9}
              fontWeight={600}
              style={{ fill: "var(--color-foreground)" }}
            >
              {formatHoursShort(p.minutes)}
            </text>
          )}
          <text x={x(i)} y={H - 5} textAnchor="middle" fontSize={8} style={{ fill: "var(--color-faint)" }}>
            {p.label}
          </text>
          {/* invisible hover target spanning the column */}
          <rect
            x={x(i) - innerW / (2 * Math.max(1, n - 1)) || 0}
            y={0}
            width={n === 1 ? W : innerW / Math.max(1, n - 1)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        </g>
      ))}
    </svg>
  );
}

/**
 * Multi-series line chart — one colored line per series (e.g. per client) over
 * shared x-axis buckets. Hovering a point shows a tooltip with the series name +
 * hours; hovering dims the other lines. Values in minutes. A color legend renders
 * below. Used for the admin "hours by client over time" overview.
 */
/** Catmull-Rom → cubic-bezier smoothing for a soft line (reference: Sales Report). */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length < 3) return "M" + pts.map((p) => `${p.x},${p.y}`).join(" L");
  const t = 0.16;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

export function MultiLineChart({
  labels,
  series,
  totalLabel,
}: {
  labels: string[];
  series: { label: string; color: string; values: number[] }[];
  /** caption under the big total, e.g. "this month" */
  totalLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  if (!series.length || !labels.length) return null;

  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const n = labels.length;
  const W = 340;
  const H = 190;
  const padL = 34;
  const padR = 10;
  const padTop = 12;
  const padBottom = 26;
  const innerW = W - padL - padR;
  const innerH = H - padTop - padBottom;
  const x = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const y = (v: number) => padTop + innerH - (v / max) * innerH;
  const step = Math.max(1, Math.ceil(n / 6));
  const baseline = padTop + innerH;

  // headline: total hours in view + trend of the last bucket vs the one before
  const total = series.reduce((s, ser) => s + ser.values.reduce((a, b) => a + b, 0), 0);
  const lastSum = series.reduce((s, ser) => s + (ser.values.at(-1) ?? 0), 0);
  const prevSum = n > 1 ? series.reduce((s, ser) => s + (ser.values.at(-2) ?? 0), 0) : 0;
  const trend = prevSum > 0 ? Math.round(((lastSum - prevSum) / prevSum) * 100) : null;

  // tooltip rows: every series with hours at the hovered bucket, biggest first
  const rows =
    hover == null
      ? []
      : series
          .map((s) => {
            const v = s.values[hover] ?? 0;
            const prev = hover > 0 ? (s.values[hover - 1] ?? 0) : null;
            const delta = prev && prev > 0 ? Math.round(((v - prev) / prev) * 100) : null;
            return { label: s.label, color: s.color, v, delta };
          })
          .filter((r) => r.v > 0)
          .sort((a, b) => b.v - a.v)
          .slice(0, 6);

  const tipLeft = hover == null ? 0 : (x(hover) / W) * 100;
  const flip = tipLeft > 55; // keep the card inside the pane

  return (
    <div>
      {/* headline + legend */}
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-serif-accent text-[26px] leading-none">{formatHoursShort(total)}</span>
            {trend != null && (
              <span
                title={`Last ${labels.at(-1)} vs ${labels.at(-2)}`}
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  trend >= 0 ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                }`}
              >
                {trend >= 0 ? "↗" : "↘"} {trend >= 0 ? "+" : ""}
                {trend}%
              </span>
            )}
          </div>
          {totalLabel && <div className="mt-0.5 text-[11px] text-muted">{totalLabel}</div>}
        </div>
        <div className="flex max-w-[62%] flex-wrap justify-end gap-x-3 gap-y-1">
          {series.map((s, si) => (
            <span key={si} className="flex items-center gap-1.5 text-[10px] text-muted">
              <span className="h-[2.5px] w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="bidi-auto max-w-20 truncate">{s.label}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Hours by client over time">
          <defs>
            {series.map((s, si) => (
              <linearGradient key={si} id={`g${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          {/* dashed gridlines + y labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((g, gi) => {
            const gy = padTop + innerH * g;
            return (
              <g key={gi}>
                <line
                  x1={padL}
                  y1={gy}
                  x2={W - padR}
                  y2={gy}
                  style={{ stroke: "var(--color-border)" }}
                  strokeWidth={0.6}
                  strokeDasharray="3 3"
                />
                <text x={padL - 6} y={gy + 2.5} textAnchor="end" fontSize={7} style={{ fill: "var(--color-faint)" }}>
                  {formatHoursShort(max * (1 - g))}
                </text>
              </g>
            );
          })}

          {/* dashed crosshair */}
          {hover != null && (
            <line
              x1={x(hover)}
              y1={padTop}
              x2={x(hover)}
              y2={baseline}
              style={{ stroke: "var(--color-border-strong)" }}
              strokeWidth={0.8}
              strokeDasharray="3 3"
            />
          )}

          {/* area + line per series */}
          {series.map((s, si) => {
            const pts = s.values.map((v, i) => ({ x: x(i), y: y(v) }));
            const line = smoothPath(pts);
            return (
              <g key={si}>
                <path
                  d={`${line} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z`}
                  fill={`url(#g${uid}-${si})`}
                  opacity={hover == null ? 0.75 : 0.35}
                />
                <path
                  d={line}
                  fill="none"
                  style={{ stroke: s.color }}
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            );
          })}

          {/* dots on the hovered bucket */}
          {hover != null &&
            series.map((s, si) => {
              const v = s.values[hover] ?? 0;
              if (v <= 0) return null;
              return (
                <circle
                  key={si}
                  cx={x(hover)}
                  cy={y(v)}
                  r={3.2}
                  style={{ fill: s.color, stroke: "var(--color-surface)" }}
                  strokeWidth={1.5}
                />
              );
            })}

          {/* full-height hit bands, one per bucket */}
          {labels.map((_, i) => (
            <rect
              key={i}
              x={i === 0 ? padL : (x(i - 1) + x(i)) / 2}
              y={padTop}
              width={
                n === 1
                  ? innerW
                  : (i === n - 1 ? W - padR : (x(i) + x(i + 1)) / 2) - (i === 0 ? padL : (x(i - 1) + x(i)) / 2)
              }
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}

          {/* x labels */}
          {labels.map((l, i) => {
            const on = hover === i;
            return i % step === 0 || on ? (
              <text
                key={i}
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                fontSize={7.5}
                fontWeight={on ? 700 : 400}
                style={{ fill: on ? "var(--color-foreground)" : "var(--color-faint)" }}
              >
                {l}
              </text>
            ) : null;
          })}
        </svg>

        {/* tooltip card */}
        {hover != null && rows.length > 0 && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[132px] rounded-xl border border-border bg-surface p-2.5 shadow-card"
            style={{
              left: `${tipLeft}%`,
              transform: flip ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
            }}
          >
            <div className="mb-1.5 text-[11px] font-semibold">{labels[hover]}</div>
            <div className="flex flex-col gap-1.5">
              {rows.map((r) => (
                <div key={r.label} className="flex items-center gap-2">
                  <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="bidi-auto max-w-24 truncate text-[10px] text-muted">{r.label}</div>
                    <div className="text-[11px] font-semibold tabular-nums">{formatHoursShort(r.v)}</div>
                  </div>
                  {r.delta != null && (
                    <span
                      className={`shrink-0 text-[10px] font-semibold tabular-nums ${
                        r.delta >= 0 ? "text-success" : "text-danger"
                      }`}
                    >
                      {r.delta >= 0 ? "+" : ""}
                      {r.delta}%
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Small column chart. Values in minutes.
 * Each bar shows its value — inside the bar (white, upper part) when the bar
 * is tall enough, otherwise just above it.
 */
export function MiniColumns({ points }: { points: { label: string; minutes: number }[] }) {
  const max = Math.max(...points.map((p) => p.minutes), 1);
  return (
    <div className="flex items-end gap-1">
      {points.map((p) => {
        const pct = Math.max(2, (p.minutes / max) * 100);
        const inside = pct >= 45;
        return (
          <div key={p.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex h-20 w-full items-end pt-3.5">
              <div
                className="relative w-full rounded-t bg-brand/80 hover:bg-brand"
                style={{ height: `${pct}%` }}
                title={`${p.label}: ${formatHoursShort(p.minutes)}`}
              >
                {p.minutes > 0 && (
                  <span
                    className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium tabular-nums ${
                      inside ? "top-0.5 text-white" : "-top-3.5 text-muted"
                    }`}
                  >
                    {formatHoursShort(p.minutes)}
                  </span>
                )}
              </div>
            </div>
            <span className="truncate text-[9px] text-faint">{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}
