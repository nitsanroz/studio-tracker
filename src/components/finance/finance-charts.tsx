"use client";

import { useEffect, useId, useState } from "react";
import { formatILS, formatILSShort, formatNum, formatPct, formatShortYear } from "@/lib/finance/format";
import { MONTH_SHORT } from "@/lib/finance/finance";
import { usePhone } from "@/lib/finance/use-phone";


/** On a phone a wide chart is squeezed far below its drawing size, and its
 * labels shrink with it. This keeps chart text readable there (years short,
 * "'26"); on a wider screen it changes nothing. The ref is a callback ref, so
 * a chart that first renders nothing and draws later is still measured. */
export function useChartText(vbW: number) {
  const phone = usePhone();
  const [el, setEl] = useState<SVGSVGElement | null>(null);
  // viewBox units per screen pixel on a phone; 0 everywhere else.
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!el || !phone) {
      setK(0);
      return;
    }
    const update = () => {
      const w = el.getBoundingClientRect().width;
      setK(w ? vbW / w : 0);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, vbW, phone]);
  const text = {
    mobile: phone,
    fs: (n: number) => (k ? Math.max(n, 11 * k) : n),
    year: (y: number | string) => (phone && /^\d{4}$/.test(String(y)) ? formatShortYear(y) : String(y)),
    /** An axis label's anchor: on a phone the first and last lean inward so
     * their larger text stays inside the chart. */
    anchor: (i: number, n: number) => (phone && i === 0 ? "start" : phone && i === n - 1 ? "end" : "middle"),
  };
  return [setEl, text] as const;
}

export interface LegendItem {
  label: string;
  color: string;
  /** box (default), a solid line, or a dashed line */
  mark?: "box" | "line" | "dash";
  opacity?: number;
}

/** A chart's legend as a row under it — it wraps on its own on a phone. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.mark === "line" || i.mark === "dash" ? (
            <span className={`w-5 border-t-2 ${i.mark === "dash" ? "border-dashed" : ""}`} style={{ borderColor: i.color }} />
          ) : (
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color, opacity: i.opacity }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** A chart's hover card, beside the hovered point (flipped left past the middle). */
export function ChartTip({ leftPct, topPct = 2, children }: { leftPct: number; topPct?: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[130px] rounded-xl border border-border bg-surface p-2.5 shadow-card"
      style={{ left: `${leftPct}%`, top: `${topPct}%`, transform: leftPct > 55 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}
    >
      {children}
    </div>
  );
}

export function TipRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="mt-1 flex items-baseline justify-between gap-3 text-[12px]">
      <span className="text-muted">{label}</span>
      <span className="font-semibold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

/** A monthly line chart's hover targets: one transparent band per point, the
 * full plot height, reaching halfway to each neighbour. */
function HoverBands({ n, x, W, padL, padR, padTop, innerW, innerH, onHover }: {
  n: number;
  x: (i: number) => number;
  W: number;
  padL: number;
  padR: number;
  padTop: number;
  innerW: number;
  innerH: number;
  onHover: (i: number | null) => void;
}) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <rect
          key={i}
          x={i === 0 ? padL : (x(i - 1) + x(i)) / 2}
          y={padTop}
          width={n === 1 ? innerW : (i === n - 1 ? W - padR : (x(i) + x(i + 1)) / 2) - (i === 0 ? padL : (x(i - 1) + x(i)) / 2)}
          height={innerH}
          fill="transparent"
          onMouseEnter={() => onHover(i)}
          onMouseLeave={() => onHover(null)}
        />
      ))}
    </>
  );
}

/** A monthly line chart's hover card, beside the hovered point (flipped left
 * past the middle). `minW` is the card's min-width class, if it has one. */
function LineTip({ leftPct, minW, children }: { leftPct: number; minW?: string; children: React.ReactNode }) {
  return (
    <div
      className={`pointer-events-none absolute top-2 z-10 ${minW ? `${minW} ` : ""}rounded-xl border border-border bg-surface p-2.5 shadow-card`}
      style={{ left: `${leftPct}%`, transform: leftPct > 55 ? "translateX(calc(-100% - 10px))" : "translateX(10px)" }}
    >
      {children}
    </div>
  );
}

/** Smooth Catmull-Rom-ish bezier through a point list — the studio tracker's
 * line-chart curve, reused so our trend lines read the same way. */
