"use client";

// Pay: what they're paid (gross, from their payslips) and what that costs the
// studio, what their work supports and how that's worked out, their pay over
// time, and the payslips themselves.

import { FileX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { useState } from "react";
import { Card, SectionTitle, Loading } from "@/components/finance/ui";
import { GapLinesChart, type GapSeries } from "@/components/finance/finance-charts";
import { MONTH_SHORT } from "@/lib/finance/finance";
import { formatILS, formatNum, formatPct } from "@/lib/finance/format";
import { TARGET_MARGIN } from "@/lib/finance/overview";
import { isHourlySlip, monthsEnding, monthsOf, recommendedTerms, sickDays, type GrossPay, type PayAdvice, type PayslipMonth } from "@/lib/finance/people";
import { billFor, rateFor, type RateTerms } from "@/lib/freelance-rate";
import { RateCurve, SalaryBars, Segmented } from "./visuals";
import { RaiseBox } from "./raise-box";
import { FactorsCard } from "./factors-card";
import { latestSlip, type PersonModel } from "./model";

const PAY_INFO = `What their own work supports: the revenue from their hours, less the studio's ${Math.round(
  TARGET_MARGIN * 100,
)}% target margin, divided by what every ₪1 of client-work pay has to carry — the studio's costs, less the revenue that isn't from designers' own hours (projects, freelancers' hours a manager logs), ÷ the pay of the people whose hours earn. Their hours on Studio work are paid at the same rate on top; written-down hours earn nothing. If the studio as a whole made its target margin, these figures would add up to what it pays. Finance books what someone costs (gross plus the employer's contributions); with payslips, it's turned into gross salary using their own payslips — and scaled to full time for a job share or a partial month.`;

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

export function PayTab({ m }: { m: PersonModel }) {
  const r = m.recent;
  const slip = latestSlip(m.slips);
  const freelancer = r?.freelancer ?? false;
  const paid = monthsOf(m.ledger, null)
    .filter((x) => x.salary + x.freelance > 0 && ym(x.year, x.month) <= m.upTo)
    .at(-1);
  const sameMonth = slip ? m.ledger?.get(ym(slip.year, slip.month)) : undefined;
  const costFactor = sameMonth && slip?.grossTotal ? (sameMonth.salary + sameMonth.freelance) / slip.grossTotal : null;

  // Pay over time: every month from their first paid one (or the last 12),
  // gaps where they weren't paid.
  const [range, setRange] = useState<"all" | "12">("all");
  const bySlip = new Map(m.slips.map((p) => [ym(p.year, p.month), p]));
  const paidKeys = monthsOf(m.ledger, null)
    .filter((x) => x.salary + x.freelance > 0 && ym(x.year, x.month) <= m.upTo)
    .map((x) => ym(x.year, x.month));
  const span: string[] = [];
  if (paidKeys.length) {
    const last = paidKeys[paidKeys.length - 1];
    const from = range === "12" ? [paidKeys[0], monthsEnding(last, 12)[0]].sort()[1] : paidKeys[0];
    for (let y = +from.slice(0, 4), mo = +from.slice(5); ym(y, mo) <= last; mo === 12 ? (y++, (mo = 1)) : mo++) span.push(ym(y, mo));
  }
  const withSlips = span.some((k) => bySlip.get(k)?.salaryPaid != null);
  const supported = m.own ? r?.supported : undefined;
  const chart: GapSeries[] = [
    ...(withSlips
      ? [{ label: "Gross salary", color: "var(--danger)", values: span.map((k) => bySlip.get(k)?.salaryPaid ?? null) }]
      : []),
    {
      label: freelancer ? "Pay" : "Cost to the studio",
      color: "var(--danger)",
      fill: true,
      stroke: false,
      values: span.map((k) => {
        const x = m.ledger?.get(k);
        return x && x.salary + x.freelance > 0 ? x.salary + x.freelance : null;
      }),
    },
    ...(supported?.byMonth.size
      ? [{ label: "Their work supports", color: "var(--brand)", values: span.map((k) => supported.byMonth.get(k) ?? null) }]
      : []),
  ];
  // Every month while few; Jan and Jul up to three years; then Januaries.
  const tick = (k: string) => {
    const mo = Number(k.slice(5));
    if (span.length <= 14) return MONTH_SHORT[mo - 1];
    if (span.length <= 40) return mo === 1 || mo === 7 ? `${MONTH_SHORT[mo - 1]} ${k.slice(2, 4)}` : "";
    return mo === 1 ? k.slice(0, 4) : "";
  };
  const label = (k: string) => `${MONTH_SHORT[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
  const chartInfo = `${withSlips ? "Gross salary is the salary on each payslip (an hourly month's hours × rate; travel, meals and one-offs left out) — from the payslips imported, 2026 on. " : ""}${freelancer ? "Pay" : "Cost to the studio"} is what finance books for the month${freelancer ? "" : " (gross plus the employer's contributions)"}.${
    supported?.byMonth.size
      ? ` Blue: what their work supported, each month worked out over the 3 months ending there, as in What their work supports${
          supported.basis === "salary"
            ? " — in gross salary, at the salary ÷ cost of those months' payslips (before their first payslip, of all of them)."
            : " — in what they cost, as there are no payslips."
        }`
      : ""
  }`;
  return (
    <div className="flex flex-col gap-4">
      {r?.raise && (
        <RaiseBox plan={r.raise} share={r.periods.last3.gross?.share ?? null} slips={m.slips} sick12={sickDays(m.slips, monthsEnding(m.upTo, 12))} />
      )}
      {m.own && !freelancer && r?.raise && <FactorsCard factors={m.factors} plan={r.raise} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <SectionTitle info="From their latest payslip; the cost is what finance books for that month (gross plus the employer's pension, severance and National Insurance).">
            Salary
          </SectionTitle>
          <dl className="space-y-3 text-sm">
            {slip?.salaryRate != null ? (
              <>
                <Row
                  label={isHourlySlip(slip) ? "Hourly rate (gross)" : "Gross salary"}
                  value={isHourlySlip(slip) ? `₪${formatNum(slip.salaryRate)}/h` : formatILS(Math.round(slip.salaryRate))}
                  sub={`${MONTH_SHORT[slip.month - 1]} ${slip.year} payslip${
                    slip.salaryQuantity == null
                      ? " · full time"
                      : isHourlySlip(slip)
                        ? ` · ${formatNum(slip.salaryQuantity)}h that month`
                        : ` · full time, on ${formatPct(slip.salaryQuantity, 0)}`
                  }`}
                  big
                />
                {slip.grossTotal != null && <Row label="Gross paid that month" value={formatILS(Math.round(slip.grossTotal))} sub="salary plus travel, meals and the rest" />}
                {sameMonth && (
                  <Row
                    label="Cost to the studio"
                    value={formatILS(Math.round(sameMonth.salary + sameMonth.freelance))}
                    sub={costFactor ? `${costFactor.toFixed(2)}× the gross` : undefined}
                  />
                )}
              </>
            ) : paid ? (
              <>
                <Row
                  label={freelancer ? "Freelance pay" : "Cost to the studio"}
                  value={formatILS(Math.round(freelancer ? paid.freelance : paid.salary + paid.freelance))}
                  sub={`${MONTH_SHORT[paid.month - 1]} ${paid.year}${
                    freelancer && paid.hours >= 1 ? ` · ₪${formatNum(paid.freelance / paid.hours)} an hour` : freelancer ? "" : " · gross shows once their payslips are imported"
                  }`}
                  big
                />
                {m.terms && (
                  <Row
                    label="Sliding rate"
                    value={`₪${m.terms.rateHigh} → ₪${m.terms.rateLow}/h`}
                    sub={`₪${m.terms.rateHigh}/h up to ${m.terms.hoursLow}h a month, down to ₪${m.terms.rateLow}/h at ${m.terms.hoursHigh}h`}
                  />
                )}
              </>
            ) : (
              <p className="text-faint">Not paid in finance yet.</p>
            )}
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle info={PAY_INFO}>What their work supports</SectionTitle>
          {!r ? (
            <Loading label="Working it out…" inline />
          ) : !m.own ? (
            <p className="text-sm text-muted">
              Their logged hours aren&apos;t their own billable work ({m.person.position?.replace("_", " ") ?? "not a designer"}), so their pay
              can&apos;t be set against them.
            </p>
          ) : !r.periods.last.pay && !r.periods.last3.pay ? (
            <p className="text-sm text-muted">Not enough paid, tracked months lately to work it out.</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <Supports title="From last month" pay={r.periods.last.pay} gross={r.periods.last.gross} freelancer={freelancer} />
              <Supports title="Last 3 months" pay={r.periods.last3.pay} gross={r.periods.last3.gross} freelancer={freelancer} />
            </div>
          )}
        </Card>
      </div>

      {m.terms && r?.periods.last3.pay && m.own && (
        <SlidingRate terms={m.terms} pay={r.periods.last3.pay} lastMonth={r.periods.last.pay} />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {span.length > 1 && (
        <Card className="lg:col-span-2">
          <SectionTitle hint={range === "all" ? `${span.length} months` : "last 12 months"} info={chartInfo}>
            Pay over time
          </SectionTitle>
          {paidKeys.length > 12 && (
            <div className="-mt-1 mb-2">
              <Segmented
                value={range}
                onChange={setRange}
                options={[
                  { id: "all", label: "All time" },
                  { id: "12", label: "12 months" },
                ]}
              />
            </div>
          )}
          <GapLinesChart
            labels={span.map(label)}
            axisLabels={span.map(tick)}
            series={chart}
          />
        </Card>
      )}
      {slip && sameMonth && slip.grossTotal != null && slip.salaryPaid != null && (
        <CostBreakdown
          month={`${MONTH_SHORT[slip.month - 1]} ${slip.year}`}
          salary={slip.salaryPaid}
          gross={slip.grossTotal}
          cost={sameMonth.salary + sameMonth.freelance}
        />
      )}
      </div>

      <Card>
        <SectionTitle
          hint={m.slips.length ? `${m.slips.length} months` : undefined}
          info="Read from the Michpal payslips in the studio's Salaries folder by the payslip import (npm run payslips) — only these figures are stored, never the PDFs."
        >
          Payslips
        </SectionTitle>
        <PayslipTable slips={m.slips} />
      </Card>
    </div>
  );
}

function Row({ label, value, sub, big = false }: { label: string; value: string; sub?: string; big?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-muted">{label}</dt>
      <dd className={`${big ? "text-2xl" : "text-base"} font-semibold tabular-nums`}>{value}</dd>
      {sub && <dd className="text-xs text-faint">{sub}</dd>}
    </div>
  );
}

function Supports({ title, pay, gross, freelancer }: { title: string; pay: PayAdvice | null; gross: GrossPay | null; freelancer: boolean }) {
  if (!pay) return <div className="text-sm text-faint">{title}: not enough data.</div>;
  const g = gross?.recommended != null ? gross : null;
  const per = g?.unit === "hour" ? "/h" : "";
  const fmt = (v: number) => (per ? `₪${formatNum(v)}${per}` : formatILS(Math.round(v / 100) * 100));
  return (
    <div>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">{title}</div>
      {g ? (
        <SalaryBars
          now={g.current}
          supports={g.recommended!}
          nowLabel={`${freelancer ? "Pay" : "Gross salary"}${g.share != null ? " (full time)" : ""}`}
          supportsLabel="Their work supports"
          format={fmt}
        />
      ) : (
        <SalaryBars now={pay.actual} supports={pay.recommended} nowLabel={freelancer ? "Freelance pay" : "Cost to the studio"} supportsLabel="Their work supports" />
      )}
      <ul className="mt-3 space-y-0.5 text-xs text-muted">
        <li>Their hours brought in {formatILS(Math.round(pay.revenue))} a month</li>
        <li>Each ₪1 of client-work pay carries ₪{pay.overhead.toFixed(2)} of studio costs</li>
        {pay.studioShare > 0.01 && <li>{formatPct(pay.studioShare, 0)} of their pay went to studio work — paid on top, not held against them</li>}
      </ul>
    </div>
  );
}

/** A sliding-rate freelancer's recommendation, as new numbers for the same
 * formula (see recommendedTerms) — and what each pays at their usual month. */
function SlidingRate({ terms, pay, lastMonth }: { terms: RateTerms; pay: PayAdvice; lastMonth: PayAdvice | null }) {
  const rec = recommendedTerms(terms, pay);
  if (!rec) return null;
  const usual = pay.hours;
  const fromLast = lastMonth ? recommendedTerms(terms, lastMonth) : null;
  const rule = (t: RateTerms) => `₪${t.rateHigh} → ₪${t.rateLow}/h`;
  const atUsual = (t: RateTerms) =>
    usual >= 1 ? `₪${formatNum(rateFor(usual, t), 1)}/h at ${Math.round(usual)}h · ${formatILS(Math.round(billFor(usual, t)))} a month` : "";
  const same = rec.terms.rateHigh === terms.rateHigh && rec.terms.rateLow === terms.rateLow;
  return (
    <Card>
      <SectionTitle
        hint="last 3 months"
        info={`The same formula — ₪/hour falling from ${terms.hoursLow}h to ${terms.hoursHigh}h a month — with both rates times what their work supports ÷ what they were paid. Since every hour of a month is paid at that month's rate, that changes the month's pay by exactly the same factor at any number of hours. Rounded to ₪5.`}
      >
        Sliding rate
      </SectionTitle>
      <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <RateCurve now={terms} next={rec.terms} usual={usual} />
          <div className="mt-1 flex gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded bg-[var(--faint)]" /> Now
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded bg-brand" /> Recommended
            </span>
          </div>
        </div>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-[11px] font-medium text-muted">Now</dt>
            <dd className="text-base font-semibold tabular-nums">{rule(terms)}</dd>
            <dd className="text-xs text-faint">{atUsual(terms)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-muted">Recommended</dt>
            <dd className={`text-xl font-semibold tabular-nums ${rec.factor < 0.95 ? "text-danger" : "text-brand"}`}>
              {same ? "Keep it" : rule(rec.terms)}
            </dd>
            <dd className="text-xs text-faint">
              {same ? `their work supports about what they're paid (${formatPct(rec.factor, 0)})` : `${rec.factor >= 1 ? "+" : "−"}${formatPct(Math.abs(rec.factor - 1), 0)} · ${atUsual(rec.terms)}`}
            </dd>
          </div>
          {fromLast && (
            <p className="text-xs text-faint">
              From last month alone: {rule(fromLast.terms)}
            </p>
          )}
          <p className="text-xs text-faint">
            Thresholds stay at {terms.hoursLow}h and {terms.hoursHigh}h.
          </p>
        </dl>
      </div>
    </Card>
  );
}

