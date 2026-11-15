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
import { createClient } from "@/lib/finance/supabase-client";
import { fetchAll } from "@/lib/finance/db";
import { MONTH_SHORT } from "@/lib/finance/finance";
import { formatILS, formatILSShort } from "@/lib/finance/format";
import { trendsOf, type AmountRow, type Mover } from "@/lib/finance/trends";

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

  const earlier = history?.year === year ? history.rows : null;
  const t = useMemo(() => trendsOf([...(earlier ?? []), ...current], year, through), [earlier, current, year, through]);

  const monthMax = Math.max(1, ...t.months.map((m) => Math.max(m.amount, m.lastYear ?? 0)));
  const yearMax = Math.max(1, ...t.years.map((y) => y.amount));
  const span = t.through === 1 ? MONTH_SHORT[0] : `${MONTH_SHORT[0]}–${MONTH_SHORT[t.through - 1]}`;

  if (t.soFar === 0 && t.years.every((y) => y.amount === 0)) return null;

  return (
    <aside className="order-first shrink-0 2xl:order-last 2xl:sticky 2xl:top-20 2xl:w-[340px]" aria-label="Trends">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-1">
        <PanelCard title={`${year}, month by month`} hint={t.lastYearSoFar != null ? `The thin line is ${year - 1}. Pale bars are forecasts.` : "Pale bars are forecasts."}>
          <div className="flex h-24 items-end gap-1">
            {t.months.map((m) => (
              <div key={m.month} className="relative flex h-full min-w-0 flex-1 items-end">
                <div
                  className={`w-full rounded-t-sm ${m.month > t.through || m.predicted ? "bg-brand/25" : "bg-brand"}`}
                  style={{ height: `${(m.amount / monthMax) * 100}%`, minHeight: m.amount ? 2 : 0 }}
                />
                {m.lastYear != null && m.lastYear > 0 && <div className="absolute inset-x-0 h-px bg-foreground/60" style={{ bottom: `${(m.lastYear / monthMax) * 100}%` }} />}
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-[10px] text-faint">
            {t.months.map((m) => (
              <span key={m.month} className="min-w-0 flex-1 text-center">
                {MONTH_SHORT[m.month - 1][0]}
              </span>
            ))}
          </div>
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
            <ul className="flex flex-col gap-2">
              {t.years.map((y) => (
                <li key={y.year} className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2 text-xs">
                  <span className="tabular-nums text-muted">{y.year}</span>
                  <span className="relative h-2.5 rounded-full bg-background">
                    <span className={`absolute inset-y-0 left-0 rounded-full ${y.partial ? "bg-brand/45" : "bg-brand"}`} style={{ width: `${(y.amount / yearMax) * 100}%` }} />
                  </span>
                  <span className="tabular-nums">{formatILSShort(y.amount)}</span>
                </li>
              ))}
            </ul>
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
