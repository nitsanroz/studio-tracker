"use client";

// The raise: whether to raise their salary, to how much, when, and on what
// condition — raiseAdvice (lib/people.ts) laid out as a verdict, three key
// figures, the why and the condition, and their salary over time.

import { BarCaret } from "@/components/caret";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CalendarDays,
  CircleSlash,
  Clock,
  Pause,
  Target,
  Thermometer,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Card, SectionTitle } from "@/components/finance/ui";
import { MONTH_SHORT } from "@/lib/finance/finance";
import { formatILSShort, formatNum } from "@/lib/finance/format";
import { isHourlySlip, MAX_RAISE, type PayslipMonth, type RaisePlan } from "@/lib/finance/people";
import { MONTH_LONG } from "./model";

const monthShort = (ym: string) => `${MONTH_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

const VERDICT: Record<RaisePlan["verdict"], { label: string; icon: LucideIcon; pill: string; accent: string }> = {
  raise: { label: "Raise", icon: TrendingUp, pill: "bg-success/15 text-success", accent: "var(--success)" },
  raise_if: { label: "Raise if it holds", icon: CalendarClock, pill: "bg-brand-soft text-brand-dark", accent: "var(--brand)" },
  hold: { label: "Hold", icon: Pause, pill: "bg-[var(--state-predicted-bg)] text-[var(--state-predicted-fg)]", accent: "var(--warning)" },
  no_raise: { label: "No raise yet", icon: CircleSlash, pill: "bg-danger/10 text-danger", accent: "var(--danger)" },
  review: { label: "Review", icon: CalendarClock, pill: "bg-surface-2 text-muted", accent: "var(--faint)" },
};

const RAISE_INFO = `Worked out from What their work supports (below), over both the last 3 and the last 12 months: a raise when both clear their salary by 5% or more; only the last 3 — raise in 3 months if it holds. At most ${Math.round(
  MAX_RAISE * 100,
)}% at once, rounded down to ₪500, and a year after the last raise (from the HR timeline and their payslips). Hours are billable hours, as full time, at their recent ₪ an hour. It can't see the quality of their work or the market — read it as the numbers' side of the decision.`;

export function RaiseBox({
  plan,
  share,
  slips,
  sick12,
}: {
  plan: RaisePlan;
  share: number | null;
  slips: PayslipMonth[];
  /** Sick days on their last 12 months' payslips, when known. */
  sick12: number | null;
}) {
  const { verdict, unit, basis, current, supported3, supported12, work3, premium, target, ceiling, when, lastRise, billable3, billable12, workdays, need } =
    plan;
  const v = VERDICT[verdict];
  const per = unit === "hour" ? "/h" : "";
  const exact = (x: number) => `₪${formatNum(x)}${per}`;
  const approx = (x: number) => `₪${formatNum(unit === "hour" ? x : Math.round(x / 100) * 100)}${per}`;
  const terms = basis === "cost" ? "in cost to the studio" : share != null ? "full time" : "gross";
  const whenText = when === "now" ? "Now" : MONTH_LONG(when);
  const raising = verdict === "raise" || verdict === "raise_if";
  const perDay = (h: number) => (workdays ? ` · ${formatNum(h / workdays, 1)}h a workday` : "");

  const headline =
    verdict === "raise"
      ? `Raise to ${exact(target!)}`
      : verdict === "raise_if"
        ? `Raise to ${exact(target!)} if the next months hold`
        : verdict === "hold"
          ? `Keep ${exact(current)} for now`
          : verdict === "no_raise"
            ? "Not yet — their work doesn't carry their salary"
            : "A pay review, on judgement";

  const why =
    verdict === "review"
      ? "Their hours aren't their own billable work (or too few months were tracked), so a raise rests on their role, the market and the studio's year."
      : verdict === "raise"
        ? `Their work has paid for more than their salary over both the last 3 and 12 months.${ceiling ? ` It supports up to ${approx(ceiling)} — a further step at the review after, if it holds.` : ""}`
        : verdict === "raise_if"
          ? "The last 3 months support it, the last 12 don't yet — it's recent, so give it 3 more months."
          : verdict === "hold"
            ? "Their work supports about what they're paid."
            : `Their work supports ${supported3 != null ? approx(supported3) : "less"} — under what they're paid.`;

  return (
    <Card className="overflow-hidden">
      <SectionTitle info={RAISE_INFO}>Salary raise</SectionTitle>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          {/* Verdict */}
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${v.accent} 14%, transparent)` }}>
              <v.icon size={20} style={{ color: v.accent }} />
            </span>
            <div className="min-w-0">
              <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ${v.pill}`}>{v.label}</span>
              <div className="mt-1 text-xl font-semibold leading-tight tabular-nums">{headline}</div>
            </div>
          </div>

          {/* Now → recommended · when */}
          <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr_1fr]">
            <Tile icon={Wallet} label="Now" value={exact(current)} sub={terms} />
            <ArrowRight size={16} className="self-center text-faint" />
            <Tile
              icon={Target}
              label={raising ? "Recommended" : verdict === "hold" ? "Next step" : "Recommended"}
              value={raising || (verdict === "hold" && target != null) ? exact(target!) : "No change"}
              sub={raising ? `+${Math.round(((target! - current) / current) * 100)}% · +${exact(target! - current)}` : verdict === "hold" ? "once the condition is met" : undefined}
              tone={raising ? "good" : undefined}
            />
            <Tile
              icon={CalendarDays}
              label="When"
              value={whenText}
              sub={lastRise ? `last raise or start ${monthShort(lastRise)}` : undefined}
              className="col-span-3 sm:col-span-1"
            />
          </div>

          {/* Why · condition */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Section icon={BarChart3} title="Why">
              <p className="mb-2 text-xs text-muted">{why}</p>
              {supported3 != null && (
                <Bars
                  rows={[
                    { label: "Paid now", v: current, color: "var(--foreground)" },
                    ...(premium !== 0 && work3 != null ? [{ label: "Their work alone · 3 months", v: work3, color: "var(--border-strong)" }] : []),
                    {
                      label: premium !== 0 ? `With beyond the hours (${premium > 0 ? "+" : "−"}${Math.round(Math.abs(premium) * 100)}%) · 3 months` : "Supports · 3 months",
                      v: supported3,
                      color: supported3 >= current ? "var(--success)" : "var(--danger)",
                    },
                    ...(supported12 != null
                      ? [
                          {
                            label: premium !== 0 ? "With beyond the hours · 12 months" : "Supports · 12 months",
                            v: supported12,
                            color: supported12 >= current ? "var(--success)" : "var(--danger)",
                          },
                        ]
                      : []),
                  ]}
                  format={approx}
                />
              )}
              {sick12 != null && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
                  <Thermometer size={12} />
                  {sick12 ? `${formatNum(sick12, sick12 % 1 ? 1 : 0)} sick day${sick12 === 1 ? "" : "s"} in the last 12 months` : "No sick days in the last 12 months"}
                  {sick12 > 0 && <span className="text-faint">— already in their hours</span>}
                </p>
              )}
            </Section>
            <Section icon={Clock} title="Condition">
              {need && billable3 != null ? (
                <>
                  <p className="mb-2 text-xs text-muted">
                    {verdict === "raise"
                      ? `Keep billing about ${Math.round(need.hours)}h a month${perDay(need.hours)} — it holds at their pace now.`
                      : verdict === "raise_if"
                        ? `About ${Math.round(need.hours)} billable hours a month${perDay(need.hours)} until ${whenText}.`
                        : verdict === "hold"
                          ? `${exact(target!)} needs about ${Math.round(need.hours)} billable hours a month${perDay(need.hours)}.`
                          : `Carrying ${exact(current)} needs about ${Math.round(need.hours)} billable hours a month${perDay(need.hours)} — more client work, better-paying clients, fewer written-down hours.`}
                  </p>
                  <HoursMeter now={billable3} need={need.hours} year={billable12} />
                </>
              ) : (
                <p className="text-xs text-muted">
                  {when === "now" ? "A year or more since their last raise — talk about pay now." : `Raises come a year apart: next in ${whenText}.`}
                </p>
              )}
            </Section>
          </div>
        </div>

        <SalaryHistory slips={slips} unit={unit} target={raising ? target : null} when={when} />
      </div>
    </Card>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone?: "good";
  className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-xl border p-2.5 ${tone === "good" ? "border-success/40 bg-success/5" : "border-border bg-background"} ${className}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
        <Icon size={13} />
        {label}
      </div>
      <div className={`mt-0.5 truncate text-base font-semibold tabular-nums ${tone === "good" ? "text-success" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] leading-snug text-faint">{sub}</div>}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
        <Icon size={14} className="text-muted" />
        {title}
      </div>
      {children}
    </div>
  );
}

function Bars({ rows, format }: { rows: { label: string; v: number; color: string }[]; format: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.v)) || 1;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="text-muted">{r.label}</span>
            <span className="font-medium tabular-nums">{format(r.v)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2">
            <div className="h-1.5 rounded-full" style={{ width: `${(r.v / max) * 100}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Billable hours a month now against what the condition needs. */
function HoursMeter({ now, need, year }: { now: number; need: number; year: number | null }) {
  const max = Math.max(now, need, year ?? 0) * 1.1 || 1;
  const met = now >= need;
  return (
    <div>
      <div className="relative h-2.5 rounded-full bg-surface-2">
        <div className="h-2.5 rounded-full" style={{ width: `${(now / max) * 100}%`, background: met ? "var(--success)" : "var(--warning)" }} />
      </div>
      {/* what it needs: a caret under the bar pointing up at it (caret.tsx) */}
      <div className="relative h-2">
        <BarCaret left={`${(need / max) * 100}%`} offset={1} className="text-foreground/70" title={`Needs ${Math.round(need)}h`} />
      </div>
      <div className="mt-0.5 flex justify-between text-[11px] text-muted tabular-nums">
        <span>
          Now <b className="text-foreground">{Math.round(now)}h</b>
          {year != null && <span className="text-faint"> · 12 months {Math.round(year)}h</span>}
        </span>
        <span>
          Needs <b className="text-foreground">{Math.round(need)}h</b>
        </span>
      </div>
    </div>
  );
}

/** Their salary rate on every payslip paid the same way as now (monthly, or
 * hourly), as steps — raises marked — and the recommended one ahead. */
function SalaryHistory({ slips, unit, target, when }: { slips: PayslipMonth[]; unit: "month" | "hour"; target: number | null; when: string }) {
  const pts = slips
    .filter((p) => p.salaryRate != null && isHourlySlip(p) === (unit === "hour"))
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((p) => ({ k: ym(p.year, p.month), v: p.salaryRate! }));
  if (pts.length < 2) return <div className="hidden lg:block" />;
  const per = unit === "hour" ? "/h" : "";
  const fmt = (x: number) => (unit === "hour" ? `₪${formatNum(x)}${per}` : formatILSShort(x));
  const idx = (k: string) => Number(k.slice(0, 4)) * 12 + Number(k.slice(5)) - 1;
  const lastK = pts[pts.length - 1].k;
  const ahead = target != null ? (when === "now" ? idx(lastK) + 1 : Math.max(idx(when), idx(lastK) + 1)) : null;
  const i0 = idx(pts[0].k);
  const i1 = ahead ?? idx(lastK);
  const W = 300;
  const H = 150;
  const [l, r, t, b] = [8, 44, 16, 20];
  const lo = Math.min(...pts.map((p) => p.v), target ?? Infinity) * 0.9;
  const hi = Math.max(...pts.map((p) => p.v), target ?? 0) * 1.05;
  const x = (i: number) => l + ((i - i0) / Math.max(1, i1 - i0)) * (W - l - r);
  const y = (v: number) => t + (1 - (v - lo) / (hi - lo || 1)) * (H - t - b);
  // Steps: flat until the next payslip's rate, then up or down.
  let d = `M${x(idx(pts[0].k))},${y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${x(idx(pts[i].k))} V${y(pts[i].v)}`;
  const raises = pts.filter((p, i) => i > 0 && p.v > pts[i - 1].v);
  const years: number[] = [];
  for (let yr = Math.ceil(i0 / 12); yr * 12 <= i1; yr++) years.push(yr);
  const last = pts[pts.length - 1];

  return (
    <div className="min-w-0 rounded-xl border border-border bg-background p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
        <TrendingUp size={14} className="text-muted" />
        Salary over time
        <span className="ml-auto text-[11px] font-normal text-faint">
          {raises.length} raise{raises.length === 1 ? "" : "s"} since {monthShort(pts[0].k)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Their gross salary on each payslip, with the recommended one ahead">
        {years.map((yr) => (
          <g key={yr}>
            <line x1={x(yr * 12)} y1={t} x2={x(yr * 12)} y2={H - b} stroke="var(--border)" strokeWidth={0.6} strokeDasharray="2 3" />
            <text x={x(yr * 12)} y={H - 6} textAnchor="middle" fontSize={8} fill="var(--faint)">
              {yr}
            </text>
          </g>
        ))}
        {/* The app's line fill (line-style.tsx). Steps, not a curve: a salary
            holds until the next payslip changes it — smoothing would draw raises
            that never happened. Raise markers stay; they are events, not points. */}
        <defs>
          <linearGradient id="salary-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={`${d} V${H - b} H${x(idx(pts[0].k))} Z`} fill="url(#salary-fill)" />
        <path d={d} fill="none" stroke="var(--brand)" strokeWidth={1.8} strokeLinejoin="round" />
        {raises.map((p) => (
          <g key={p.k}>
            <circle cx={x(idx(p.k))} cy={y(p.v)} r={2.6} fill="var(--brand)" stroke="var(--surface)" strokeWidth={1}>
              <title>{`${monthShort(p.k)}: ${fmt(p.v)}`}</title>
            </circle>
          </g>
        ))}
        <text x={x(idx(last.k)) + 4} y={y(last.v) + 3} fontSize={9} fontWeight={600} fill="var(--foreground)">
          {fmt(last.v)}
        </text>
        {ahead != null && target != null && (
          <g>
            <path
              d={`M${x(idx(last.k))},${y(last.v)} H${x(ahead)} V${y(target)}`}
              fill="none"
              stroke="var(--success)"
              strokeWidth={1.6}
              strokeDasharray="3 2.5"
            />
            <circle cx={x(ahead)} cy={y(target)} r={3.2} fill="var(--success)" stroke="var(--surface)" strokeWidth={1.2} />
            <text x={x(ahead) + 5} y={y(target) - 4} fontSize={9} fontWeight={600} fill="var(--success)">
              {fmt(target)}
            </text>
          </g>
        )}
      </svg>
      {raises.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
          {raises.slice(-4).map((p) => {
            const prev = pts[pts.indexOf(p) - 1].v;
            return (
              <li key={p.k} className="tabular-nums">
                {monthShort(p.k)} <span className="text-success">+{Math.round(((p.v - prev) / prev) * 100)}%</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
