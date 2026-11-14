"use client";

// The person page's small visuals — plain HTML bars, no chart library (like
// finance-charts.tsx). Each one answers one question at a glance and keeps its
// exact numbers one hover away.

import type { ReactNode } from "react";
import { InfoDot } from "@/components/finance/ui";
import { formatILS, formatNum, formatPct } from "@/lib/finance/format";
import type { PersonSummary } from "@/lib/finance/people";
import { rateFor, type RateTerms } from "@/lib/finance/freelance-rate";

/** Where hours go, in the order they're worth something. */
const HOUR_KINDS = [
  { key: "billable", label: "Billable", color: "var(--brand)", info: "Client work that's charged." },
  { key: "studio", label: "Studio work", color: "#6181e8", info: "The studio's own work (the website, internal projects) — worth something, just not to a client. Not held against their return." },
  { key: "keys", label: "Written down", color: "var(--danger)", info: "Moved to a client's Keys task: client work the studio didn't charge for. Earns nothing." },
  { key: "other", label: "Other", color: "var(--border-strong)", info: "Everything else that isn't charged: meetings, admin, non-billable tasks." },
] as const;

function hourSplit(s: Pick<PersonSummary, "hours" | "billableHours" | "studioHours" | "keysHours">) {
  const other = Math.max(0, s.hours - s.billableHours - s.studioHours - s.keysHours);
  return { billable: s.billableHours, studio: s.studioHours, keys: s.keysHours, other };
}

/** A stacked bar of where their hours went, with a legend underneath. */
/** Below this share a part of the bar is too narrow for its label, which then
 * sits in a line under the bar instead. */
const LABEL_FITS = 0.12;

