"use client";

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
                {p.minutes > 0 && (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] tabular-nums text-muted">
                    {formatHoursShort(p.minutes)}
                  </span>
                )}
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
                    <div className="h-full w-full bg-brand/80 hover:bg-brand" />
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
 * SVG pie chart with a legend beside it. Values in minutes.
 * Percentage labels render inside slices of at least 8%.
 */
export function PieChart({
  slices,
}: {
  slices: { label: string; minutes: number; color: string }[];
}) {
  const total = slices.reduce((s, x) => s + x.minutes, 0);
  if (total <= 0) return null;
  const cx = 50;
  const cy = 50;
  const r = 48;
  let angle = -Math.PI / 2;
  const parts = slices
    .filter((s) => s.minutes > 0)
    .map((s, i) => {
      const frac = s.minutes / total;
      const a0 = angle;
      const a1 = angle + frac * Math.PI * 2;
      angle = a1;
      return { ...s, key: `${s.label}-${i}`, frac, a0, a1, mid: (a0 + a1) / 2 };
    });
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="size-28 shrink-0" role="img" aria-label="Hours by client">
        {parts.map((p) =>
          p.frac >= 0.999 ? (
            <circle key={p.key} cx={cx} cy={cy} r={r} fill={p.color} />
          ) : (
            <path
              key={p.key}
              d={`M ${cx} ${cy} L ${cx + r * Math.cos(p.a0)} ${cy + r * Math.sin(p.a0)} A ${r} ${r} 0 ${
                p.frac > 0.5 ? 1 : 0
              } 1 ${cx + r * Math.cos(p.a1)} ${cy + r * Math.sin(p.a1)} Z`}
              fill={p.color}
            >
              <title>{`${p.label}: ${formatHoursShort(p.minutes)}`}</title>
            </path>
          ),
        )}
        {parts
          .filter((p) => p.frac >= 0.08)
          .map((p) => (
            <text
              key={p.key}
              x={cx + r * 0.62 * Math.cos(p.mid)}
              y={cy + r * 0.62 * Math.sin(p.mid)}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#fff"
              fontSize="8.5"
              fontWeight="600"
            >
              {Math.round(p.frac * 100)}%
            </text>
          ))}
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {slices.map((s, i) => (
          <div key={`${s.label}-${i}`} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 font-medium">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="bidi-auto truncate">{s.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted">{formatHoursShort(s.minutes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small column chart. Values in minutes. */
export function MiniColumns({ points }: { points: { label: string; minutes: number }[] }) {
  const max = Math.max(...points.map((p) => p.minutes), 1);
  return (
    <div className="flex items-end gap-1">
      {points.map((p) => (
        <div key={p.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex h-16 w-full items-end">
            <div
              className="w-full rounded-t bg-brand/80 hover:bg-brand"
              style={{ height: `${Math.max(2, (p.minutes / max) * 100)}%` }}
              title={`${p.label}: ${formatHoursShort(p.minutes)}`}
            />
          </div>
          <span className="truncate text-[9px] text-faint">{p.label}</span>
        </div>
      ))}
    </div>
  );
}
