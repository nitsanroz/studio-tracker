"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/db";
import {
  formatILS,
  formatILSShort,
  formatPct,
  formatSignedPct,
} from "@/lib/format";
import {
  LINE,
  PARTIAL_YEARS,
  annualize,
  inPeriod,
  isForecast,
  monthsElapsed,
  periodLabel,
  summarizeRows,
  summarizeYear,
  yearsIn,
  yoy,
  type ClientMonthly,
  type PeriodSel,
  type PeriodSummary,
  type PnlMonthly,
  type YearSummary,
} from "@/lib/finance";
import {
  BreakEvenChart,
  CostStructureChart,
  RateTrendChart,
  TrendChart,
  UtilizationChart,
  type BreakEvenMonth,
  type CostYear,
  type FinanceEvent,
  type RatePoint,
  type UtilizationPoint,
} from "@/components/finance-charts";
import { ClientChip, CollapseChevron } from "@/components/ui";

interface PnlRow {
  year: number;
  month: number;
  line_item: string;
  value: number | string;
  state: PnlMonthly["state"];
  source: string;
}
interface EventRow {
  year: number;
  month: number | null;
  event: string;
  category: string | null;
  note: string | null;
}
interface ClientMonthlyRow {
  year: number;
  month: number;
  client_id: string | null;
  client_canon: string;
  discipline: string | null;
  sub_account: string;
  hours: number | string;
  rate: number | string | null;
  revenue_gross: number | string;
  state: PnlMonthly["state"];
}

// ── small helpers ────────────────────────────────────────────────────────────

