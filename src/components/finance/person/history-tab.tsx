"use client";

// History: their whole time at the studio — revenue against cost and hours,
// month by month, and every year side by side. Pick a year to zoom in.

import { FileX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { useState } from "react";
import { Card, SectionTitle } from "@/components/finance/ui";
import { DualLineChart, MonthlyLineChart, type DualPoint, type MonthPoint } from "@/components/finance/finance-charts";
import { MONTH_SHORT } from "@/lib/finance/finance";
import { formatHours, formatILS, formatNum } from "@/lib/finance/format";
import { monthsOf, summarize, type PersonSummary } from "@/lib/finance/people";
import type { PersonModel } from "./model";

export function HistoryTab({ m }: { m: PersonModel }) {
  const [year, setYear] = useState<number | null>(null);
  const { ledger, upTo, own } = m;
  const activeMonths = monthsOf(ledger, null).filter((x) => x.salary + x.freelance > 0 || x.hours >= 1);
  const years = [...new Set(activeMonths.map((x) => x.year))].sort((a, b) => b - a);
  if (!activeMonths.length) return <EmptyState compact icon={FileX} text="No pay or hours on record." />;

  // Month by month: one year's twelve, or all time from their first month to
  // the last finished one, ticked at each January.
  const finished = (y: number, mo: number) => `${y}-${String(mo).padStart(2, "0")}` <= upTo;
  const span: { y: number; m: number }[] = [];
  if (year) for (let mo = 1; mo <= 12; mo++) span.push({ y: year, m: mo });
  else {
    const last = activeMonths.filter((x) => finished(x.year, x.month)).at(-1) ?? activeMonths[activeMonths.length - 1];
    for (let y = activeMonths[0].year, mo = activeMonths[0].month; y < last.year || (y === last.year && mo <= last.month); mo === 12 ? (y++, (mo = 1)) : mo++)
      span.push({ y, m: mo });
  }
  const at = (y: number, mo: number) => ledger?.get(`${y}-${String(mo).padStart(2, "0")}`);
  const label = (y: number, mo: number) => (year ? MONTH_SHORT[mo - 1] : `${MONTH_SHORT[mo - 1]} ${y}`);
  const axis = (y: number, mo: number) => (year ? undefined : mo === 1 || span.length <= 14 ? `${MONTH_SHORT[mo - 1]} ${String(y).slice(2)}` : "");
  const points: DualPoint[] = span.map(({ y, m: mo }) => {
    const x = at(y, mo);
    return { label: label(y, mo), axisLabel: axis(y, mo), a: x?.revenue ?? 0, b: (x?.salary ?? 0) + (x?.freelance ?? 0), future: !finished(y, mo) };
  });
  const hours: MonthPoint[] = span.map(({ y, m: mo }) => ({ label: label(y, mo), axisLabel: axis(y, mo), value: at(y, mo)?.hours ?? 0, future: !finished(y, mo) }));
  const all = summarize(ledger, null, upTo, own);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Showing</span>
        <select
          value={year ?? "all"}
          onChange={(e) => setYear(e.target.value === "all" ? null : Number(e.target.value))}
          className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm"
        >
          <option value="all">All time</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${own ? "lg:grid-cols-3" : ""}`}>
        <Card className={own ? "lg:col-span-2" : ""}>
          <SectionTitle
            hint="by month"
            info={own ? "What their hours brought in (blue) against what they cost (red), month by month." : "What they cost the studio, month by month."}
          >
            {own ? "Revenue from hours vs cost" : "Cost"}
          </SectionTitle>
          {/* Their hours aren't their own work, so no revenue is set against them (the By-year table
              shows "—"); the card titled "Cost" used to draw a revenue line all the same. */}
          {own ? (
            <DualLineChart points={points} aLabel="Revenue from hours" bLabel="Cost" />
          ) : (
            <MonthlyLineChart
              points={points.map((p) => ({ label: p.label, axisLabel: p.axisLabel, value: p.b, future: p.future }))}
              seriesLabel="Cost"
              totalLabel={year ? `in ${year}` : "all time"}
              color="var(--danger)"
              trendOverride={null}
            />
          )}
        </Card>
        {own && (
          <Card>
            <SectionTitle hint="by month" info="Every hour they logged in the tracker, month by month.">
              Hours
            </SectionTitle>
            <MonthlyLineChart
              points={hours}
              seriesLabel="Hours"
              totalLabel={year ? `in ${year}` : "all time"}
              formatValue={formatHours}
              formatDetail={formatHours}
              higherIsBetter
              trendOverride={null}
            />
          </Card>
        )}
      </div>

      <Card>
        <SectionTitle info="Click a year to show it in the charts above.">By year</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead>
              <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-faint">
                {["Year", "Salary", "Freelance", "Hours", "Billable", "Cost / hour", "Revenue from hours", "Return"].map((h, i) => (
                  <th key={h} className={`whitespace-nowrap px-2 py-1.5 ${i ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <YearRow key={y} label={String(y)} s={summarize(ledger, y, upTo, own)} active={year === y} onClick={() => setYear(year === y ? null : y)} />
              ))}
            </tbody>
            <tfoot>
              <YearRow label="All time" s={all} active={year == null} onClick={() => setYear(null)} total />
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

function YearRow({ label, s, active, onClick, total = false }: { label: string; s: PersonSummary; active: boolean; onClick: () => void; total?: boolean }) {
  return (
    <tr
      onClick={onClick}
      className={`cursor-pointer border-b border-border last:border-0 hover:bg-background ${active ? "bg-brand-soft/60" : ""} ${total ? "border-t border-border-strong font-medium" : ""}`}
    >
      <td className="px-2 py-1.5 text-left">{label}</td>
      <td className="px-2 py-1.5 text-right">{s.salary ? formatILS(Math.round(s.salary)) : "—"}</td>
      <td className="px-2 py-1.5 text-right">{s.freelance ? formatILS(Math.round(s.freelance)) : "—"}</td>
      <td className="px-2 py-1.5 text-right">{s.hours >= 1 ? formatNum(s.hours) : "—"}</td>
      <td className="px-2 py-1.5 text-right">{s.billableShare != null ? `${Math.round(s.billableShare * 100)}%` : "—"}</td>
      <td className="px-2 py-1.5 text-right">{s.costPerHour != null ? `₪${formatNum(s.costPerHour)}` : "—"}</td>
      <td className="px-2 py-1.5 text-right">{s.revenue ? formatILS(Math.round(s.revenue)) : "—"}</td>
      <td className={`px-2 py-1.5 text-right ${s.returnRatio != null && s.returnRatio < 1 ? "text-danger" : ""}`}>
        {s.returnRatio != null ? `${s.returnRatio.toFixed(1)}×` : "—"}
      </td>
    </tr>
  );
}
