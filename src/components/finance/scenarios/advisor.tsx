"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, MessageSquareText, Sparkles, X } from "lucide-react";
import { formatILSShort } from "@/lib/finance/format";
import type { Advice, AdviceKind, AdviceInput } from "@/lib/finance/scenarios/advise-prompt";
import { acceptAdvice } from "@/lib/finance/scenarios/advise-prompt";
import { describe, type Decision } from "@/lib/finance/scenarios/decisions";
import { useT } from "@/components/finance/scenarios/lang";
import { Hover } from "@/components/finance/scenarios/hover";
import type { Member } from "@/lib/finance/scenarios/types";

export interface StoredAdvice {
  kind: AdviceKind;
  runAt: string;
  advice: Advice;
}

const RISK: Record<string, string> = { low: "text-success", medium: "text-[var(--warning)]", high: "text-danger" };

/** The advisor: one Claude call per click, with real figures (owner only). */
export function Advisor({
  build,
  scenarioIds,
  team,
  refs,
  last,
  onResult,
  onTry,
  canCompare,
}: {
  build: (kind: AdviceKind) => AdviceInput;
  scenarioIds: (kind: AdviceKind) => string[];
  team: Member[];
  refs: Map<string, string>;
  last: StoredAdvice | null;
  onResult: (a: StoredAdvice) => void;
  onTry: (name: string, decisions: Decision[]) => void;
  canCompare: boolean;
}) {
  const { t: tr, lang } = useT();
  const [busy, setBusy] = useState<AdviceKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The answer opens in a drawer at the side, over the page — not in it.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  async function ask(kind: AdviceKind) {
    setBusy(kind);
    setError(null);
    setOpen(true);
    try {
      const res = await fetch("/api/finance/scenarios/advise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: build(kind), scenarioIds: scenarioIds(kind) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? tr("The advisor didn't answer ({status})", { status: res.status }));
      onResult({ kind, runAt: body.runAt, advice: body.advice });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const a = last ? acceptAdvice(last.advice, team, refs) : null;
  const button = (kind: AdviceKind, label: string, disabled = false) => (
    <button
      onClick={() => ask(kind)}
      disabled={busy != null || disabled}
      className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-[15px] text-white hover:bg-white/20 disabled:opacity-40"
    >
      {busy === kind ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
      {label}
    </button>
  );

  return (
    <>
      {/* The bar: one line under the page title. */}
      <section className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-[var(--foreground)] px-4 py-2.5 text-white shadow-card">
        <span className="flex items-center gap-1.5 text-[17px] font-medium">
          <span className="text-[20px] text-[var(--aqua)]">&amp;</span>
          {tr("advice on scenarios")}
          <span className="text-white/60 [&_button]:text-white/60">
            <InfoHint text={tr("Sees the real figures (people by initials). Tax and labour-law points are for the accountant or a lawyer to confirm. One call per click.")} />
          </span>
        </span>
        <div className="flex flex-wrap gap-2">
          {button("advise", tr("Advise on this scenario"))}
          {button("compare", tr("Compare my scenarios"), !canCompare)}
          {button("suggest", tr("Suggest what I haven't tried"))}
        </div>
        {last && (
          <button onClick={() => setOpen(true)} className="ms-auto flex items-center gap-1.5 text-[15px] text-[var(--aqua)] hover:underline">
            <MessageSquareText size={16} /> {tr("Last advice")}
          </button>
        )}
      </section>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50" dir={lang === "he" ? "rtl" : "ltr"} role="dialog" aria-modal="true" aria-label={tr("advice on scenarios")}>
            <div className="absolute inset-0 bg-foreground/30" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 end-0 flex w-full max-w-[560px] flex-col bg-[var(--foreground)] text-white shadow-2xl">
              <div className="flex items-center justify-between gap-3 px-5 py-4">
                <span className="flex items-center gap-1.5 text-[20px] font-medium">
                  <span className="text-[var(--aqua)]">&amp;</span>
                  {tr("advice on scenarios")}
                </span>
                <button onClick={() => setOpen(false)} aria-label={tr("Close")} className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-6">
      {busy && <p className="mt-3 text-[16px] text-white/70">{tr("Thinking it through — this can take a minute…")}</p>}
      {error && <p className="mt-3 text-[16px] text-red-300">{error}</p>}
      {a && !busy && (
        <div className="space-y-4 text-[16px]">
          <p className="text-[22px] leading-snug">{a.bottomLine}</p>
          {a.recommendations.length > 0 && (
            <ol className="space-y-2">
              {a.recommendations.map((r) => (
                <li key={r.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/10 text-[14px] font-semibold tabular-nums">{r.score}</span>
                  <span>
                    <span className="font-medium">{r.title}</span>
                    <span className="ml-2 text-[14px] tabular-nums text-white/60">
                      {r.perMonth ? `${r.perMonth > 0 ? "+" : ""}${formatILSShort(r.perMonth)}/mo · ` : ""}
                      <span className={RISK[r.risk]}>{tr(r.risk === "low" ? "low risk" : r.risk === "high" ? "high risk" : "medium risk")}</span> · {r.when}
                    </span>
                    <span className="block text-white/75">{r.why}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {a.triggers.length > 0 && (
            <div>
              <p className="mb-1 text-[14px] font-medium uppercase tracking-wide text-white/50">{tr("Watch")}</p>
              <ul className="space-y-1">
                {a.triggers.map((t) => (
                  <li key={t.watch} className="tabular-nums">
                    <span className="font-medium">{t.watch}</span> {t.level} → {t.then}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-4">
            {a.questions.length > 0 && (
              <div>
                <p className="mb-1 text-[14px] font-medium uppercase tracking-wide text-white/50">{tr("Ask")}</p>
                <ul className="list-disc space-y-1 pl-4">
                  {a.questions.map((q) => <li key={q}>{q}</li>)}
                </ul>
              </div>
            )}
            {a.checkWith.length > 0 && (
              <div>
                <p className="mb-1 text-[14px] font-medium uppercase tracking-wide text-white/50">{tr("Check with")}</p>
                <ul className="space-y-1">
                  {a.checkWith.map((c) => (
                    <li key={c.what}><span className="text-[var(--aqua)]">{tr(c.who === "lawyer" ? "lawyer" : "accountant")}:</span> {c.what}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {a.tryThis.length > 0 && (
            <div>
              <p className="mb-1 text-[14px] font-medium uppercase tracking-wide text-white/50">{tr("Try this")}</p>
              <div className="grid gap-2">
                {a.tryThis.map((t) => (
                  <div key={t.name} className="rounded-xl border border-white/15 p-3">
                    <p className="font-medium">{t.name}</p>
                    <p className="mt-0.5 text-[14px] text-white/70">{t.why}</p>
                    <ul className="mt-2 space-y-0.5 text-[14px] tabular-nums text-white/80">
                      {t.resolved.map((d) => <li key={d.id}>· {describe(d, team, tr)}</li>)}
                    </ul>
                    <button
                      onClick={() => {
                        onTry(t.name, t.resolved);
                        setOpen(false);
                      }}
                      disabled={!t.resolved.length}
                      className="mt-2 rounded-md bg-white/15 px-2.5 py-1 text-[14px] hover:bg-white/25 disabled:opacity-40"
                    >
                      {tr("Open as a scenario")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[13px] text-white/40">
            {last && new Date(last.runAt).toLocaleString(lang === "he" ? "he-IL" : "en-GB", { timeZone: "Asia/Jerusalem", dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
      )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** A small (i) whose text shows on hover — the bar's one-line explanation. */
function InfoHint({ text }: { text: string }) {
  return <Hover>{text}</Hover>;
}