export function smoothPath(pts: { x: number; y: number }[]): string {
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

interface FinanceEvent {
  year: number;
  month: number | null;
  event: string;
  category: string | null;
  note: string | null;
}

// ── 10-year revenue (bars) + profit-margin (line) hero chart ─────────────────
// Custom SVG, in-brand, matching the app's chart style (see charts.tsx).
// Revenue on the left axis, margin % on the right; macro events annotated on top.

// A phone gets its own, narrower drawing — not the wide one squeezed — and
// no room for the event labels.
const TREND_DESK = { W: 960, H: 410, PAD: { l: 62, r: 52, t: 78, b: 24 } };
const TREND_PHONE = { W: 400, H: 290, PAD: { l: 66, r: 62, t: 24, b: 22 } };

/** Round a max up to a clean gridline value. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** A point on the trend chart. YearSummary satisfies this; `label` overrides the
 *  x-axis text (used for month names when a single year is selected). */
export interface TrendPoint {
  year: number;
  label?: string;
  revenue: number;
  margin: number;
  partial: boolean;
  /** The month in progress: revenue/margin are its projected full month,
   * `soFar` what's come in, `note` what the estimate stands on. */
  estimate?: { soFar: number; note: string };
}

/** The accountant's figure for a year, drawn as a ghost beside our own. */
export interface AccountantGhost {
  revenue: number;
  pretaxProfit: number;
  margin: number;
}

/** The accountant's colour wherever his figures sit beside ours. */
export const ACC_COLOR = "#e0701a";

export function TrendChart({
  summaries,
  events,
  accountant,
}: {
  summaries: TrendPoint[];
  events: FinanceEvent[];
  /** Per year; when given, an outlined bar and a dashed margin line show the
   * accountant's numbers over ours (only years he has a statement for). */
  accountant?: Map<number, AccountantGhost>;
}) {
  const phone = usePhone();
  const { W: VB_W, H: VB_H, PAD } = phone ? TREND_PHONE : TREND_DESK;
  const [chartRef, t] = useChartText(VB_W);
  const [hover, setHover] = useState<number | null>(null);
  const [eventHover, setEventHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  if (summaries.length === 0) return null;
  const shownEvents = phone ? [] : events;

  const plotW = VB_W - PAD.l - PAD.r;
  const plotH = VB_H - PAD.t - PAD.b;
  const n = summaries.length;
  const band = plotW / n;
  const barW = Math.min(band * 0.5, 72);

  const ghosts = summaries.map((s) => (accountant && s.label == null ? accountant.get(s.year) : undefined));
  const revMax = niceMax(Math.max(...summaries.map((s) => s.revenue), ...ghosts.map((g) => g?.revenue ?? 0)));
  const margins = [...summaries.map((s) => s.margin), ...ghosts.flatMap((g) => (g ? [g.margin] : []))];
  const marMinRaw = Math.min(0, ...margins);
  const marMaxRaw = Math.max(0, ...margins);
  const marPad = (marMaxRaw - marMinRaw) * 0.15 || 0.05;
  const marMin = marMinRaw - marPad;
  const marMax = marMaxRaw + marPad;

  const cx = (i: number) => PAD.l + band * i + band / 2;
  const yRev = (v: number) => PAD.t + plotH * (1 - v / revMax);
  const yMar = (m: number) => PAD.t + plotH * (1 - (m - marMin) / (marMax - marMin));

  // Revenue gridlines (0, ¼, ½, ¾, max).
  const revTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * revMax);
  // Margin ticks: 0 plus a couple of round values.
  const marTicks = Array.from(new Set([marMinRaw, 0, marMaxRaw])).sort((a, b) => a - b);

  // The margin line skips periods with no revenue yet (a margin of nothing);
  // the trailing in-progress ones are dashed.
  const marIdx = summaries.flatMap((s, i) => (s.revenue > 0 ? [i] : []));
  const marPts = marIdx.map((i) => ({ x: cx(i), y: yMar(summaries[i].margin) }));
  let solidEnd = marIdx.length;
  while (solidEnd > 1 && summaries[marIdx[solidEnd - 1]].partial) solidEnd--;
  const marSolid = smoothPath(marPts.slice(0, solidEnd));
  const marDashed = solidEnd < marPts.length ? smoothPath(marPts.slice(solidEnd - 1)) : "";
  const marLine = smoothPath(marPts);
  const marArea = marPts.length
    ? `${marLine} L${marPts[marPts.length - 1].x},${yMar(0)} L${marPts[0].x},${yMar(0)} Z`
    : "";

  // The accountant's margin line: dashed grey, through the years he has.
  const ghostPts = ghosts.flatMap((g, i) => (g ? [{ x: cx(i), y: yMar(g.margin) }] : []));
  const ghostLine = ghostPts.length > 1 ? smoothPath(ghostPts) : "";

  const eventsByYear = new Map<number, FinanceEvent[]>();
  for (const e of shownEvents) {
    const arr = eventsByYear.get(e.year) ?? [];
    arr.push(e);
    eventsByYear.set(e.year, arr);
  }
  // A year's first event is the one the chart names (the rest are "+N"), so the
  // order has to mean something: by month, then by name. The rows arrive in the
  // order of their ids, which are random — and before the merge, in whatever
  // order the database kept them (found comparing the two apps, 2026-11-15).
  for (const arr of eventsByYear.values()) arr.sort((a, b) => (a.month ?? 0) - (b.month ?? 0) || a.event.localeCompare(b.event));

  return (
    <div className="relative">
    <svg ref={chartRef} viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full" role="img"
      aria-label="Ten-year revenue and profit-margin trend">
      {/* zero / gridlines */}
      {revTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={VB_W - PAD.r} y1={yRev(v)} y2={yRev(v)}
            stroke="var(--border)" strokeWidth={1} />
          <text x={PAD.l - 8} y={yRev(v) + 3} textAnchor="end"
            fontSize={t.fs(11)} fill="var(--muted)">{formatILSShort(v)}</text>
        </g>
      ))}

      {/* margin axis ticks (right) */}
      {marTicks.map((m, i) => (
        <text key={i} x={VB_W - PAD.r + 8} y={yMar(m) + 3} textAnchor="start"
          fontSize={t.fs(11)} fill={m < 0 ? "var(--danger)" : "var(--muted)"}>
          {formatPct(m, m === 0 ? 0 : 1)}
        </text>
      ))}
      {/* margin zero baseline (emphasized) */}
      <line x1={PAD.l} x2={VB_W - PAD.r} y1={yMar(0)} y2={yMar(0)}
        stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="3 3" />

      {/* revenue bars */}
      {summaries.map((s, i) => {
        const y = yRev(s.revenue);
        const h = PAD.t + plotH - y;
        const soFarY = s.estimate ? yRev(s.estimate.soFar) : 0;
        return (
          <g key={s.year} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {/* the whole column is the hover target, not just the bar */}
            <rect x={PAD.l + band * i} y={PAD.t} width={band} height={plotH} fill="transparent" />
            {hover === i && (
              <line x1={cx(i)} x2={cx(i)} y1={PAD.t} y2={PAD.t + plotH} stroke="var(--border-strong)"
                strokeWidth={0.8} strokeDasharray="3 3" pointerEvents="none" />
            )}
            {(() => {
              const g = ghosts[i];
              const pw = Math.min(band * 0.36, 40);
              const ox = g ? cx(i) - pw - 1 : cx(i) - barW / 2;
              const ow = g ? pw : barW;
              return (
                <>
                  <rect
                    x={ox} y={y} width={ow} height={Math.max(0, h)} rx={3} pointerEvents="none"
                    fill={s.partial ? "var(--brand-soft)" : "var(--brand)"}
                    stroke={s.partial ? "var(--brand)" : "none"}
                    strokeWidth={s.partial ? 1.5 : 0}
                    strokeDasharray={s.partial ? "3 2" : undefined}
                  />
                  {g && (
                    <>
                      <rect x={cx(i) + 1} y={yRev(g.revenue)} width={pw}
                        height={Math.max(0, PAD.t + plotH - yRev(g.revenue))} rx={3} pointerEvents="none"
                        fill={ACC_COLOR} />
                      {!phone && (
                        <>
                          <text x={ox + pw / 2} y={y - 5} textAnchor="middle" fontSize={t.fs(9)}
                            fontWeight={600} fill="var(--brand)" pointerEvents="none">{formatILSShort(s.revenue)}</text>
                          <text x={cx(i) + 1 + pw / 2} y={yRev(g.revenue) - 5} textAnchor="middle" fontSize={t.fs(9)}
                            fontWeight={600} fill={ACC_COLOR} pointerEvents="none">{formatILSShort(g.revenue)}</text>
                        </>
                      )}
                    </>
                  )}
                </>
              );
            })()}
            {/* what has come in so far, solid inside the projected outline */}
            {s.estimate && (
              <rect x={cx(i) - barW / 2} y={soFarY} width={barW}
                height={Math.max(0, PAD.t + plotH - soFarY)} rx={3} fill="var(--brand)" pointerEvents="none" />
            )}
            {s.partial && s.revenue > 0 && !phone && (
              <text x={cx(i)} y={y - 6} textAnchor="middle" fontSize={t.fs(10)}
                fontWeight={600} fill="var(--brand)">{s.estimate ? "projected" : "partial"}</text>
            )}
            <text x={cx(i)} y={VB_H - PAD.b + 16} textAnchor="middle" fontSize={t.fs(11)}
              fill="var(--muted)" fontWeight={500}>{s.label ?? t.year(s.year)}</text>
          </g>
        );
      })}

      {/* margin: a smooth line, blue above zero and red below, over a soft fill
          to the zero line — haloed so it reads over the bars */}
      <defs>
        <clipPath id={`tc-up-${uid}`}><rect x={0} y={0} width={VB_W} height={yMar(0)} /></clipPath>
        <clipPath id={`tc-dn-${uid}`}><rect x={0} y={yMar(0)} width={VB_W} height={VB_H - yMar(0)} /></clipPath>
      </defs>
      <g pointerEvents="none">
        <path d={marSolid} fill="none" stroke="var(--surface)" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
        <path d={marDashed} fill="none" stroke="var(--surface)" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" />
        {([["up", "var(--brand)"], ["dn", "var(--danger)"]] as const).map(([side, color]) => (
          <g key={side} clipPath={`url(#tc-${side}-${uid})`}>
            <path d={marArea} fill={color} opacity={0.1} />
            <path d={marSolid} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={marDashed} fill="none" stroke={color} strokeWidth={2} strokeDasharray="4 3"
              strokeLinejoin="round" strokeLinecap="round" opacity={0.7} />
          </g>
        ))}
        {hover != null && marIdx.includes(hover) && (
          <circle cx={cx(hover)} cy={yMar(summaries[hover].margin)} r={3.5}
            fill={summaries[hover].margin < 0 ? "var(--danger)" : "var(--brand)"} stroke="var(--surface)" strokeWidth={1.5} />
        )}
      </g>

      {/* the accountant's margin: a dashed grey line with hollow markers */}
      {ghostPts.length > 0 && (
        <g pointerEvents="none">
          {ghostLine && <path d={ghostLine} fill="none" stroke="var(--surface)" strokeWidth={5} />}
          {ghostLine && <path d={ghostLine} fill="none" stroke={ACC_COLOR} strokeWidth={2} strokeDasharray="6 4" />}
          {ghostPts.map((p, k) => (
            <circle key={k} cx={p.x} cy={p.y} r={4} fill={ACC_COLOR} stroke="var(--surface)" strokeWidth={1.5} />
          ))}
        </g>
      )}

      {/* event annotations along the top */}
      {summaries.map((s, i) => {
        const evs = eventsByYear.get(s.year);
        if (!evs || evs.length === 0) return null;
        const label = evs[0].event + (evs.length > 1 ? ` +${evs.length - 1}` : "");
        const catColor =
          evs[0].category === "macro" ? "var(--danger)"
            : evs[0].category === "strategic" ? "var(--brand)" : "var(--success)";
        return (
          <g
            key={`ev-${s.year}`}
            onMouseEnter={() => setEventHover(i)}
            onMouseLeave={() => setEventHover(null)}
            style={{ cursor: "help" }}
          >
            <line x1={cx(i)} x2={cx(i)} y1={PAD.t - 6} y2={PAD.t + plotH}
              stroke={catColor} strokeWidth={1} strokeDasharray="2 3" opacity={0.35} />
            {/* fat invisible hit area so the line is hoverable */}
            <rect x={cx(i) - 6} y={PAD.t - 24} width={12} height={plotH + 24} fill="transparent" />
            <circle cx={cx(i)} cy={PAD.t - 10} r={3} fill={catColor} />
            <text x={cx(i)} y={PAD.t - 18} textAnchor="middle" fontSize={t.fs(9.5)}
              fill="var(--muted)">
              {label.length > 16 ? label.slice(0, 15) + "…" : label}
            </text>
          </g>
        );
      })}

      {/* event tooltip: what happened + its effect */}
      {eventHover != null &&
        (() => {
          const s = summaries[eventHover];
          const evs = eventsByYear.get(s.year) ?? [];
          if (evs.length === 0) return null;
          const lines = evs.flatMap((e) => {
            const out = [`${e.event} (${s.year})`];
            if (e.note) out.push(...(e.note.match(/.{1,52}(\s|$)/g) ?? [e.note]).map((t) => t.trim()));
            return out;
          });
          const w = Math.min(360, Math.max(...lines.map((l) => l.length)) * 5.8 + 20);
          const h = lines.length * 13 + 14;
          const x = Math.min(Math.max(cx(eventHover) - w / 2, PAD.l), VB_W - PAD.r - w);
          return (
            <g pointerEvents="none">
              <rect x={x} y={PAD.t} width={w} height={h} rx={6}
                fill="var(--surface)" stroke="var(--border-strong)" strokeWidth={1} />
              {lines.map((l, li) => (
                <text key={li} x={x + 10} y={PAD.t + 16 + li * 13} fontSize={t.fs(10)}
                  fontWeight={li === 0 ? 600 : 400}
                  fill={li === 0 ? "var(--foreground)" : "var(--muted)"}>
                  {l}
                </text>
              ))}
            </g>
          );
        })()}

    </svg>
    {hover != null && (() => {
      const s = summaries[hover];
      const name = s.label ?? String(s.year);
      const approx = s.estimate ? "≈" : "";
      return (
        <ChartTip leftPct={(cx(hover) / VB_W) * 100} topPct={(PAD.t / VB_H) * 100}>
          <div className="text-[11px] font-semibold">
            {name}
            {s.estimate ? <span className="ml-1 font-normal text-faint">· projected</span>
              : s.partial && <span className="ml-1 font-normal text-faint">· {s.revenue > 0 ? "partial" : "to come"}</span>}
          </div>
          {s.revenue > 0 && (
            <>
              <TipRow label="Revenue" value={`${approx}${formatILS(Math.round(s.revenue))}`} />
              <TipRow label="Profit" value={`${approx}${formatILS(Math.round(s.revenue * s.margin))}`}
                color={s.margin < 0 ? "var(--danger)" : undefined} />
              <TipRow label="Margin" value={`${approx}${formatPct(s.margin)}`}
                color={s.margin < 0 ? "var(--danger)" : "var(--brand)"} />
            </>
          )}
          {ghosts[hover] && (
            <div className="mt-1 border-t border-border pt-1">
              <div className="text-[10px] font-semibold text-faint">Per the accountant</div>
              <TipRow label="Revenue" value={formatILS(Math.round(ghosts[hover]!.revenue))} />
              <TipRow label="Pre-tax profit" value={formatILS(Math.round(ghosts[hover]!.pretaxProfit))}
                color={ghosts[hover]!.pretaxProfit < 0 ? "var(--danger)" : undefined} />
              <TipRow label="Margin" value={formatPct(ghosts[hover]!.margin)} />
            </div>
          )}
          {s.estimate && <div className="mt-1 text-[10px] text-faint">{s.estimate.note}</div>}
        </ChartTip>
      );
    })()}
    <ChartLegend
      items={[
        { label: "Revenue", color: "var(--brand)" },
        { label: "Margin above 0", color: "var(--brand)", mark: "line" },
        { label: "Margin below 0", color: "var(--danger)", mark: "line" },
        ...(ghostPts.length > 0
          ? [
              { label: "Accountant's revenue", color: ACC_COLOR },
              { label: "Accountant's margin", color: ACC_COLOR, mark: "dash" as const },
            ]
          : []),
      ]}
    />
    </div>
  );
}

