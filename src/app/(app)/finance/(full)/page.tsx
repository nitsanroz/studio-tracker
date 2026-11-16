"use client";

import { useEffect, useMemo, useState } from "react";
import { useFinanceCore } from "@/lib/finance/finance-data";
import { PNL_UPDATED, refreshPnl } from "@/lib/finance/auto-rollup";
import { getGoalInputs } from "@/lib/finance/actions";
import {
  isPartialYear,
  isForecastMonth,
  monthsElapsed,
  annualize,
  yoy,
  summarizeRows,
  MONTH_SHORT,
  type YearSummary,
  type PeriodSummary,
} from "@/lib/finance/finance";
import {
  buildYearSummaries,
  aggregateSummaries,
  buildCostYears,
  buildRatePoints,
  buildUtilization,
  buildBreakEven,
  buildMonthlyTrend,
  buildMonthlyCost,
  buildMonthlyRate,
  buildMonthlyUtilization,
  buildMonthlyExpenses,
  hoursGoal,
  studioDayLogged,
  projectMonths,
  projectYear,
  type GoalInputs,
  topClientsForYear,
  clientPieSlices,
  topVendorsForYear,
  vendorPieSlices,
} from "@/lib/finance/overview";
import {
  TrendChart,
  CostStructureChart,
  RateTrendChart,
  UtilizationChart,
  BreakEvenChart,
  PieChart,
  MonthlyLineChart,
  type MonthPoint,
} from "@/components/finance/finance-charts";
import {
  PageHeader,
  Card,
  SectionTitle,
  Loading,
  ErrorState,
  InfoDot,
} from "@/components/finance/ui";
import { useExplainHover } from "@/components/finance/explain-card";
import { explainKpi, kpiKey, type KpiContext } from "@/components/finance/overview-explain";
import { buildInsights } from "@/components/finance/overview-insights";
import { InsightsPanel } from "@/components/finance/insights-panel";
import { HoursGoalCard } from "@/components/finance/hours-goal-card";
import { AccountantProfitChart, AccountantSwitch, useAccountantToggle } from "@/components/finance/accountant-card";
import { accountantMargin } from "@/lib/finance/accountant";
import { useCompanyFigures } from "@/components/finance/company-figures";
import {
  formatILS,
  formatILSShort,
  formatPct,
  formatSignedPct,
} from "@/lib/finance/format";

type Period = number | "all";

