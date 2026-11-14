"use client";

import { useEffect, useState } from "react";
import type { YearSummary } from "@/lib/finance/finance";
import { useCompanyFigures } from "@/components/finance/company-figures";
import { ACC_COLOR, ChartLegend, niceMax } from "@/components/finance/finance-charts";
import { formatILSShort } from "@/lib/finance/format";

const KEY = "overview.accountant";

/** The "show the accountant's figures" switch — remembered in this browser. */
export function useAccountantToggle(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(window.localStorage.getItem(KEY) === "1");
    } catch {
      /* private window: the switch just starts off */
    }
  }, []);
  const set = (v: boolean) => {
    setOn(v);
    try {
      window.localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* not remembered, still works */
    }
  };
  return [on, set];
}

/** A clear two-way switch above the chart: our books alone, or with the
 *  accountant's alongside. */
export function AccountantSwitch({ on, onChange, canShow }: { on: boolean; onChange: (on: boolean) => void; canShow: boolean }) {
  const seg = (active: boolean) =>
    `rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
      active ? "bg-brand text-white shadow-sm" : "text-muted hover:text-foreground"
    }`;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div role="group" aria-label="Compare with the accountant" className="inline-flex rounded-full border border-border bg-surface p-0.5">
        <button type="button" aria-pressed={!on} className={seg(!on)} onClick={() => onChange(false)}>Our books</button>
        <button type="button" aria-pressed={on} className={seg(on)} onClick={() => onChange(true)}>
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: ACC_COLOR }} />
          + Accountant
        </button>
      </div>
      {on && !canShow && (
        <span className="text-[12px] text-faint">His statements are yearly — pick “All time” to see them against ours.</span>
      )}
      {on && canShow && (
        <span className="text-[12px] text-faint">Orange = per his audited statements. Same years, booked his way (by invoice).</span>
      )}
    </div>
  );
}

/** Pre-tax profit per year, ours beside the accountant's — paired bars. */
export function AccountantProfitChart({ summaries }: { summaries: YearSummary[] }) {
  const { accountantYears } = useCompanyFigures();
  const rows = accountantYears.flatMap((a) => {
    const ours = summaries.find((s) => s.year === a.year);
    return ours && !ours.partial ? [{ year: a.year, ours: ours.profit, acc: a.pretaxProfit }] : [];
  });
  if (rows.length === 0) return null;
  const W = 900, H = 260, PAD = { l: 56, r: 16, t: 22, b: 28 };
  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const vals = rows.flatMap((r) => [r.ours, r.acc]);
  const max = niceMax(Math.max(0, ...vals));
  const min = Math.min(0, ...vals) < 0 ? -niceMax(-Math.min(...vals)) : 0;
  const y = (v: number) => PAD.t + plotH * (1 - (v - min) / (max - min));
  const band = plotW / rows.length;
  const bw = Math.min(band * 0.3, 44);
  const ticks = [min, 0, max / 2, max].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-1 flex items-baseline gap-2">
        <h3 className="text-[13px] font-semibold">Profit before tax · ours vs the accountant</h3>
        <span className="text-[11px] text-faint">the gap is mostly timing — see the two-year totals</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Profit per year, ours and the accountant's">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--border-strong)" : "var(--border)"} />
            <text x={PAD.l - 8} y={y(v) + 3} textAnchor="end" fontSize={11} fill="var(--muted)">{formatILSShort(v)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = PAD.l + band * i + band / 2;
          const bar = (v: number, x: number, color: string) => (
            <>
              <rect x={x} y={Math.min(y(v), y(0))} width={bw} height={Math.abs(y(v) - y(0))} rx={3} fill={color} />
              <text x={x + bw / 2} y={v >= 0 ? y(v) - 5 : y(v) + 13} textAnchor="middle" fontSize={10} fontWeight={600} fill={color}>
                {formatILSShort(v)}
              </text>
            </>
          );
          return (
            <g key={r.year}>
              {bar(r.ours, cx - bw - 1, r.ours < 0 ? "var(--danger)" : "var(--brand)")}
              {bar(r.acc, cx + 1, ACC_COLOR)}
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fontWeight={500} fill="var(--muted)">{r.year}</text>
            </g>
          );
        })}
      </svg>
      <ChartLegend items={[{ label: "Our profit", color: "var(--brand)" }, { label: "Accountant's pre-tax profit", color: ACC_COLOR }]} />
    </div>
  );
}