/** One month's cost to the studio, split: the salary, what the payslip adds
 * on top (travel, meals…), and the employer's contributions finance books. */
function CostBreakdown({ month, salary, gross, cost }: { month: string; salary: number; gross: number; cost: number }) {
  const parts = [
    { label: "Salary", v: salary, color: "var(--brand)" },
    { label: "Extras on the payslip", v: Math.max(0, gross - salary), color: "#6181e8" },
    { label: "Employer's share", v: Math.max(0, cost - gross), color: "var(--border-strong)" },
  ];
  const total = parts.reduce((t, p) => t + p.v, 0) || 1;
  return (
    <Card>
      <SectionTitle
        hint={month}
        info="Salary and extras (travel, meals) from the payslip; the employer's share — pension, severance, study fund, National Insurance — is the rest of what finance books for the month."
      >
        Where their cost goes
      </SectionTitle>
      <div className="mb-1.5 font-serif-accent text-[32px] leading-none tabular-nums">{formatILS(Math.round(cost))}</div>
      <div className="mb-3 text-xs text-faint">{(cost / gross).toFixed(2)}× the gross pay</div>
      <div className="flex h-4 overflow-hidden rounded-full bg-surface-2">
        {parts.map((p) => (p.v > 0 ? <div key={p.label} style={{ width: `${(p.v / total) * 100}%`, background: p.color }} /> : null))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
            <span className="text-muted">{p.label}</span>
            <span className="ml-auto tabular-nums">{formatILS(Math.round(p.v))}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PayslipTable({ slips }: { slips: PayslipMonth[] }) {
  if (!slips.length)
    return <EmptyState compact icon={FileX} text="No payslips imported yet. Run the payslip import on the studio Mac (npm run payslips)." />;
  const rows = [...slips].sort((a, b) => b.year - a.year || b.month - a.month);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-border text-[11px] font-medium uppercase tracking-wide text-faint">
            {["Month", "Gross salary", "Share / hours", "Gross paid", "Vacation left", "Sick days left"].map((h, i) => (
              <th key={h} className={`whitespace-nowrap px-2 py-1.5 ${i ? "text-right" : "text-left"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={`${p.year}-${p.month}`} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-2 py-1.5 text-left">
                {MONTH_SHORT[p.month - 1]} {p.year}
              </td>
              <td className="px-2 py-1.5 text-right">{p.salaryRate == null ? "—" : isHourlySlip(p) ? `₪${formatNum(p.salaryRate)}/h` : formatILS(Math.round(p.salaryRate))}</td>
              <td className="px-2 py-1.5 text-right">
                {p.salaryQuantity == null ? "full" : isHourlySlip(p) ? `${formatNum(p.salaryQuantity)}h` : formatPct(p.salaryQuantity, 0)}
              </td>
              <td className="px-2 py-1.5 text-right">{p.grossTotal != null ? formatILS(Math.round(p.grossTotal)) : "—"}</td>
              <td className={`px-2 py-1.5 text-right ${p.vacationBalance != null && p.vacationBalance < 0 ? "text-danger" : ""}`}>
                {p.vacationBalance != null ? formatNum(p.vacationBalance, 2) : "—"}
              </td>
              <td className="px-2 py-1.5 text-right">{p.sickBalance != null ? formatNum(p.sickBalance, 2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