/** Fine-print explanations open in a click-toggled popover on the ⓘ icon. */
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex ${open ? "text-brand" : "text-muted hover:text-brand"}`}
        aria-label="More info"
      >
        <Info size={12} />
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <span className="absolute left-1/2 top-full z-40 mt-1.5 w-64 -translate-x-1/2 rounded-lg border border-border bg-surface p-2.5 text-left text-xs font-normal normal-case leading-relaxed text-muted shadow-xl">
            {text}
          </span>
        </>
      )}
    </span>
  );
}

/** Simple money bar block (div-based) with value labels; red for negatives. */
function MoneyBars({
  points,
}: {
  points: { label: string; value: number }[];
}) {
  const max = Math.max(...points.map((p) => Math.abs(p.value)), 1);
  return (
    <div className="flex items-end gap-1 pt-5">
      {points.map((p) => (
        <div key={p.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="text-[9px] tabular-nums text-muted">
            {p.value !== 0 ? formatILSShort(p.value) : ""}
          </span>
          <div className="flex h-20 w-full items-end">
            <div
              className="w-full rounded-t"
              style={{
                height: `${Math.max(2, (Math.abs(p.value) / max) * 100)}%`,
                background: p.value < 0 ? "var(--danger)" : "var(--brand)",
                opacity: p.value < 0 ? 0.85 : 0.85,
              }}
              title={`${p.label}: ${formatILS(p.value)}`}
            />
          </div>
          <span className="truncate text-[9px] text-faint">{p.label}</span>
        </div>
      ))}
    </div>
  );
}

function Kpi({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: { text: string; good: boolean | null };
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-heading font-semibold tabular-nums">{value}</div>
      {delta && (
        <div
          className="mt-1 text-xs tabular-nums"
          style={{
            color:
              delta.good == null
                ? "var(--muted)"
                : delta.good
                  ? "var(--success)"
                  : "var(--danger)",
          }}
        >
          {delta.text} <span className="text-faint">YoY</span>
        </div>
      )}
    </div>
  );
}

/** Percentage-point delta (for margin / ratio KPIs). */
function ppDelta(current: number, prior: number): string {
  const pp = (current - prior) * 100;
  return `${pp >= 0 ? "+" : ""}${pp.toFixed(1)} pp`;
}

const fmtHours = (h: number) => `${Math.round(h).toLocaleString("en-US")}h`;

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── page ─────────────────────────────────────────────────────────────────────

export default function FinancePage() {
  const { profiles, clients, currentUserId, loading: storeLoading } = useData();
  const me = profiles.find((p) => p.id === currentUserId) ?? null;
  const isAdmin = me?.role === "admin";

  const supabase = useMemo(() => createClient(), []);
  const [pnl, setPnl] = useState<PnlMonthly[]>([]);
  const [clientMonthly, setClientMonthly] = useState<ClientMonthly[]>([]);
  const [events, setEvents] = useState<FinanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // time filter
  const nowYear = new Date().getFullYear();
  const [sel, setSel] = useState<PeriodSel>({ kind: "all" });
  const [dropYear, setDropYear] = useState(nowYear);
  // client view
  const [discipline, setDiscipline] = useState("");
  const [expandedCanons, setExpandedCanons] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const [pnlRows, cliRows, evRows] = await Promise.all([
          fetchAll<PnlRow>(supabase, "finance_pnl_monthly", "year,month,line_item,value,state,source"),
          fetchAll<ClientMonthlyRow>(
            supabase,
            "finance_client_monthly",
            "year,month,client_id,client_canon,discipline,sub_account,hours,rate,revenue_gross,state",
          ),
          fetchAll<EventRow>(supabase, "finance_events", "year,month,event,category,note"),
        ]);
        if (cancelled) return;
        setPnl(
          pnlRows.map((r) => ({
            year: r.year,
            month: r.month,
            lineItem: r.line_item,
            value: Number(r.value),
            state: r.state,
            source: r.source,
          })),
        );
        setClientMonthly(
          cliRows.map((r) => ({
            year: r.year,
            month: r.month,
            clientId: r.client_id,
            clientCanon: r.client_canon,
            discipline: r.discipline,
            subAccount: r.sub_account,
            hours: Number(r.hours),
            rate: r.rate == null ? null : Number(r.rate),
            revenueGross: Number(r.revenue_gross),
            state: r.state,
          })),
        );
        setEvents(
          evRows.map((r) => ({
            year: r.year,
            month: r.month,
            event: r.event,
            category: r.category,
            note: r.note,
          })),
        );
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load finance data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, supabase]);

  const years = useMemo(() => yearsIn(pnl), [pnl]);

  // all-time per-year summaries (trend + rate charts stay unfiltered)
  const allSummaries = useMemo<YearSummary[]>(
    () => years.map((y) => summarizeYear(pnl, y)),
    [pnl, years],
  );

  // rows inside the selected scope
  const filteredPnl = useMemo(
    () => pnl.filter((r) => inPeriod(sel, r.year, r.month)),
    [pnl, sel],
  );

  // per-month summaries within the scope (for the scoped revenue/profit views)
  const monthlyScoped = useMemo(() => {
    const keys = new Map<string, PnlMonthly[]>();
    for (const r of filteredPnl) {
      const k = `${r.year}-${String(r.month).padStart(2, "0")}`;
      if (!keys.has(k)) keys.set(k, []);
      keys.get(k)!.push(r);
    }
    return [...keys.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, rows]) => {
        const s = summarizeRows(rows);
        return { year: Number(k.slice(0, 4)), month: Number(k.slice(5)), ...s };
      });
  }, [filteredPnl]);

  // ── KPI header for the selected scope ──
  const kpi = useMemo(() => {
    if (pnl.length === 0) return null;
    if (sel.kind === "all") {
      const fullYears = years.filter((y) => !PARTIAL_YEARS.has(y));
      const headerYear = fullYears.length ? Math.max(...fullYears) : years[years.length - 1];
      const cur: PeriodSummary = summarizeYear(pnl, headerYear);
      const prev: PeriodSummary | null = years.includes(headerYear - 1)
        ? summarizeYear(pnl, headerYear - 1)
        : null;
      return { label: `${headerYear} (latest full year)`, cur, prev, note: null as string | null };
    }
    if (sel.kind === "year") {
      const partial = PARTIAL_YEARS.has(sel.year);
      const cur: PeriodSummary = summarizeYear(pnl, sel.year);
      // never compare a partial year's raw totals to a full year
      const prev: PeriodSummary | null =
        !partial && years.includes(sel.year - 1) ? summarizeYear(pnl, sel.year - 1) : null;
      const note = partial
        ? `H1 only (partial year) — raw totals aren't comparable to full years. Annualized run-rate revenue ≈ ${formatILSShort(annualize(cur.revenue, monthsElapsed(pnl, sel.year)))}.`
        : null;
      return { label: `${sel.year}${partial ? " · H1" : ""}`, cur, prev, note };
    }
    return {
      label: periodLabel(sel),
      cur: summarizeRows(filteredPnl),
      prev: null as PeriodSummary | null,
      note: null as string | null,
    };
  }, [pnl, filteredPnl, sel, years]);

  // ── by-year table + cost structure, from the filtered scope ──
  const scopedByYear = useMemo(() => {
    const byYear = new Map<number, PnlMonthly[]>();
    for (const r of filteredPnl) {
      const arr = byYear.get(r.year) ?? [];
      arr.push(r);
      byYear.set(r.year, arr);
    }
    return [...byYear.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, rows]) => ({
        year,
        // only badge H1 when the scope shows the whole (partial) year
        partial: PARTIAL_YEARS.has(year) && (sel.kind === "all" || sel.kind === "year"),
        s: summarizeRows(rows),
      }))
      .filter((r) => r.s.revenue !== 0 || r.s.hours !== 0 || r.s.profit !== 0);
  }, [filteredPnl, sel]);

  const costYears = useMemo<CostYear[]>(
    () =>
      scopedByYear
        .filter((r) => r.s.revenue > 0)
        .map((r) => ({
          year: r.year,
          partial: r.partial,
          salaries: r.s.salaries / r.s.revenue,
          freelance: r.s.freelance / r.s.revenue,
          rent: r.s.rent / r.s.revenue,
          other: r.s.otherExpenses / r.s.revenue,
        })),
    [scopedByYear],
  );

  // ── monthly line-item lookup (actuals only) ──
  const monthLine = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of pnl) {
      if (isForecast(r.state)) continue;
      map.set(`${r.year}-${r.month}-${r.lineItem}`, r.value);
    }
    return map;
  }, [pnl]);

  // ── rate & utilization ──
  const ratePoints = useMemo<RatePoint[]>(
    () =>
      allSummaries
        .filter((s) => s.hours > 0)
        .map((s) => ({ year: s.year, rate: s.avgRate, partial: s.partial })),
    [allSummaries],
  );

  const utilPoints = useMemo<UtilizationPoint[]>(() => {
    // capacity lines exist from 2023 only — never fabricate earlier years
    const out: UtilizationPoint[] = [];
    for (const y of years) {
      if (y < 2023) continue;
      let hours = 0;
      let maxHours = 0;
      for (let m = 1; m <= 12; m++) {
        const cap = monthLine.get(`${y}-${m}-${LINE.maxHours}`);
        if (cap == null || cap <= 0) continue; // months without capacity data
        maxHours += cap;
        hours += monthLine.get(`${y}-${m}-${LINE.totalHours}`) ?? 0;
      }
      if (maxHours > 0) out.push({ year: y, partial: PARTIAL_YEARS.has(y), hours, maxHours });
    }
    return out;
  }, [years, monthLine]);

  // ── break-even (per month, one year) ──
  const beYear = sel.kind === "all" ? (years[years.length - 1] ?? nowYear) : sel.year;
  const beMonths = useMemo<BreakEvenMonth[]>(() => {
    const out: BreakEvenMonth[] = [];
    for (let m = 1; m <= 12; m++) {
      const hours = monthLine.get(`${beYear}-${m}-${LINE.totalHours}`);
      if (hours == null) continue; // no actuals for this month (e.g. 2026 H2 forecast)
      out.push({
        month: m,
        hours,
        minHours: monthLine.get(`${beYear}-${m}-${LINE.minHoursBE}`) ?? null,
      });
    }
    return out;
  }, [beYear, monthLine]);

  // ── client view ──
  const disciplines = useMemo(
    () =>
      [...new Set(clientMonthly.map((r) => r.discipline).filter((d): d is string => !!d))].sort(),
    [clientMonthly],
  );

  const clientView = useMemo(() => {
    interface CanonAgg {
      canon: string;
      clientId: string | null;
      revenue: number;
      hours: number;
      subs: Map<string, { revenue: number; hours: number }>;
    }
    const byCanon = new Map<string, CanonAgg>();
    const yearsActive = new Map<string, Set<number>>();
    for (const r of clientMonthly) {
      if (isForecast(r.state)) continue;
      // loyalty counts all history, ignoring the time filter
      if (r.revenueGross > 0 || r.hours > 0) {
        let ys = yearsActive.get(r.clientCanon);
        if (!ys) yearsActive.set(r.clientCanon, (ys = new Set()));
        ys.add(r.year);
      }
      if (!inPeriod(sel, r.year, r.month)) continue;
      if (discipline && r.discipline !== discipline) continue;
      let agg = byCanon.get(r.clientCanon);
      if (!agg) {
        byCanon.set(
          r.clientCanon,
          (agg = { canon: r.clientCanon, clientId: r.clientId, revenue: 0, hours: 0, subs: new Map() }),
        );
      }
      if (!agg.clientId && r.clientId) agg.clientId = r.clientId;
      agg.revenue += r.revenueGross;
      agg.hours += r.hours;
      const sub = agg.subs.get(r.subAccount) ?? { revenue: 0, hours: 0 };
      sub.revenue += r.revenueGross;
      sub.hours += r.hours;
      agg.subs.set(r.subAccount, sub);
    }
    const list = [...byCanon.values()].sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = list.reduce((s, c) => s + c.revenue, 0);
    const top1 = totalRevenue > 0 && list[0] ? list[0].revenue / totalRevenue : null;
    const top3 =
      totalRevenue > 0
        ? list.slice(0, 3).reduce((s, c) => s + c.revenue, 0) / totalRevenue
        : null;
    return { list, totalRevenue, top1, top3, yearsActive };
  }, [clientMonthly, sel, discipline]);

  if (storeLoading || loading) {
    return <div className="text-sm text-muted">Loading finance…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        The Finance section is available to studio owners only.
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-danger/40 bg-surface p-6 text-sm text-danger">
        {error}
      </div>
    );
  }
  if (pnl.length === 0 || !kpi) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-sm text-muted">
        No finance data yet. Run the finance migrations (0005 + 0006) to load history.
      </div>
    );
  }

  const { cur, prev } = kpi;
  const yearOptions = years.length ? years : [nowYear];

  const pillCls = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm font-medium ${
      active
        ? "border-brand bg-brand-soft text-brand-dark"
        : "border-border bg-surface text-muted hover:border-border-strong"
    }`;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-heading font-semibold">Finance</h1>
          <p className="mt-0.5 text-sm text-muted">
            Studio&amp;More · 10-year overview · figures in ₪ (ILS)
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-right text-xs text-muted">
          KPIs for <span className="font-semibold text-foreground">{kpi.label}</span>
          {kpi.note && <InfoTip text={kpi.note} />}
        </div>
      </div>

      {/* time filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={pillCls(sel.kind === "all")} onClick={() => setSel({ kind: "all" })}>
          All time
        </button>
        <button
          className={pillCls(sel.kind === "year" && sel.year === nowYear)}
          onClick={() => {
            setDropYear(nowYear);
            setSel({ kind: "year", year: nowYear });
          }}
        >
          This year
        </button>
        <button
          className={pillCls(sel.kind === "year" && sel.year === nowYear - 1)}
          onClick={() => {
            setDropYear(nowYear - 1);
            setSel({ kind: "year", year: nowYear - 1 });
          }}
        >
          Last year
        </button>
        <button
          className={pillCls(sel.kind === "month")}
          onClick={() =>
            setSel({ kind: "month", year: nowYear, month: new Date().getMonth() + 1 })
          }
        >
          This month
        </button>
        {([1, 2, 3, 4] as const).map((q) => (
          <button
            key={q}
            className={pillCls(sel.kind === "quarter" && sel.q === q && sel.year === dropYear)}
            onClick={() => setSel({ kind: "quarter", year: dropYear, q })}
          >
            Q{q}
          </button>
        ))}
        <select
          value={dropYear}
          onChange={(e) => {
            const y = Number(e.target.value);
            setDropYear(y);
            setSel(sel.kind === "quarter" ? { ...sel, year: y } : { kind: "year", year: y });
          }}
          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          title="Pick a year — Q1–Q4 scope to it"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {/* KPI header */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi
          label="Revenue"
          value={formatILSShort(cur.revenue)}
          delta={prev ? { text: formatSignedPct(yoy(cur.revenue, prev.revenue).pct), good: cur.revenue >= prev.revenue } : undefined}
        />
        <Kpi
          label="Profit"
          value={formatILSShort(cur.profit)}
          delta={prev ? { text: formatSignedPct(yoy(cur.profit, prev.profit).pct), good: cur.profit >= prev.profit } : undefined}
        />
        <Kpi
          label="Margin"
          value={formatPct(cur.margin)}
          delta={prev ? { text: ppDelta(cur.margin, prev.margin), good: cur.margin >= prev.margin } : undefined}
        />
        <Kpi
          label="Total hours"
          value={Math.round(cur.hours).toLocaleString("en-US")}
          delta={prev ? { text: formatSignedPct(yoy(cur.hours, prev.hours).pct), good: cur.hours >= prev.hours } : undefined}
        />
        <Kpi
          label="Avg rate"
          value={formatILS(cur.avgRate)}
          delta={prev ? { text: formatSignedPct(yoy(cur.avgRate, prev.avgRate).pct), good: cur.avgRate >= prev.avgRate } : undefined}
        />
        <Kpi
          label="Salaries % of rev"
          value={formatPct(cur.salariesPctRev)}
          delta={prev ? { text: ppDelta(cur.salariesPctRev, prev.salariesPctRev), good: cur.salariesPctRev <= prev.salariesPctRev } : undefined}
        />
      </div>

      {/* main body: 4/6 left + 2/6 right */}
      <div className="grid items-start gap-4 lg:grid-cols-6">
      <div className="space-y-4 lg:col-span-4">

      {/* Revenue & profit — scoped by the time filter */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="text-sm font-heading font-semibold">
            Revenue &amp; profit margin ·{" "}
            {sel.kind === "all" ? `${years[0]}–${years[years.length - 1]}` : periodLabel(sel)}
          </h2>
          <InfoTip text="2026 is H1 only (partial year) — never compare its raw total to full years. All-time shows yearly bars; a narrowed filter shows that scope month by month. Hover a bar for exact values; hover an event marker for what happened and its effect." />
        </div>
        {sel.kind === "all" ? (
          <TrendChart summaries={allSummaries} events={events} />
        ) : (
          <MoneyBars
            points={monthlyScoped.map((m) => ({
              label: MONTH_LABELS[m.month - 1],
              value: m.revenue,
            }))}
          />
        )}
      </div>

      {/* Cost structure */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="text-sm font-heading font-semibold">
            Cost structure · % of revenue
            {sel.kind !== "all" && (
              <span className="ml-1 text-xs font-normal text-muted">· {periodLabel(sel)}</span>
            )}
          </h2>
          <InfoTip text="Each block is that expense as a share of the period's revenue (net of VAT). Salaries % (labeled) is the margin driver — it spiked in 2024 and drove the loss. A bar crossing the dashed red 100% line means expenses ate all revenue." />
        </div>
        <CostStructureChart data={costYears} />
        {costYears.length === 0 && (
          <p className="py-4 text-center text-sm text-faint">No revenue in this scope.</p>
        )}
      </div>

      {/* Client view */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-heading font-semibold">
              Clients · top by revenue
              <span className="ml-1 text-xs font-normal text-muted">· {periodLabel(sel)}</span>
            </h2>
            <InfoTip text="From the imported client ledger (actuals only, gross ₪). Concentration = the top client's / top-3 clients' share of the scope's client revenue. Years active counts calendar years with any activity, across all history." />
          </div>
          <select
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value)}
            className="ml-auto rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">All disciplines</option>
            {disciplines.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
          <span>
            Top client:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {clientView.top1 == null ? "–" : formatPct(clientView.top1, 0)}
            </span>{" "}
            of revenue
          </span>
          <span>
            Top 3:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {clientView.top3 == null ? "–" : formatPct(clientView.top3, 0)}
            </span>
          </span>
          <span>
            Clients:{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {clientView.list.length}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-3 border-b border-border pb-2 text-xs font-medium uppercase tracking-wide text-faint">
          <span className="min-w-0 flex-1">Client</span>
          <span className="w-16 shrink-0 text-right">Years</span>
          <span className="w-20 shrink-0 text-right">Hours</span>
          <span className="w-24 shrink-0 text-right">Revenue</span>
          <span className="w-14 shrink-0 text-right">Share</span>
        </div>
        {clientView.list.slice(0, 15).map((c) => {
          const live = c.clientId ? clients.find((cl) => cl.id === c.clientId) : undefined;
          const share = clientView.totalRevenue > 0 ? c.revenue / clientView.totalRevenue : 0;
          const expandable = c.subs.size > 1;
          const open = expandedCanons.has(c.canon);
          return (
            <div key={c.canon} className="border-b border-border last:border-b-0">
              <div
                className={`flex items-center gap-3 py-2 text-sm ${expandable ? "cursor-pointer hover:bg-background" : ""}`}
                onClick={() => {
                  if (!expandable) return;
                  setExpandedCanons((prevSet) => {
                    const next = new Set(prevSet);
                    if (next.has(c.canon)) next.delete(c.canon);
                    else next.add(c.canon);
                    return next;
                  });
                }}
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {expandable && <CollapseChevron open={open} />}
                  {live ? (
                    <ClientChip client={live} size="sm" link={false} />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium capitalize">
                      <span className="size-2 shrink-0 rounded-full bg-faint" />
                      {c.canon}
                    </span>
                  )}
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted">
                  {clientView.yearsActive.get(c.canon)?.size ?? "–"}
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted">
                  {fmtHours(c.hours)}
                </span>
                <span className="w-24 shrink-0 text-right font-medium tabular-nums">
                  {formatILSShort(c.revenue)}
                </span>
                <span className="w-14 shrink-0 text-right tabular-nums text-muted">
                  {formatPct(share, 0)}
                </span>
              </div>
              {open &&
                [...c.subs.entries()]
                  .sort((a, b) => b[1].revenue - a[1].revenue)
                  .map(([sub, v]) => (
                    <div
                      key={sub}
                      className="flex items-center gap-3 py-1 pl-7 text-xs text-muted"
                    >
                      <span className="min-w-0 flex-1 truncate capitalize">{sub}</span>
                      <span className="w-20 shrink-0 text-right tabular-nums">{fmtHours(v.hours)}</span>
                      <span className="w-24 shrink-0 text-right tabular-nums">
                        {formatILSShort(v.revenue)}
                      </span>
                      <span className="w-14 shrink-0" />
                    </div>
                  ))}
            </div>
          );
        })}
        {clientView.list.length === 0 && (
          <p className="py-4 text-center text-sm text-faint">No client revenue in this scope.</p>
        )}
        {clientView.list.length > 15 && (
          <p className="mt-2 text-xs text-faint">
            Showing top 15 of {clientView.list.length} — concentration stats cover all of them.
          </p>
        )}
      </div>

      </div>{/* /left column */}

      <div className="space-y-4 lg:col-span-2">

      {/* Profit graph (replaces the by-year table) */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="text-sm font-heading font-semibold">
            Profit · {sel.kind === "all" ? "by year" : periodLabel(sel)}
          </h2>
          <InfoTip text="Net profit (revenue minus all expenses, net of VAT). Red bars are loss periods. Scopes with the time filter: all-time shows years, a narrowed filter shows months." />
        </div>
        <MoneyBars
          points={
            sel.kind === "all"
              ? allSummaries.map((s, i) => ({ label: String(years[i]), value: s.profit }))
              : monthlyScoped.map((m) => ({ label: MONTH_LABELS[m.month - 1], value: m.profit }))
          }
        />
      </div>

      {/* Rate & utilization */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="text-sm font-heading font-semibold">Avg hourly rate by year</h2>
          <InfoTip text="Derived: revenue ÷ hours (never an input). The 300→350 rate transition shows as the step up. Always shows all years." />
        </div>
        <RateTrendChart points={ratePoints} />
      </div>
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="text-sm font-heading font-semibold">Utilization vs capacity</h2>
          <InfoTip text="Logged hours ÷ capacity (designers × working days). Capacity data exists from 2023 only — earlier years aren't shown rather than fabricated. Months without capacity data are excluded." />
        </div>
        <UtilizationChart points={utilPoints} />
        {utilPoints.length === 0 && (
          <p className="py-4 text-center text-sm text-faint">No capacity data (2023+ only).</p>
        )}
      </div>

      {/* Break-even */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="text-sm font-heading font-semibold">Break-even · {beYear}</h2>
          <InfoTip text="Bars are hours logged per month; the dashed line is the minimum hours needed to cover that month's expenses at the effective rate. Red bars ran below break-even. Forecast (predicted) months are excluded. Pick a year with the time filter above." />
        </div>
        <BreakEvenChart year={beYear} months={beMonths} />
        {beMonths.length === 0 && (
          <p className="py-4 text-center text-sm text-faint">No monthly actuals for {beYear}.</p>
        )}
      </div>

      </div>{/* /right column */}
      </div>{/* /grid */}
    </div>
  );
}