// ── Cost structure: expense blocks as % of revenue, stacked per year ──────────

export interface CostYear {
  year: number | string;
  partial: boolean;
  /** Shares of the month in progress's projected revenue. */
  estimate?: boolean;
  /** fractions of revenue */
  salaries: number;
  freelance: number;
  rent: number;
  other: number;
}

const COST_SEGMENTS = [
  { key: "salaries", label: "Salaries", color: "var(--brand)" },
  { key: "freelance", label: "Freelance", color: "var(--aqua)" },
  { key: "rent", label: "Rent", color: "var(--warning)" },
  { key: "other", label: "Other", color: "var(--faint)" },
] as const;

// Drawn for a half-width card since 2026-11-15 (it was a row of its own at 960).
const COST_DESK = { W: 560, H: 250, pad: { l: 46, r: 12, t: 26, b: 28 } };
const COST_PHONE = { W: 400, H: 250, pad: { l: 48, r: 8, t: 22, b: 26 } };

export function CostStructureChart({ data }: { data: CostYear[] }) {
  const { W, H, pad } = usePhone() ? COST_PHONE : COST_DESK;
  const [chartRef, t] = useChartText(W);
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return null;

  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / data.length;
  const barW = Math.min(band * 0.55, 56);

  const totals = data.map((d) => d.salaries + d.freelance + d.rent + d.other);
  const yMax = Math.max(1.05, niceMax(Math.max(...totals)));
  const y = (v: number) => pad.t + plotH * (1 - v / yMax);
  const cx = (i: number) => pad.l + band * i + band / 2;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);

  return (
    <div>
    <svg ref={chartRef} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label="Cost structure as percent of revenue per year">
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)}
            stroke="var(--border)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize={t.fs(10)}
            fill="var(--muted)">{formatPct(v, 0)}</text>
        </g>
      ))}
      {/* 100%-of-revenue line: above it the year ran at a loss */}
      {1 <= yMax && (
        <line x1={pad.l} x2={W - pad.r} y1={y(1)} y2={y(1)}
          stroke="var(--danger)" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
      )}

      {data.map((d, i) => {
        let acc = 0;
        const total = totals[i];
        return (
          <g key={d.year}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            {COST_SEGMENTS.map((seg) => {
              const v = d[seg.key];
              const y0 = y(acc + v);
              const h = y(acc) - y0;
              acc += v;
              return (
                <rect key={seg.key} x={cx(i) - barW / 2} y={y0} width={barW}
                  height={Math.max(0, h)} fill={seg.color}
                  opacity={seg.key === "salaries" ? 1 : 0.75} />
              );
            })}
            {/* salaries % — the margin driver — always labeled */}
            <text x={cx(i)} y={y(total) - 5} textAnchor="middle" fontSize={t.fs(10)}
              fontWeight={600} fill="var(--brand)">
              {formatPct(d.salaries, 0)}
            </text>
            {/* a wide invisible hit area, so the whole column is hoverable */}
            <rect x={cx(i) - band / 2} y={pad.t} width={band} height={plotH} fill="transparent" />
            <text x={cx(i)} y={H - pad.b + 14} textAnchor="middle" fontSize={t.fs(11)}
              fill="var(--muted)" fontWeight={500}>
              {t.year(d.year)}{d.partial && !t.mobile ? (d.estimate ? "·est." : "·partial") : ""}
            </text>
          </g>
        );
      })}

    </svg>
    {/* What a column holds, in a card of the page's own — it was the browser's
        tooltip per segment plus a "Σ" swapped into the label (Nitsan, 2026-11-15). */}
    <div className="mt-1 min-h-[2.75rem] text-xs text-muted">
      {hover != null ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-medium text-foreground">
            {data[hover].year}
            {data[hover].estimate ? " (projected)" : data[hover].partial ? " (so far)" : ""}
          </span>
          {COST_SEGMENTS.map((seg) => (
            <span key={seg.key} className="inline-flex items-center gap-1">
              <span className="size-2 rounded-sm" style={{ background: seg.color }} />
              {seg.label} <span className="tabular-nums text-foreground">{formatPct(data[hover][seg.key], 0)}</span>
            </span>
          ))}
          <span>
            All costs <span className="tabular-nums font-medium text-foreground">{formatPct(totals[hover], 0)}</span> of revenue
          </span>
        </div>
      ) : (
        <span className="text-faint">Hover a column for its breakdown.</span>
      )}
    </div>
    <ChartLegend
      items={[
        ...COST_SEGMENTS.map((seg) => ({
          label: `${seg.label}${seg.key === "salaries" ? " % (labeled)" : ""}`,
          color: seg.color,
          opacity: seg.key === "salaries" ? 1 : 0.75,
        })),
        { label: "100% of revenue", color: "var(--danger)", mark: "dash" as const },
      ]}
    />
    </div>
  );
}

// ── Avg hourly rate trend per year ────────────────────────────────────────────

