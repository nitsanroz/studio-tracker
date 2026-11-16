"use client";

// Overview: what to do about them, and how they're doing — the recommendations,
// their pay against what their work supports, and the last 3 months in one look.

import { CheckCircle2 } from "lucide-react";
import { Card, SectionTitle, Loading } from "@/components/finance/ui";
import { formatILS, formatNum } from "@/lib/finance/format";
import { neededReturn, type Advice } from "@/lib/finance/people";
import { HoursSplitBar, ReturnScale, SalaryBars } from "./visuals";
import type { PersonModel } from "./model";

const TONE: Record<Advice["tone"], { label: string; className: string }> = {
  act: { label: "Act", className: "bg-brand-soft text-brand-dark" },
  watch: { label: "Watch", className: "bg-[var(--state-predicted-bg)] text-[var(--state-predicted-fg)]" },
  good: { label: "Good", className: "bg-[var(--state-final-bg)] text-[var(--state-final-fg)]" },
};

export function OverviewTab({ m, onOpen }: { m: PersonModel; onOpen: (tab: "pay" | "performance") => void }) {
  const r = m.recent;
  if (!r) return <Loading label="Working out pay and efficiency…" inline />;
  const p3 = r.periods.last3;
  const s3 = p3.eff.summary;
  const g = p3.gross?.recommended != null ? p3.gross : null;
  const per = g?.unit === "hour" ? "/h" : "";
  const needed = neededReturn(p3.pay);
  const side = m.own && (p3.pay || s3.hours >= 1);

  return (
    <div className={`grid grid-cols-1 gap-4 ${side ? "lg:grid-cols-3" : ""}`}>
      <Card className={side ? "lg:col-span-2" : ""}>
        <SectionTitle
          hint="for you, as their employer"
          info="Worked out from their numbers and their HR timeline: pay against what their work supports, time since the last salary update and review talk, and which way their hours are going. It can't see the quality of their work — read it as what to look into, not a verdict."
        >
          Recommendations
        </SectionTitle>
        {r.advice.length ? (
          <ul className="space-y-3">
            {r.advice.map((a) => (
              <li key={a.title} className="grid grid-cols-[3.5rem_1fr] items-start gap-3 text-sm">
                <span className={`rounded-md px-1.5 py-0.5 text-center text-[11px] font-medium ${TONE[a.tone].className}`}>
                  {TONE[a.tone].label}
                </span>
                <div>
                  <div className="font-medium">{a.title}</div>
                  <div className="text-muted">{a.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 py-4 text-sm text-muted">
            <CheckCircle2 size={16} className="text-success" />
            {m.person.position === "owner" ? "No recommendations for the owner." : "Nothing needs your attention right now."}
          </p>
        )}
      </Card>

      {side && (
        <div className="flex flex-col gap-4">
          {p3.pay && (
            <Card>
              <SectionTitle hint="last 3 months">Salary check</SectionTitle>
              {g ? (
                <SalaryBars
                  now={g.current}
                  supports={g.recommended!}
                  nowLabel={`Gross salary${g.share != null ? " (full time)" : ""}`}
                  supportsLabel="Their work supports"
                  format={(v) => (per ? `₪${formatNum(v)}${per}` : formatILS(Math.round(v / 100) * 100))}
                />
              ) : (
                <SalaryBars now={p3.pay.actual} supports={p3.pay.recommended} nowLabel="Cost to the studio" supportsLabel="Their work supports" />
              )}
              <button onClick={() => onOpen("pay")} className="mt-3 text-xs text-brand hover:underline">
                How it&apos;s worked out →
              </button>
            </Card>
          )}
          {s3.hours >= 1 && (
            <Card>
              <SectionTitle hint="last 3 months">At a glance</SectionTitle>
              <HoursSplitBar summary={s3} compact />
              {s3.returnRatio != null && (
                <div className="mt-4">
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="text-muted">Return</span>
                    <span className="text-base font-semibold tabular-nums">{s3.returnRatio.toFixed(1)}×</span>
                  </div>
                  <ReturnScale value={s3.returnRatio} needed={needed} />
                </div>
              )}
              <button onClick={() => onOpen("performance")} className="mt-1 text-xs text-brand hover:underline">
                Performance →
              </button>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