export function HoursSplitBar({ summary, compact = false }: { summary: PersonSummary; compact?: boolean }) {
  const split = hourSplit(summary);
  const total = summary.hours;
  if (total < 1) return <p className="text-sm text-faint">No hours logged in this period.</p>;
  const parts = HOUR_KINDS.map((k) => ({ ...k, v: split[k.key], share: split[k.key] / total })).filter((p) => p.v > 0);
  const tip = (p: (typeof parts)[number]) => `${p.label}: ${formatNum(p.v)}h (${formatPct(p.share, 0)}) — ${p.info}`;

  if (compact)
    return (
      <div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
          {parts.map((p) => (
            <div key={p.key} style={{ width: `${p.share * 100}%`, background: p.color }} title={tip(p)} />
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {HOUR_KINDS.map((k) => {
            const share = split[k.key] / total;
            return (
              <div key={k.key} className="flex items-baseline gap-1.5 text-xs">
                <span className="inline-block size-2 shrink-0 translate-y-[-1px] rounded-full" style={{ background: k.color }} />
                <span className="text-muted">{k.label}</span>
                <span className={`ml-auto font-medium tabular-nums ${k.key === "keys" && share >= 0.1 ? "text-danger" : ""}`}>
                  {formatPct(share, 0)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );

  // The labels live ON the bar; only a part too narrow to hold one is named
  // underneath.
  const tight = parts.filter((p) => p.share < LABEL_FITS);
  return (
    <div>
      <div className="flex h-16 w-full gap-0.5 overflow-hidden rounded-xl">
        {parts.map((p) => (
          <div
            key={p.key}
            title={tip(p)}
            style={{ width: `${p.share * 100}%`, background: p.color }}
            className={`flex min-w-0 flex-col justify-center px-3 ${p.key === "other" ? "text-foreground" : "text-white"}`}
          >
            {p.share >= LABEL_FITS ? (
              <>
                <div className="truncate text-xs opacity-90">{p.label}</div>
                <div className="truncate text-base font-semibold tabular-nums">
                  {formatPct(p.share, 0)} <span className="text-xs font-normal opacity-90">· {formatNum(p.v)}h</span>
                </div>
              </>
            ) : p.share >= 0.04 ? (
              <div className="text-center text-xs font-semibold tabular-nums">{formatPct(p.share, 0)}</div>
            ) : null}
          </div>
        ))}
      </div>
      {tight.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          {tight.map((p) => (
            <span key={p.key} className="inline-flex items-center gap-1.5" title={p.info}>
              <span className="inline-block size-2 rounded-full" style={{ background: p.color }} />
              {p.label} {formatPct(p.share, 0)} · {formatNum(p.v)}h
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A value on a bar from 0 to `max`, with a target tick. */
export function Meter({
  value,
  max,
  target,
  targetLabel,
  format,
}: {
  value: number;
  max: number;
  target: number;
  targetLabel: string;
  format: (v: number) => string;
}) {
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const short = value < target * 0.75;
  return (
    <div>
      <div className="relative h-3 rounded-full bg-surface-2">
        <div className={`h-3 rounded-full ${short ? "bg-[var(--warning)]" : "bg-brand"}`} style={{ width: pct(value) }} />
        <div className="absolute -top-1 h-5 w-0.5 rounded bg-foreground" style={{ left: pct(target) }} title={targetLabel} />
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-faint">
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(target) }}>
          {targetLabel} · {format(target)}
        </span>
      </div>
    </div>
  );
}

/** Return on a scale: 1× covers their pay; `needed` also carries their share
 * of the studio's other costs and the target margin. */
export function ReturnScale({ value, needed }: { value: number; needed: number | null }) {
  const max = Math.max(3, value * 1.15, (needed ?? 0) * 1.25);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const tone = value < 1 ? "var(--danger)" : needed != null && value < needed ? "var(--warning)" : "var(--success)";
  return (
    <div className="pt-1">
      <div className="relative h-3 rounded-full" style={{ background: "linear-gradient(to right, #fde2e2, #fef3c7 40%, #dcfce7)" }}>
        {[1, needed].map((m, i) =>
          m != null ? (
            <div key={i} className="absolute -top-1 h-5 w-0.5 rounded bg-foreground/40" style={{ left: pct(m) }} />
          ) : null,
        )}
        <div
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
          style={{ left: pct(value), background: tone }}
          title={`${value.toFixed(1)}×`}
        />
      </div>
      <div className="relative mt-1 h-8 text-[11px] leading-tight text-faint">
        <span className="absolute -translate-x-1/2 text-center" style={{ left: pct(1) }}>
          1×
          <br />
          covers pay
        </span>
        {needed != null && (
          <span className="absolute -translate-x-1/2 text-center" style={{ left: pct(needed) }}>
            {needed.toFixed(1)}×
            <br />
            + costs &amp; margin
          </span>
        )}
      </div>
    </div>
  );
}

/** Their pay now against what their work supports, as two bars. */
export function SalaryBars({
  now,
  supports,
  nowLabel,
  supportsLabel,
  format = (v) => formatILS(Math.round(v / 100) * 100),
}: {
  now: number;
  supports: number;
  nowLabel: string;
  supportsLabel: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(now, supports) || 1;
  const under = supports < now * 0.95;
  const rows = [
    { label: nowLabel, v: now, color: "var(--foreground)" },
    { label: supportsLabel, v: supports, color: under ? "var(--danger)" : "var(--success)" },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted">{r.label}</span>
            <span className="font-medium tabular-nums">{format(r.v)}</span>
          </div>
          <div className="h-2.5 rounded-full bg-surface-2">
            <div className="h-2.5 rounded-full" style={{ width: `${(r.v / max) * 100}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** One of the key figures above the tabs. */
export function Kpi({
  label,
  value,
  sub,
  info,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  info?: ReactNode;
  tone?: "danger" | "success" | "warning";
}) {
  const color = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : tone === "warning" ? "text-[var(--warning)]" : "";
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-medium text-muted">{label}</span>
        {info && <InfoDot>{info}</InfoDot>}
      </div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-faint">{sub}</div>}
    </div>
  );
}

/** A small segmented switch. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border-strong p-0.5 text-xs" role="group">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-md px-2.5 py-1 ${value === o.id ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A sliding rate as a line — ₪/hour against hours in the month — the current
 * terms against the recommended ones, with their usual month marked. */
export function RateCurve({ now, next, usual }: { now: RateTerms; next: RateTerms; usual: number | null }) {
  const W = 420;
  const H = 170;
  const pad = { l: 40, r: 12, t: 14, b: 26 };
  const maxH = Math.max(now.hoursHigh, next.hoursHigh) + 30;
  // Zoomed to where the rates live, not from ₪0 — or two close lines merge.
  const top = Math.ceil((Math.max(now.rateHigh, next.rateHigh) * 1.08) / 10) * 10;
  const bottom = Math.max(0, Math.floor((Math.min(now.rateLow, next.rateLow) * 0.85) / 10) * 10);
  const x = (h: number) => pad.l + (h / maxH) * (W - pad.l - pad.r);
  const y = (r: number) => H - pad.b - ((r - bottom) / (top - bottom)) * (H - pad.t - pad.b);
  const path = (t: RateTerms) =>
    [0, t.hoursLow, t.hoursHigh, maxH].map((h, i) => `${i ? "L" : "M"}${x(h).toFixed(1)},${y(rateFor(h, t)).toFixed(1)}`).join(" ");
  const ticksR = [bottom, Math.round((bottom + top) / 2 / 10) * 10, top];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Sliding rate: current against recommended">
      {ticksR.map((r) => (
        <g key={r}>
          <line x1={pad.l} x2={W - pad.r} y1={y(r)} y2={y(r)} stroke="var(--border)" strokeDasharray={r !== bottom ? "3 3" : undefined} />
          <text x={pad.l - 6} y={y(r) + 3} textAnchor="end" fontSize="10" fill="var(--faint)">
            ₪{r}
          </text>
        </g>
      ))}
      {[0, now.hoursLow, now.hoursHigh].map((h) => (
        <text key={h} x={x(h)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--faint)">
          {h}h
        </text>
      ))}
      {usual != null && usual > 0 && (
        <g>
          <line x1={x(usual)} x2={x(usual)} y1={pad.t} y2={H - pad.b} stroke="var(--foreground)" strokeOpacity="0.35" strokeDasharray="2 3" />
          <text x={x(usual) + 4} y={pad.t + 8} fontSize="10" fill="var(--muted)">
            usual {Math.round(usual)}h
          </text>
        </g>
      )}
      <path d={path(now)} fill="none" stroke="var(--faint)" strokeWidth="2" />
      <path d={path(next)} fill="none" stroke="var(--brand)" strokeWidth="2.5" />
      {usual != null && usual > 0 && (
        <>
          <circle cx={x(usual)} cy={y(rateFor(usual, now))} r="3.5" fill="var(--faint)" />
          <circle cx={x(usual)} cy={y(rateFor(usual, next))} r="4" fill="var(--brand)" />
        </>
      )}
    </svg>
  );
}
