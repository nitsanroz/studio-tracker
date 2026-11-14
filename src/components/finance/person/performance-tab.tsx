"use client";

// Performance: how they work, for a designer — where their hours go, how many
// they log, what an hour of theirs earns and what that returns on their pay.
// One window at a time (last month / 3 months / 12 months).

import { useState } from "react";
import { Card, SectionTitle, Loading } from "@/components/finance/ui";
import { DualLineChart, PieChart, type DualPoint } from "@/components/finance/finance-charts";
import { MONTH_SHORT } from "@/lib/finance/finance";
import { formatNum, formatPct } from "@/lib/finance/format";
import { TARGET_MARGIN } from "@/lib/finance/overview";
import { neededReturn } from "@/lib/finance/people";
import { HoursSplitBar, Meter, ReturnScale, Segmented } from "./visuals";
import type { PeriodId, PersonModel } from "./model";

/** A full studio day, from the payslips (שעות ליום 8.50). */
const FULL_DAY = 8.5;

export function PerformanceTab({ m }: { m: PersonModel }) {
  const [pid, setPid] = useState<PeriodId>("last3");
  const r = m.recent;
  if (!r) return <Loading label="Working out efficiency…" />;
  const per = r.periods[pid];
  const e = per.eff;
  const s = e.summary;
  const year = r.periods.last12.eff;
  const needed = neededReturn(per.pay);
  const day = FULL_DAY * (r.jobShare != null && r.jobShare < 1 ? r.jobShare : 1);
  const vsYear =
    pid !== "last12" && e.earnedPerHour != null && year.earnedPerHour ? e.earnedPerHour / year.earnedPerHour - 1 : null;

  const points: DualPoint[] = r.periods.last12.keys.map((k) => {
    const pm = m.ledger?.get(k);
    const mo = Number(k.slice(5, 7));
    return {
      label: `${MONTH_SHORT[mo - 1]} ${k.slice(0, 4)}`,
      axisLabel: MONTH_SHORT[mo - 1],
      a: pm?.revenue ?? 0,
      b: (pm?.salary ?? 0) + (pm?.freelance ?? 0),
    };
  });

  // Only an empty 12 months means nothing to show. An empty shorter window (no pay or hours last
  // month) used to replace the tab with this line — untrue, and with the switch gone, a dead end.
  if (!year.months)
    return <p className="py-10 text-center text-sm text-faint">Not paid and no hours in the last 12 months.</p>;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted">
        {formatNum(s.hours)}h logged over {e.months} month{e.months === 1 ? "" : "s"}
      </p>
      <Segmented
        value={pid}
        onChange={setPid}
        options={[
          { id: "last", label: "Last month" },
          { id: "last3", label: "3 months" },
          { id: "last12", label: "12 months" },
        ]}
      />
    </div>
  );
  if (!e.months)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="py-10 text-center text-sm text-faint">Not paid and no hours in this window ({per.label.toLowerCase()}).</p>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {header}

      <Card>
        <SectionTitle info="Every hour they logged in the tracker, by what it was for.">Where the hours went</SectionTitle>
        <HoursSplitBar summary={s} />
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <SectionTitle info={`Hours logged ÷ the studio's workdays (holidays out). The tick is a full day (${FULL_DAY}h), scaled to their job share on the payslips.`}>
            Hours a workday
          </SectionTitle>
          {e.hoursPerWorkday != null ? (
            <>
              <div className="mb-3 text-3xl tabular-nums">{e.hoursPerWorkday.toFixed(1)}h</div>
              <Meter value={e.hoursPerWorkday} max={10} target={day} targetLabel="their day" format={(v) => `${v.toFixed(1)}h`} />
            </>
          ) : (
            <p className="text-sm text-faint">—</p>
          )}
        </Card>
        <Card>
          <SectionTitle info="Revenue from their hours ÷ every hour they logged — the client's rate and how much of their time is billable, in one number.">
            Earned an hour
          </SectionTitle>
          {e.earnedPerHour != null ? (
            <>
              <div className="text-3xl tabular-nums">₪{formatNum(e.earnedPerHour)}</div>
              <div className="mt-1 text-xs text-muted">
                {vsYear != null ? (
                  <span className={vsYear >= 0 ? "text-success" : "text-danger"}>
                    {vsYear >= 0 ? "▲" : "▼"} {formatPct(Math.abs(vsYear), 0)} vs their 12-month average (₪{formatNum(year.earnedPerHour!)})
                  </span>
                ) : (
                  `₪${formatNum(s.revenue)} brought in`
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-faint">—</p>
          )}
        </Card>
        <Card>
          <SectionTitle
            info={
              <>
                Revenue from their hours ÷ the part of their pay that went to client work. 1× covers their pay;
                {needed != null && ` ${needed.toFixed(1)}× also carries their share of the studio's other costs (rent, the owner and office, software) and the ${Math.round(TARGET_MARGIN * 100)}% margin.`}{" "}
                Studio work isn&apos;t held against them; written-down hours are.
              </>
            }
          >
            Return
          </SectionTitle>
          {e.returnRatio != null ? (
            <>
              <div className="mb-2 text-3xl tabular-nums">{e.returnRatio.toFixed(1)}×</div>
              <ReturnScale value={e.returnRatio} needed={needed} />
            </>
          ) : (
            <p className="text-sm text-faint">Not enough tracked hours.</p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle hint="last 12 months" info="What their hours brought in (blue) against what they cost (red), month by month.">
            Revenue vs cost
          </SectionTitle>
          <DualLineChart points={points} aLabel="Revenue from hours" bLabel="Cost" />
        </Card>
        <Card>
          <SectionTitle hint={per.label.toLowerCase()} info="Where their hours went, by client, in the window picked above.">
            Clients
          </SectionTitle>
          {s.clients.length ? (
            <PieChart
              slices={[
                ...s.clients.slice(0, 6).map((c) => ({ label: c.client, value: c.hours })),
                ...(s.clients.length > 6
                  ? [{ label: `Others (${s.clients.length - 6})`, value: s.clients.slice(6).reduce((t, c) => t + c.hours, 0) }]
                  : []),
              ]}
              layout="stacked"
              size={150}
              ariaLabel="Share of hours by client"
              formatValue={(v) => `${formatNum(v)}h`}
              formatTotal={(v) => `${formatNum(v)}h`}
            />
          ) : (
            <p className="py-10 text-center text-sm text-faint">No tracked hours.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
