"use client";

import { useState } from "react";
import { ChartLegend, ChartTip, TipRow, niceMax, useChartText } from "@/components/finance/finance-charts";
import { formatILSShort } from "@/lib/finance/format";
import { monthLabel } from "@/lib/finance/scenarios/decisions";
import { useT } from "@/components/finance/scenarios/lang";
import type { Ym } from "@/lib/finance/scenarios/types";

export interface ScenarioSeries {
  name: string;
  color: string;
  bad: number[];
  mid: number[];
  good: number[];
}

const W = 720;
const H = 420;

/** Cumulative profit (or cash) a month for up to 3 scenarios: the middle
 * future as a line, bad-to-good as a band, a line at zero / the cash floor.
 * Unlike the other charts it goes below zero. */
export function ScenarioChart({ months, series, floor, floorLabel }: { months: Ym[]; series: ScenarioSeries[]; floor: number; floorLabel: string }) {
  const [setEl, t] = useChartText(W);
  const { t: tr, lang } = useT();
  const [hover, setHover] = useState<number | null>(null);
  // A phone's larger axis text needs a wider margin.
  const PAD = { l: t.mobile ? 96 : 58, r: 14, t: 14, b: t.mobile ? 40 : 26 };
  const all = series.flatMap((s) => [...s.bad, ...s.good, ...s.mid]).concat([floor, 0]);
  const top = niceMax(Math.max(1, ...all));
  const lowRaw = Math.min(0, ...all);
  const bottom = lowRaw < 0 ? -niceMax(-lowRaw) : 0;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (months.length > 1 ? (i / (months.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.t + ((top - v) / (top - bottom || 1)) * plotH;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const band = (lo: number[], hi: number[]) =>
    `${hi.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ")} ${lo
      .map((v, i) => [i, v] as const)
      .reverse()
      .map(([i, v]) => `L${x(i)},${y(v)}`)
      .join(" ")} Z`;
  const ticks = 4;
  const grid = Array.from({ length: ticks + 1 }, (_, i) => bottom + ((top - bottom) * i) / ticks);

  return (
    <div className="relative" dir="ltr">
      <svg
        ref={setEl}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = Math.round(((px - PAD.l) / plotW) * (months.length - 1));
          setHover(i >= 0 && i < months.length ? i : null);
        }}
      >
        {grid.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize={t.fs(13)} fill="var(--muted)">
              {formatILSShort(v)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} />
        {floor !== 0 && <line x1={PAD.l} x2={W - PAD.r} y1={y(floor)} y2={y(floor)} stroke="var(--danger)" strokeDasharray="4 4" strokeWidth={1} opacity={0.6} />}
        {months.map((m, i) =>
          i % (t.mobile ? 3 : 2) === 0 || (!t.mobile && i === months.length - 1) ? (
            <text key={m} x={x(i)} y={H - 6} textAnchor={t.anchor(i, months.length)} fontSize={t.fs(13)} fill="var(--muted)">
              {monthLabel(m, lang)}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <g key={s.name}>
            <path d={band(s.bad, s.good)} fill={s.color} opacity={0.1} />
            <path d={path(s.bad)} fill="none" stroke={s.color} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
            <path d={path(s.mid)} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinejoin="round" />
          </g>
        ))}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + plotH} stroke="var(--border-strong)" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.mid[hover])} r={3.5} fill={s.color} stroke="var(--surface)" strokeWidth={1.5} />
            ))}
          </g>
        )}
      </svg>
      {hover != null && (
        <ChartTip leftPct={(x(hover) / W) * 100}>
          <p className="text-xs font-medium">{monthLabel(months[hover], lang)}</p>
          {series.map((s) => (
            <div key={s.name} className="mt-1">
              <p className="text-[11px] font-medium" style={{ color: s.color }}>{s.name}</p>
              <TipRow label={tr("Bad")} value={formatILSShort(s.bad[hover])} />
              <TipRow label={tr("Middle")} value={formatILSShort(s.mid[hover])} />
              <TipRow label={tr("Good")} value={formatILSShort(s.good[hover])} />
            </div>
          ))}
        </ChartTip>
      )}
      <ChartLegend
        items={[
          ...series.map((s) => ({ label: s.name, color: s.color, mark: "line" as const })),
          { label: tr("bad future"), color: "var(--muted)", mark: "dash" as const },
          ...(floor !== 0 ? [{ label: floorLabel, color: "var(--danger)", mark: "dash" as const }] : []),
        ]}
      />
    </div>
  );
}
