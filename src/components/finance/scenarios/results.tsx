"use client";

// A scenario's outcome, graphic first (Nitsan, 2026-11-11: "more graphic and
// approachable, not so much small text"): three big figures for the middle
// future, each with a bar from the bad future to the good one; break-even
// against the futures; tips; when each decision lands; the full figures folded.
// English or Hebrew (useT); bars and figures stay left-to-right.

import { useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { Hover, HoverTip } from "@/components/finance/scenarios/hover";
import { StripCard } from "@/components/finance/scenarios/futures";
import { useT } from "@/components/finance/scenarios/lang";
import { formatILSShort } from "@/lib/finance/format";
import { addMonths, describe, monthLabel, type Decision } from "@/lib/finance/scenarios/decisions";
import { stabilityGrade, type ScenarioResult } from "@/lib/finance/scenarios/engine";
import type { T } from "@/lib/finance/scenarios/i18n";
import type { Tip } from "@/lib/finance/scenarios/tips";
import { FUTURE_IDS, FUTURE_LABEL, type CompanyFacts, type FutureId, type Futures, type Member } from "@/lib/finance/scenarios/types";

const k = formatILSShort;
const h = (n: number) => `${Math.round(n)}h`;

/** What a figure's name means — behind the (i) dots and the hovers on every
 * figure in the tables. Keyed by the English label; undefined = nothing to add. */
function metricInfo(label: string, t: T): string | undefined {
  switch (label) {
    case "Bad":
      return t("The bad future: the least work you set for the next 12 months (see Futures). Read it as the year if demand disappoints.");
    case "Middle":
      return t("The middle future: the work you expect. The big figures everywhere are this one.");
    case "Good":
      return t("The good future: the most work you set. Read it as the year if demand is strong.");
    case "Profit a month":
      return t("The 12-month profit divided by 12 — the average monthly profit after every cost, with the decisions in.");
    case "Profit over 12 months":
    case "12-month profit":
      return t("What the studio earns over the next 12 months after every cost, the decisions in. The bar runs from the bad future to the good one; the line is zero.");
    case "Lowest cash":
      return t("The least money in the company's bank over the 12 months, starting from Cash in the bank. Under your cash floor means a tight month.");
    case "Break-even":
      return t("The billable hours a month (today's terms) at which the studio covers its costs once every decision is in. Under the bad future = safe even in a bad year.");
    case "Fixed costs":
      return t("The share of costs that don't fall when work does — salaries, office, tools. Freelancers are the variable part. Lower = safer when work drops.");
    case "Dividend over 12 months":
    case "Dividend over 12 months (net)":
      return t("The extra beyond your salary over the next 12 months, net to you after dividend tax. The smaller of the profit after 23% company tax and the cash the bank can spare above your floor. It closes the shareholder loan first.");
    case "Worst month":
      return t("The month with the lowest profit, and which month it is.");
    case "Months at a loss":
      return t("How many of the 12 months cost more than they bring in.");
    case "Reserve you'd need":
      return t("The deepest dip in the running profit over the 12 months — the cushion you'd need so it never goes under. A dash means none.");
    case "Runway":
      return t("Months until the bank goes under zero. 12+ means not within the 12 months.");
    case "Work turned away":
      return t("Hours of client work, added up over the 12 months, that the team and freelancers can't fit. A dash means none.");
    case "Employees idle":
      return t("Hours of paid employee capacity left unused, added up over the 12 months. A dash means none.");
    case "…of it closes the loan":
      return t("The part of the dividend that goes to repaying the shareholder loan instead of reaching you.");
    case "Loan at the end":
      return t("What you still owe the company at the end of the 12 months, after repayments.");
    default:
      return undefined;
  }
}

/** Bad → good on one line, the middle marked, and a reference line (zero, a floor). */
export function RangeBar({ bad, mid, good, line, lineLabel, fmt = k }: { bad: number; mid: number; good: number; line?: number; lineLabel?: string; fmt?: (n: number) => string }) {
  const { t } = useT();
  const lo = Math.min(bad, mid, good, line ?? bad);
  const hi = Math.max(bad, mid, good, line ?? good);
  const pad = (hi - lo) * 0.06 || 1;
  const x = (v: number) => `${((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100}%`;
  const [a, b] = bad <= good ? [bad, good] : [good, bad];
  return (
    <div className="mt-4" dir="ltr">
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-border/60" />
        <div className="absolute top-3 h-2 rounded-full bg-gradient-to-r from-red-400 via-brand to-emerald-500 opacity-80" style={{ left: x(a), width: `calc(${x(b)} - ${x(a)})` }} />
        {line != null && <span className="absolute top-0 h-8 w-0.5 -translate-x-1/2 bg-foreground/40" style={{ left: x(line) }} title={lineLabel} />}
        <span className="absolute top-1 size-6 -translate-x-1/2 rounded-full border-[3px] border-white bg-brand shadow" style={{ left: x(mid) }} />
      </div>
      <div className="mt-1 flex justify-between gap-2 text-[15px] tabular-nums">
        <span className="text-danger">
          {t("Bad")} {fmt(bad)}
        </span>
        {line != null && lineLabel && <span className="text-muted">{lineLabel}</span>}
        <span className="text-success">
          {t("Good")} {fmt(good)}
        </span>
      </div>
    </div>
  );
}

function Big({ label, info, value, tone, sub, children }: { label: string; info: string; value: string; tone?: "bad" | "good"; sub?: React.ReactNode; children?: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className="rounded-2xl bg-[var(--strip)] p-4 @md:flex @md:items-center @md:gap-5">
      <div className="@md:w-48 @md:shrink-0">
        <p className="flex items-center gap-1.5 text-[16px] leading-6 text-muted">
          {label} <Hover title={label}>{info}</Hover>
        </p>
        <p dir="ltr" className={`text-start text-[30px] font-semibold leading-9 tabular-nums ${tone === "bad" ? "text-danger" : tone === "good" ? "text-[var(--state-final-fg)]" : ""}`}>
          {value}
        </p>
        <p className="text-[14px] text-faint">{t("middle future")}</p>
        {sub && <div className="mt-1 text-[14px] leading-5 text-muted tabular-nums">{sub}</div>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Outcome({ result: r, futures }: { result: ScenarioResult; futures: Futures }) {
  const { t } = useT();
  const f = r.futures;
  const be = r.breakEven;
  const maxH = Math.max(be ?? 0, futures.good.hours) * 1.12 || 1;
  const px = (v: number) => `${Math.min(100, (v / maxH) * 100)}%`;
  const limit = f.mid.dividend.limitedBy === "cash" ? t("held back by cash") + " · " : f.mid.dividend.limitedBy === "none" ? t("no profit to share") + " · " : "";
  return (
    <div className="@container flex flex-col gap-3">
      <div className="grid gap-3">
        <Big
          label={t("Profit over 12 months")}
          info={t("What the studio earns over the next 12 months after every cost, the decisions in. The bar runs from the bad future to the good one; the line is zero.")}
          value={k(f.mid.profit)}
          tone={f.mid.profit < 0 ? "bad" : "good"}
        >
          <RangeBar bad={f.bad.profit} mid={f.mid.profit} good={f.good.profit} line={0} lineLabel="0" />
        </Big>
        <Big
          label={t("Lowest cash")}
          info={t(
            "The least money in the company's bank over the 12 months. It starts from Cash in the bank (Company facts). The leasehold write-off isn't cash; the tax refund, dividend tax and loan moves are. The line is your cash floor.",
          )}
          value={k(f.mid.lowestCash.cash)}
          tone={f.mid.lowestCash.cash < r.cashFloor ? "bad" : undefined}
        >
          <RangeBar bad={f.bad.lowestCash.cash} mid={f.mid.lowestCash.cash} good={f.good.lowestCash.cash} line={r.cashFloor} lineLabel={t("floor {amount}", { amount: k(r.cashFloor) })} />
        </Big>
        <Big
          label={t("Dividend you can take over 12 months")}
          info={t(
            "The extra beyond your salary, over the 12 months, net to you. It's the smaller of two limits: the year's profit after 23% company tax, and the cash the bank can spare above your cash floor (the dividend and its 30% tax both leave the bank). It closes the shareholder loan first; what's left reaches you. Your salary is fixed and shown on its own.",
          )}
          value={k(f.mid.dividend.net)}
          tone={f.mid.dividend.net > 0 ? "good" : "bad"}
          sub={
            <>
              {f.mid.dividend.net > 0 && <span className="block">{t("{loan} closes the loan · {you} to you", { loan: k(f.mid.dividend.toLoan), you: k(f.mid.dividend.toYou) })}</span>}
              <span className="block">
                {limit}
                {t("salary {amount} net a month, fixed", { amount: k(f.mid.salaryNet) })}
              </span>
            </>
          }
        >
          <RangeBar bad={f.bad.dividend.net} mid={f.mid.dividend.net} good={f.good.dividend.net} />
        </Big>
      </div>

      {/* Break-even against the three futures. */}
      <div className="rounded-2xl bg-[var(--strip)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[16px] text-muted">
            {t("Hours needed to break even")}
            <Hover title={t("Break-even")}>
              {t("The billable hours a month (today's terms) at which the studio covers its costs once every decision is in. Under the bad future = safe even in a bad year.")}
            </Hover>
          </p>
          <p className="flex items-center gap-1.5 text-[16px] tabular-nums">
            {t("Fixed costs")} <span className="font-semibold">{Math.round(r.fixedShare * 100)}%</span>
            <Hover title={t("Fixed costs")}>
              {t("The share of costs that don't fall when work does — salaries, office, tools. Freelancers are the variable part. Lower = safer when work drops.")}
            </Hover>
          </p>
        </div>
        <p className={`text-[30px] font-semibold leading-9 tabular-nums ${be == null || be > futures.bad.hours ? "text-danger" : "text-[var(--state-final-fg)]"}`}>
          {be == null ? t("Not within capacity") : t("{hours} a month", { hours: h(be) })}
        </p>
        <div className="relative mt-3 h-16" dir="ltr">
          <div className="absolute inset-x-0 top-4 h-3 rounded-full bg-[var(--state-final-bg)]" />
          {be != null && <div className="absolute left-0 top-4 h-3 rounded-full bg-red-300" style={{ width: px(be) }} />}
          {FUTURE_IDS.map((id) => (
            <span key={id} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: px(futures[id].hours) }}>
              <span className="mx-auto block h-10 w-1 rounded-full bg-foreground/70" />
              <span className={`block whitespace-nowrap text-[14px] tabular-nums ${id === "bad" ? "text-danger" : id === "good" ? "text-success" : "text-brand"}`}>
                {t(FUTURE_LABEL[id])} {h(futures[id].hours)}
              </span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-[15px] text-muted">{t("Red is loss, green is profit. Where each future sits shows which side it lands on.")}</p>
      </div>
    </div>
  );
}

export function Tips({ tips }: { tips: Tip[] }) {
  if (!tips.length) return null;
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {tips.map((tip) => (
        <li
          key={tip.text}
          className={`flex gap-3 rounded-2xl p-4 text-[16px] leading-6 tabular-nums ${tip.tone === "danger" ? "bg-red-50" : tip.tone === "warning" ? "bg-amber-50" : "bg-[var(--state-final-bg)]"}`}
        >
          {tip.tone === "danger" ? (
            <CircleAlert size={20} className="mt-0.5 shrink-0 text-danger" />
          ) : tip.tone === "warning" ? (
            <TriangleAlert size={20} className="mt-0.5 shrink-0 text-[var(--warning)]" />
          ) : (
            <CircleCheck size={20} className="mt-0.5 shrink-0 text-success" />
          )}
          <span>{tip.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** When each decision lands, down a month line. */
export function Timeline({ decisions, team, facts, start }: { decisions: Decision[]; team: Member[]; facts: CompanyFacts; start: string }) {
  const { t, lang } = useT();
  const events = decisions
    .flatMap((d) => {
      const out = [{ month: d.from, text: describe(d, team, t) }];
      if (d.type === "office_end")
        out.push({
          month: addMonths(d.from, d.months ?? 4),
          text: d.writeoff ? t("Last rent — leave the studio (write-off {amount})", { amount: k(d.writeoff) }) : t("Last rent — leave the studio"),
        });
      return out;
    })
    .concat(facts.taxRefund ? [{ month: facts.taxRefundMonth, text: t("Tax refund {amount}", { amount: k(facts.taxRefund) }) }] : [])
    .sort((a, z) => a.month.localeCompare(z.month));
  if (!events.length) return null;
  const byMonth = new Map<string, string[]>();
  for (const e of events) byMonth.set(e.month, [...(byMonth.get(e.month) ?? []), e.text]);
  return (
    <ol className="relative ms-1.5 flex flex-col gap-4 border-s-2 border-brand-soft ps-5">
      {[...byMonth].map(([m, texts]) => (
        <li key={m} className="relative">
          <span className={`absolute -start-[27px] top-1.5 size-3 rounded-full ${m < start ? "bg-border-strong" : "bg-brand"}`} />
          <p className="text-[15px] font-medium text-brand">{monthLabel(m, lang)}</p>
          {texts.map((x) => (
            <p key={x} className="text-[16px] leading-6 tabular-nums">
              {x}
            </p>
          ))}
        </li>
      ))}
    </ol>
  );
}

type Row = { label: string; value: (r: ScenarioResult, id: FutureId, t: T) => { text: string; sub?: string; bad?: boolean } };
const ROWS: Row[] = [
  { label: "12-month profit", value: (r, id) => ({ text: k(r.futures[id].profit), bad: r.futures[id].profit < 0 }) },
  { label: "Worst month", value: (r, id, t) => ({ text: k(r.futures[id].worst.profit), sub: monthLabel(r.futures[id].worst.month, t.lang), bad: r.futures[id].worst.profit < 0 }) },
  { label: "Months at a loss", value: (r, id) => ({ text: String(r.futures[id].lossMonths), bad: r.futures[id].lossMonths > 0 }) },
  { label: "Reserve you'd need", value: (r, id) => ({ text: r.futures[id].reserve < 0 ? k(-r.futures[id].reserve) : "—", bad: r.futures[id].reserve < 0 }) },
  { label: "Lowest cash", value: (r, id, t) => ({ text: k(r.futures[id].lowestCash.cash), sub: monthLabel(r.futures[id].lowestCash.month, t.lang), bad: r.futures[id].lowestCash.cash < r.cashFloor }) },
  { label: "Runway", value: (r, id, t) => ({ text: r.futures[id].runway == null ? t("12+ mo") : t("{n} mo", { n: r.futures[id].runway! }), bad: r.futures[id].runway != null }) },
  { label: "Work turned away", value: (r, id) => ({ text: r.futures[id].turnedAway > 0 ? h(r.futures[id].turnedAway) : "—" }) },
  { label: "Employees idle", value: (r, id) => ({ text: r.futures[id].idle > 0 ? h(r.futures[id].idle) : "—" }) },
  { label: "Dividend over 12 months (net)", value: (r, id) => ({ text: k(r.futures[id].dividend.net) }) },
  { label: "…of it closes the loan", value: (r, id) => ({ text: k(r.futures[id].dividend.toLoan) }) },
  { label: "Loan at the end", value: (r) => ({ text: k(r.loanEnd) }) },
];

/** Every figure, three futures — folded by default. */
export function AllFigures({ result }: { result: ScenarioResult }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[16px] font-medium text-brand">
        <ChevronDown size={18} className={open ? "" : "-rotate-90 rtl:rotate-90"} /> {t("All the figures")}
      </button>
      {open && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr>
                <th />
                {FUTURE_IDS.map((id) => (
                  <th key={id} className={`pb-2 text-end font-medium ${id === "bad" ? "text-danger" : id === "good" ? "text-success" : "text-brand"}`}>
                    <span className="inline-flex items-center gap-1.5">
                      {t(FUTURE_LABEL[id])}
                      <Hover title={t(FUTURE_LABEL[id])}>{metricInfo(FUTURE_LABEL[id], t)}</Hover>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <td className="py-1.5 pe-3 text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      {t(row.label)}
                      {metricInfo(row.label, t) && <Hover title={t(row.label)}>{metricInfo(row.label, t)}</Hover>}
                    </span>
                  </td>
                  {FUTURE_IDS.map((id) => {
                    const v = row.value(result, id, t);
                    return (
                      <td key={id} className={`whitespace-nowrap py-1.5 text-end tabular-nums ${v.bad ? "text-danger" : ""}`}>
                        <HoverTip title={`${t(row.label)} · ${t(FUTURE_LABEL[id])}`} body={metricInfo(row.label, t) ?? t(row.label)} className="inline-block">
                          {v.text}
                          {v.sub && <span className="block text-[13px] text-faint">{v.sub}</span>}
                        </HoverTip>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Up to three scenarios side by side: big middle figures, the bad one under. */
export function Compare({ items }: { items: { name: string; color: string; result: ScenarioResult }[] }) {
  const { t } = useT();
  if (items.length < 2) return null;
  const rows: { label: string; get: (r: ScenarioResult, id: FutureId) => number | null; fmt: (n: number) => string; better: "high" | "low" }[] = [
    { label: "Profit over 12 months", get: (r, id) => r.futures[id].profit, fmt: k, better: "high" },
    { label: "Lowest cash", get: (r, id) => r.futures[id].lowestCash.cash, fmt: k, better: "high" },
    { label: "Break-even", get: (r) => r.breakEven, fmt: (n) => `${Math.round(n)}h`, better: "low" },
    { label: "Fixed costs", get: (r) => r.fixedShare, fmt: (n) => `${Math.round(n * 100)}%`, better: "low" },
    { label: "Dividend over 12 months", get: (r, id) => r.futures[id].dividend.net, fmt: k, better: "high" },
  ];
  return (
    <StripCard title={t("Side by side")} info={t("The middle future in big type, the bad future under it in red. The best of each row is marked green.")}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th />
              {items.map((it) => (
                <th key={it.name} className="pb-3 text-end text-[16px] font-medium" style={{ color: it.color }}>
                  {it.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const mids = items.map((it) => row.get(it.result, "mid"));
              const nums = mids.filter((n): n is number => n != null);
              const best = nums.length ? (row.better === "high" ? Math.max(...nums) : Math.min(...nums)) : null;
              return (
                <tr key={row.label}>
                  <td className="py-2 pe-3 text-[16px] text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      {t(row.label)}
                      <Hover title={t(row.label)}>{metricInfo(row.label, t)}</Hover>
                    </span>
                  </td>
                  {items.map((it, i) => {
                    const mid = mids[i];
                    const bad = row.get(it.result, "bad");
                    const isBest = mid != null && mid === best;
                    return (
                      <td key={it.name} className="py-2 text-end tabular-nums">
                        <HoverTip
                          title={`${it.name} · ${t(row.label)}`}
                          body={<>{metricInfo(row.label, t)}<span className="mt-2 block text-foreground">{t("Middle")} {mid == null ? t("none") : row.fmt(mid)}{bad != null && bad !== mid ? ` · ${t("Bad")} ${row.fmt(bad)}` : ""}</span></>}
                          className="inline-block"
                        >
                          <span className={`inline-block rounded-lg px-2 text-[20px] font-semibold ${isBest ? "bg-[var(--state-final-bg)] text-[var(--state-final-fg)]" : ""}`}>
                            {mid == null ? t("none") : row.fmt(mid)}
                          </span>
                          {bad != null && bad !== mid && <span className="block text-[14px] text-danger">{t("bad {value}", { value: row.fmt(bad) })}</span>}
                        </HoverTip>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </StripCard>
  );
}

/** Every scenario at a glance (Nitsan, 2026-11-11: "a high-level comparison of
 * scenarios … a grade of stability, profit per month, best first"). One row
 * each, its chart colour before the name; the middle future big, the bad one
 * quietly beneath; the best of each column marked. Best first = the most
 * profit in the BAD future (then the middle) — what a plan keeps when things
 * go wrong. Click a name to open it. */
export function AllScenarios({
  items,
  futures,
  selected,
  onSelect,
}: {
  items: { id: string; name: string; color: string; result: ScenarioResult }[];
  futures: Futures;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useT();
  const rows = items
    .map((it) => ({ ...it, grade: stabilityGrade(it.result, futures) }))
    .sort((a, z) => z.result.futures.bad.profit - a.result.futures.bad.profit || z.result.futures.mid.profit - a.result.futures.mid.profit);
  type R = (typeof rows)[number];
  const cols: { label: string; info?: string; get: (r: R, id: FutureId) => number | null; fmt: (n: number) => string; better: "high" | "low"; noBad?: boolean }[] = [
    { label: "Profit a month", get: (r, id) => r.result.futures[id].profit / 12, fmt: k, better: "high" },
    { label: "Profit over 12 months", get: (r, id) => r.result.futures[id].profit, fmt: k, better: "high" },
    { label: "Lowest cash", get: (r, id) => r.result.futures[id].lowestCash.cash, fmt: k, better: "high" },
    { label: "Break-even", get: (r) => r.result.breakEven, fmt: (n) => `${Math.round(n)}h`, better: "low", noBad: true },
    { label: "Dividend over 12 months", get: (r, id) => r.result.futures[id].dividend.net, fmt: k, better: "high" },
  ];
  const best = cols.map((c) => {
    const v = rows.map((r) => c.get(r, "mid")).filter((n): n is number => n != null);
    return v.length ? (c.better === "high" ? Math.max(...v) : Math.min(...v)) : null;
  });
  const bestGrade = Math.max(...rows.map((r) => r.grade));
  return (
    <div className="overflow-x-auto rounded-3xl bg-surface p-4 shadow-card">
      <table className="w-full">
        <thead>
          <tr className="text-[14px] text-muted">
            <th className="pb-3 text-start font-normal">
              <span className="flex items-center gap-1.5">
                {t("Scenario")}
                <Hover title={t("Best first")}>{t("Ordered by profit in the bad future, then the middle — what a plan keeps when things go wrong. Grey under each figure: the bad future.")}</Hover>
              </span>
            </th>
            <th className="px-3 pb-3 text-start font-normal">
              <span className="flex items-center gap-1.5">
                {t("Stability")}
                <Hover title={t("Stability")}>
                  {t(
                    "0–100, all from the bad future: 35% how far its hours sit above break-even, 25% its lowest cash against your floor, 20% how much of the costs fall when work does, 20% months not at a loss. Higher is safer — it says nothing about how much a scenario earns.",
                  )}
                </Hover>
              </span>
            </th>
            {cols.map((c) => (
              <th key={c.label} className="px-3 pb-3 text-end font-normal leading-5">
                <span className="inline-flex items-center gap-1.5">
                  {t(c.label)}
                  <Hover title={t(c.label)}>{metricInfo(c.label, t)}</Hover>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.id} className={r.id === selected ? "bg-brand-soft/40" : "hover:bg-[var(--strip)]"}>
              <td className="rounded-s-2xl py-3 ps-2">
                <span className="flex items-center gap-2.5">
                  <span className="w-4 text-end text-[13px] tabular-nums text-faint">{idx + 1}</span>
                  <span className="h-1 w-5 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
                  <button onClick={() => onSelect(r.id)} className="text-start text-[16px] font-medium hover:text-brand hover:underline">
                    {r.name}
                  </button>
                </span>
              </td>
              <td className="px-3 py-3">
                <HoverTip
                  title={`${r.name} · ${t("Stability")}`}
                  body={t(
                    "0–100, all from the bad future: 35% how far its hours sit above break-even, 25% its lowest cash against your floor, 20% how much of the costs fall when work does, 20% months not at a loss. Higher is safer — it says nothing about how much a scenario earns.",
                  )}
                  className="block"
                >
                <span className="flex items-center gap-2">
                  <span className={`text-[18px] font-semibold tabular-nums ${r.grade === bestGrade && rows.length > 1 ? "text-[var(--state-final-fg)]" : ""}`}>{r.grade}</span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-border/70" dir="ltr">
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${r.grade}%`, background: r.grade >= 70 ? "var(--success)" : r.grade >= 45 ? "var(--warning)" : "var(--danger)" }}
                    />
                  </span>
                </span>
                </HoverTip>
              </td>
              {cols.map((c, i) => {
                const mid = c.get(r, "mid");
                const bad = c.noBad ? null : c.get(r, "bad");
                return (
                  <td key={c.label} className="whitespace-nowrap px-3 py-3 text-end tabular-nums last:rounded-e-2xl">
                    <HoverTip
                      title={`${r.name} · ${t(c.label)}`}
                      body={<>{metricInfo(c.label, t)}<span className="mt-2 block text-foreground">{t("Middle")} {mid == null ? t("none") : c.fmt(mid)}{bad != null && bad !== mid ? ` · ${t("Bad")} ${c.fmt(bad)}` : ""}</span></>}
                      className="inline-block"
                    >
                      <span className={`inline-block rounded-md px-1.5 text-[17px] font-semibold ${mid != null && mid === best[i] && rows.length > 1 ? "bg-[var(--state-final-bg)] text-[var(--state-final-fg)]" : ""}`}>
                        {mid == null ? t("none") : c.fmt(mid)}
                      </span>
                      {bad != null && bad !== mid && <span className="block text-[13px] text-faint">{t("bad {value}", { value: c.fmt(bad) })}</span>}
                    </HoverTip>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
