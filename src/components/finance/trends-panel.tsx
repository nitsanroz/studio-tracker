"use client";

// The charts beside the Salaries and Freelancers grids (Nitsan, 2026-11-15:
// "the pages that are mostly a table can get charts at the side, of trends and
// of things worth noticing"). The maths is lib/finance/trends.ts; this loads the
// earlier years and draws.
//
// A column at the side from 1536px; under that, a row of cards above the grid —
// the grid is ~1,850px wide and already scrolls sideways, so a side column on a
// laptop would only squeeze it.
//
// ⚠️ Every amount is TEXT with its ₪, never a `title`: "Hide numbers" smudges
// text it can see, and a native tooltip would show the figure anyway.

import { useEffect, useMemo, useState } from "react";
import { PanelFold } from "@/components/panel-fold";
import { useFold } from "@/lib/use-fold";
import { createClient } from "@/lib/finance/supabase-client";
import { fetchAll } from "@/lib/finance/db";
import { MONTH_SHORT } from "@/lib/finance/finance";
import { formatILS, formatILSShort } from "@/lib/finance/format";
import { trendsOf, type AmountRow, type Mover, type Trends } from "@/lib/finance/trends";

const YEARS_BACK = 4;
const pct = (f: number) => Math.round(f * 100);
const signed = (f: number) => `${f > 0 ? "+" : f < 0 ? "−" : ""}${Math.abs(pct(f))}%`;

const MOVER_WORD: Record<Mover["kind"], string> = { up: "up", down: "down", new: "new this year", gone: "not this year" };

function PanelCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h3 className="text-sm font-medium">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function TrendsPanel({
  table,
  nameColumn,
  amountColumn,
  year,
  through,
  current,
  what,
}: {
  table: string;
  nameColumn: string;
  amountColumn: string;
  year: number;
  /** the last month the comparison includes: the current month for this year, 12 for a past one */
  through: number;
  /** the year's rows, as the grid has them — so an edit shows here at once */
  current: AmountRow[];
  /** "salaries" / "freelance payments", for the captions */
  what: string;
}) {
  // The earlier years, loaded once per year looked at. A failure leaves the
  // comparisons out; the grid is what the page is for.
  const [history, setHistory] = useState<{ year: number; rows: AmountRow[] } | null>(null);
  useEffect(() => {
    let live = true;
    fetchAll<Record<string, unknown>>(createClient(), table, `id, year, month, ${nameColumn}, ${amountColumn}`, (q) => q.gte("year", year - YEARS_BACK).lte("year", year - 1))
      .then((rows) => {
        if (!live) return;
        setHistory({ year, rows: rows.map((r) => ({ year: Number(r.year), month: Number(r.month), name: String(r[nameColumn] ?? ""), amount: Number(r[amountColumn]) || 0 })) });
      })
      .catch(() => {
        if (live) setHistory({ year, rows: [] });
      });
    return () => {
      live = false;
    };
  }, [table, nameColumn, amountColumn, year]);

  const [open, toggle] = useFold("finance.trends");
  const earlier = history?.year === year ? history.rows : null;
  const t = useMemo(() => trendsOf([...(earlier ?? []), ...current], year, through), [earlier, current, year, through]);

  const monthMax = Math.max(1, ...t.months.map((m) => Math.max(m.amount, m.lastYear ?? 0)));
  const yearMax = Math.max(1, ...t.years.map((y) => y.amount));
  const span = t.through === 1 ? MONTH_SHORT[0] : `${MONTH_SHORT[0]}–${MONTH_SHORT[t.through - 1]}`;

  if (t.soFar === 0 && t.years.every((y) => y.amount === 0)) return null;

  // Folded: a clear tab to open it again, where the panel was.
  if (!open)
    return (
      <aside className="order-first shrink-0 2xl:order-last 2xl:sticky 2xl:top-20" aria-label="Trends">
        <PanelFold open={false} onClick={toggle} label="trends" />
      </aside>
    );

  return (
    <aside className="order-first shrink-0 2xl:order-last 2xl:sticky 2xl:top-20 2xl:w-[340px]" aria-label="Trends">
      <div className="mb-2 flex justify-end">
        <PanelFold open onClick={toggle} label="trends" />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-1">
        <PanelCard title={`${year}, month by month`} hint={t.lastYearSoFar != null ? `The grey line is ${year - 1}. Dashed is a forecast.` : "Dashed is a forecast."}>
          <MonthLines months={t.months} through={t.through} max={monthMax} />
          <p className="mt-3 text-sm">
            <span className="text-muted">{span}: </span>
            <span className="font-medium tabular-nums">{formatILS(Math.round(t.soFar))}</span>
          </p>
          {t.change != null && (
            <p className="text-xs text-muted">
              <span className="font-medium tabular-nums text-foreground">{signed(t.change)}</span> on the same months of {year - 1}
            </p>
          )}
        </PanelCard>

        {t.years.length > 1 && (
          <PanelCard title="Year by year" hint={t.through < 12 ? `${year} is ${span} only.` : undefined}>
            <YearLine years={t.years} max={yearMax} />
          </PanelCard>
        )}

        {t.people.length > 0 && (
          <PanelCard title="Who it goes to" hint={`Share of ${span} ${year}.`}>
            <ul className="flex flex-col gap-2">
              {t.people.map((p) => (
                <li key={p.name} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {p.name}
                    </span>
                    <span className="tabular-nums text-muted">{pct(p.share)}%</span>
                  </div>
                  <div className="relative mt-1 h-1.5 rounded-full bg-background">
                    <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${p.share * 100}%` }} />
                  </div>
                </li>
              ))}
              {t.others.count > 0 && (
                <li className="flex items-baseline justify-between gap-2 text-xs text-muted">
                  <span>
                    {t.others.count} more
                  </span>
                  <span className="tabular-nums">{pct(t.others.share)}%</span>
                </li>
              )}
            </ul>
          </PanelCard>
        )}

        <PanelCard title="Worth a look">
          <ul className="flex flex-col gap-2 text-xs text-muted">
            <li>
              An average month of {what}: <span className="font-medium tabular-nums text-foreground">{formatILS(Math.round(t.average))}</span>
            </li>
            {t.peak && (
              <li>
                The highest was {MONTH_SHORT[t.peak.month - 1]}: <span className="font-medium tabular-nums text-foreground">{formatILS(Math.round(t.peak.amount))}</span>
              </li>
            )}
            <li>
              <span className="font-medium text-foreground">{t.headcount.now}</span> {t.headcount.now === 1 ? "person" : "people"} paid in {span}
              {t.headcount.lastYear != null && t.headcount.lastYear !== t.headcount.now && <>, {t.headcount.lastYear} a year before</>}
            </li>
            {t.movers.length > 0 && (
              <li className="mt-1 border-t border-border pt-2">
                <p className="mb-1 text-faint">Moved most against {year - 1}</p>
                <ul className="flex flex-col gap-1">
                  {t.movers.map((m) => (
                    <li key={m.name} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate" dir="auto">
                        <span className="text-foreground">{m.name}</span> · {MOVER_WORD[m.kind]}
                      </span>
                      <span className="tabular-nums text-foreground">
                        {m.change > 0 ? "+" : "−"}
                        {formatILS(Math.round(Math.abs(m.change)))}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ul>
        </PanelCard>
      </div>
    </aside>
  );
}

const CW = 300;
const CH = 96;
const CP = { l: 4, r: 4, t: 8, b: 16 };

/** This year as a line (dashed where it is a forecast), last year as a thin grey one. */
function MonthLines({ months, through, max }: { months: Trends["months"]; through: number; max: number }) {
  const x = (m: number) => CP.l + ((m - 1) / 11) * (CW - CP.l - CP.r);
  const y = (v: number) => CP.t + (1 - v / max) * (CH - CP.t - CP.b);
  const path = (pts: { m: number; v: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const real = months.filter((m) => m.amount > 0 && m.month <= through && !m.predicted);
  const lastReal = real.at(-1)?.month ?? 0;
  const ahead = months.filter((m) => m.amount > 0 && m.month >= lastReal && (m.month > through || m.predicted || m.month === lastReal));
  const before = months.filter((m) => m.lastYear != null && m.lastYear > 0);
  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" role="img" aria-label="This year month by month, against last year">
      {before.length > 1 && <path d={path(before.map((m) => ({ m: m.month, v: m.lastYear ?? 0 })))} fill="none" stroke="var(--faint)" strokeWidth={1.25} />}
      {real.length > 1 && <path d={path(real.map((m) => ({ m: m.month, v: m.amount })))} fill="none" stroke="var(--brand)" strokeWidth={2.25} strokeLinejoin="round" />}
      {ahead.length > 1 && <path d={path(ahead.map((m) => ({ m: m.month, v: m.amount })))} fill="none" stroke="var(--brand)" strokeWidth={2} strokeDasharray="4 3" opacity={0.6} />}
      {real.map((m) => (
        <circle key={m.month} cx={x(m.month)} cy={y(m.amount)} r={2.25} fill="var(--brand)" />
      ))}
      {months.map((m) => (
        <text key={m.month} x={x(m.month)} y={CH - 3} textAnchor="middle" fontSize={9} fill="var(--faint)">
          {MONTH_SHORT[m.month - 1][0]}
        </text>
      ))}
    </svg>
  );
}

/** The last years as one line; a year still running ends in a hollow point. */
function YearLine({ years, max }: { years: Trends["years"]; max: number }) {
  const n = years.length;
  const x = (i: number) => CP.l + 18 + (n > 1 ? i / (n - 1) : 0.5) * (CW - CP.l - CP.r - 36);
  const y = (v: number) => CP.t + 10 + (1 - v / max) * (CH - CP.t - CP.b - 10);
  const done = years.filter((yr) => !yr.partial);
  const d = done.map((yr) => `${years.indexOf(yr) ? "L" : "M"}${x(years.indexOf(yr)).toFixed(1)},${y(yr.amount).toFixed(1)}`).join(" ").replace(/^L/, "M");
  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full" role="img" aria-label="Year by year">
      {done.length > 1 && <path d={d} fill="none" stroke="var(--brand)" strokeWidth={2.25} strokeLinejoin="round" />}
      {years.map((yr, i) => (
        <g key={yr.year}>
          <circle cx={x(i)} cy={y(yr.amount)} r={3} fill={yr.partial ? "var(--surface)" : "var(--brand)"} stroke="var(--brand)" strokeWidth={1.5} />
          <text x={x(i)} y={y(yr.amount) - 7} textAnchor="middle" fontSize={9} fill="var(--muted)" className="tabular-nums">
            {formatILSShort(yr.amount)}
          </text>
          <text x={x(i)} y={CH - 3} textAnchor="middle" fontSize={9} fill="var(--faint)">
            {yr.year}
          </text>
        </g>
      ))}
    </svg>
  );
}
