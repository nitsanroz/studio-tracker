"use client";

// Beyond the hours: what someone brings that their billable hours don't show
// — guidance, client relationships, culture… The owner grades each 0–10;
// together they add a premium to what their work supports (valuePremium), and
// the raise box above follows at once.

import {
  AlertTriangle,
  Check,
  Compass,
  Gem,
  Handshake,
  Loader2,
  Palette,
  ShieldCheck,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Card, InfoDot, SectionTitle } from "@/components/finance/ui";
import { formatNum } from "@/lib/finance/format";
import { FACTOR_TOP, FACTORS, valuePremium, type FactorId, type RaisePlan } from "@/lib/finance/people";
import type { Factors } from "./model";

const ICON: Record<FactorId, LucideIcon> = {
  guidance: Compass,
  clients: Handshake,
  ownership: ShieldCheck,
  culture: Palette,
  skills: Gem,
  growth: Sprout,
  concerns: AlertTriangle,
};

const pct = (v: number) => `${v >= 0 ? "+" : "−"}${formatNum(Math.abs(v) * 100, Math.abs(v) * 100 % 1 ? 1 : 0)}%`;

export function FactorsCard({ factors, plan }: { factors: Factors; plan: RaisePlan | null }) {
  const { levels, state, set } = factors;
  const premium = valuePremium(levels);
  const per = plan?.unit === "hour" ? "/h" : "";
  const money = (v: number) => `₪${formatNum(plan?.unit === "hour" ? v : Math.round(v / 100) * 100)}${per}`;

  return (
    <Card>
      <SectionTitle
        hint={
          state === "loading"
            ? "Loading…"
            : state === "saving"
              ? "Saving…"
              : state === "saved"
                ? "Saved"
                : state === "error"
                  ? "Couldn't save"
                  : state === "missing"
                    ? "Not saved — run reference/0009"
                    : undefined
        }
        info="What they bring that their billable hours don't show. Grade each 0–10 (hover ⓘ for what a factor means); each grade adds a tenth of the factor's share to what their work supports, Concerns takes off. The Salary raise above follows at once. Only finance admins see these."
      >
        Beyond the hours
      </SectionTitle>

      <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 md:grid-cols-2">
        {FACTORS.map((f, i) => {
          const Icon = ICON[f.id];
          const level = levels[f.id] ?? 0;
          const neg = f.max < 0;
          const color = neg ? "var(--danger)" : "var(--brand)";
          return (
            <div key={f.id} className="flex min-w-0 items-center gap-2">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${
                  level ? (neg ? "bg-danger/10 text-danger" : "bg-brand-soft text-brand-dark") : "bg-surface-2 text-muted"
                }`}
              >
                <Icon size={15} />
              </span>
              <span className="flex w-28 shrink-0 items-center gap-1 text-sm font-medium">
                <span className="truncate">{f.label}</span>
                <InfoDot align={i % 2 ? "right" : "left"}>
                  <span className="block max-w-xs">
                    <b className="block">
                      {f.title} · up to {pct(f.max)}
                    </b>
                    {f.detail}
                  </span>
                </InfoDot>
              </span>
              <span className="relative min-w-0 flex-1">
                <input
                  type="range"
                  min={0}
                  max={FACTOR_TOP}
                  step={1}
                  value={level}
                  onChange={(e) => set(f.id, Number(e.target.value))}
                  disabled={state === "loading"}
                  aria-label={f.title}
                  aria-valuetext={`${level} of ${FACTOR_TOP}`}
                  className="grade-range block w-full"
                  style={{ "--range-color": level ? color : "var(--border-strong)", "--range-fill": `${(level / FACTOR_TOP) * 100}%` } as CSSProperties}
                />
                {/* A tick a grade, under the track. */}
                <span className="pointer-events-none absolute inset-x-[8px] -bottom-1 flex justify-between">
                  {Array.from({ length: FACTOR_TOP + 1 }, (_, g) => (
                    <span key={g} className={`h-1 w-px ${g % 5 ? "bg-border" : "bg-border-strong"}`} />
                  ))}
                </span>
              </span>
              <span className="w-[4.5rem] shrink-0 text-right text-xs tabular-nums">
                <b className={level ? "" : "font-normal text-faint"}>{level}</b>
                <span className="text-faint">/{FACTOR_TOP}</span>{" "}
                <span className={level ? (neg ? "text-danger" : "text-brand") : "text-faint"}>{level ? pct((level / FACTOR_TOP) * f.max) : ""}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-background px-3 py-2.5 text-sm">
        <span className="flex items-center gap-1.5">
          {state === "saving" ? <Loader2 size={14} className="animate-spin text-muted" /> : <Check size={14} className="text-muted" />}
          Beyond the hours
          <b className={`tabular-nums ${premium < 0 ? "text-danger" : premium > 0 ? "text-brand" : ""}`}>{premium ? pct(premium) : "±0%"}</b>
        </span>
        {plan?.work3 != null && plan.supported3 != null && (
          <span className="text-muted">
            Their work supports <b className="text-foreground tabular-nums">{money(plan.work3)}</b>
            {premium !== 0 && (
              <>
                {" "}
                → with this <b className="tabular-nums text-foreground">{money(plan.supported3)}</b>
              </>
            )}{" "}
            (last 3 months)
          </span>
        )}
      </div>
    </Card>
  );
}
