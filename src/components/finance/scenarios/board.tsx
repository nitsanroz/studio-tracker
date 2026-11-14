"use client";

// The decision board: tick-boxes in foldable groups (Nitsan, 2026-11-11), in
// the look of the tracker's offer page (v1.94.1): each group a card with a
// Light White header strip, its title in brand blue; items at 18px, their
// explanations at 16px; no divider lines — spacing separates.

import { useEffect, useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { Hover } from "@/components/finance/scenarios/hover";
import { useT } from "@/components/finance/scenarios/lang";
import { formatILSShort } from "@/lib/finance/format";
import { decisionFor, keyOf, type BoardGroup, type BoardItem } from "@/lib/finance/scenarios/board";
import { addMonths, describe, monthLabel, type Decision, type Field } from "@/lib/finance/scenarios/decisions";
import { HORIZON } from "@/lib/finance/scenarios/engine";
import type { Baseline, Member } from "@/lib/finance/scenarios/types";

export function TickBox({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`mt-[3px] flex size-[22px] shrink-0 items-center justify-center rounded-md transition-colors ${
        on ? "bg-brand text-white" : "bg-surface ring-2 ring-border-strong group-hover:ring-brand/60"
      }`}
    >
      {on && <Check size={15} strokeWidth={3} />}
    </span>
  );
}

