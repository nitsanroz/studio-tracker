"use client";

// &advice, laid out in full (Nitsan, 2026-11-15: "a page that shows everything
// on one page with charts and metrics and all the recommendations, suggestions
// and diagnoses, split so it is easy to look at, dig into and follow").
//
// The pane says what matters on the page you're on; this is the whole of it:
//   1. Today          how many things wait, by urgency
//   2. The consultant the business review's summary and its questions
//   3. In numbers     the last three complete months as charts (lib/advice/board.ts)
//   4. Everything     every finding, by urgency or by subject
//   5. Follow-up      what is snoozed or dismissed, what closed lately, week by week
//
// ⚠️ OWNER ONLY — it shows amounts. The layout answers anyone else with a 404,
// and /api/advice with a 403. With "Hide numbers" on, every digit is smudged
// (`advice-hold`), as in the pane.
//
// English or Hebrew, the pane's own switch (components/advice-lang.tsx).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Clock3, RotateCw, Sparkles, Undo2, X } from "lucide-react";
import { AdviceLangSwitch, useAdviceLang, useHebrew, type Hebrew } from "@/components/advice-lang";
import { FIX_CLASS, UNDO_FAILED, checkedLine, dayLabel, dayOf, fixOf, patch, snoozeLabel, snoozeOptions } from "@/components/advice";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/skeleton";
import { StudioArrow } from "@/components/studio-arrow";
import type { AdviceBoard, BoardFigures } from "@/lib/advice/board";
import type { AdviceRow } from "@/lib/advice/merge";
import type { AdviceView, PaneTile } from "@/lib/advice/run";
import type { AdviceKind, FindingLink } from "@/lib/advice/signals";
import { shownBody, shownTitle, viewTexts } from "@/lib/advice/texts";
import { applyFix } from "@/lib/finance/advice/client";
import { formatILS } from "@/lib/finance/format";
import { useDataMaybe } from "@/lib/store";
import { toast } from "@/lib/toast";

type Loaded = AdviceView & { board: AdviceBoard };

const KINDS: AdviceKind[] = ["now", "heads", "idea"];
const KIND_LABEL: Record<AdviceKind, string> = { now: "Do now", heads: "Heads-up", idea: "Idea" };
const KIND_PLURAL: Record<AdviceKind, string> = { now: "Do now", heads: "Heads-ups", idea: "Ideas" };
const KIND_COLOR: Record<AdviceKind, string> = { now: "var(--danger)", heads: "var(--warning)", idea: "var(--brand)" };
const pct = (f: number) => Math.round(f * 100);
const LIST_SHOWN = 5;

