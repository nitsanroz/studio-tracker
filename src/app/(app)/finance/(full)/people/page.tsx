"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown } from "lucide-react";
import { usePeople } from "@/lib/finance/people-data";
import { PositionTag } from "@/components/finance/position-tag";
import { SHARED_ACCOUNT_NAME, finishedThrough, hoursAreOwnWork, summarize, type PersonSummary } from "@/lib/finance/people";
import { PageHeader, Loading, ErrorState, InfoDot } from "@/components/finance/ui";
import { PageViews, TEAM_VIEWS } from "@/components/page-views";
import { formatILS, formatNum, formatPct } from "@/lib/finance/format";

type SortKey = "name" | "cost" | "hours" | "costPerHour" | "revenue" | "returnRatio";

const COLUMNS: { key: SortKey; label: string; info: string; align?: "left" }[] = [
  { key: "name", label: "Person", info: "Everyone paid in the period (only people still in the studio, unless Everyone is picked). Open a person for their months, clients and details.", align: "left" },
  { key: "cost", label: "Cost", info: "Salary plus freelance payments in the period, finished months only." },
  { key: "hours", label: "Hours", info: "Hours they logged in the tracker, on any task. A project manager's include freelancers' hours they logged for them." },
  { key: "costPerHour", label: "Cost / hour", info: "Cost ÷ hours logged — what an hour of theirs cost the studio. Blank for someone who logs under 20h a paid month (owner, office managers)." },
  { key: "revenue", label: "Revenue from hours", info: "Their billable hours × each client's rate at the time — what their work brought in." },
  { key: "returnRatio", label: "Return", info: "Revenue from their hours ÷ the part of their cost that went to client work. Hours on Studio (the website, internal projects) are an investment the whole studio carries, so they aren't held against them; hours written down to Keys earn nothing and are. Above 1× their work covered their cost; it also has to carry rent and the rest." },
];