export function DecisionBoard({
  board,
  decisions,
  baseline,
  team,
  impact,
  onChange,
  scenarioId,
}: {
  board: BoardGroup[];
  decisions: Decision[];
  baseline: Baseline;
  team: Member[];
  /** Each group's effect on the middle future's 12-month profit. */
  impact: Map<string, number>;
  onChange: (next: Decision[]) => void;
  /** Groups open by themselves only when the scenario changes — never on a tick
   * (Nitsan, 2026-11-11: every tick unfolded the sections and the page jumped). */
  scenarioId: string;
}) {
  const { t } = useT();
  // Groups holding a ticked decision start open; the rest folded.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const used = new Set(decisions.map(keyOf));
  useEffect(() => {
    setOpen(new Set(board.filter((g) => g.items.some((i) => used.has(i.key))).map((g) => g.id)));
    // Only when another scenario is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioId]);

  const toggle = (it: BoardItem) => {
    const mine = decisions.filter((d) => keyOf(d) === it.key);
    if (mine.length) onChange(decisions.filter((d) => keyOf(d) !== it.key));
    else onChange([...decisions, decisionFor(it, baseline)]);
  };

  return (
    <div className="flex flex-col gap-4">
      {board.map((g) => {
        const isOpen = open.has(g.id);
        const on = g.items.filter((i) => used.has(i.key)).length;
        const effect = impact.get(g.id);
        return (
          <section key={g.id} className="overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-[#dfe4ee]">
            <div className="flex items-start gap-3 bg-[var(--strip)] px-5 py-4 sm:px-6">
              <button
                onClick={() => setOpen((o) => (o.has(g.id) ? new Set([...o].filter((x) => x !== g.id)) : new Set([...o, g.id])))}
                aria-expanded={isOpen}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-start"
              >
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block text-[22px] font-medium leading-8 text-brand">{g.title}</span>
                  {g.subtitle && <span className="block text-[15px] leading-6 text-muted tabular-nums">{g.subtitle}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {on > 0 && <span className="rounded-full bg-brand-soft px-3 py-1 text-[14px] font-medium text-brand">{t("{n} on", { n: on })}</span>}
                  {effect != null && Math.abs(effect) >= 500 && (
                    <span
                      title={t("What this group's ticks do to the middle future's 12-month profit")}
                      className={`rounded-full px-3 py-1 text-[14px] font-medium tabular-nums ${effect >= 0 ? "bg-[var(--state-final-bg)] text-[var(--state-final-fg)]" : "bg-red-50 text-danger"}`}
                    >
                      <span dir="ltr">
                        {effect >= 0 ? "+" : ""}
                        {formatILSShort(effect)}
                      </span>
                      {t("/yr")}
                    </span>
                  )}
                  <ChevronDown size={20} aria-hidden className={`text-faint transition-transform ${isOpen ? "" : "-rotate-90 rtl:rotate-90"}`} />
                </span>
              </button>
              <span className="pt-1.5">
                <Hover title={g.title}>{g.info}</Hover>
              </span>
            </div>
            {isOpen && (
              <ul className="flex flex-col gap-6 px-5 pb-6 pt-5 sm:px-6">
                {g.items.map((it) => {
                  const mine = decisions.filter((d) => keyOf(d) === it.key);
                  const ticked = mine.length > 0;
                  return (
                    <li key={it.key}>
                      <div className="flex items-start gap-3">
                        <label className="group flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                          <input type="checkbox" checked={ticked} onChange={() => toggle(it)} className="sr-only" />
                          <TickBox on={ticked} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[18px] font-medium leading-7">{it.title}</span>
                            {!ticked && <span className="block text-[16px] leading-6 text-muted">{it.blurb}</span>}
                          </span>
                        </label>
                        <span className="pt-1">
                          <Hover title={it.title}>{it.info}</Hover>
                        </span>
                      </div>
                      {mine.map((d) => (
                        <div key={d.id} className="ms-[34px] mt-3 rounded-2xl bg-[var(--strip)] p-4">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-[16px] font-medium leading-6 text-brand tabular-nums">{describe(d, team, t)}</p>
                            {it.multi && mine.length > 1 && (
                              <button onClick={() => onChange(decisions.filter((x) => x.id !== d.id))} aria-label={t("Remove this one")} className="rounded-full p-1 text-faint hover:bg-surface hover:text-danger">
                                <X size={16} />
                              </button>
                            )}
                          </div>
                          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                            {it.fields.map((f) => (
                              <FieldInput key={f.key} field={f} decision={d} start={baseline.start} onChange={(nd) => onChange(decisions.map((x) => (x.id === d.id ? nd : x)))} />
                            ))}
                          </div>
                        </div>
                      ))}
                      {it.multi && ticked && (
                        <button onClick={() => onChange([...decisions, decisionFor(it, baseline)])} className="ms-[34px] mt-2 flex items-center gap-1.5 text-[15px] font-medium text-brand hover:underline">
                          <Plus size={16} /> {t("Add another")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

const SUFFIX: Partial<Record<Field["kind"], string>> = { pct: "%", hours: "h", count: "" };

/** One lever of a ticked decision: a number, a month, a currency, a yes/no or a name. */
function FieldInput({ field: f, decision: d, start, onChange }: { field: Field; decision: Decision; start: string; onChange: (d: Decision) => void }) {
  const { t, lang } = useT();
  const v = d[f.key];
  const set = (val: unknown) => onChange({ ...d, [f.key]: val });
  const label = (
    <span className="mb-1 flex items-center gap-1.5 text-[14px] leading-5 text-muted">
      {t(f.label)}
      {f.hint && <Hover size={14}>{t(f.hint)}</Hover>}
    </span>
  );
  const box = "w-full rounded-xl bg-surface px-3 py-2 text-[16px] ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-brand";

  if (f.kind === "month") {
    const months = Array.from({ length: HORIZON + 3 }, (_, i) => addMonths(start, i - 1));
    const val = String(v);
    return (
      <label className="block">
        {label}
        <select value={val} onChange={(e) => set(e.target.value)} className={box}>
          {(months.includes(val) ? months : [val, ...months]).map((m) => (
            <option key={m} value={m}>{monthLabel(m, lang)}</option>
          ))}
        </select>
      </label>
    );
  }
  if (f.kind === "currency")
    return (
      <div>
        {label}
        <div dir="ltr" className="inline-flex rounded-xl bg-surface p-1 ring-1 ring-border" role="group">
          {(["ILS", "EUR", "USD"] as const).map((c) => (
            <button
              key={c}
              onClick={() => set(c)}
              aria-pressed={(v ?? "ILS") === c}
              className={`rounded-lg px-3 py-1 text-[15px] ${(v ?? "ILS") === c ? "bg-brand text-white" : "text-muted hover:text-foreground"}`}
            >
              {c === "ILS" ? "₪" : c === "EUR" ? "€" : "$"}
            </button>
          ))}
        </div>
      </div>
    );
  if (f.kind === "bool")
    return (
      <label className="group flex cursor-pointer items-start gap-2.5 self-end text-[15px] leading-6">
        <input type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked)} className="sr-only" />
        <TickBox on={v === true} />
        {t(f.label)}
      </label>
    );
  if (f.kind === "text")
    return (
      <label className="block">
        {label}
        <input value={String(v ?? "")} onChange={(e) => set(e.target.value)} className={box} />
      </label>
    );
  const prefix = f.kind === "money" ? "₪" : f.kind === "rate" ? (d.currency === "EUR" ? "€" : d.currency === "USD" ? "$" : "₪") : "";
  const suffix = f.kind === "rate" ? "/h" : SUFFIX[f.kind] ?? "";
  return <NumberInput label={label} value={Number(v ?? 0)} prefix={prefix} suffix={suffix} step={f.step ?? 1} onChange={set} />;
}

function NumberInput({ label, value, prefix, suffix, step, onChange }: { label: React.ReactNode; value: number; prefix: string; suffix: string; step: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text.replace(/[,\s₪€$%h]/g, ""));
    if (Number.isFinite(n)) onChange(n);
    else setText(String(value));
  };
  return (
    <label className="block">
      {label}
      <span dir="ltr" className="flex items-center gap-1 rounded-xl bg-surface px-3 py-2 ring-1 ring-border focus-within:ring-2 focus-within:ring-brand">
        {prefix && <span className="text-[16px] text-faint">{prefix}</span>}
        <input
          type="number"
          step={step}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Live: a valid figure moves the results as you type or step.
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
          }}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-full min-w-0 bg-transparent text-[16px] tabular-nums focus:outline-none"
        />
        {suffix && <span className="text-[16px] text-faint">{suffix}</span>}
      </span>
    </label>
  );
}
