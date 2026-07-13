"use client";

import { useState } from "react";
import { formatILS, formatILSShort, formatPct } from "@/lib/format";
import type { YearSummary } from "@/lib/finance";

export interface FinanceEvent {
  year: number;
  month: number | null;
  event: string;
  category: string | null;
  note: string | null;
}

// ── 10-year revenue (bars) + profit-margin (line) hero chart ─────────────────
// Custom SVG, in-brand, matching the app's chart style (see charts.tsx).
// Revenue on the left axis, margin % on the right; macro events annotated on top.

const VB_W = 960;
const VB_H = 420;
const PAD = { l: 62, r: 52, t: 78, b: 34 };

/** Round a max up to a clean gridline value. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function TrendChart({
  summaries,
  events,
}: {
  summaries: YearSummary[];
  events: FinanceEvent[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [eventHover, setEventHover] = useState<number | null>(null);
  if (summaries.length === 0) return null;

  const plotW = VB_W - PAD.l - PAD.r;
  const plotH = VB_H - PAD.t - PAD.b;
  const n = summaries.length;
  const band = plotW / n;
  const barW = band * 0.5;

  const revMax = niceMax(Math.max(...summaries.map((s) => s.revenue)));
  const margins = summaries.map((s) => s.margin);
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

  const linePath = summaries
    .map((s, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${yMar(s.margin).toFixed(1)}`)
    .join(" ");

  const eventsByYear = new Map<number, FinanceEvent[]>();
  for (const e of events) {
    const arr = eventsByYear.get(e.year) ?? [];
    arr.push(e);
    eventsByYear.set(e.year, arr);
  }

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full" role="img"
      aria-label="Ten-year revenue and profit-margin trend">
      {/* zero / gridlines */}
      {revTicks.map((v, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={VB_W - PAD.r} y1={yRev(v)} y2={yRev(v)}
            stroke="var(--border)" strokeWidth={1} />
          <text x={PAD.l - 8} y={yRev(v) + 3} textAnchor="end"
            fontSize={11} fill="var(--muted)">{formatILSShort(v)}</text>
        </g>
      ))}

      {/* margin axis ticks (right) */}
      {marTicks.map((m, i) => (
        <text key={i} x={VB_W - PAD.r + 8} y={yMar(m) + 3} textAnchor="start"
          fontSize={11} fill={m < 0 ? "var(--danger)" : "var(--muted)"}>
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
        return (
          <g key={s.year}>
            <rect
              x={cx(i) - barW / 2} y={y} width={barW} height={Math.max(0, h)} rx={3}
              fill={s.partial ? "var(--brand-soft)" : "var(--brand)"}
              stroke={s.partial ? "var(--brand)" : "none"}
              strokeWidth={s.partial ? 1.5 : 0}
              strokeDasharray={s.partial ? "3 2" : undefined}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${s.year}${s.partial ? " (H1)" : ""}: ${formatILSShort(s.revenue)} revenue, ${formatPct(s.margin)} margin`}</title>
            </rect>
            {s.partial && (
              <text x={cx(i)} y={y - 6} textAnchor="middle" fontSize={10}
                fontWeight={600} fill="var(--brand)">H1</text>
            )}
            <text x={cx(i)} y={VB_H - PAD.b + 16} textAnchor="middle" fontSize={11}
              fill="var(--muted)" fontWeight={500}>{s.year}</text>
          </g>
        );
      })}

      {/* margin line + markers */}
      <path d={linePath} fill="none" stroke="var(--foreground)" strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" />
      {summaries.map((s, i) => (
        <circle key={s.year} cx={cx(i)} cy={yMar(s.margin)} r={3.5}
          fill="var(--surface)" stroke={s.margin < 0 ? "var(--danger)" : "var(--foreground)"}
          strokeWidth={2}>
          <title>{`${s.year}: ${formatPct(s.margin)} margin`}</title>
        </circle>
      ))}

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
            <text x={cx(i)} y={PAD.t - 18} textAnchor="middle" fontSize={9.5}
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
                <text key={li} x={x + 10} y={PAD.t + 16 + li * 13} fontSize={10}
                  fontWeight={li === 0 ? 600 : 400}
                  fill={li === 0 ? "var(--foreground)" : "var(--muted)"}>
                  {l}
                </text>
              ))}
            </g>
          );
        })()}

      {/* legend */}
      <g transform={`translate(${PAD.l},${VB_H - 6})`} fontSize={11} fill="var(--muted)">
        <rect x={0} y={-9} width={11} height={11} rx={2} fill="var(--brand)" />
        <text x={16} y={0}>Revenue</text>
        <line x1={74} x2={94} y1={-4} y2={-4} stroke="var(--foreground)" strokeWidth={2} />
        <text x={99} y={0}>Profit margin</text>
      </g>

      {/* hover value label, floating just above the bar */}
      {hover != null &&
        (() => {
          const s = summaries[hover];
          const label = `${formatILSShort(s.revenue)} · ${formatPct(s.margin)}`;
          const w = label.length * 6.4 + 16;
          const x = Math.min(Math.max(cx(hover), PAD.l + w / 2), VB_W - PAD.r - w / 2);
          const y = Math.max(yRev(s.revenue) - 14, 14);
          return (
            <g pointerEvents="none">
              <rect
                x={x - w / 2} y={y - 13} width={w} height={19} rx={5}
                fill="var(--surface)" stroke="var(--border-strong)" strokeWidth={1}
              />
              <text x={x} y={y + 1} textAnchor="middle" fontSize={11} fontWeight={600}
                fill="var(--foreground)">
                {label}
              </text>
            </g>
          );
        })()}
    </svg>
  );
}

// ── Cost structure: expense blocks as % of revenue, stacked per year ──────────

export interface CostYear {
  year: number;
  partial: boolean;
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

export function CostStructureChart({ data }: { data: CostYear[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return null;

  const W = 960;
  const H = 300;
  const pad = { l: 46, r: 12, t: 26, b: 40 };
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label="Cost structure as percent of revenue per year">
      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)}
            stroke="var(--border)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10}
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
                  opacity={seg.key === "salaries" ? 1 : 0.75}>
                  <title>{`${d.year} ${seg.label}: ${formatPct(v)} of revenue`}</title>
                </rect>
              );
            })}
            {/* salaries % — the margin driver — always labeled */}
            <text x={cx(i)} y={y(total) - 5} textAnchor="middle" fontSize={10}
              fontWeight={600} fill={hover === i ? "var(--foreground)" : "var(--brand)"}>
              {hover === i ? `Σ ${formatPct(total, 0)}` : formatPct(d.salaries, 0)}
            </text>
            <text x={cx(i)} y={H - pad.b + 14} textAnchor="middle" fontSize={11}
              fill="var(--muted)" fontWeight={500}>
              {d.year}{d.partial ? "·H1" : ""}
            </text>
          </g>
        );
      })}

      <g transform={`translate(${pad.l},${H - 6})`} fontSize={10.5} fill="var(--muted)">
        {COST_SEGMENTS.map((seg, i) => (
          <g key={seg.key} transform={`translate(${i * 92},0)`}>
            <rect x={0} y={-8.5} width={10} height={10} rx={2} fill={seg.color}
              opacity={seg.key === "salaries" ? 1 : 0.75} />
            <text x={14} y={0}>{seg.label}{seg.key === "salaries" ? " % (labeled)" : ""}</text>
          </g>
        ))}
        <text x={COST_SEGMENTS.length * 92 + 12} y={0} fill="var(--faint)">
          dashed red = 100% of revenue
        </text>
      </g>
    </svg>
  );
}

// ── Avg hourly rate trend per year ────────────────────────────────────────────

export interface RatePoint {
  year: number;
  rate: number;
  partial: boolean;
}

export function RateTrendChart({ points }: { points: RatePoint[] }) {
  if (points.length === 0) return null;

  const W = 460;
  const H = 210;
  const pad = { l: 44, r: 14, t: 26, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / points.length;

  const rates = points.map((p) => p.rate);
  const rMin = Math.min(...rates) * 0.9;
  const rMax = Math.max(...rates) * 1.06;
  const cx = (i: number) => pad.l + band * i + band / 2;
  const y = (v: number) => pad.t + plotH * (1 - (v - rMin) / (rMax - rMin || 1));

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${cx(i).toFixed(1)},${y(p.rate).toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label="Average hourly rate per year">
      {[rMin, (rMin + rMax) / 2, rMax].map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)}
            stroke="var(--border)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10}
            fill="var(--muted)">{formatILS(v)}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth={2}
        strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={p.year}>
          <circle cx={cx(i)} cy={y(p.rate)} r={3.5} fill="var(--surface)"
            stroke="var(--brand)" strokeWidth={2}>
            <title>{`${p.year}${p.partial ? " (H1)" : ""}: ${formatILS(p.rate)}/h avg`}</title>
          </circle>
          <text x={cx(i)} y={y(p.rate) - 8} textAnchor="middle" fontSize={9.5}
            fontWeight={600} fill="var(--foreground)">
            {formatILS(p.rate)}
          </text>
          <text x={cx(i)} y={H - pad.b + 14} textAnchor="middle" fontSize={10}
            fill="var(--muted)">
            {String(p.year).slice(2)}{p.partial ? "·H1" : ""}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Utilization vs capacity (2023+, where capacity lines exist) ───────────────

export interface UtilizationPoint {
  year: number;
  partial: boolean;
  hours: number;
  maxHours: number;
}

export function UtilizationChart({ points }: { points: UtilizationPoint[] }) {
  if (points.length === 0) return null;

  const W = 460;
  const H = 210;
  const pad = { l: 40, r: 14, t: 26, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / points.length;
  const barW = Math.min(band * 0.5, 48);

  const utils = points.map((p) => (p.maxHours > 0 ? p.hours / p.maxHours : 0));
  const yMax = Math.max(1.1, niceMax(Math.max(...utils)));
  const cx = (i: number) => pad.l + band * i + band / 2;
  const y = (v: number) => pad.t + plotH * (1 - v / yMax);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label="Utilization versus capacity per year">
      {[0, 0.5, 1].map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)}
            stroke={v === 1 ? "var(--border-strong)" : "var(--border)"}
            strokeWidth={1} strokeDasharray={v === 1 ? "4 3" : undefined} />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10}
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
              <title>{`${p.year}${p.partial ? " (H1)" : ""}: ${formatPct(u)} — ${Math.round(p.hours).toLocaleString("en-US")}h of ${Math.round(p.maxHours).toLocaleString("en-US")}h capacity`}</title>
            </rect>
            <text x={cx(i)} y={top - 5} textAnchor="middle" fontSize={10}
              fontWeight={600} fill="var(--foreground)">{formatPct(u, 0)}</text>
            <text x={cx(i)} y={H - pad.b + 14} textAnchor="middle" fontSize={10}
              fill="var(--muted)">
              {p.year}{p.partial ? "·H1" : ""}
            </text>
          </g>
        );
      })}
      <text x={W - pad.r} y={y(1) - 4} textAnchor="end" fontSize={9}
        fill="var(--faint)">100% capacity</text>
    </svg>
  );
}

// ── Break-even: monthly hours vs the min hours needed to break even ───────────

export interface BreakEvenMonth {
  month: number; // 1–12
  hours: number;
  minHours: number | null;
}

const BE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function BreakEvenChart({ year, months }: { year: number; months: BreakEvenMonth[] }) {
  if (months.length === 0) return null;

  const W = 960;
  const H = 260;
  const pad = { l: 46, r: 14, t: 22, b: 40 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / 12;
  const barW = Math.min(band * 0.55, 42);

  const vMax = niceMax(
    Math.max(1, ...months.map((m) => Math.max(m.hours, m.minHours ?? 0))),
  );
  const cx = (m: number) => pad.l + band * (m - 1) + band / 2;
  const y = (v: number) => pad.t + plotH * (1 - v / vMax);

  const bePath = months
    .filter((m) => m.minHours != null)
    .map((m, i) => `${i === 0 ? "M" : "L"}${cx(m.month).toFixed(1)},${y(m.minHours!).toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label={`Monthly hours versus break-even hours, ${year}`}>
      {[0, 0.5, 1].map((f, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={y(f * vMax)} y2={y(f * vMax)}
            stroke="var(--border)" strokeWidth={1} />
          <text x={pad.l - 6} y={y(f * vMax) + 3} textAnchor="end" fontSize={10}
            fill="var(--muted)">{Math.round(f * vMax).toLocaleString("en-US")}h</text>
        </g>
      ))}

      {months.map((m) => {
        const below = m.minHours != null && m.hours < m.minHours;
        return (
          <g key={m.month}>
            <rect x={cx(m.month) - barW / 2} y={y(m.hours)} width={barW}
              height={Math.max(0, y(0) - y(m.hours))} rx={3}
              fill={below ? "var(--danger)" : "var(--brand)"}
              opacity={below ? 0.85 : 1}>
              <title>{`${BE_MONTHS[m.month - 1]} ${year}: ${Math.round(m.hours).toLocaleString("en-US")}h logged${m.minHours != null ? ` · break-even at ${Math.round(m.minHours).toLocaleString("en-US")}h` : ""}${below ? " — below break-even" : ""}`}</title>
            </rect>
          </g>
        );
      })}

      {/* break-even line over the bars */}
      {bePath && (
        <path d={bePath} fill="none" stroke="var(--foreground)" strokeWidth={2}
          strokeDasharray="5 3" strokeLinejoin="round" strokeLinecap="round" />
      )}
      {months.filter((m) => m.minHours != null).map((m) => (
        <circle key={m.month} cx={cx(m.month)} cy={y(m.minHours!)} r={2.8}
          fill="var(--foreground)">
          <title>{`${BE_MONTHS[m.month - 1]}: break-even at ${Math.round(m.minHours!).toLocaleString("en-US")}h`}</title>
        </circle>
      ))}

      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
        <text key={m} x={cx(m)} y={H - pad.b + 14} textAnchor="middle" fontSize={10}
          fill="var(--muted)">{BE_MONTHS[m - 1]}</text>
      ))}

      <g transform={`translate(${pad.l},${H - 8})`} fontSize={10.5} fill="var(--muted)">
        <rect x={0} y={-8.5} width={10} height={10} rx={2} fill="var(--brand)" />
        <text x={14} y={0}>Hours logged</text>
        <rect x={104} y={-8.5} width={10} height={10} rx={2} fill="var(--danger)" opacity={0.85} />
        <text x={118} y={0}>Below break-even</text>
        <line x1={238} x2={260} y1={-4} y2={-4} stroke="var(--foreground)" strokeWidth={2}
          strokeDasharray="5 3" />
        <text x={265} y={0}>Min hours to break even</text>
      </g>
    </svg>
  );
}