export default function AdvicePage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [group, setGroup] = useState<"urgency" | "subject">("urgency");
  const [hold, setHold] = useState(false);
  const [lang] = useAdviceLang();
  const texts = useMemo(() => (data ? viewTexts(data, data.board) : []), [data]);
  const he = useHebrew(lang, texts);
  const { t, tr, rtl } = he;

  const load = useCallback(async () => {
    setChecking(true);
    const res = await fetch("/api/advice?board=1").catch(() => null);
    setChecking(false);
    if (!res) return setError("Couldn't reach the tracker.");
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setError((j as { error?: string }).error ?? "Something went wrong.");
    setError(null);
    setData(j as Loaded);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the page IS the check
    void load();
    try {
      setHold(window.localStorage.getItem("finance-privacy-hold") === "1");
    } catch {
      /* no storage: numbers show */
    }
  }, [load]);

  // The day's first open asks Claude for wording, as the pane does; the cards change when it lands.
  const wordAsked = useRef(false);
  useEffect(() => {
    if (!data?.wordingDue || wordAsked.current) return;
    wordAsked.current = true;
    void fetch("/api/advice/word", { method: "POST" })
      .then((res) => (res.ok ? load() : null))
      .catch(() => null);
  }, [data?.wordingDue, load]);

  // "Review the business": one Claude call per click.
  const [consulting, setConsulting] = useState(false);
  const [consultError, setConsultError] = useState<string | null>(null);
  const runBusiness = async () => {
    setConsulting(true);
    setConsultError(null);
    const res = await fetch("/api/advice/business", { method: "POST" }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) setConsultError((j as { error?: string }).error ?? "Couldn't reach the tracker.");
    else await load();
    setConsulting(false);
  };

  /** Snooze, dismiss, mark done or bring back: the write, then a fresh check; the toast's Undo reverses it. */
  const act = (it: AdviceRow, body: object, text: string, tone: "done" | "info") => {
    setData((d) => (d ? { ...d, items: d.items.filter((x) => x.id !== it.id) } : d));
    void patch(it.id, body).then((ok) => {
      if (!ok) {
        toast(t("Couldn't save that — try again"), { tone: "info" });
        return void load();
      }
      toast(text, {
        tone,
        onUndo: () =>
          void patch(it.id, { action: "undo" }).then((undone) => {
            if (!undone) toast(t(UNDO_FAILED), { tone: "info" });
            void load();
          }),
      });
      void load();
    });
  };
  const fix = async (it: AdviceRow) => {
    const r = await applyFix(it.id);
    if ("error" in r) return toast(r.error, { tone: "info" });
    toast(r.done, {
      onUndo: () =>
        void r.undo().then((ok) => {
          if (!ok) toast(t(UNDO_FAILED), { tone: "info" });
          void load();
        }),
    });
    void load();
  };

  const items = useMemo(() => data?.items ?? [], [data]);
  const board = data?.board;
  const groups = useMemo(() => {
    const by = new Map<string, AdviceRow[]>();
    for (const it of items) by.set(it.area, [...(by.get(it.area) ?? []), it]);
    const worst = (list: AdviceRow[]) => Math.min(...list.map((i) => KINDS.indexOf(i.kind)));
    return [...by].sort((a, b) => worst(a[1]) - worst(b[1]) || b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [items]);

  const card = (it: AdviceRow) => <FindingCard key={it.id} it={it} today={data?.today ?? ""} he={he} onAct={act} onFix={fix} />;

  return (
    <div dir={rtl ? "rtl" : "ltr"} className={`mx-auto flex w-full max-w-[1500px] flex-col gap-8 p-4 md:p-6 ${hold ? "advice-hold" : ""}`}>
      {/* On a phone the title takes the first line whole and the controls sit under it; beside them it was squeezed to a word a line. */}
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="w-full min-w-0 md:w-auto md:flex-1">
          {/* The name reads left to right in either language — in a right-to-left line the ampersand would jump to the end. */}
          <h1 className="page-title">
            <span dir="ltr" className="inline-block">
              &amp;advice
            </span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t("The studio at a glance: what needs you, how the last three months read, and what was found and closed.")}</p>
        </div>
        {data && <span className="min-w-0 flex-1 text-[12px] text-faint md:flex-none">{he.busy ? t("Translating…") : (he.off ?? checkedLine(data, t))}</span>}
        <AdviceLangSwitch />
        <button
          onClick={() => void load()}
          disabled={checking}
          aria-label={t("Check again")}
          title={t("Check again")}
          className="flex size-9 items-center justify-center rounded-xl bg-surface text-muted shadow-card hover:text-foreground"
        >
          <RotateCw size={18} strokeWidth={1.75} className={checking ? "animate-spin" : ""} />
        </button>
      </header>

      {error ? (
        <p className="rounded-2xl bg-surface p-5 text-sm text-muted">{t(error)}</p>
      ) : !data || !board ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-40 rounded-2xl" />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-56 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* 1 — Today */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {KINDS.map((k) => (
              <Stat key={k} label={t(KIND_PLURAL[k])} value={items.filter((i) => i.kind === k).length} color={KIND_COLOR[k]} />
            ))}
            <Stat label={t("Snoozed or dismissed")} value={board.hidden.length} />
            <Stat label={t("Closed in 30 days")} value={board.resolved.length} />
          </section>

          {/* 2 — The consultant's read */}
          <section className="rounded-2xl bg-surface p-5 shadow-card md:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="card-title flex min-w-0 flex-1 items-center gap-2">
                <Sparkles size={18} strokeWidth={1.75} className="shrink-0 text-brand" />
                {t("The consultant's read")}
              </h2>
              <span className="text-[12px] text-faint">
                {!data.reviewOn
                  ? t("Needs a Claude API key")
                  : !data.businessReady
                    ? t("The last three months aren't booked yet")
                    : consulting
                      ? t("about a minute")
                      : data.business
                        ? t(data.business.error ? "Last try failed {day}" : "Last review {day}", { day: dayLabel(dayOf(data.business.at), t.locale) })
                        : ""}
              </span>
              <button
                onClick={() => void runBusiness()}
                disabled={!data.reviewOn || !data.businessReady || consulting}
                className="rounded-full bg-brand px-4 py-1.5 text-[13px] font-medium text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {t(consulting ? "Reviewing…" : data.business && !data.business.error ? "Review again" : "Review now")}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <p className="bidi-auto text-[15px] leading-6">
                {data.business?.summary ? tr(data.business.summary) : <span className="text-muted">{t("No review yet. One click reads the last three months as a consultant would.")}</span>}
              </p>
              {!!data.business?.questions.length && (
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{t("Questions only you can answer")}</p>
                  <ul className="mt-2 list-disc space-y-1.5 ps-4 text-[13px] leading-5 text-muted">
                    {data.business.questions.map((q) => (
                      <li key={q} className="bidi-auto">
                        {tr(q)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {consultError && <p className="mt-2 text-[12px] text-danger">{consultError}</p>}
          </section>

          {/* 3 — The studio in numbers */}
          <section>
            <SectionHead title={t("The studio in numbers")} note={board.figures ? `${t("The last three complete months")} · ${board.figures.label}` : undefined} />
            {board.figures ? (
              <Figures f={board.figures} weeks={board.weeks} he={he} />
            ) : (
              <p className="mt-3 rounded-2xl bg-surface p-5 text-sm text-muted">{t("These charts need the last three months in the books.")}</p>
            )}
            {data.pulse.length > 0 && (
              <>
                <p className="mt-6 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">{t("The pages' own figures")}</p>
                <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                  {uniqueTiles(data.pulse).map((p) => (
                    <PulseTile key={`${p.label}|${p.display}`} p={p} tr={tr} />
                  ))}
                </div>
              </>
            )}
          </section>

          {/* 4 — Everything found */}
          <section>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <SectionHead title={t("Everything found")} note={String(items.length)} />
              </div>
              <div className="inline-flex rounded-full bg-surface p-0.5 text-[13px] shadow-card" role="group">
                {(["urgency", "subject"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGroup(g)}
                    aria-pressed={group === g}
                    className={`rounded-full px-3.5 py-1 font-medium ${group === g ? "bg-brand text-white" : "text-muted hover:text-foreground"}`}
                  >
                    {t(g === "urgency" ? "By urgency" : "By subject")}
                  </button>
                ))}
              </div>
            </div>
            {items.length === 0 ? (
              <EmptyState icon={Check} tone="success" text={t("All clear.")} />
            ) : group === "urgency" ? (
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-3">
                {KINDS.map((k) => {
                  const list = items.filter((i) => i.kind === k);
                  return (
                    <div key={k} className="flex min-w-0 flex-col gap-3">
                      <p className="flex items-center gap-2 text-[13px] font-medium">
                        <span className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} />
                        {t(KIND_PLURAL[k])}
                        <span className="text-faint">{list.length}</span>
                      </p>
                      {list.length ? list.map(card) : <p className="rounded-2xl bg-surface px-4 py-3 text-[13px] text-muted">{t("Nothing here.")}</p>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 gap-4 md:columns-2 xl:columns-3">
                {groups.map(([area, list]) => (
                  <div key={area} className="mb-5 flex break-inside-avoid flex-col gap-3">
                    <p className="flex items-center gap-2 text-[13px] font-medium">
                      <span className="bidi-auto">{tr(area)}</span>
                      <span className="text-faint">{list.length}</span>
                    </p>
                    {list.map(card)}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 5 — Follow-up */}
          <section>
            <SectionHead title={t("Follow-up")} />
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
              <div className="rounded-2xl bg-surface p-5 shadow-card">
                <h3 className="card-title">{t("Snoozed and dismissed")}</h3>
                {board.hidden.length === 0 ? (
                  <p className="mt-2 text-[13px] text-muted">{t("Nothing is snoozed or dismissed.")}</p>
                ) : (
                  <ul className="mt-2 flex flex-col">
                    {board.hidden.map((it) => (
                      <li key={it.id} className="flex items-start gap-3 py-2.5">
                        <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[it.kind] }} />
                        <span className="min-w-0 flex-1">
                          <span className="bidi-auto block text-[14px] leading-5">{tr(shownTitle(it))}</span>
                          <span className="block text-[12px] text-faint">
                            {tr(it.area)} · {it.doneAt ? t("dismissed") : t("back {day}", { day: dayLabel(it.snoozedUntil!, t.locale) })}
                          </span>
                        </span>
                        <button
                          onClick={() => {
                            setData((d) => (d ? { ...d, board: { ...d.board, hidden: d.board.hidden.filter((x) => x.id !== it.id) } } : d));
                            void patch(it.id, { action: "undo" }).then((ok) => {
                              toast(t(ok ? "Brought back" : "Couldn't save that — try again"), { tone: "info" });
                              void load();
                            });
                          }}
                          className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
                        >
                          <Undo2 size={14} strokeWidth={1.75} /> {t("Bring back")}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-2xl bg-surface p-5 shadow-card">
                <h3 className="card-title">{t("Closed lately")}</h3>
                <p className="mt-1 text-[12px] text-faint">{t("A check closes a finding by itself once it is no longer true.")}</p>
                {board.resolved.length === 0 ? (
                  <p className="mt-2 text-[13px] text-muted">{t("Nothing closed in the last 30 days.")}</p>
                ) : (
                  <ul className="mt-2 flex flex-col">
                    {board.resolved.slice(0, 40).map((it) => (
                      <li key={it.id} className="flex items-start gap-3 py-2">
                        <Check size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-success" />
                        <span className="min-w-0 flex-1">
                          <span className="bidi-auto block text-[14px] leading-5 text-muted">{tr(shownTitle(it))}</span>
                          <span className="block text-[12px] text-faint">
                            {tr(it.area)} · {t("closed {day}", { day: dayLabel(dayOf(it.resolvedAt!), t.locale) })}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** The pulse repeats a figure for each page that shows it; the page lists each once. */
function uniqueTiles(tiles: PaneTile[]): PaneTile[] {
  const seen = new Set<string>();
  return tiles.filter((p) => {
    const k = `${p.label}|${p.display}`;
    // A client's own figures belong on that client's page, not here.
    if (p.display == null || p.clientId != null || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="card-title">{title}</h2>
      {note && <span className="text-[13px] text-faint">{note}</span>}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-card">
      <p className="flex items-center gap-2 text-[12px] text-muted">
        {color && <span className="size-2 rounded-full" style={{ background: color }} />}
        {label}
      </p>
      <p className="font-serif-accent mt-2 text-[34px] leading-none tabular-nums" style={color && value > 0 ? { color } : undefined}>
        {value}
      </p>
    </div>
  );
}

function PulseTile({ p, tr }: { p: PaneTile; tr: (s: string) => string }) {
  const color = p.good ? "var(--brand)" : "var(--danger)";
  const min = Math.min(...p.series);
  const max = Math.max(...p.series);
  const pts = p.series.map((v, i) => `${(i / Math.max(1, p.series.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 24}`).join(" ");
  return (
    <div title={tr(p.help)} className="cursor-help rounded-2xl bg-surface p-3.5 shadow-card">
      <p className="truncate text-[12px] text-muted">{tr(p.label)}</p>
      <p dir="ltr" className="font-serif-accent mt-1.5 text-start text-[24px] leading-none tabular-nums" style={p.good ? undefined : { color }}>
        {p.display}
      </p>
      {p.series.length >= 2 && (
        <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-1 h-7 w-full opacity-70" aria-hidden>
          <polyline points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <p className="mt-1 truncate text-[11px] text-faint">{tr(p.note)}</p>
    </div>
  );
}

/* ── the charts ─────────────────────────────────────────────────────────── */

function ChartCard({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-2xl bg-surface p-5 shadow-card ${wide ? "md:col-span-2" : ""}`}>
      <h3 className="text-[14px] font-medium">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** A track with a fill and labelled marks along it; `scale` is the value at the track's end. */
function Track({ value, scale, color, marks = [], band }: { value: number; scale: number; color: string; marks?: { at: number; label: string }[]; band?: [number, number] }) {
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  return (
    <div className="pb-5">
      <div className="relative h-3 rounded-full bg-track">
        {band && <div className="absolute inset-y-0 rounded-full bg-success/20" style={{ insetInlineStart: x(band[0]), width: `${((band[1] - band[0]) / scale) * 100}%` }} />}
        <div className="absolute inset-y-0 rounded-full" style={{ insetInlineStart: 0, width: x(value), background: color }} />
        {marks.map((m) => (
          <div key={m.label} className="absolute -top-1 h-5 w-px bg-foreground" style={{ insetInlineStart: x(m.at) }}>
            <span className="absolute top-full mt-0.5 -translate-x-1/2 whitespace-nowrap text-[11px] text-faint rtl:translate-x-1/2">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const SHARE_COLORS = { salaries: "#0b43ed", freelance: "#6181e8", rent: "#001e6c", tools: "#00c8d2", other: "#aeb5c6", left: "#16a34a" } as const;
type ShareKey = keyof typeof SHARE_COLORS;
const SHARE_LABEL: Record<ShareKey, string> = { salaries: "Salaries", freelance: "Freelancers", rent: "Rent", tools: "Tools", other: "Other", left: "Left over" };

function sharesWithLeft(s: BoardFigures["shares"]): Record<ShareKey, number> {
  const spent = s.salaries + s.freelance + s.rent + s.tools + s.other;
  return { ...s, left: Math.max(0, 1 - spent) };
}

function Stacked({ label, shares }: { label: string; shares: Record<ShareKey, number> }) {
  const total = Math.max(1, Object.values(shares).reduce((a, b) => a + b, 0));
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[12px] text-muted">{label}</span>
      <div className="flex h-6 min-w-0 flex-1 overflow-hidden rounded-lg">
        {(Object.keys(SHARE_COLORS) as ShareKey[]).map((k) =>
          shares[k] > 0.004 ? <div key={k} title={`${pct(shares[k])}%`} style={{ width: `${(shares[k] / total) * 100}%`, background: SHARE_COLORS[k] }} /> : null,
        )}
      </div>
    </div>
  );
}

function Figures({ f, weeks, he }: { f: BoardFigures; weeks: AdviceBoard["weeks"]; he: Hebrew }) {
  const { t } = he;
  const now = sharesWithLeft(f.shares);
  const then = f.sharesLastYear ? sharesWithLeft(f.sharesLastYear) : null;
  const marginScale = Math.max(0.4, f.targetMargin * 1.5, f.margin * 1.2, (f.marginLastYear ?? 0) * 1.2);
  const hourScale = Math.max(f.avgRate, f.hourCost, f.hourCostLastYear ?? 0) * 1.1;
  const clientScale = Math.max(0.4, f.topClient * 1.15);
  const weekMax = Math.max(1, ...weeks.map((w) => Math.max(w.opened, w.resolved)));
  const util = f.utilization;
  return (
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
      <ChartCard title={t("Profit margin")}>
        <p className="font-serif-accent text-[40px] leading-none tabular-nums" style={{ color: f.margin >= f.targetMargin ? "var(--success)" : f.margin < 0 ? "var(--danger)" : undefined }}>
          {pct(f.margin)}%
        </p>
        <div className="mt-4">
          <Track
            value={Math.max(0, f.margin)}
            scale={marginScale}
            color={f.margin >= f.targetMargin ? "var(--success)" : "var(--brand)"}
            marks={[{ at: f.targetMargin, label: `${t("Target")} ${pct(f.targetMargin)}%` }]}
          />
        </div>
        {f.marginLastYear != null && (
          <p className="mt-1 text-[13px] text-muted">
            {t("A year ago")}: <span className="tabular-nums">{pct(f.marginLastYear)}%</span>
          </p>
        )}
      </ChartCard>

      <ChartCard title={t("Where the income goes")}>
        <div className="flex flex-col gap-2">
          <Stacked label={t("Now")} shares={now} />
          {then && <Stacked label={t("A year ago")} shares={then} />}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted">
          {(Object.keys(SHARE_COLORS) as ShareKey[]).map((k) => (
            <li key={k} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: SHARE_COLORS[k] }} />
              <span className="min-w-0 flex-1 truncate">{t(SHARE_LABEL[k])}</span>
              <span className="tabular-nums text-foreground">{pct(now[k])}%</span>
              {then && <span className="w-9 text-end tabular-nums text-faint">{pct(then[k])}%</span>}
            </li>
          ))}
        </ul>
      </ChartCard>

      <ChartCard title={t("An hour")}>
        <div className="flex flex-col gap-3">
          <HourBar label={t("Sold for")} value={f.avgRate} scale={hourScale} color="var(--brand)" />
          <HourBar label={t("Costs the studio")} value={f.hourCost} scale={hourScale} color={f.hourCost > f.avgRate ? "var(--danger)" : "#001e6c"} />
          {f.hourCostLastYear != null && <HourBar label={t("A year ago it cost")} value={f.hourCostLastYear} scale={hourScale} color="#aeb5c6" />}
        </div>
        <p className="mt-3 text-[13px] text-muted">{t("{pct}% of income is sold by the hour", { pct: pct(f.hourlyShare) })}</p>
      </ChartCard>

      <ChartCard title={t("Team")}>
        {util != null && (
          <>
            <p className="flex items-baseline gap-2">
              <span
                className="font-serif-accent text-[40px] leading-none tabular-nums"
                style={{ color: util < f.bench.utilizationLow || util > f.bench.utilizationHigh ? "var(--warning)" : "var(--success)" }}
              >
                {pct(util)}%
              </span>
              <span className="text-[13px] text-muted">{t("of a full day billed")}</span>
            </p>
            <div className="mt-4">
              <Track value={util} scale={1} color="var(--brand)" band={[f.bench.utilizationLow, f.bench.utilizationHigh]} />
            </div>
            <p className="-mt-1 text-[12px] text-faint">{t("Healthy range {low}–{high}% — a rule of thumb", { low: pct(f.bench.utilizationLow), high: pct(f.bench.utilizationHigh) })}</p>
          </>
        )}
        <ul className="mt-3 flex flex-col gap-1 text-[13px] text-muted">
          <li>{t("{n} salaried designers", { n: Math.round(f.designers * 10) / 10 })}</li>
          {f.ownerShare != null && <li>{t("You bill {pct}% of the hours", { pct: pct(f.ownerShare) })}</li>}
        </ul>
        {f.freelancers.length > 0 && (
          <>
            <p className="mt-3 text-[12px] text-faint">{t("Freelancers, hours a month")}</p>
            <ul className="mt-1 flex flex-col gap-1 text-[13px]">
              {f.freelancers.map((x) => (
                <li key={x.name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{x.name}</span>
                  <span className="tabular-nums">{Math.round(x.hoursPerMonth)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </ChartCard>

      <ChartCard title={`${t("Clients")} · ${t("Share of billable hours")}`} wide>
        <ul className="flex flex-col gap-2.5">
          {f.clients.map((c) => (
            <li key={c.name} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_2.75rem] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3rem] md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3rem_minmax(0,14rem)]">
              <span className="truncate">{c.name}</span>
              <span className="relative h-3 rounded-full bg-track">
                <span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    insetInlineStart: 0,
                    width: `${Math.min(100, (c.hoursShare / clientScale) * 100)}%`,
                    background: c.hoursShare >= f.bench.clientRed ? "var(--danger)" : c.hoursShare >= f.bench.clientAmber ? "var(--warning)" : "var(--brand)",
                  }}
                />
                {[f.bench.clientAmber, f.bench.clientRed].map((m) => (m < clientScale ? <span key={m} className="absolute -inset-y-1 w-px bg-foreground/40" style={{ insetInlineStart: `${(m / clientScale) * 100}%` }} /> : null))}
              </span>
              <span className="text-end tabular-nums">{pct(c.hoursShare)}%</span>
              <span className="col-span-3 -mt-1.5 truncate text-[12px] text-faint md:col-span-1 md:mt-0">
                {[
                  c.leftShare != null ? `${pct(c.leftShare)}% ${t("left after its people")}` : null,
                  c.rateAgeMonths != null && c.rateAgeMonths >= 12 ? t("rate unchanged {n} months", { n: c.rateAgeMonths }) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-faint">
          {[
            f.otherClients.count > 0 ? `${t("{n} more clients", { n: f.otherClients.count })} · ${pct(f.otherClients.hoursShare)}%` : null,
            t("Top three together {pct}%", { pct: pct(f.topThree) }),
            t("Amber at {amber}%, red at {red}% — a rule of thumb", { amber: pct(f.bench.clientAmber), red: pct(f.bench.clientRed) }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </ChartCard>

      <ChartCard title={t("Closing the gap to the target")}>
        {f.gap ? (
          <>
            <p className="text-[12px] text-faint">{t("Any one of these would do it")}</p>
            <ul className="mt-2 flex flex-col gap-2.5">
              <Lever label={t("Raise rates")} value={`+${pct(f.gap.rateUp)}%`} />
              <Lever label={t("Bill more hours a month")} value={`+${Math.round(f.gap.extraHoursPerMonth)}`} />
              <Lever label={t("Cut costs")} value={`−${pct(f.gap.costCut)}%`} />
            </ul>
          </>
        ) : (
          <p className="text-[13px] text-muted">{t("The target is met.")}</p>
        )}
      </ChartCard>

      <ChartCard title={t("Pipeline")}>
        <div className="grid grid-cols-3 gap-3">
          <Mini label={t("Open leads")} value={f.pipeline.openLeads} href="/leads" />
          <Mini label={t("Waiting on us")} value={f.pipeline.waitingOnUs} href="/leads" warn={f.pipeline.waitingOnUs > 0} />
          <Mini label={t("Active candidates")} value={f.pipeline.candidates} href="/candidates" />
        </div>
      </ChartCard>

      <ChartCard title={t("Findings, week by week")} wide>
        <div dir="ltr" className="flex h-32 items-end gap-3">
          {weeks.map((w) => (
            <div key={w.start} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-24 w-full items-end justify-center gap-1">
                <div title={String(w.opened)} className="w-1/3 max-w-5 rounded-t-md bg-warning" style={{ height: `${(w.opened / weekMax) * 100}%`, minHeight: w.opened ? 3 : 0 }} />
                <div title={String(w.resolved)} className="w-1/3 max-w-5 rounded-t-md bg-success" style={{ height: `${(w.resolved / weekMax) * 100}%`, minHeight: w.resolved ? 3 : 0 }} />
              </div>
              <span className="truncate text-[11px] text-faint">{new Date(`${w.start}T12:00:00`).toLocaleDateString(t.locale, { day: "numeric", month: "short" })}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 flex gap-4 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-warning" /> {t("Opened")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-success" /> {t("Closed")}
          </span>
        </p>
      </ChartCard>
    </div>
  );
}

function HourBar({ label, value, scale, color }: { label: string; value: number; scale: number; color: string }) {
  return (
    <div>
      <p className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-muted">{label}</span>
        <span dir="ltr" className="tabular-nums">
          {formatILS(Math.round(value))}
        </span>
      </p>
      <div className="relative mt-1 h-3 rounded-full bg-track">
        <div className="absolute inset-y-0 rounded-full" style={{ insetInlineStart: 0, width: `${Math.min(100, (value / scale) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function Lever({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-muted">{label}</span>
      <span dir="ltr" className="font-serif-accent text-[22px] leading-none tabular-nums">
        {value}
      </span>
    </li>
  );
}

function Mini({ label, value, href, warn = false }: { label: string; value: number; href: string; warn?: boolean }) {
  return (
    <Link href={href} className="rounded-xl bg-background p-3 hover:bg-brand-soft">
      <p className="font-serif-accent text-[26px] leading-none tabular-nums" style={warn ? { color: "var(--warning)" } : undefined}>
        {value}
      </p>
      <p className="mt-1.5 text-[12px] leading-4 text-muted">{label}</p>
    </Link>
  );
}

/* ── one finding ────────────────────────────────────────────────────────── */

function FindingCard({
  it,
  today,
  he,
  onAct,
  onFix,
}: {
  it: AdviceRow;
  today: string;
  he: Hebrew;
  onAct: (it: AdviceRow, body: object, text: string, tone: "done" | "info") => void;
  onFix: (it: AdviceRow) => Promise<void>;
}) {
  const { t, tr, rtl } = he;
  const [snoozing, setSnoozing] = useState(false);
  const [full, setFull] = useState(false);
  const [fixing, setFixing] = useState(false);
  const openTask = useDataMaybe()?.openTask;
  const href = typeof it.facts.href === "string" ? it.facts.href : null;
  const external = !!href && href.startsWith("http");
  const action = typeof it.facts.action === "string" ? it.facts.action : null;
  const figure = typeof it.facts.figure === "string" ? it.facts.figure : null;
  const horizon = typeof it.facts.horizon === "string" ? it.facts.horizon : null;
  const fix = fixOf(it);
  const list = (Array.isArray(it.facts.list) ? it.facts.list : []) as FindingLink[];
  const linkClass = "inline-flex items-center gap-1.5 font-medium text-brand hover:underline";
  const quiet = "inline-flex items-center gap-1.5 text-muted hover:text-foreground";
  return (
    <article className="rounded-2xl bg-surface p-4 shadow-card">
      <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
        <span className="size-2 rounded-full" style={{ background: KIND_COLOR[it.kind] }} />
        {t(KIND_LABEL[it.kind])} · <span className="bidi-auto">{tr(it.area)}</span>
        {horizon && <span>· {t(horizon)}</span>}
        {it.facts.changed === true && <span className="text-danger">{t("· got worse")}</span>}
      </p>
      <p className="bidi-auto mt-1.5 text-[15px] font-medium leading-5">{tr(shownTitle(it))}</p>
      <p className="bidi-auto mt-1 text-[13px] leading-5 text-muted">{tr(shownBody(it))}</p>
      {figure && (
        <p dir="ltr" className="font-serif-accent mt-2 text-start text-[22px] leading-none tabular-nums" style={{ color: it.kind === "now" ? "var(--danger)" : undefined }}>
          {figure}
        </p>
      )}
      {list.length > 0 && (
        <ul className="-mx-2 mt-2.5">
          {(full ? list : list.slice(0, LIST_SHOWN)).map((l, i) => {
            const inner = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="bidi-auto block truncate text-[13px]">{l.label}</span>
                  {l.sub && <span className="block truncate text-[11px] text-faint">{l.sub}</span>}
                </span>
                <StudioArrow size={14} className={`shrink-0 text-faint group-hover/link:text-brand ${rtl ? "-scale-x-100" : ""}`} />
              </>
            );
            const cls = "group/link flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-start hover:bg-background";
            return (
              <li key={l.taskId ?? l.href ?? i}>
                {l.taskId && openTask ? (
                  <button onClick={() => openTask(l.taskId!)} className={cls}>
                    {inner}
                  </button>
                ) : (
                  <Link href={l.href ?? (l.taskId ? `/?task=${l.taskId}` : "#")} className={cls}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
          {list.length > LIST_SHOWN && (
            <li>
              <button onClick={() => setFull((v) => !v)} className="px-2 py-1 text-[12px] text-muted hover:text-foreground">
                {full ? t("Show fewer") : t("Show all {n}", { n: list.length })}
              </button>
            </li>
          )}
        </ul>
      )}
      {snoozing ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-muted">{t("Snooze until")}</span>
          {snoozeOptions(today).map((o) => (
            <button
              key={o.label}
              onClick={() => onAct(it, { action: "snooze", until: o.until }, t("Snoozed until {day}", { day: dayLabel(o.until, t.locale) }), "info")}
              className="rounded-full bg-background px-2.5 py-1 hover:bg-brand-soft"
            >
              {snoozeLabel(o, t)}
            </button>
          ))}
          <button onClick={() => setSnoozing(false)} className="px-1.5 text-faint hover:text-foreground">
            {t("Cancel")}
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          {fix && (
            <button
              onClick={() => {
                setFixing(true);
                void onFix(it).finally(() => setFixing(false));
              }}
              disabled={fixing}
              className={FIX_CLASS}
              style={{ background: "var(--aqua)" }}
            >
              {fixing ? t("Saving…") : tr(fix.label)}
            </button>
          )}
          {href &&
            action &&
            (external ? (
              <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
                {tr(action)}
                <StudioArrow size={14} up />
              </a>
            ) : (
              <Link href={href} className={linkClass}>
                {tr(action)}
                <StudioArrow size={14} className={rtl ? "-scale-x-100" : ""} />
              </Link>
            ))}
          {it.isReminder && (
            <button onClick={() => onAct(it, { action: "done" }, t("Done — {title}", { title: tr(shownTitle(it)) }), "done")} className={quiet}>
              <Check size={14} strokeWidth={2} /> {t("Mark done")}
            </button>
          )}
          <span className="ms-auto flex items-center gap-1 text-faint">
            <span className="me-1 text-[12px]">{t("since {day}", { day: dayLabel(dayOf(it.firstSeen), t.locale) })}</span>
            <button onClick={() => setSnoozing(true)} title={t("Snooze")} aria-label={t("Snooze")} className="flex size-7 items-center justify-center rounded-lg hover:bg-background hover:text-foreground">
              <Clock3 size={16} strokeWidth={1.75} />
            </button>
            <button
              onClick={() => onAct(it, { action: "done" }, t("Dismissed"), "info")}
              title={t("Dismiss — it comes back only if it gets worse")}
              aria-label={t("Dismiss")}
              className="flex size-7 items-center justify-center rounded-lg hover:bg-background hover:text-foreground"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </span>
        </div>
      )}
    </article>
  );
}