/** The month in progress, as the hours goal reads it ("2026-11"). */
const monthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}`;
};

export default function OverviewPage() {
  const { data, error, loading, reload } = useFinanceCore();
  const [period, setPeriod] = useState<Period>("all");
  // The accountant's own figures, shown beside ours on request (reference only).
  const [showAccountant, setShowAccountant] = useAccountantToggle();
  const { accountantYears } = useCompanyFigures();
  // The hours goal's tracker facts: designers away (weekly plan) and hourly
  // freelancers' pace. The goal shows without them until they arrive.
  // Keyed by month: they were fetched once, for the month the page opened in,
  // so a tab left open into the next month set last month's absences and
  // freelancers against this month's goal. Any render in a new month refetches;
  // coming back to the tab renders again once the month has turned.
  const goalMonth = monthKey();
  const [, setSeenMonth] = useState(goalMonth);
  const [goalInputs, setGoalInputs] = useState<{ month: string; inputs: GoalInputs } | undefined>();
  useEffect(() => {
    const onBack = () => document.visibilityState === "visible" && setSeenMonth(monthKey());
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const [y, m] = goalMonth.split("-").map(Number);
    getGoalInputs(y, m)
      .then((inputs) => alive && setGoalInputs({ month: goalMonth, inputs }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [goalMonth]);
  // Live figures: this year's P&L recomputes on opening (and after any edit
  // elsewhere); the page refreshes in place when a recompute changed something.
  useEffect(() => {
    void refreshPnl();
    const onUpdated = (e: Event) => {
      if ((e as CustomEvent<{ monthsWritten: number } | null>).detail?.monthsWritten) void reload(true);
    };
    window.addEventListener(PNL_UPDATED, onUpdated);
    return () => window.removeEventListener(PNL_UPDATED, onUpdated);
  }, [reload]);

  const summaries = useMemo(
    () => (data ? buildYearSummaries(data.pnl) : []),
    [data],
  );

  if (loading) return <Loading label="Loading finance data…" />;
  if (error) return <ErrorState message={error} />;
  if (!data || summaries.length === 0)
    return <ErrorState message="No finance data found." />;

  const years = summaries.map((s) => s.year);
  const isAll = period === "all";
  const selYear = isAll ? null : (period as number);

  // Everything below the header respects the selected period. "All time" shows a
  // year-by-year view; a single year switches the time-series charts to months.
  const cur = isAll
    ? aggregateSummaries(summaries)
    : summaries.find((s) => s.year === selYear)!;
  const partial = selYear != null && isPartialYear(selYear);
  const elapsed = selYear != null ? monthsElapsed(data.pnl, selYear) : 0;
  const priorFull =
    isAll || selYear == null
      ? null
      : ([...summaries].reverse().find((s) => s.year < selYear && !s.partial) ??
        null);
  // A partial year (this year, so far) is only comparable to the SAME elapsed
  // months of the prior year — Jan–Aug this year vs Jan–Aug last year, never
  // vs. all 12 months of last year, which would always read as a decline.
  // For 2016 (the business's first, partial year) there IS no 2015 to
  // compare against — filtering finds nothing, so fall back to null rather
  // than a zeroed-out summary that would render as "vs ₪0".
  const priorSamePeriodRows =
    selYear != null && partial && elapsed > 0
      ? data.pnl.filter((r) => r.year === selYear - 1 && r.month <= elapsed)
      : [];
  const priorSamePeriod = priorSamePeriodRows.length > 0 ? summarizeRows(priorSamePeriodRows) : null;
  const prior: PeriodSummary | null = partial ? priorSamePeriod : priorFull;
  const priorLabel =
    selYear == null
      ? null
      : partial && elapsed > 0
        ? priorSamePeriod
          ? `Jan–${MONTH_SHORT[elapsed - 1]} ${selYear - 1}`
          : null
        : (priorFull?.year ?? null);

  // The key figures count finished months only (sumLine's rule) — their hover
  // cards must read the very same rows, or a card wouldn't add up to its tile.
  const thisYear = new Date().getFullYear();
  const finishedPnl = data.pnl.filter((r) => !(r.year === thisYear && isForecastMonth(r.year, r.month)));

  const kpiCtx: KpiContext = {
    accountantYears,
    pnl: finishedPnl,
    clientMonthly: data.clientMonthly,
    curRows: isAll ? finishedPnl : finishedPnl.filter((r) => r.year === selYear),
    priorRows: partial ? priorSamePeriodRows : priorFull ? data.pnl.filter((r) => r.year === priorFull.year) : [],
    priorLabel: priorLabel != null ? String(priorLabel) : null,
    selYear,
    years,
    partial,
  };

  // Unfinished months are drawn as estimated full months, never counted —
  // a few days of income against a whole month of costs would read as a huge
  // loss, and the plan's placeholders aren't real.
  const projection = selYear != null ? projectMonths(data.pnl, selYear) : undefined;
  // All time: this year's bar is its estimated full year, over what's booked.
  const yearProjection = isAll ? projectYear(data.pnl, thisYear) : null;
  const trendPoints = isAll
    ? summaries.map((s) =>
        yearProjection && s.year === thisYear
          ? { ...s, revenue: yearProjection.revenue, margin: yearProjection.margin,
              estimate: { soFar: yearProjection.booked, note: yearProjection.note } }
          : s,
      )
    : buildMonthlyTrend(data.pnl, selYear!, projection);
  const expensesPoints: MonthPoint[] = isAll
    ? summaries.map((s) => ({
        label: String(s.year),
        value: s.expenses,
      }))
    : buildMonthlyExpenses(data.pnl, selYear!, projection);
  // The all-time trend badge compares the last two full years — never this
  // year so far against a whole one.
  const fullYears = summaries.filter((s) => !s.partial).slice(-2);
  const costData = isAll
    ? buildCostYears(summaries)
    : buildMonthlyCost(data.pnl, selYear!, projection);
  const ratePoints = isAll
    ? buildRatePoints(summaries)
    : buildMonthlyRate(data.pnl, selYear!, projection);
  const utilization = isAll
    ? buildUtilization(data.pnl)
    : buildMonthlyUtilization(data.pnl, selYear!, projection);
  const breakEven = selYear != null ? buildBreakEven(data.pnl, selYear, projection) : [];
  // The month in progress as a target — shown in All time and this year.
  const goal = isAll || selYear === thisYear ? hoursGoal(data.pnl, thisYear, new Date(), { inputs: goalInputs?.month === goalMonth ? goalInputs.inputs : undefined, todayLogged: studioDayLogged() }) : null;
  // Macro events annotate the yearly (all-time) view only.
  const events = isAll
    ? data.events.map((e) => ({
        year: e.year,
        month: e.month,
        event: e.event,
        category: e.category,
        note: e.note,
      }))
    : [];
  // The pies count finished months only, like the key figures: an unfinished
  // month's client rows and bills are the plan's, not what happened.
  const clientView = topClientsForYear(data.clientMonthly.filter((r) => !isForecastMonth(r.year, r.month)), selYear);
  const clientPie = clientPieSlices(clientView.clients);
  const vendorView = topVendorsForYear(
    data.expenses.filter((r) => !isForecastMonth(Number(r.date.slice(0, 4)), Number(r.date.slice(5, 7)))),
    selYear,
    data.fx,
  );
  const vendorPie = vendorPieSlices(vendorView.vendors);
  const spanLabel = isAll
    ? `${years[0]}–${years[years.length - 1]}`
    : String(selYear);

  return (
    // The whole width of the screen (Nitsan, 2026-11-15) — it was a 1152px column
    // with empty margins on a wide monitor. The charts below flow in two columns,
    // three from 1536px, with the main chart across two of them.
    <div className="w-full">
      <PageHeader
        title="Overview"
        subtitle={
          isAll
            ? "The whole business at a glance — 10 years of Studio&more."
            : `Studio&more in ${selYear}.`
        }
        actions={
          <select
            value={isAll ? "all" : period}
            onChange={(e) =>
              setPeriod(
                e.target.value === "all" ? "all" : Number(e.target.value),
              )
            }
            className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm"
          >
            <option value="all">All time</option>
            {years
              .slice()
              .reverse()
              .map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
          </select>
        }
      />

      {partial && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[var(--state-predicted-bg)] px-3 py-1 text-xs text-[var(--state-predicted-fg)]">
          {selYear} is partial — {elapsed} {elapsed === 1 ? "month" : "months"}{" "}
          of actuals. Annualized figures are labelled as such; YoY compares
          against{" "}
          {priorLabel != null
            ? String(priorLabel)
            : "the same period last year"}
          , not the full prior year.
        </div>
      )}

      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
        Key figures
      </h2>
      <KpiRow
        explainCtx={kpiCtx}
        cur={cur}
        prior={prior}
        priorLabel={priorLabel}
        partial={partial}
        elapsed={elapsed}
        allTime={isAll}
      />

      {goal && <HoursGoalCard goal={goal} />}

      <InsightsPanel insights={buildInsights(kpiCtx)} period={isAll ? "all time" : `${selYear}${partial ? " so far" : ""}`} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      <Card className="lg:col-span-2">
        <SectionTitle
          hint={isAll ? "bars = revenue · line = margin %" : "by month"}
          info="Bars are gross revenue for each year (or month); the line is profit margin (profit ÷ revenue), read off the right-hand axis. A lighter, dashed bar marks a period that's still in progress, so it isn't a fair comparison to a complete one yet. In a single year, the month in progress is projected to its end: the solid part is what's come in so far, the outline is the estimate — the workdays left, at a pace that blends this month's so far with last month's; later months at the last three months' pace. In All time, this year's bar is likewise its estimated full year: the months still to come at the last three booked months' pace per workday. Unfinished months' costs are the Plan's plus 15%, since its figures run light."
        >
          Revenue and margin · {spanLabel}
        </SectionTitle>
        <AccountantSwitch on={showAccountant} onChange={setShowAccountant} canShow={isAll} />
        <TrendChart
          summaries={trendPoints}
          events={events}
          accountant={
            showAccountant && isAll
              ? new Map(
                  accountantYears.map((a) => [
                    a.year,
                    { revenue: a.revenue, pretaxProfit: a.pretaxProfit, margin: accountantMargin(a) },
                  ]),
                )
              : undefined
          }
        />
        {showAccountant && isAll && <AccountantProfitChart summaries={summaries} />}
      </Card>

        <Card>
          <SectionTitle
            hint={isAll ? "₪ total · by year" : "₪ total · by month"}
            info="Total recorded expenses (salaries + freelance + rent + other + investments) for the period — the absolute ₪ figure behind the Cost structure pane above, with its own trend and period-over-period change."
          >
            Expenses · {spanLabel}
          </SectionTitle>
          <MonthlyLineChart
            points={expensesPoints}
            color="var(--danger)"
            totalLabel={isAll ? "all-time total" : `so far in ${selYear}`}
            {...(isAll && fullYears.length > 1 && {
              trendOverride: Math.round((fullYears[1].expenses / fullYears[0].expenses - 1) * 100),
              trendTitle: `${fullYears[1].year} vs ${fullYears[0].year}`,
            })}
          />
        </Card>

        <Card>
          <SectionTitle
            hint={isAll ? "₪ / hour" : "₪ / hour · by month"}
            info="Revenue ÷ hours logged — the effective rate actually billed on average, which can differ from any single client's card rate."
          >
            Average rate
          </SectionTitle>
          <RateTrendChart points={ratePoints} />
        </Card>
        <Card>
          <SectionTitle
            hint={
              isAll
                ? "actual vs capacity · 2023→"
                : "actual vs capacity · by month"
            }
            info="Hours actually logged against the team's total capacity for the period. Capacity tracking only exists from 2023 onward, so earlier periods show nothing here."
          >
            Utilization
          </SectionTitle>
          {utilization.length > 0 ? (
            <UtilizationChart points={utilization} />
          ) : (
            <p className="py-10 text-center text-sm text-faint">
              {isAll
                ? "No capacity data before 2023."
                : "No capacity data for this year."}
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle
            hint="revenue share"
            info="Revenue share by client for the selected period. Top client / Top 3 show concentration — how much of revenue rides on a small number of clients, which is a risk figure as much as a sales one."
          >
            Clients · {spanLabel}
          </SectionTitle>
          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-muted">
              Top client:{" "}
              <span className="font-medium text-foreground">
                {formatPct(clientView.top1Share)}
              </span>
            </span>
            <span className="text-muted">
              Top 3:{" "}
              <span className="font-medium text-foreground">
                {formatPct(clientView.top3Share)}
              </span>
            </span>
            <span className="text-muted">
              {clientView.clients.length} active client
              {clientView.clients.length === 1 ? "" : "s"}
            </span>
          </div>
          {clientView.clients.length > 0 ? (
            <PieChart slices={clientPie} layout="side" size={200} />
          ) : (
            <p className="py-10 text-center text-sm text-faint">
              No client data for {spanLabel}.
            </p>
          )}
        </Card>

        <Card>
          <SectionTitle
            hint="spend share"
            info="Spend share by vendor for the selected period, across every expense category. Top vendor / Top 3 show how concentrated spending is on a small number of vendors."
          >
            Top vendors · {spanLabel}
          </SectionTitle>
          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-muted">
              Top vendor:{" "}
              <span className="font-medium text-foreground">
                {formatPct(vendorView.top1Share)}
              </span>
            </span>
            <span className="text-muted">
              Top 3:{" "}
              <span className="font-medium text-foreground">
                {formatPct(vendorView.top3Share)}
              </span>
            </span>
            <span className="text-muted">
              {vendorView.vendors.length} vendor
              {vendorView.vendors.length === 1 ? "" : "s"}
            </span>
          </div>
          {vendorView.vendors.length > 0 ? (
            <PieChart slices={vendorPie} layout="side" size={200} />
          ) : (
            <p className="py-10 text-center text-sm text-faint">
              No expense data for {spanLabel}.
            </p>
          )}
        </Card>

      {/* In the grid like the rest (Nitsan, 2026-11-15): as a row of its own across the full width it was drawn far larger than any other chart. */}
      <Card>
        <SectionTitle
          hint={isAll ? "share of revenue" : "share of revenue · by month"}
          info="Every major expense line as a share of that period's revenue, stacked. The dashed red line marks 100% of revenue — a stack that reaches or crosses it means the period ran at a loss."
        >
          Cost structure · {spanLabel}
        </SectionTitle>
        <CostStructureChart data={costData} />
      </Card>

      <Card>
        <SectionTitle
          hint="min hours to break even vs actual"
          info="Each month's minimum billable hours needed to cover costs (break-even), against the hours actually logged. A month logged below its own break-even line ran at a loss."
        >
          Break-even · {spanLabel}
        </SectionTitle>
        {selYear == null ? (
          <p className="py-10 text-center text-sm text-faint">
            Break-even is monthly — pick a year to see it.
          </p>
        ) : breakEven.length > 0 ? (
          <BreakEvenChart year={selYear} months={breakEven} />
        ) : (
          <p className="py-10 text-center text-sm text-faint">
            No monthly data for {selYear}.
          </p>
        )}
      </Card>
      </div>
    </div>
  );
}

function KpiRow({
  explainCtx,
  cur,
  prior,
  priorLabel,
  partial,
  elapsed,
  allTime,
}: {
  explainCtx: KpiContext;
  cur: YearSummary;
  prior: PeriodSummary | null;
  priorLabel: string | number | null;
  partial: boolean;
  elapsed: number;
  allTime: boolean;
}) {
  const annualRev =
    partial && elapsed > 0 ? annualize(cur.revenue, elapsed) : null;
  const yoyNote =
    " YoY compares against the same elapsed span of the prior year when this period is partial (e.g. Jan–Aug vs Jan–Aug last year), never a full prior year.";
  const kpis = [
    {
      label: "Revenue",
      value: formatILS(Math.round(cur.revenue)),
      sub: allTime
        ? "all-time total"
        : annualRev != null
          ? `≈ ${formatILSShort(annualRev)} annualized`
          : null,
      delta: prior ? yoy(cur.revenue, prior.revenue).pct : null,
      info: `Total gross revenue for the period, from logged hours × each client's rate.${yoyNote}`,
    },
    {
      label: "Expenses",
      value: formatILS(Math.round(cur.expenses)),
      sub: prior ? `vs ${formatILS(Math.round(prior.expenses))}` : null,
      delta: prior ? yoy(cur.expenses, prior.expenses).pct : null,
      info: `Total expenses for the period, across all expense categories.${yoyNote}`,
    },
    {
      label: "Profit",
      value: formatILS(Math.round(cur.profit)),
      sub: prior ? `vs ${formatILS(Math.round(prior.profit))}` : null,
      delta: prior ? yoy(cur.profit, prior.profit).pct : null,
      info: `Revenue minus total expenses for the period.${yoyNote}`,
    },
    {
      label: "Margin",
      value: formatPct(cur.margin, 0),
      sub: prior ? `vs ${formatPct(prior.margin, 0)}` : null,
      delta: null,
      info: "Profit ÷ revenue — the share of what came in that was actually kept.",
    },
    {
      label: "Avg rate",
      value: `₪${Math.round(cur.avgRate)}`,
      sub: prior ? `vs ₪${Math.round(prior.avgRate)}` : null,
      delta: prior ? yoy(cur.avgRate, prior.avgRate).pct : null,
      info: `Revenue ÷ hours — the effective average rate actually billed, which can differ from any single client's card rate.${yoyNote}`,
      align: "right" as const,
    },
    {
      label: "Salaries % rev",
      value: formatPct(cur.salariesPctRev, 0),
      sub: prior ? `vs ${formatPct(prior.salariesPctRev, 0)}` : null,
      delta: null,
      info: "Salaries as a share of revenue for the period — how much of what came in went to fixed payroll.",
      align: "right" as const,
    },
  ];
  const explain = useExplainHover((key) => explainKpi(key, explainCtx));
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      onMouseOver={explain.onMouseOver}
      onMouseLeave={explain.onMouseLeave}
    >
      {explain.card}
      {kpis.map((k) => (
        <div
          key={k.label}
          className="rounded-xl border border-border bg-surface p-3"
        >
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-medium text-muted">{k.label}</span>
            <InfoDot align={k.align}>{k.info}</InfoDot>
          </div>
          <div
            data-cell={kpiKey(k.label)}
            className="-mx-1 mt-0.5 cursor-default rounded px-1 text-xl font-semibold tabular-nums"
          >
            {k.value}
          </div>
          {k.delta != null && (
            <div
              className={`text-xs tabular-nums ${
                k.delta >= 0 ? "text-success" : "text-danger"
              }`}
              title={priorLabel != null ? `vs ${priorLabel}` : undefined}
            >
              {formatSignedPct(k.delta)} YoY
            </div>
          )}
          {k.delta == null && k.sub && (
            <div className="text-xs text-faint">{k.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}
