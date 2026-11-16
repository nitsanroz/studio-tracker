"use client";

import { Caret } from "@/components/caret";
import { useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { Hover } from "@/components/finance/scenarios/hover";
import { useT } from "@/components/finance/scenarios/lang";
import { Slider } from "@/components/finance/scenarios/slider";
import { useCompanyFigures } from "@/components/finance/company-figures";
import type { T } from "@/lib/finance/scenarios/i18n";
import type { Demand } from "@/lib/finance/scenarios/starters";
import type { Baseline, CompanyFacts } from "@/lib/finance/scenarios/types";

/** A card in the offer page's look: Light White header strip, brand-blue title. */
export function StripCard({
  title,
  info,
  right,
  children,
  foldable = false,
  defaultOpen = true,
  bare = false,
}: {
  title: string;
  info?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  /** A chevron folds the card to its header strip. */
  foldable?: boolean;
  defaultOpen?: boolean;
  /** Inside a tab: no card around it — just its (i) and actions over the body. */
  bare?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (bare)
    return (
      <div>
        {(info || right) && (
          <div className="mb-3 flex items-center gap-2 text-[15px] text-muted">
            {info && <Hover title={title}>{info}</Hover>}
            {right && <span className="ms-auto">{right}</span>}
          </div>
        )}
        {children}
      </div>
    );
  const shown = !foldable || open;
  return (
    <section className="overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-[#dfe4ee]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[var(--strip)] px-4 py-3 sm:px-5">
        {foldable ? (
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 text-start">
            <ChevronDown size={18} className={`text-faint transition-transform ${open ? "" : "-rotate-90 rtl:rotate-90"}`} />
            <h2 className="text-[20px] font-medium leading-7 text-brand">{title}</h2>
          </button>
        ) : (
          <h2 className="text-[20px] font-medium leading-7 text-brand">{title}</h2>
        )}
        {info && <Hover title={title}>{info}</Hover>}
        {right && <span className="ms-auto">{right}</span>}
      </div>
      {shown && <div className="px-4 pb-5 pt-4 sm:px-5">{children}</div>}
    </section>
  );
}

/** A past mark's word: "2025 average" → "2025 avg" (or its Hebrew). */
function shortPast(label: string, t: T) {
  const avg = label.match(/^(\d{4}) average$/);
  if (avg) return t("{year} avg", { year: avg[1] });
  const low = label.match(/^(\d{4}) lowest month$/);
  if (low) return t("{year} low", { year: low[1] });
  return label === "Last 3 months" ? t("last 3 mo") : label;
}

/** Each past mark's row: a mark too close to one already on a row goes down a row. */
function placePast(refs: Baseline["references"], max: number) {
  const gap = max * 0.09;
  const rows: number[][] = [];
  return [...refs]
    .sort((a, b) => a.hours - b.hours)
    .map((r) => {
      let row = rows.findIndex((hs) => hs.every((h) => Math.abs(h - r.hours) >= gap));
      if (row < 0) row = rows.push([]) - 1;
      rows[row].push(r.hours);
      return { r, row };
    });
}
const pastRows = (refs: Baseline["references"], max: number) => Math.max(1, ...placePast(refs, max).map((p) => p.row + 1));

/** How much work comes in: the middle, and how far bad and good go either side. */
export function DemandCard({ demand, baseline, onChange, onReset, bare }: { demand: Demand; baseline: Baseline; onChange: (d: Demand) => void; onReset: () => void; bare?: boolean }) {
  const { t } = useT();
  const bad = Math.round(demand.hours * (1 - demand.spread));
  const good = Math.round(demand.hours * (1 + demand.spread));
  const max = Math.max(900, ...baseline.references.map((r) => r.hours * 1.3));
  const scale = (h: number) => `${Math.min(100, (h / max) * 100)}%`;
  return (
    <StripCard
      bare={bare}
      title={t("How much work comes in")}
      info={t(
        "Billable hours a month that clients will buy, in today's terms. Nobody knows the next year, so every scenario runs against three futures: the middle you set, a bad one under it and a good one over it, as far as the range says. The past is shown only for reference — it doesn't drive anything.",
      )}
      right={
        <button onClick={onReset} className="flex items-center gap-1.5 text-[15px] text-muted hover:text-brand">
          <RotateCcw size={15} /> {t("Last 3 months")}
        </button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Slider label={t("Middle — hours a month")} value={demand.hours} onChange={(v) => onChange({ ...demand, hours: v })} min={0} max={Math.round(max / 50) * 50} step={5} unit="h" />
        <Slider
          label={t("How wide the range is")}
          hint={t("25% = the bad future is 25% fewer hours than the middle, the good one 25% more. Wider = less sure.")}
          value={Math.round(demand.spread * 100)}
          onChange={(v) => onChange({ ...demand, spread: Math.max(0, Math.min(90, v)) / 100 })}
          min={0}
          max={60}
          step={5}
          unit="%"
        />
      </div>
      {/* The three futures on one line, with the past marked beneath. Hours run
          left to right in both languages. */}
      <div className="mt-4" dir="ltr">
        {/* The bar, then each future hanging under it: a small caret pointing
            up at its place and its word + hours beneath (Nitsan, 2026-11-16:
            "a triangle from the text pointing to the bar — a more delicate
            solution" than the dark tick through it). */}
        <div className="relative h-12">
          <div className="absolute inset-x-0 top-0 h-2 rounded-full bg-[var(--strip)] ring-1 ring-border" />
          <div className="absolute top-0 h-2 rounded-full bg-gradient-to-r from-red-300 via-brand to-emerald-400" style={{ left: scale(bad), width: `calc(${scale(good)} - ${scale(bad)})` }} />
          {[
            { h: bad, label: t("Bad"), cls: "text-danger" },
            { h: demand.hours, label: t("Middle"), cls: "text-brand" },
            { h: good, label: t("Good"), cls: "text-success" },
          ].map((p) => (
            <span key={p.label} className="absolute top-2.5 flex -translate-x-1/2 flex-col items-center" style={{ left: scale(p.h) }}>
              <Caret dir="up" className={p.cls} />
              <span className="mt-1 whitespace-nowrap text-[15px] leading-5 tabular-nums">
                <span className={`hidden font-medium sm:inline ${p.cls}`}>{p.label} </span>
                <span className="font-semibold">{p.h}h</span>
              </span>
            </span>
          ))}
        </div>
        <p className="mt-3 flex justify-between text-[15px] font-medium tabular-nums sm:hidden">
          <span className="text-danger">{t("Bad")} {bad}h</span>
          <span className="text-brand">{t("Middle")} {demand.hours}h</span>
          <span className="text-success">{t("Good")} {good}h</span>
        </p>
        {/* The past, under the bar: a grey caret pointing up at its place and a
            word. Marks close together drop to a second row so their labels
            don't collide. */}
        <div className="relative mt-5" style={{ height: `${pastRows(baseline.references, max) * 26 + 12}px` }}>
          {placePast(baseline.references, max).map(({ r, row }) => (
            <span
              key={r.label}
              className="absolute flex -translate-x-1/2 flex-col items-center text-center"
              style={{ left: scale(r.hours), top: row * 26 }}
              title={t("{label}: {hours}h — the past, for reference only", { label: shortPast(r.label, t), hours: Math.round(r.hours) })}
            >
              <Caret dir="up" size={8} className="text-faint" />
              <span className="block whitespace-nowrap text-[13px] leading-4 text-muted">{shortPast(r.label, t)}</span>
            </span>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[14px] text-faint">{t("Grey marks: the past, for reference only — it doesn't drive anything.")}</p>
    </StripCard>
  );
}

const FIELDS: { key: keyof CompanyFacts; label: string; unit: "₪" | "%"; min: number; max: number; step: number; pct?: boolean }[] = [
  { key: "cashToday", label: "Cash in the bank", unit: "₪", min: 0, max: 800_000, step: 1_000 },
  { key: "loan", label: "You owe the company (loan)", unit: "₪", min: 0, max: 400_000, step: 1_000 },
  { key: "loanInterest", label: "Loan interest a year", unit: "%", min: 0, max: 10, step: 0.5, pct: true },
  { key: "retained", label: "Retained earnings", unit: "₪", min: 0, max: 1_000_000, step: 1_000 },
  { key: "leaseholdLeft", label: "Leasehold improvements left", unit: "₪", min: 0, max: 100_000, step: 1_000 },
  { key: "equipmentBook", label: "Equipment book value", unit: "₪", min: 0, max: 100_000, step: 1_000 },
  { key: "taxRefund", label: "Tax refund expected", unit: "₪", min: 0, max: 50_000, step: 500 },
  { key: "corporateTax", label: "Company tax", unit: "%", min: 0, max: 40, step: 1, pct: true },
  { key: "dividendTax", label: "Dividend tax", unit: "%", min: 0, max: 40, step: 1, pct: true },
  { key: "netShare", label: "Net ÷ gross salary", unit: "%", min: 40, max: 100, step: 1, pct: true },
  { key: "bracketTop", label: "Salary bracket top", unit: "₪", min: 10_000, max: 60_000, step: 500 },
];

/** The company's facts the finance app doesn't hold — from the 2025 report, editable. */
export function FactsCard({ facts, cashFloor, onChange, saved, bare }: { facts: CompanyFacts; cashFloor: number; onChange: (f: CompanyFacts) => void; saved: boolean; bare?: boolean }) {
  const { t } = useT();
  const set = (k: keyof CompanyFacts, v: number | string | null) => onChange({ ...facts, [k]: v });
  const box = "mt-1 block w-full rounded-xl bg-surface px-3 py-2 text-[16px] ring-1 ring-border";
  const { factSource: FACT_SOURCE } = useCompanyFigures();
  const src = (k: keyof CompanyFacts) => (FACT_SOURCE[k] ? t(FACT_SOURCE[k]!) : undefined);
  return (
    <StripCard
      bare={bare}
      title={t("Company facts")}
      info={t("From the accountant's signed 2025 report and the call with him (Nov 2026). Labelled estimates — confirm tax figures with the accountant. Nothing here changes the P&L.")}
      right={<span className="text-[15px] text-faint">{saved ? t("saved as you change them") : t("not saved")}</span>}
    >
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Slider
          label={t("Your take-home floor (net a month)")}
          hint={src("takeHomeFloor")}
          value={facts.takeHomeFloor ?? 0}
          onChange={(v) => set("takeHomeFloor", v > 0 ? v : null)}
          min={0}
          max={60_000}
          step={500}
          unit="₪"
        />
        <Slider
          label={facts.cashFloor == null ? t("Cash floor (two months of costs)") : t("Cash floor")}
          hint={src("cashFloor")}
          value={cashFloor}
          onChange={(v) => set("cashFloor", v)}
          min={0}
          max={500_000}
          step={5_000}
          unit="₪"
        />
        {FIELDS.map((f) => (
          <Slider
            key={f.key}
            label={t(f.label)}
            hint={src(f.key)}
            value={f.pct ? Math.round(Number(facts[f.key]) * 1000) / 10 : Number(facts[f.key])}
            onChange={(v) => set(f.key, f.pct ? v / 100 : v)}
            min={f.min}
            max={f.max}
            step={f.step}
            unit={f.unit}
          />
        ))}
        <label className="block text-[15px] text-muted">
          {t("Cash figure is from")}
          <input type="date" value={facts.cashAsOf} onChange={(e) => e.target.value && set("cashAsOf", e.target.value)} className={box} />
        </label>
        <label className="block text-[15px] text-muted">
          {t("Refund expected in")}
          <input type="month" value={facts.taxRefundMonth} onChange={(e) => e.target.value && set("taxRefundMonth", e.target.value)} className={box} />
        </label>
      </div>
    </StripCard>
  );
}