export default function PeoplePage() {
  const { data, error, loading } = usePeople();
  // The year of the last finished month: the calendar year opened an empty table all January.
  const [period, setPeriod] = useState<number | "all">(() => Number(finishedThrough().slice(0, 4)));
  const [sort, setSort] = useState<SortKey>("cost");
  const [activeOnly, setActiveOnly] = useState(true);

  const rows = useMemo(() => {
    if (!data) return [];
    const year = period === "all" ? null : period;
    return data.people
      .filter((p) => p.name !== SHARED_ACCOUNT_NAME && (!activeOnly || p.active))
      .map((p) => ({ person: p, s: summarize(data.ledgers.get(p.id), year, finishedThrough(), hoursAreOwnWork(p.position)) }))
      .filter((r) => r.s.cost > 0 || r.s.hours >= 1);
  }, [data, period, activeOnly]);

  const sorted = useMemo(() => {
    const val = (s: PersonSummary, k: SortKey) => (k === "name" ? 0 : (s[k] ?? -Infinity));
    return [...rows].sort((a, b) =>
      sort === "name" ? a.person.name.localeCompare(b.person.name) : val(b.s, sort) - val(a.s, sort),
    );
  }, [rows, sort]);

  const years = useMemo(() => {
    const ys = new Set<number>();
    for (const l of data?.ledgers.values() ?? []) for (const m of l.values()) if (m.salary + m.freelance > 0) ys.add(m.year);
    return [...ys].sort((a, b) => b - a);
  }, [data]);

  if (loading) return <Loading label="Loading people…" />;
  if (error) return <ErrorState message={error} />;

  // Hours and revenue only from people whose hours are their own work; cost from everyone.
  const total = rows.reduce(
    (t, r) => {
      const own = hoursAreOwnWork(r.person.position);
      return {
        cost: t.cost + r.s.cost,
        ownCost: t.ownCost + (own ? r.s.cost : 0),
        // Return over the rows that show one, so it follows the rows' own
        // rules (tracked, enough client work) rather than restating them.
        retRevenue: t.retRevenue + (r.s.returnRatio != null ? r.s.revenue : 0),
        retCost: t.retCost + (r.s.returnRatio != null ? r.s.clientCost : 0),
        hours: t.hours + (own ? r.s.hours : 0),
        revenue: t.revenue + r.s.revenue,
      };
    },
    { cost: 0, ownCost: 0, retRevenue: 0, retCost: 0, hours: 0, revenue: 0 },
  );

  return (
    <div className="mx-auto max-w-6xl">
      {/* Team | Pay & HR — this is the Team page's money view. */}
      <PageViews views={TEAM_VIEWS} className="mb-3" />
      <PageHeader
        title="Pay & HR"
        subtitle="What each person cost against the work their hours brought in."
        actions={
          <>
            <div className="flex rounded-lg border border-border-strong p-0.5 text-sm" role="group" aria-label="Who to show">
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  onClick={() => setActiveOnly(v)}
                  aria-pressed={activeOnly === v}
                  className={`rounded-md px-2.5 py-1 ${activeOnly === v ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
                >
                  {v ? "Active" : "Everyone"}
                </button>
              ))}
            </div>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm"
            >
              <option value="all">All time</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </>
        }
      />
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-[11px] font-medium uppercase tracking-wide text-faint">
              {COLUMNS.map((c) => (
                <th key={c.key} className={`px-3 py-2 ${c.align === "left" ? "text-left" : "text-right"}`}>
                  <span className={`inline-flex items-center gap-1 ${c.align === "left" ? "" : "justify-end"}`}>
                    <button onClick={() => setSort(c.key)} className="inline-flex items-center gap-0.5 uppercase hover:text-foreground">
                      {c.label}
                      {sort === c.key && <ArrowDown size={11} />}
                    </button>
                    <InfoDot align={c.align === "left" ? undefined : "right"}>{c.info}</InfoDot>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ person, s }) => (
              <tr
                key={person.id}
                title={person.active ? undefined : "No longer in the studio"}
                className={`border-b border-border last:border-0 hover:bg-background ${person.active ? "" : "text-faint"}`}
              >
                <td className="px-3 py-2 text-left">
                  <Link href={`/finance/people/${person.id}`} className="font-medium hover:underline">
                    {person.name}
                  </Link>
                  <PositionTag position={person.position} />
                </td>
                <td className="px-3 py-2 text-right">{s.cost ? formatILS(Math.round(s.cost)) : "—"}</td>
                <td className="px-3 py-2 text-right">{s.hours >= 1 ? formatNum(s.hours) : "—"}</td>
                <td className="px-3 py-2 text-right">{s.costPerHour != null ? `₪${formatNum(s.costPerHour)}` : "—"}</td>
                <td className="px-3 py-2 text-right">{s.revenue ? formatILS(Math.round(s.revenue)) : "—"}</td>
                <td className={`px-3 py-2 text-right font-medium ${s.returnRatio != null && s.returnRatio < 1 ? "text-danger" : ""}`}>
                  {s.returnRatio != null ? `${s.returnRatio.toFixed(1)}×` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border-strong bg-surface-2 font-medium">
              <td className="px-3 py-2 text-left text-muted">{rows.length} people</td>
              <td className="px-3 py-2 text-right">{formatILS(Math.round(total.cost))}</td>
              <td className="px-3 py-2 text-right">{formatNum(total.hours)}</td>
              <td className="px-3 py-2 text-right">{total.hours >= 1 ? `₪${formatNum(total.ownCost / total.hours)}` : "—"}</td>
              <td className="px-3 py-2 text-right">{formatILS(Math.round(total.revenue))}</td>
              <td className="px-3 py-2 text-right">{total.retCost ? `${(total.retRevenue / total.retCost).toFixed(1)}×` : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-faint">
        {"Finished months only. Project managers log freelancers' hours, and office managers and the owner barely log any, so their hours aren't counted as their own work — the totals take their cost, not their hours."}
        {data?.historyCoverage != null &&
          ` Before 2023 only ${formatPct(data.historyCoverage, 0)} of tracked hours have a person, so earlier years understate what people worked.`}
      </p>
    </div>
  );
}