export interface RatePoint {
  year: number | string;
  rate: number;
  partial: boolean;
  /** An unfinished month's estimated rate — dashed, never the headline. */
  estimate?: boolean;
}

/** A quiet line of the average rate: the latest figure up top, each point's
 * rate on hover. */
export function RateTrendChart({ points }: { points: RatePoint[] }) {
  const W = 460;
  const [chartRef, t] = useChartText(W);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;

  const H = 190;
  const pad = { l: 14, r: 14, t: 14, b: 24 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / points.length;

  const rates = points.map((p) => p.rate);
  const rMin = Math.min(...rates) * 0.92;
  const rMax = Math.max(...rates) * 1.04;
  const cx = (i: number) => pad.l + band * i + band / 2;
  const y = (v: number) => pad.t + plotH * (1 - (v - rMin) / (rMax - rMin || 1));
  const pts = points.map((p, i) => ({ x: cx(i), y: y(p.rate) }));
  const firstEst = points.findIndex((p) => p.estimate);
  const solidEnd = firstEst === -1 ? pts.length : Math.max(1, firstEst);
  const lastIdx = solidEnd - 1;
  const shown = hover != null ? points[hover] : points[lastIdx];
  // A partial year still running is "so far"; the business's short first year is a "part year".
  const label = (p: RatePoint) =>
    `${p.year}${p.estimate ? " · estimated" : p.partial ? (typeof p.year === "number" && p.year < new Date().getFullYear() ? " · part year" : " · so far") : ""}`;

  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">₪{Math.round(shown.rate)}</span>
        <span className="text-xs text-muted">/h · {label(shown)}</span>
      </div>
      <svg ref={chartRef} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Average hourly rate"
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - box.left) / box.width) * W;
          setHover(Math.max(0, Math.min(points.length - 1, Math.floor((x - pad.l) / band))));
        }}
        onMouseLeave={() => setHover(null)}>
        <path d={smoothPath(pts.slice(0, solidEnd))} fill="none" stroke="var(--brand)" strokeWidth={2}
          strokeLinejoin="round" strokeLinecap="round" />
        {solidEnd < pts.length && (
          <path d={smoothPath(pts.slice(solidEnd - 1))} fill="none" stroke="var(--brand)" strokeWidth={2}
            strokeDasharray="3 2.5" opacity={0.55} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {hover != null && (
          <g>
            <line x1={pts[hover].x} x2={pts[hover].x} y1={pad.t} y2={H - pad.b} stroke="var(--border-strong)" strokeDasharray="3 3" />
            <circle cx={pts[hover].x} cy={pts[hover].y} r={4} fill="var(--surface)" stroke="var(--brand)" strokeWidth={2} />
          </g>
        )}
        {hover == null && (
          <circle cx={pts[lastIdx].x} cy={pts[lastIdx].y} r={3.5} fill="var(--brand)" />
        )}
        {points.map((p, i) => (
          <g key={String(p.year)}>
            <text x={cx(i)} y={H - pad.b + 15} textAnchor="middle" fontSize={t.fs(10)}
              fill={hover === i ? "var(--foreground)" : "var(--muted)"}>
              {typeof p.year === "number" ? formatShortYear(p.year) : p.year}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ── Utilization vs capacity (2023+, where capacity lines exist) ───────────────

export interface UtilizationPoint {
  year: number | string;
  partial: boolean;
  /** The month in progress, its hours projected to the month's end. */
  estimate?: boolean;
  hours: number;
  maxHours: number;
}

export function UtilizationChart({ points }: { points: UtilizationPoint[] }) {
  const W = 460;
  const [chartRef, t] = useChartText(W);
  if (points.length === 0) return null;

  const H = 210;
  const pad = { l: t.mobile ? 48 : 40, r: 14, t: 26, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / points.length;
  const barW = Math.min(band * 0.5, 48);

  const utils = points.map((p) => (p.maxHours > 0 ? p.hours / p.maxHours : 0));
  const yMax = Math.max(1.1, niceMax(Math.max(...utils)));
  const cx = (i: number) => pad.l + band * i + band / 2;
  const y = (v: number) => pad.t + plotH * (1 - v / yMax);

  return (
    <svg ref={chartRef} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label="Utilization versus capacity per year">
      {[0, 0.5, 1].map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)}
            stroke={v === 1 ? "var(--border-strong)" : "var(--border)"}
            strokeWidth={1} strokeDasharray={v === 1 ? "4 3" : undefined} />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize={t.fs(10)}
            fill="var(--muted)">{formatPct(v, 0)}</text>
        </g>
      ))}
      {points.map((p, i) => {
        const u = utils[i];
        const top = y(u);
        return (
          <g key={p.year}>
            <rect x={cx(i) - barW / 2} y={top} width={barW}
              height={Math.max(0, y(0) - top)} rx={3}
              fill={u > 1 ? "var(--danger)" : "var(--brand)"}
              opacity={p.partial ? 0.55 : 1}>
              <title>{`${p.year}${p.estimate ? " (projected)" : p.partial ? " (partial)" : ""}: ${p.estimate ? "≈" : ""}${formatPct(u)} — ${p.estimate ? "≈" : ""}${formatNum(Math.round(p.hours))}h of ${formatNum(Math.round(p.maxHours))}h capacity`}</title>
            </rect>
            <text x={cx(i)} y={top - 5} textAnchor="middle" fontSize={t.fs(10)}
              fontWeight={600} fill="var(--foreground)">{formatPct(u, 0)}</text>
            <text x={cx(i)} y={H - pad.b + 14} textAnchor="middle" fontSize={t.fs(10)}
              fill="var(--muted)">
              {t.year(p.year)}{p.partial && !t.mobile ? (p.estimate ? "·est." : "·partial") : ""}
            </text>
          </g>
        );
      })}
      <text x={W - pad.r} y={y(1) - 4} textAnchor="end" fontSize={t.fs(9)}
        fill="var(--faint)">100% capacity</text>
    </svg>
  );
}

// ── Break-even: monthly hours vs the min hours needed to break even ───────────

export interface BreakEvenMonth {
  month: number; // 1–12
  hours: number;
  minHours: number | null;
  /** The month in progress: `hours` is projected, `soFar` is logged. */
  soFar?: number;
  /** In progress or still planned — drawn dashed. */
  future?: boolean;
}

const BE_DESK = { W: 960, H: 248, pad: { l: 46, r: 14, t: 22, b: 28 } };
const BE_PHONE = { W: 400, H: 228, pad: { l: 48, r: 8, t: 20, b: 26 } };

export function BreakEvenChart({ year, months }: { year: number; months: BreakEvenMonth[] }) {
  const { W, H, pad } = usePhone() ? BE_PHONE : BE_DESK;
  const [chartRef, t] = useChartText(W);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  if (months.length === 0) return null;

  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / 12;
  const base = pad.t + plotH;

  const vMax = niceMax(
    Math.max(1, ...months.map((m) => Math.max(m.hours, m.minHours ?? 0))),
  );
  const cx = (m: number) => pad.l + band * (m - 1) + band / 2;
  const y = (v: number) => pad.t + plotH * (1 - v / vMax);

  // Each line runs solid through the booked months and dashed through the
  // month in progress and the planned ones.
  const lineParts = (pts: { month: number; v: number; future: boolean }[]) => {
    const xy = pts.map((p) => ({ x: cx(p.month), y: y(p.v) }));
    const firstFuture = pts.findIndex((p) => p.future);
    const split = firstFuture === -1 ? xy.length : Math.max(1, firstFuture);
    return {
      all: smoothPath(xy),
      solid: smoothPath(xy.slice(0, split)),
      dashed: split < xy.length ? smoothPath(xy.slice(split - 1)) : "",
      area: xy.length ? `${smoothPath(xy)} L${xy[xy.length - 1].x},${base} L${xy[0].x},${base} Z` : "",
    };
  };
  const logged = lineParts(months.map((m) => ({ month: m.month, v: m.hours, future: !!m.future })));
  const be = lineParts(
    months.filter((m) => m.minHours != null).map((m) => ({ month: m.month, v: m.minHours!, future: !!m.future })),
  );
  const series = [
    { key: "be", parts: be, color: "var(--danger)" },
    { key: "logged", parts: logged, color: "var(--brand)" },
  ];

  const hm = hover != null ? months.find((m) => m.month === hover) : undefined;
  const h = (v: number) => `${formatNum(Math.round(v))}h`;

  return (
    <div className="relative">
    <svg ref={chartRef} viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label={`Monthly hours versus break-even hours, ${year}`}>
      <defs>
        {/* everything above the hours-logged line: the break-even line shows
            only where it's out of reach, filled down to the hours logged */}
        <clipPath id={`be-short-${uid}`}>
          <path d={`${logged.all} L${cx(months[months.length - 1].month)},0 L${cx(months[0].month)},0 Z`} />
        </clipPath>
        {series.map((sr) => (
          <linearGradient key={sr.key} id={`be-${sr.key}-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sr.color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={sr.color} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {[0, 0.5, 1].map((f, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(f * vMax)} y2={y(f * vMax)}
            stroke="var(--border)" strokeWidth={0.6} strokeDasharray="3 3" />
          <text x={pad.l - 6} y={y(f * vMax) + 3} textAnchor="end" fontSize={t.fs(10)}
            fill="var(--muted)">{h(f * vMax)}</text>
        </g>
      ))}

      {hover != null && (
        <line x1={cx(hover)} x2={cx(hover)} y1={pad.t} y2={base}
          stroke="var(--border-strong)" strokeWidth={0.8} strokeDasharray="3 3" />
      )}

      {/* the break-even line, faint grey wherever the hours logged cleared it */}
      <path d={be.all} fill="none" stroke="var(--faint)" strokeWidth={1.2} opacity={0.6}
        strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" />
      {/* break-even (red) first, so the hours logged (blue) sit in front of it */}
      {series.map((sr) => (
        <g key={sr.key} pointerEvents="none" clipPath={sr.key === "be" ? `url(#be-short-${uid})` : undefined}>
          <path d={sr.parts.area} fill={`url(#be-${sr.key}-${uid})`} opacity={hover == null ? 0.75 : 0.35} />
          <path d={sr.parts.solid} fill="none" stroke={sr.color} strokeWidth={1.8}
            strokeLinejoin="round" strokeLinecap="round" />
          {sr.parts.dashed && (
            <path d={sr.parts.dashed} fill="none" stroke={sr.color} strokeWidth={1.8} strokeDasharray="3 2.5"
              strokeLinejoin="round" strokeLinecap="round" opacity={0.55} />
          )}
        </g>
      ))}

      {hm && (
        <g pointerEvents="none">
          {hm.minHours != null && (
            <circle cx={cx(hm.month)} cy={y(hm.minHours)} r={3.2} fill="var(--danger)" stroke="var(--surface)" strokeWidth={1.5} />
          )}
          <circle cx={cx(hm.month)} cy={y(hm.hours)} r={3.2} fill="var(--brand)" stroke="var(--surface)" strokeWidth={1.5} />
        </g>
      )}

      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
        <g key={m}>
          <rect x={pad.l + band * (m - 1)} y={pad.t} width={band} height={plotH} fill="transparent"
            onMouseEnter={() => setHover(m)} onMouseLeave={() => setHover(null)} />
          <text x={cx(m)} y={H - pad.b + 14} textAnchor="middle" fontSize={t.fs(10)}
            fontWeight={hover === m ? 700 : 400}
            fill={hover === m ? "var(--foreground)" : "var(--muted)"}>{MONTH_SHORT[m - 1]}</text>
        </g>
      ))}
    </svg>
    {hm && (() => {
      const gap = hm.minHours != null ? hm.hours - hm.minHours : null;
      const est = hm.soFar != null;
      return (
        <ChartTip leftPct={(cx(hm.month) / W) * 100}>
          <div className="text-[11px] font-semibold">
            {MONTH_SHORT[hm.month - 1]} {year}
            {est ? <span className="ml-1 font-normal text-faint">· projected</span>
              : hm.future && <span className="ml-1 font-normal text-faint">· planned</span>}
          </div>
          <TipRow label={est ? "Hours by month end" : hm.future ? "Hours planned" : "Hours logged"}
            value={`${est ? "≈" : ""}${h(hm.hours)}`} color="var(--brand)" />
          {est && <TipRow label="Logged so far" value={h(hm.soFar!)} />}
          {hm.minHours != null && <TipRow label="Break-even at" value={h(hm.minHours)} color="var(--danger)" />}
          {gap != null && (
            <div className={`mt-1 text-[11px] font-medium ${gap < 0 ? "text-danger" : "text-success"}`}>
              {est ? "≈" : ""}{h(Math.abs(gap))} {gap < 0 ? "below" : "above"} break-even
            </div>
          )}
        </ChartTip>
      );
    })()}
    <ChartLegend
      items={[
        { label: "Hours logged", color: "var(--brand)", mark: "line" },
        { label: "Short of break-even", color: "var(--danger)", mark: "line" },
        { label: "Break-even, cleared", color: "var(--faint)", mark: "line" },
      ]}
    />
    </div>
  );
}

// ── Donut pie (revenue share by client) ──────────────────────────────────────

export interface PieSlice {
  label: string;
  value: number;
}

export const PIE_COLORS = [
  "var(--brand)",
  "var(--aqua)",
  "var(--warning)",
  "var(--brand-deep)",
  "#7c9cf5",
  "var(--success)",
  "#d98cc0",
  "#f0a35e",
  "var(--faint)",
];

export function PieChart({
  slices,
  ariaLabel = "Revenue share by client",
  layout = "stacked",
  size,
  formatValue = formatILS,
  formatTotal = formatILSShort,
}: {
  slices: PieSlice[];
  /** A slice's value — ₪ by default; e.g. hours for a share of time. */
  formatValue?: (v: number) => string;
  /** The total in the donut's middle. */
  formatTotal?: (v: number) => string;
  ariaLabel?: string;
  /** "stacked" (default) puts the legend below the donut, full width — used
   * on the narrow expense-tab panes. "side" sits the donut beside the list
   * and lets the donut grow via `size`, for a pane with room to spare. */
  layout?: "stacked" | "side";
  /** Rendered donut diameter in px. Defaults to 192 (stacked) or 260 (side). */
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;

  const px = size ?? (layout === "side" ? 340 : 192);
  const R = 78;
  const r0 = 44; // inner radius (donut hole)
  const C = 100;
  const p = (r: number, a: number) =>
    `${(C + r * Math.cos(a)).toFixed(2)},${(C + r * Math.sin(a)).toFixed(2)}`;
  const arcs = slices.map((s, i) => {
    const before = slices.slice(0, i).reduce((sum, x) => sum + x.value, 0);
    const a0 = (before / total) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((before + s.value) / total) * Math.PI * 2 - Math.PI / 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    // A slice of the whole ring starts and ends on the same point, which an
    // SVG arc draws as nothing — a one-slice donut came out empty. Draw it as
    // two half-rings instead.
    const whole = a1 - a0 >= Math.PI * 2 - 1e-6;
    const h = a0 + Math.PI;
    const d = whole
      ? `M${p(R, a0)}A${R},${R} 0 1 1 ${p(R, h)}A${R},${R} 0 1 1 ${p(R, a0)}L${p(r0, a0)}A${r0},${r0} 0 1 0 ${p(r0, h)}A${r0},${r0} 0 1 0 ${p(r0, a0)}Z`
      : `M${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
    return { d, color: PIE_COLORS[i % PIE_COLORS.length], slice: s, share: s.value / total };
  });

  return (
    <div className={layout === "side" ? "flex flex-col items-center gap-6 md:flex-row" : "flex flex-col items-center gap-4"}>
      <svg viewBox="0 0 200 200" style={{ width: "100%", maxWidth: px, aspectRatio: "1 / 1" }} className="shrink-0" role="img"
        aria-label={ariaLabel}>
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color}
            opacity={hover == null || hover === i ? 1 : 0.35}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <title>{`${a.slice.label}: ${formatValue(a.slice.value)} (${formatPct(a.share)})`}</title>
          </path>
        ))}
        <text x={100} y={96} textAnchor="middle" fontSize={13} fill="var(--muted)">Total</text>
        <text x={100} y={114} textAnchor="middle" fontSize={15} fontWeight={600}
          fill="var(--foreground)">{formatTotal(total)}</text>
      </svg>
      <ul className={layout === "side" ? "min-w-0 flex-1 space-y-1.5 self-center text-sm" : "w-full min-w-0 space-y-1 text-sm"}>
        {arcs.map((a, i) => (
          <li key={i}
            className="flex min-w-0 items-center gap-2"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ opacity: hover == null || hover === i ? 1 : 0.5 }}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
            <span className="bidi-auto min-w-0 flex-1 truncate">{a.slice.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{formatValue(a.slice.value)}</span>
            <span className="w-12 shrink-0 text-right tabular-nums text-faint">{formatPct(a.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Simple 12-month line chart (one value per month) ─────────────────────────

export interface MonthPoint {
  label: string; // "Jan"
  /** Axis text when it should differ from `label` (the hover name) — e.g. a
   * long monthly series ticks only its Januaries; "" leaves the slot blank. */
  axisLabel?: string;
  value: number;
  /** Not yet elapsed — drawn dimmed/dashed as a prediction, not an actual. */
  future?: boolean;
}

export function MonthlyLineChart({
  points,
  activeIndex,
  totalLabel,
  seriesLabel = "Total",
  formatValue = formatILSShort,
  formatDetail = formatILS,
  higherIsBetter = false,
  headline,
  trendOverride,
  trendTitle,
  color = "var(--brand)",
}: {
  points: MonthPoint[];
  activeIndex?: number;
  /** caption under the big headline number, e.g. "so far this year" */
  totalLabel?: string;
  seriesLabel?: string;
  /** Short form for the headline number and axis gridlines. Defaults to ₪ short (e.g. "₪1.4M"). */
  formatValue?: (v: number) => string;
  /** Exact form for the hover tooltip. Defaults to full ₪ (e.g. "₪1,400.50"). */
  formatDetail?: (v: number) => string;
  /** Trend-badge color polarity. Default false (an expense-like metric: up = red).
   * Set true for a metric where more is good (revenue, hours, rate): up = green. */
  higherIsBetter?: boolean;
  /** Override the headline number instead of summing `points` — summing only
   * makes sense for an additive quantity (₪, hours). For a rate/average
   * metric (₪/hour, a monthly average), pass the real overall figure here. */
  headline?: number;
  /** Override the trend badge's percent instead of comparing the latest
   * point to the one before it — month-over-month is a noisy, arbitrary
   * comparison for a partial year. Pass a same-elapsed-period-last-year
   * percent here for an apples-to-apples figure; `null` hides the badge. */
  trendOverride?: number | null;
  /** Hover text for the trend badge when `trendOverride` is set (e.g. "Jan-Aug 2026 vs Jan-Aug 2025"). */
  trendTitle?: string;
  /** The line's color — e.g. red for an expense series. */
  color?: string;
}) {
  const W = 340;
  const [chartRef, t] = useChartText(W);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  if (points.length === 0) return null;

  const n = points.length;
  const H = 190;
  const padL = 8;
  const padR = 8;
  const padTop = 14;
  const padBottom = 24;
  const innerW = W - padL - padR;
  const innerH = H - padTop - padBottom;
  const max = niceMax(Math.max(...points.map((p) => p.value), 1));
  const x = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const y = (v: number) => padTop + innerH * (1 - v / max);
  const baseline = padTop + innerH;

  const firstFuture = points.findIndex((p) => p.future);
  const splitAt = firstFuture === -1 ? n - 1 : Math.max(0, firstFuture - 1);
  const pts = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
  const line = smoothPath(pts);
  const solid = firstFuture === -1 ? line : smoothPath(pts.slice(0, splitAt + 1));

  // headline: real (non-future) total (or the caller's override), and the
  // trend of the latest actual month against the one before it.
  const actual = points.filter((p) => !p.future).map((p) => p.value);
  const total = headline ?? actual.reduce((s, v) => s + v, 0);
  const last = actual.at(-1) ?? 0;
  const prev = actual.length > 1 ? actual.at(-2)! : 0;
  const momTrend = actual.length > 1 && prev > 0 ? Math.round(((last - prev) / prev) * 100) : null;
  const trend = trendOverride !== undefined ? trendOverride : momTrend;

  const tipLeft = hover == null ? 0 : (x(hover) / W) * 100;

  return (
    <div>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-serif text-[26px] italic leading-none">{formatValue(total)}</span>
            {trend != null && (
              <span
                title={trendTitle ?? `${points[actual.length - 1]?.label} vs ${points[actual.length - 2]?.label}`}
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  trend >= 0 === higherIsBetter ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                }`}
              >
                {trend >= 0 ? "↗" : "↘"} {trend >= 0 ? "+" : ""}
                {trend}%
              </span>
            )}
          </div>
          {totalLabel && <div className="mt-0.5 text-[11px] text-muted">{totalLabel}</div>}
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted">
          <span className="h-[2.5px] w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          {seriesLabel}
        </span>
      </div>

      <div className="relative">
        <svg ref={chartRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly totals">
          <defs>
            <linearGradient id={`mlc-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((g, gi) => {
            const gy = padTop + innerH * g;
            return (
              <line
                key={gi}
                x1={padL}
                y1={gy}
                x2={W - padR}
                y2={gy}
                stroke="var(--border)"
                strokeWidth={0.6}
                strokeDasharray="3 3"
              />
            );
          })}

          {hover != null && (
            <line x1={x(hover)} y1={padTop} x2={x(hover)} y2={baseline} stroke="var(--border-strong)" strokeWidth={0.8} strokeDasharray="3 3" />
          )}

          <path d={`${line} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z`} fill={`url(#mlc-${uid})`} opacity={hover == null ? 0.75 : 0.35} />
          <path d={solid} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
          {firstFuture !== -1 && (
            <path
              d={smoothPath(pts.slice(splitAt))}
              fill="none"
              stroke={color}
              strokeWidth={1.6}
              strokeDasharray="3 2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.55}
            />
          )}

          {hover != null && (
            <circle
              cx={x(hover)}
              cy={y(points[hover].value)}
              r={3.2}
              fill={color}
              stroke="var(--surface)"
              strokeWidth={1.5}
            />
          )}

          <HoverBands n={n} x={x} W={W} padL={padL} padR={padR} padTop={padTop} innerW={innerW} innerH={innerH} onHover={setHover} />

          {points.map((p, i) => {
            const on = hover === i || i === activeIndex;
            return (
              <text
                key={i}
                x={x(i)}
                y={H - 8}
                textAnchor={t.anchor(i, points.length)}
                fontSize={t.fs(8)}
                fontWeight={on ? 700 : 400}
                fill={on ? "var(--foreground)" : "var(--faint)"}
              >
                {t.year(p.axisLabel ?? p.label)}
              </text>
            );
          })}
        </svg>

        {hover != null && (
          <LineTip leftPct={tipLeft} minW="min-w-[110px]">
            <div className="text-[11px] font-semibold">
              {points[hover].label}
              {points[hover].future && <span className="ml-1 font-normal text-faint">· predicted</span>}
            </div>
            <div className="mt-1 text-[13px] font-semibold tabular-nums">{formatDetail(points[hover].value)}</div>
          </LineTip>
        )}
      </div>
    </div>
  );
}

// ── Two-series 12-month line chart (e.g. revenue vs expenses) ────────────────

export interface DualPoint {
  label: string; // "Jan"
  /** Axis text when it should differ from `label` (the hover name) — e.g. a
   * long monthly series ticks only its Januaries; "" leaves the slot blank. */
  axisLabel?: string;
  a: number;
  b: number;
  /** Not yet elapsed — drawn dimmed/dashed as a prediction, not an actual. */
  future?: boolean;
}

function TrendBadge({
  trend,
  higherIsBetter,
  title,
}: {
  trend?: number | null;
  higherIsBetter: boolean;
  title?: string;
}) {
  if (trend == null) return null;
  return (
    <span
      title={title}
      className={`rounded-md px-1 py-0.5 text-[9px] font-semibold tabular-nums ${
        trend >= 0 === higherIsBetter ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
      }`}
    >
      {trend >= 0 ? "↗" : "↘"} {trend >= 0 ? "+" : ""}
      {trend}%
    </span>
  );
}

export function DualLineChart({
  points,
  aLabel = "Revenue",
  bLabel = "Expenses",
  aColor = "var(--brand)",
  bColor = "var(--danger)",
  formatValue = formatILSShort,
  formatDetail = formatILS,
  aTrend,
  bTrend,
  trendTitle,
}: {
  points: DualPoint[];
  aLabel?: string;
  bLabel?: string;
  aColor?: string;
  bColor?: string;
  /** Short form for the headline numbers. Defaults to ₪ short (e.g. "₪1.4M"). */
  formatValue?: (v: number) => string;
  /** Exact form for the hover tooltip. Defaults to full ₪. */
  formatDetail?: (v: number) => string;
  /** Trend badge percent for each series (e.g. vs same period last year). `null` hides it. */
  aTrend?: number | null;
  bTrend?: number | null;
  trendTitle?: string;
}) {
  const W = 340;
  const [chartRef, t] = useChartText(W);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  if (points.length === 0) return null;

  const n = points.length;
  const H = 190;
  const padL = 8;
  const padR = 8;
  const padTop = 14;
  const padBottom = 24;
  const innerW = W - padL - padR;
  const innerH = H - padTop - padBottom;
  const max = niceMax(Math.max(...points.flatMap((p) => [p.a, p.b]), 1));
  const x = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const y = (v: number) => padTop + innerH * (1 - v / max);
  const baseline = padTop + innerH;

  const firstFuture = points.findIndex((p) => p.future);
  const splitAt = firstFuture === -1 ? n - 1 : Math.max(0, firstFuture - 1);

  const ptsA = points.map((p, i) => ({ x: x(i), y: y(p.a) }));
  const ptsB = points.map((p, i) => ({ x: x(i), y: y(p.b) }));
  const lineA = smoothPath(ptsA);
  const lineB = smoothPath(ptsB);
  const solidA = firstFuture === -1 ? lineA : smoothPath(ptsA.slice(0, splitAt + 1));
  const solidB = firstFuture === -1 ? lineB : smoothPath(ptsB.slice(0, splitAt + 1));

  const totalA = points.filter((p) => !p.future).reduce((s, p) => s + p.a, 0);
  const totalB = points.filter((p) => !p.future).reduce((s, p) => s + p.b, 0);

  const tipLeft = hover == null ? 0 : (x(hover) / W) * 100;

  return (
    <div>
      <div className="mb-2 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="h-[2.5px] w-3 shrink-0 rounded-full" style={{ backgroundColor: aColor }} />
          <span className="text-[11px] text-muted">{aLabel}</span>
          <span className="font-serif text-[15px] italic leading-none">{formatValue(totalA)}</span>
          <TrendBadge trend={aTrend} higherIsBetter title={trendTitle} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="h-[2.5px] w-3 shrink-0 rounded-full" style={{ backgroundColor: bColor }} />
          <span className="text-[11px] text-muted">{bLabel}</span>
          <span className="font-serif text-[15px] italic leading-none">{formatValue(totalB)}</span>
          <TrendBadge trend={bTrend} higherIsBetter={false} title={trendTitle} />
        </div>
      </div>

      <div className="relative">
        <svg ref={chartRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${aLabel} vs ${bLabel} by month`}>
          <defs>
            <linearGradient id={`dlc-a-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={aColor} stopOpacity={0.22} />
              <stop offset="100%" stopColor={aColor} stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`dlc-b-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={bColor} stopOpacity={0.22} />
              <stop offset="100%" stopColor={bColor} stopOpacity={0} />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((g, gi) => {
            const gy = padTop + innerH * g;
            return (
              <line
                key={gi}
                x1={padL}
                y1={gy}
                x2={W - padR}
                y2={gy}
                stroke="var(--border)"
                strokeWidth={0.6}
                strokeDasharray="3 3"
              />
            );
          })}

          {hover != null && (
            <line x1={x(hover)} y1={padTop} x2={x(hover)} y2={baseline} stroke="var(--border-strong)" strokeWidth={0.8} strokeDasharray="3 3" />
          )}

          {/* B (expenses) fill and line render first — A (revenue) is drawn on
              top of it in both fill and stroke, so blue wins where they overlap. */}
          <path
            d={`${lineB} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z`}
            fill={`url(#dlc-b-${uid})`}
            opacity={hover == null ? 0.75 : 0.35}
          />
          <path
            d={`${lineA} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z`}
            fill={`url(#dlc-a-${uid})`}
            opacity={hover == null ? 0.75 : 0.35}
          />
          <path d={solidB} fill="none" stroke={bColor} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
          {firstFuture !== -1 && (
            <path
              d={smoothPath(ptsB.slice(splitAt))}
              fill="none"
              stroke={bColor}
              strokeWidth={1.6}
              strokeDasharray="3 2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.55}
            />
          )}
          <path d={solidA} fill="none" stroke={aColor} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
          {firstFuture !== -1 && (
            <path
              d={smoothPath(ptsA.slice(splitAt))}
              fill="none"
              stroke={aColor}
              strokeWidth={1.6}
              strokeDasharray="3 2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.55}
            />
          )}

          {hover != null && (
            <>
              <circle cx={x(hover)} cy={y(points[hover].a)} r={3} fill={aColor} stroke="var(--surface)" strokeWidth={1.5} />
              <circle cx={x(hover)} cy={y(points[hover].b)} r={3} fill={bColor} stroke="var(--surface)" strokeWidth={1.5} />
            </>
          )}

          <HoverBands n={n} x={x} W={W} padL={padL} padR={padR} padTop={padTop} innerW={innerW} innerH={innerH} onHover={setHover} />

          {points.map((p, i) => {
            const on = hover === i;
            return (
              <text
                key={i}
                x={x(i)}
                y={H - 8}
                textAnchor={t.anchor(i, points.length)}
                fontSize={t.fs(8)}
                fontWeight={on ? 700 : 400}
                fill={on ? "var(--foreground)" : "var(--faint)"}
              >
                {t.year(p.axisLabel ?? p.label)}
              </text>
            );
          })}
        </svg>

        {hover != null && (
          <LineTip leftPct={tipLeft} minW="min-w-[110px]">
            <div className="text-[11px] font-semibold">
              {points[hover].label}
              {points[hover].future && <span className="ml-1 font-normal text-faint">· predicted</span>}
            </div>
            <div className="mt-1 text-[12px] font-semibold tabular-nums" style={{ color: aColor }}>
              {formatDetail(points[hover].a)}
            </div>
            <div className="mt-0.5 text-[12px] font-semibold tabular-nums" style={{ color: bColor }}>
              {formatDetail(points[hover].b)}
            </div>
          </LineTip>
        )}
      </div>
    </div>
  );
}

// ── Multi-series 12-month line chart (one line per category) ─────────────────

export interface MonthSeries {
  label: string;
  color: string;
  values: number[]; // aligned to `labels`, one per month
}

export function MultiMonthlyLineChart({
  labels,
  series,
  /** index of the first not-yet-elapsed month — drawn dashed/dimmed past that point */
  futureFromIndex,
  activeIndex,
  totalLabel,
}: {
  labels: string[];
  series: MonthSeries[];
  futureFromIndex?: number;
  activeIndex?: number;
  totalLabel?: string;
}) {
  const W = 340;
  const [chartRef, t] = useChartText(W);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const n = labels.length;
  if (n === 0 || series.length === 0) return null;

  const H = 190;
  const padL = 40;
  const padR = 10;
  const padTop = 14;
  const padBottom = 24;
  const innerW = W - padL - padR;
  const innerH = H - padTop - padBottom;
  const max = niceMax(Math.max(...series.flatMap((s) => s.values), 1));
  const x = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const y = (v: number) => padTop + innerH * (1 - v / max);
  const baseline = padTop + innerH;

  const splitAt = futureFromIndex == null ? n - 1 : Math.max(0, futureFromIndex - 1);
  const hasFuture = futureFromIndex != null && futureFromIndex > 0 && futureFromIndex < n;

  // headline: sum of every series' actual (non-future) months, and the trend
  // of the latest actual month's total against the one before it.
  const actualLen = futureFromIndex == null ? n : futureFromIndex;
  const monthTotal = (i: number) => series.reduce((s, ser) => s + (ser.values[i] ?? 0), 0);
  const total = Array.from({ length: actualLen }, (_, i) => monthTotal(i)).reduce((a, b) => a + b, 0);
  const last = actualLen > 0 ? monthTotal(actualLen - 1) : 0;
  const prev = actualLen > 1 ? monthTotal(actualLen - 2) : 0;
  const trend = actualLen > 1 && prev > 0 ? Math.round(((last - prev) / prev) * 100) : null;

  const rows =
    hover == null
      ? []
      : series
          .map((s) => ({ label: s.label, color: s.color, v: s.values[hover] ?? 0 }))
          .filter((r) => r.v > 0)
          .sort((a, b) => b.v - a.v);

  const tipLeft = hover == null ? 0 : (x(hover) / W) * 100;

  return (
    <div>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-serif text-[26px] italic leading-none">{formatILSShort(total)}</span>
            {trend != null && (
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  trend >= 0 ? "bg-danger/10 text-danger" : "bg-success/10 text-success"
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
        <svg ref={chartRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly totals by category">
          <defs>
            {series.map((s, si) => (
              <linearGradient key={si} id={`mmlc-${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.2} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((g, gi) => {
            const gy = padTop + innerH * g;
            return (
              <g key={gi}>
                <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--border)" strokeWidth={0.6} strokeDasharray="3 3" />
                <text x={padL - 6} y={gy + 2.5} textAnchor="end" fontSize={t.fs(7)} fill="var(--faint)">
                  {formatILSShort(max * (1 - g))}
                </text>
              </g>
            );
          })}

          {hover != null && (
            <line x1={x(hover)} y1={padTop} x2={x(hover)} y2={baseline} stroke="var(--border-strong)" strokeWidth={0.8} strokeDasharray="3 3" />
          )}

          {series.map((s, si) => {
            const pts = s.values.map((v, i) => ({ x: x(i), y: y(v) }));
            const line = smoothPath(pts);
            const solid = hasFuture ? smoothPath(pts.slice(0, splitAt + 1)) : line;
            return (
              <g key={si}>
                <path
                  d={`${line} L${x(n - 1)},${baseline} L${x(0)},${baseline} Z`}
                  fill={`url(#mmlc-${uid}-${si})`}
                  opacity={hover == null ? 0.7 : 0.3}
                />
                <path d={solid} fill="none" stroke={s.color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
                {hasFuture && (
                  <path
                    d={smoothPath(pts.slice(splitAt))}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={1.6}
                    strokeDasharray="3 2.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={0.55}
                  />
                )}
              </g>
            );
          })}

          {hover != null &&
            series.map((s, si) => {
              const v = s.values[hover] ?? 0;
              if (v <= 0) return null;
              return <circle key={si} cx={x(hover)} cy={y(v)} r={3} fill={s.color} stroke="var(--surface)" strokeWidth={1.4} />;
            })}

          <HoverBands n={n} x={x} W={W} padL={padL} padR={padR} padTop={padTop} innerW={innerW} innerH={innerH} onHover={setHover} />

          {labels.map((l, i) => {
            const on = hover === i || i === activeIndex;
            return (
              <text
                key={i}
                x={x(i)}
                y={H - 8}
                textAnchor={t.anchor(i, labels.length)}
                fontSize={t.fs(8)}
                fontWeight={on ? 700 : 400}
                fill={on ? "var(--foreground)" : "var(--faint)"}
              >
                {t.year(l)}
              </text>
            );
          })}
        </svg>

        {hover != null && rows.length > 0 && (
          <LineTip leftPct={tipLeft} minW="min-w-[132px]">
            <div className="mb-1.5 text-[11px] font-semibold">
              {labels[hover]}
              {futureFromIndex != null && hover >= futureFromIndex && (
                <span className="ml-1 font-normal text-faint">· predicted</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              {rows.map((r) => (
                <div key={r.label} className="flex items-center gap-2">
                  <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="bidi-auto max-w-24 truncate text-[10px] text-muted">{r.label}</div>
                    <div className="text-[11px] font-semibold tabular-nums">{formatILS(r.v)}</div>
                  </div>
                </div>
              ))}
            </div>
          </LineTip>
        )}
      </div>
    </div>
  );
}

// ── Several monthly lines, each allowed gaps ─────────────────────────────────

export interface GapSeries {
  label: string;
  color: string;
  /** One per point; null where the series has no value (a gap in the line). */
  values: (number | null)[];
  dashed?: boolean;
  /** A soft fill under the line. */
  fill?: boolean;
  /** False draws the fill alone, as an area. */
  stroke?: boolean;
}

/** A max just above `v` whose quarters are round (₪8K steps → ₪32K), so the
 * lines fill the chart — niceMax would put ₪29K under a ₪50K top. */
function quarterMax(v: number): number {
  const q = v / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(q)));
  const step = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * pow >= q)! * pow;
  return step * 4;
}

/** Monthly lines that can start late or break off — e.g. pay from finance for
 * every month, the payslip salary only once there are payslips. The headline
 * shows each line's latest value. */
export function GapLinesChart({
  labels,
  axisLabels,
  series,
  formatValue = formatILSShort,
  formatDetail = (v: number) => formatILS(Math.round(v)),
}: {
  /** Hover names, one per point. */
  labels: string[];
  /** Axis text per point; "" leaves the slot blank. */
  axisLabels: string[];
  series: GapSeries[];
  formatValue?: (v: number) => string;
  formatDetail?: (v: number) => string;
}) {
  const W = 340;
  const [chartRef, t] = useChartText(W);
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const n = labels.length;
  if (!n || !series.length) return null;

  const H = 190;
  const padL = 30;
  const padR = 8;
  const padTop = 10;
  const padBottom = 22;
  const innerW = W - padL - padR;
  const innerH = H - padTop - padBottom;
  const max = quarterMax(Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const x = (i: number) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const y = (v: number) => padTop + innerH * (1 - v / max);
  const baseline = padTop + innerH;
  const runsOf = (values: (number | null)[]) => {
    const runs: { x: number; y: number }[][] = [];
    values.forEach((v, i) => {
      if (v == null) return;
      if (i > 0 && values[i - 1] != null) runs.at(-1)!.push({ x: x(i), y: y(v) });
      else runs.push([{ x: x(i), y: y(v) }]);
    });
    return runs;
  };
  const tipLeft = hover == null ? 0 : (x(hover) / W) * 100;
  const showAxis = axisLabels.map((a) => a !== "");

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => {
          const last = s.values.findLast((v) => v != null);
          return (
            <div key={s.label} className="flex items-center gap-1.5">
              {s.stroke === false ? (
                <span className="h-2.5 w-3 shrink-0 rounded-sm opacity-40" style={{ background: s.color }} />
              ) : (
                <span className={`w-3 shrink-0 border-t-[2.5px] ${s.dashed ? "border-dotted" : ""}`} style={{ borderColor: s.color }} />
              )}
              <span className="text-[11px] text-muted">{s.label}</span>
              {last != null && <span className="font-serif text-[15px] italic leading-none">{formatValue(last)}</span>}
            </div>
          );
        })}
      </div>
      <div className="relative">
        <svg ref={chartRef} viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${series.map((s) => s.label).join(", ")} by month`}>
          <defs>
            {series.map((s, si) => (
              <linearGradient key={si} id={`glc-${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={s.stroke === false ? 0.26 : 0.18} />
                <stop offset="100%" stopColor={s.color} stopOpacity={s.stroke === false ? 0.06 : 0} />
              </linearGradient>
            ))}
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((g) => {
            const gy = padTop + innerH * g;
            return (
              <g key={g}>
                <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--border)" strokeWidth={0.6} strokeDasharray="3 3" />
                {g < 1 && (
                  <text x={padL - 4} y={gy + 3} textAnchor="end" fontSize={t.fs(7.5)} fill="var(--faint)">
                    {formatValue(max * (1 - g))}
                  </text>
                )}
              </g>
            );
          })}
          {hover != null && <line x1={x(hover)} y1={padTop} x2={x(hover)} y2={baseline} stroke="var(--border-strong)" strokeWidth={0.8} strokeDasharray="3 3" />}
          {series.map((s, si) =>
            runsOf(s.values).map((run, ri) => (
              <g key={`${si}-${ri}`}>
                {s.fill && run.length > 1 && (
                  <path
                    d={`${smoothPath(run)} L${run.at(-1)!.x},${baseline} L${run[0].x},${baseline} Z`}
                    fill={`url(#glc-${uid}-${si})`}
                    opacity={hover == null ? 0.9 : 0.5}
                  />
                )}
                {s.stroke === false ? null : run.length > 1 ? (
                  <path
                    d={smoothPath(run)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={1.6}
                    strokeDasharray={s.dashed ? "4 3" : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ) : (
                  <circle cx={run[0].x} cy={run[0].y} r={1.8} fill={s.color} />
                )}
              </g>
            )),
          )}
          {hover != null &&
            series.map((s) =>
              s.values[hover] != null ? (
                <circle key={s.label} cx={x(hover)} cy={y(s.values[hover]!)} r={3} fill={s.color} stroke="var(--surface)" strokeWidth={1.5} />
              ) : null,
            )}
          <HoverBands n={n} x={x} W={W} padL={padL} padR={padR} padTop={padTop} innerW={innerW} innerH={innerH} onHover={setHover} />
          {axisLabels.map((a, i) =>
            showAxis[i] ? (
              <text
                key={i}
                x={x(i)}
                y={H - 7}
                textAnchor={t.anchor(i, n)}
                fontSize={t.fs(8)}
                fontWeight={hover === i ? 700 : 400}
                fill={hover === i ? "var(--foreground)" : "var(--faint)"}
              >
                {a}
              </text>
            ) : null,
          )}
        </svg>
        {hover != null && (
          <LineTip leftPct={tipLeft}>
            <div className="text-[11px] font-semibold">{labels[hover]}</div>
            {series.map((s) =>
              s.values[hover] != null ? (
                <div key={s.label} className="mt-1 flex items-baseline justify-between gap-3 whitespace-nowrap text-[11px]">
                  <span className="text-muted">{s.label}</span>
                  <span className="font-semibold tabular-nums" style={{ color: s.color }}>
                    {formatDetail(s.values[hover]!)}
                  </span>
                </div>
              ) : null,
            )}
          </LineTip>
        )}
      </div>
    </div>
  );
}
