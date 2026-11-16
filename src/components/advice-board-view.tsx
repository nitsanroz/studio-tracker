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

import { Sparkline } from "@/components/line-style";
import { Caret } from "@/components/caret";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Clock3, RotateCw, Sparkles, Undo2, X } from "lucide-react";
import { said, useAdviceLang, useHebrew, type Hebrew } from "@/components/advice-lang";
import { InfoTip, Tip, TipRows, TipScope } from "@/components/advice-tip";
import { AdviceTop } from "@/components/advice-top";
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
import { PRIVACY_EVENT, loadHold } from "@/lib/finance/privacy";
import { useDataMaybe } from "@/lib/store";
import { toast } from "@/lib/toast";

type Loaded = AdviceView & { board: AdviceBoard };

type PageTab = "today" | "studio" | "follow";
const PAGE_TABS: [PageTab, string][] = [
  ["today", "Today"],
  ["studio", "The studio"],
  ["follow", "Follow-up"],
];

const KINDS: AdviceKind[] = ["now", "heads", "idea"];
const KIND_LABEL: Record<AdviceKind, string> = { now: "Do now", heads: "Heads-up", idea: "Idea" };
const KIND_PLURAL: Record<AdviceKind, string> = { now: "Do now", heads: "Heads-ups", idea: "Ideas" };
const KIND_COLOR: Record<AdviceKind, string> = { now: "var(--danger)", heads: "var(--warning)", idea: "var(--brand)" };
/** What each kind means — the hover on a count and on a card's label. */
const KIND_TIP: Record<AdviceKind, string> = {
  now: "Things that cost money or a client if they wait.",
  heads: "Worth knowing this week. Nothing breaks today.",
  idea: "Ways to run the studio better, read from the last three months as a whole. No deadline.",
};
const HIDDEN_TIP = "Findings you put aside. A snoozed one returns on its day; a dismissed one only if it gets worse.";
const pct = (f: number) => Math.round(f * 100);
const LIST_SHOWN = 5;

export function AdviceBoardView() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const periodRef = useRef("3m");
  const [group, setGroup] = useState<"urgency" | "subject">("urgency");
  // The page in three tabs (Nitsan, 2026-11-15: "the page is very long — reorder it or put it in tabs"),
  // remembered per browser; and the months "The studio in numbers" reads.
  const [view, setView] = useState<PageTab>("today");
  const [period, setPeriod] = useState("3m");
  useEffect(() => {
    try {
      const v = window.localStorage.getItem("advice.tab");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once, from storage
      if (v === "today" || v === "studio" || v === "follow") setView(v);
    } catch {
      /* no storage: Today */
    }
  }, []);
  const pickView = (v: PageTab) => {
    setView(v);
    try {
      window.localStorage.setItem("advice.tab", v);
    } catch {
      /* not kept */
    }
  };
  const [hold, setHold] = useState(false);
  const [lang] = useAdviceLang();
  const texts = useMemo(() => (data ? viewTexts(data, data.board) : []), [data]);
  const he = useHebrew(lang, texts);
  const { t, tr, rtl } = he;

  const load = useCallback(async (p: string = periodRef.current) => {
    setChecking(true);
    const res = await fetch(`/api/advice?board=1&period=${encodeURIComponent(p)}`).catch(() => null);
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
  }, [load]);
  const pickPeriod = (p: string) => {
    setPeriod(p);
    periodRef.current = p;
    void load(p);
  };
  // "Hide numbers" is the header's switch; the page follows it at once.
  useEffect(() => {
    const read = () => setHold(loadHold());
    read();
    window.addEventListener(PRIVACY_EVENT, read);
    return () => window.removeEventListener(PRIVACY_EVENT, read);
  }, []);

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

  const scope = useMemo(() => ({ rtl, hold }), [rtl, hold]);

  return (
    <TipScope.Provider value={scope}>
    <div dir={rtl ? "rtl" : "ltr"} className={`mx-auto flex w-full max-w-[1500px] flex-col gap-6 ${hold ? "advice-hold" : ""}`}>
      <AdviceTop
        rtl={rtl}
        // The name reads left to right in either language — in a right-to-left line the ampersand would jump to the end.
        title={
          <span dir="ltr" className="inline-block">
            &amp;advice
          </span>
        }
        note={t("The studio at a glance: what needs you, how the last three months read, and what was found and closed.")}
        status={data ? (he.busy ? t("Translating…") : (he.off ?? checkedLine(data, t))) : null}
        control={
          <button
            onClick={() => void load()}
            disabled={checking}
            aria-label={t("Check again")}
            title={t("Check again")}
            className="flex size-9 items-center justify-center rounded-xl bg-surface text-muted shadow-card hover:text-foreground"
          >
            <RotateCw size={18} strokeWidth={1.75} className={checking ? "animate-spin" : ""} />
          </button>
        }
      />

      {data && board && (
        <div className="-mt-2 inline-flex self-start rounded-full bg-surface p-0.5 text-[13px] shadow-card" role="tablist" aria-label={t("Sections")}>
          {PAGE_TABS.map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => pickView(v)}
              className={`rounded-full px-4 py-1.5 font-medium ${view === v ? "bg-brand text-white" : "text-muted hover:text-foreground"}`}
            >
              {t(label)}
              {v === "today" && items.length > 0 && <span className={`ms-1.5 tabular-nums ${view === v ? "text-white/75" : "text-faint"}`}>{items.length}</span>}
            </button>
          ))}
        </div>
      )}

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
          {view === "today" && (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {KINDS.map((k) => (
              <Stat
                key={k}
                label={t(KIND_PLURAL[k])}
                value={items.filter((i) => i.kind === k).length}
                color={KIND_COLOR[k]}
                tip={t(KIND_TIP[k])}
                rows={bySubject(items.filter((i) => i.kind === k), tr, t("Other subjects"))}
              />
            ))}
            <Stat
              label={t("Snoozed or dismissed")}
              value={board.hidden.length}
              tip={t(HIDDEN_TIP)}
              rows={[[t("Snoozed, back on a date"), board.hidden.filter((i) => !i.doneAt).length] as const, [t("Dismissed, back if worse"), board.hidden.filter((i) => i.doneAt).length] as const]}
            />
            <Stat
              label={t("Closed in 30 days")}
              value={board.resolved.length}
              tip={t("Findings that stopped being true. A check closes them by itself; there is nothing to do.")}
              rows={bySubject(board.resolved, tr, t("Other subjects"))}
            />
          </section>
          )}

          {view === "studio" && (
          <section className="rounded-2xl bg-surface p-5 shadow-card md:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="card-title flex min-w-0 flex-1 items-center gap-2">
                <Sparkles size={18} strokeWidth={1.75} className="shrink-0 text-brand" />
                {t("The consultant's read")}
                <InfoTip title={t("The consultant's read")}>
                  {t("One Claude call per click, about a minute. It reads the last three months as shares, percentages, hours and rates as an index. No amount in ₪ is sent.")}
                </InfoTip>
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
              {data.business?.summary ? (
                <p {...said(he, tr(data.business.summary), "text-[15px] leading-6")}>{tr(data.business.summary)}</p>
              ) : (
                <p className="text-[15px] leading-6 text-muted">{t("No review yet. One click reads the last three months as a consultant would.")}</p>
              )}
              {!!data.business?.questions.length && (
                <div>
                  <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-muted">
                    <Tip mark body={t("What the figures alone could not settle. They are for you to think over; nothing is sent back.")}>
                      {t("Questions only you can answer")}
                    </Tip>
                  </p>
                  <ul className="mt-2 list-disc space-y-1.5 ps-4 text-[13px] leading-5 text-muted">
                    {data.business.questions.map((q) => (
                      <li key={q} {...said(he, tr(q))}>
                        {tr(q)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {consultError && <p className="mt-2 text-[12px] text-danger">{consultError}</p>}
          </section>
          )}

          {view === "studio" && (
          <section>
            <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
            <SectionHead
              title={t("The studio in numbers")}
              note={board.figures?.label}
              tip={t("The months picked here, read together. \"A year ago\" is the same months last year. Three months is the default, so one odd month doesn't decide.")}
            />
            </div>
            <select
              value={period}
              onChange={(e) => pickPeriod(e.target.value)}
              disabled={checking}
              aria-label={t("Period")}
              className="rounded-full bg-surface px-3.5 py-1.5 text-[13px] font-medium shadow-card outline-none ring-brand focus:ring-2 disabled:opacity-60"
            >
              {board.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {/^\d{4}-\d{2}$/.test(p.id) ? new Date(`${p.id}-15T12:00:00`).toLocaleDateString(t.locale, { month: "long", year: "numeric" }) : t(p.label)}
                </option>
              ))}
            </select>
            </div>
            {board.figures ? (
              <Figures f={board.figures} he={he} />
            ) : (
              <p className="mt-3 rounded-2xl bg-surface p-5 text-sm text-muted">{t("These charts need the months picked to be in the books.")}</p>
            )}
            {data.pulse.length > 0 && (
              <>
                <p className="mt-6 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">
                  <Tip mark body={t("The same figures the pages themselves show, each with its last weeks. Hover one for how it is counted.")}>
                    {t("The pages' own figures")}
                  </Tip>
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
                  {uniqueTiles(data.pulse).map((p) => (
                    <PulseTile key={`${p.label}|${p.display}`} p={p} tr={tr} />
                  ))}
                </div>
              </>
            )}
          </section>
          )}

          {view === "today" && (
          <section>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <SectionHead
                  title={t("Everything found")}
                  note={String(items.length)}
                  tip={t("Every open finding. Snooze hides one until a date; dismiss hides it until it gets worse; a check closes it by itself once it is no longer true.")}
                />
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
                        <Tip mark body={t(KIND_TIP[k])}>
                          {t(KIND_PLURAL[k])}
                        </Tip>
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
                      <span {...said(he, tr(area))}>{tr(area)}</span>
                      <span className="text-faint">{list.length}</span>
                    </p>
                    {list.map(card)}
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

          {view === "follow" && (
          <section>
            <SectionHead title={t("Follow-up")} tip={t("What you put aside and what closed by itself, so nothing disappears without a trace.")} />
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
              <div className="rounded-2xl bg-surface p-5 shadow-card">
                <h3 className="card-title flex items-center gap-2">
                  {t("Snoozed and dismissed")}
                  <InfoTip title={t("Snoozed and dismissed")}>{t(HIDDEN_TIP)}</InfoTip>
                </h3>
                {board.hidden.length === 0 ? (
                  <p className="mt-2 text-[13px] text-muted">{t("Nothing is snoozed or dismissed.")}</p>
                ) : (
                  <ul className="mt-2 flex flex-col">
                    {board.hidden.map((it) => (
                      <li key={it.id} className="flex items-start gap-3 py-2.5">
                        <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[it.kind] }} />
                        <span className="min-w-0 flex-1">
                          <span {...said(he, tr(shownTitle(it)), "block text-[14px] leading-5")}>{tr(shownTitle(it))}</span>
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
                          <span {...said(he, tr(shownTitle(it)), "block text-[14px] leading-5 text-muted")}>{tr(shownTitle(it))}</span>
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
            <div className="mt-4">
              <WeeksCard weeks={board.weeks} he={he} />
            </div>
          </section>
          )}
        </>
      )}
    </div>
    </TipScope.Provider>
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

/** How many of `list` sit under each subject, largest first — a stat's breakdown. */
function bySubject(list: AdviceRow[], tr: (s: string) => string, more: string): (readonly [string, number])[] {
  const n = new Map<string, number>();
  for (const it of list) n.set(it.area, (n.get(it.area) ?? 0) + 1);
  const rows = [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = rows.slice(0, 6).map(([area, count]) => [tr(area), count] as const);
  const rest = rows.slice(6).reduce((t, [, count]) => t + count, 0);
  return rest ? [...shown, [more, rest] as const] : shown;
}

function SectionHead({ title, note, tip }: { title: string; note?: string; tip?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="card-title flex items-center gap-2">
        {title}
        {tip && <InfoTip title={title}>{tip}</InfoTip>}
      </h2>
      {note && <span className="text-[13px] text-faint">{note}</span>}
    </div>
  );
}

function Stat({ label, value, color, tip, rows = [] }: { label: string; value: number; color?: string; tip: string; rows?: (readonly [string, number])[] }) {
  return (
    <Tip
      as="div"
      title={label}
      body={
        <>
          {tip}
          <TipRows rows={rows} />
        </>
      }
      className="rounded-2xl bg-surface p-4 shadow-card"
    >
      <p className="flex items-center gap-2 text-[12px] text-muted">
        {color && <span className="size-2 rounded-full" style={{ background: color }} />}
        {label}
      </p>
      <p className="font-serif-accent mt-2 text-[34px] leading-none tabular-nums" style={color && value > 0 ? { color } : undefined}>
        {value}
      </p>
    </Tip>
  );
}

function PulseTile({ p, tr }: { p: PaneTile; tr: (s: string) => string }) {
  const color = p.good ? "var(--brand)" : "var(--danger)";
  return (
    <Tip as="div" title={tr(p.label)} body={tr(p.help)} className="rounded-2xl bg-surface p-3.5 shadow-card">
      <p className="truncate text-[12px] text-muted">{tr(p.label)}</p>
      <p dir="ltr" className="font-serif-accent mt-1.5 text-start text-[24px] leading-none tabular-nums" style={p.good ? undefined : { color }}>
        {p.display}
      </p>
      <Sparkline series={p.series} color={color} />
      <p className="mt-1 truncate text-[11px] text-faint">{tr(p.note)}</p>
    </Tip>
  );
}

/* ── the charts ─────────────────────────────────────────────────────────── */

function ChartCard({ title, tip, children, wide = false }: { title: string; tip: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`rounded-2xl bg-surface p-5 shadow-card ${wide ? "md:col-span-2" : ""}`}>
      <h3 className="flex items-center gap-2 text-[14px] font-medium">
        {title}
        <InfoTip title={title}>{tip}</InfoTip>
      </h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** A track with a fill and labelled marks along it; `scale` is the value at the track's end. */
function Track({
  value,
  scale,
  color,
  marks = [],
  band,
}: {
  value: number;
  scale: number;
  color: string;
  marks?: { at: number; label: string; tip: string }[];
  band?: [number, number];
}) {
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  return (
    <div className="pb-7">
      <div className="relative h-3 rounded-full bg-track">
        {band && <div className="absolute inset-y-0 rounded-full bg-success/20" style={{ insetInlineStart: x(band[0]), width: `${((band[1] - band[0]) / scale) * 100}%` }} />}
        <div className="absolute inset-y-0 rounded-full" style={{ insetInlineStart: 0, width: x(value), background: color }} />
        {/* each mark hangs under the track: a caret pointing up at its place,
            its label beneath — no line through the bar (caret.tsx). The w-0
            column centres both on the point in either direction. */}
        {marks.map((m) => (
          <div key={m.label} className="absolute top-full mt-0.5 flex w-0 flex-col items-center" style={{ insetInlineStart: x(m.at) }}>
            <Caret dir="up" size={8} className="text-foreground/70" />
            <Tip body={m.tip} className="mt-0.5 whitespace-nowrap text-[11px] text-faint">
              {m.label}
            </Tip>
          </div>
        ))}
      </div>
    </div>
  );
}

const SHARE_COLORS = { salaries: "#0b43ed", freelance: "#6181e8", rent: "#001e6c", tools: "#00c8d2", other: "#aeb5c6", left: "#16a34a" } as const;
type ShareKey = keyof typeof SHARE_COLORS;
const SHARE_LABEL: Record<ShareKey, string> = { salaries: "Salaries", freelance: "Freelancers", rent: "Rent", tools: "Tools", other: "Other", left: "Left over" };
/** What each part of "Where the income goes" holds (business.ts `sharesOf`). */
const SHARE_TIP: Record<ShareKey, string> = {
  salaries: "The salaried team, with what the employer pays on top.",
  freelance: "What freelancers were paid.",
  rent: "Rent and the bills of the place.",
  tools: "Everything on the Expenses page: monthly, yearly and one-off.",
  other: "Every other cost in the books.",
  left: "Income that no cost took: the profit margin. A loss shows as none.",
};

function sharesWithLeft(s: BoardFigures["shares"]): Record<ShareKey, number> {
  const spent = s.salaries + s.freelance + s.rent + s.tools + s.other;
  return { ...s, left: Math.max(0, 1 - spent) };
}

function Stacked({ label, shares, tipOf }: { label: string; shares: Record<ShareKey, number>; tipOf: (k: ShareKey) => { title: string; body: React.ReactNode } }) {
  const total = Math.max(1, Object.values(shares).reduce((a, b) => a + b, 0));
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-[12px] text-muted">{label}</span>
      <div className="flex h-6 min-w-0 flex-1 overflow-hidden rounded-lg">
        {(Object.keys(SHARE_COLORS) as ShareKey[]).map((k) =>
          shares[k] > 0.004 ? <Tip key={k} as="div" {...tipOf(k)} style={{ width: `${(shares[k] / total) * 100}%`, background: SHARE_COLORS[k] }}>{null}</Tip> : null,
        )}
      </div>
    </div>
  );
}

function Figures({ f, he }: { f: BoardFigures; he: Hebrew }) {
  const { t } = he;
  const now = sharesWithLeft(f.shares);
  const then = f.sharesLastYear ? sharesWithLeft(f.sharesLastYear) : null;
  const marginScale = Math.max(0.4, f.targetMargin * 1.5, f.margin * 1.2, (f.marginLastYear ?? 0) * 1.2);
  const hourScale = Math.max(f.avgRate, f.hourCost, f.hourCostLastYear ?? 0) * 1.1;
  const clientScale = Math.max(0.4, f.topClient * 1.15);
  const util = f.utilization;
  const short = pct(f.targetMargin) - pct(f.margin);
  const perHour = f.avgRate - f.hourCost;
  const shareTip = (k: ShareKey) => ({
    title: t(SHARE_LABEL[k]),
    body: (
      <>
        {t(SHARE_TIP[k])}
        <TipRows rows={[[t("Now"), `${pct(now[k])}%`] as const, ...(then ? [[t("A year ago"), `${pct(then[k])}%`] as const] : [])]} />
      </>
    ),
  });
  return (
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
      <ChartCard title={t("Profit margin")} tip={t("What is left of the income after every cost, as a share of the income.")}>
        <Tip
          as="p"
          title={t("Profit margin")}
          body={
            <TipRows
              rows={[
                [t("Now"), `${pct(f.margin)}%`] as const,
                [t("Target"), `${pct(f.targetMargin)}%`] as const,
                ...(f.marginLastYear != null ? [[t("A year ago"), `${pct(f.marginLastYear)}%`] as const] : []),
                [t(short > 0 ? "Short of the target" : "Above the target"), t("{n} points", { n: Math.abs(short) })] as const,
              ]}
            />
          }
          className="font-serif-accent inline-block text-[40px] leading-none tabular-nums"
          style={{ color: f.margin >= f.targetMargin ? "var(--success)" : f.margin < 0 ? "var(--danger)" : undefined }}
        >
          {pct(f.margin)}%
        </Tip>
        <div className="mt-4">
          <Track
            value={Math.max(0, f.margin)}
            scale={marginScale}
            color={f.margin >= f.targetMargin ? "var(--success)" : "var(--brand)"}
            marks={[{ at: f.targetMargin, label: `${t("Target")} ${pct(f.targetMargin)}%`, tip: t("The margin the studio aims for: the same target the hours goal on Home is built on.") }]}
          />
        </div>
        {f.marginLastYear != null && (
          <p className="mt-1 text-[13px] text-muted">
            <Tip mark body={t("The same three months, last year.")}>
              {t("A year ago")}
            </Tip>
            : <span className="tabular-nums">{pct(f.marginLastYear)}%</span>
          </p>
        )}
      </ChartCard>

      <ChartCard title={t("Where the income goes")} tip={t("Each cost as a share of the income. What no cost took is left over: the profit margin.")}>
        <div className="flex flex-col gap-2">
          <Stacked label={t("Now")} shares={now} tipOf={shareTip} />
          {then && <Stacked label={t("A year ago")} shares={then} tipOf={shareTip} />}
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-muted">
          {(Object.keys(SHARE_COLORS) as ShareKey[]).map((k) => (
            <Tip key={k} as="li" {...shareTip(k)} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: SHARE_COLORS[k] }} />
              <span className="min-w-0 flex-1 truncate">{t(SHARE_LABEL[k])}</span>
              <span className="tabular-nums text-foreground">{pct(now[k])}%</span>
              {then && <span className="w-9 text-end tabular-nums text-faint">{pct(then[k])}%</span>}
            </Tip>
          ))}
        </ul>
      </ChartCard>

      <ChartCard title={t("An hour")} tip={t("The average hour of the three months: what it is sold for, and what it has to bring in to cover every cost.")}>
        <div className="flex flex-col gap-3">
          <HourBar label={t("Sold for")} value={f.avgRate} scale={hourScale} color="var(--brand)" tip={t("Income from hourly work ÷ billable hours.")} />
          <HourBar
            label={t("Costs the studio")}
            value={f.hourCost}
            scale={hourScale}
            color={f.hourCost > f.avgRate ? "var(--danger)" : "#001e6c"}
            tip={
              <>
                {t("All costs ÷ billable hours: what an hour must bring in to break even.")}
                <TipRows rows={[[t(perHour >= 0 ? "Left on each hour" : "Missing on each hour"), formatILS(Math.round(Math.abs(perHour)))] as const]} />
              </>
            }
          />
          {f.hourCostLastYear != null && (
            <HourBar label={t("A year ago it cost")} value={f.hourCostLastYear} scale={hourScale} color="#aeb5c6" tip={t("The same sum for the same three months, last year.")} />
          )}
        </div>
        <p className="mt-3 text-[13px] text-muted">
          <Tip mark body={t("The rest is fixed-price projects.")}>
            {t("{pct}% of income is sold by the hour", { pct: pct(f.hourlyShare) })}
          </Tip>
        </p>
      </ChartCard>

      <ChartCard title={t("Team")} tip={t("How much of the salaried team's time is billed, and who else the hours lean on.")}>
        {util != null && (
          <>
            <Tip
              as="p"
              title={t("of a full day billed")}
              body={t("The salaried team's billable hours ÷ the hours of full working days, 8 a day.")}
              className="flex items-baseline gap-2"
            >
              <span
                className="font-serif-accent text-[40px] leading-none tabular-nums"
                style={{ color: util < f.bench.utilizationLow || util > f.bench.utilizationHigh ? "var(--warning)" : "var(--success)" }}
              >
                {pct(util)}%
              </span>
              <span className="text-[13px] text-muted">{t("of a full day billed")}</span>
            </Tip>
            <div className="mt-4">
              <Track value={util} scale={1} color="var(--brand)" band={[f.bench.utilizationLow, f.bench.utilizationHigh]} />
            </div>
            <p className="-mt-1 text-[12px] text-faint">
              <Tip mark body={t("Under the range people sit idle; over it there is no room for anything but client work.")}>
                {t("Healthy range {low}–{high}% — a rule of thumb", { low: pct(f.bench.utilizationLow), high: pct(f.bench.utilizationHigh) })}
              </Tip>
            </p>
          </>
        )}
        <ul className="mt-3 flex flex-col gap-1 text-[13px] text-muted">
          <li>
            <Tip mark body={t("Salaried people who logged real hours, averaged over the three months.")}>
              {t("{n} salaried designers", { n: Math.round(f.designers * 10) / 10 })}
            </Tip>
          </li>
          {f.ownerShare != null && (
            <li>
              <Tip mark body={t("Your own hours out of all billable hours. The higher it is, the more the studio depends on you.")}>
                {t("You bill {pct}% of the hours", { pct: pct(f.ownerShare) })}
              </Tip>
            </li>
          )}
        </ul>
        {f.freelancers.length > 0 && (
          <>
            <p className="mt-3 text-[12px] text-faint">
              <Tip mark body={t("The hours each freelancer logged, a month on average.")}>
                {t("Freelancers, hours a month")}
              </Tip>
            </p>
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

      <ChartCard
        title={`${t("Clients")} · ${t("Share of billable hours")}`}
        tip={t("Each client's part of the billable hours. One client too large is a risk: if it leaves, that part of the work leaves with it.")}
        wide
      >
        <ul className="flex flex-col gap-2.5">
          {f.clients.map((c) => (
            <Tip
              key={c.name}
              as="li"
              title={c.name}
              body={
                <>
                  <TipRows
                    rows={[
                      [t("Hours in the three months"), Math.round(c.hours)] as const,
                      [t("Share of billable hours"), `${pct(c.hoursShare)}%`] as const,
                      [t("Left after its people"), c.leftShare != null ? `${pct(c.leftShare)}%` : t("not known")] as const,
                      ...(c.rateAgeMonths != null ? [[t("Rate unchanged"), t("{n} months", { n: c.rateAgeMonths })] as const] : []),
                    ]}
                  />
                  <p className="mt-2">{t("Left after its people: its hours at its rate, less the cost of the hours people put in.")}</p>
                </>
              }
              className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_2.75rem] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3rem] md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3rem_minmax(0,14rem)]"
            >
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
                {/* the two thresholds as small carets under the bar, in their own colours */}
                {[
                  { m: f.bench.clientAmber, cls: "text-warning" },
                  { m: f.bench.clientRed, cls: "text-danger" },
                ].map(({ m, cls }) =>
                  m < clientScale ? (
                    <span key={m} className={`absolute top-full mt-px flex w-0 justify-center ${cls}`} style={{ insetInlineStart: `${(m / clientScale) * 100}%` }}>
                      <Caret dir="up" size={7} />
                    </span>
                  ) : null,
                )}
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
            </Tip>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-faint">
          <Tip mark body={t("The two thin lines on each bar. Past the first, one client carries a large part of the work; past the second, losing it would be hard to absorb.")}>
            {[
              f.otherClients.count > 0 ? `${t("{n} more clients", { n: f.otherClients.count })} · ${pct(f.otherClients.hoursShare)}%` : null,
              t("Top three together {pct}%", { pct: pct(f.topThree) }),
              t("Amber at {amber}%, red at {red}% — a rule of thumb", { amber: pct(f.bench.clientAmber), red: pct(f.bench.clientRed) }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Tip>
        </p>
      </ChartCard>

      <ChartCard
        title={t("Closing the gap to the target")}
        tip={t("How far the three months fell short of the target margin, and three ways to close it. Each alone would do it; in practice, a little of each.")}
      >
        {f.gap ? (
          <>
            <p className="text-[12px] text-faint">{t("Any one of these would do it")}</p>
            <ul className="mt-2 flex flex-col gap-2.5">
              <Lever label={t("Raise rates")} value={`+${pct(f.gap.rateUp)}%`} tip={t("Every hourly rate up by this much, for the same hours.")} />
              <Lever label={t("Bill more hours a month")} value={`+${Math.round(f.gap.extraHoursPerMonth)}`} tip={t("This many more billable hours every month, at today's average rate.")} />
              <Lever label={t("Cut costs")} value={`−${pct(f.gap.costCut)}%`} tip={t("All costs down by this much, for the same income.")} />
            </ul>
          </>
        ) : (
          <p className="text-[13px] text-muted">{t("The target is met.")}</p>
        )}
      </ChartCard>

      <ChartCard title={t("Pipeline")} tip={t("Where the next work and the next people would come from.")}>
        <div className="grid grid-cols-3 gap-3">
          <Mini label={t("Open leads")} value={f.pipeline.openLeads} href="/leads" tip={t("Leads that are neither won nor lost.")} />
          <Mini
            label={t("Waiting on us")}
            value={f.pipeline.waitingOnUs}
            href="/leads"
            warn={f.pipeline.waitingOnUs > 0}
            tip={t("Open leads that are owed a reply, or have a next step with a date.")}
          />
          <Mini label={t("Active candidates")} value={f.pipeline.candidates} href="/candidates" tip={t("Candidates still in the hiring process.")} />
        </div>
      </ChartCard>

    </div>
  );
}

/** How many findings each week opened and closed — on the Follow-up tab. */
function WeeksCard({ weeks, he }: { weeks: AdviceBoard["weeks"]; he: Hebrew }) {
  const { t } = he;
  const weekMax = Math.max(1, ...weeks.map((w) => Math.max(w.opened, w.resolved)));
  const weekDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(t.locale, { day: "numeric", month: "short" });
  return (
      <ChartCard
        title={t("Findings, week by week")}
        tip={t("How many findings a check opened each week, and how many it closed. More closed than opened: the list is getting shorter.")}
        
      >
        <div dir="ltr" className="flex h-32 items-end gap-3">
          {weeks.map((w) => (
            <Tip
              key={w.start}
              as="div"
              title={t("Week of {day}", { day: weekDay(w.start) })}
              body={<TipRows rows={[[t("Opened"), w.opened] as const, [t("Closed"), w.resolved] as const]} />}
              className="flex min-w-0 flex-1 flex-col items-center gap-1"
            >
              <div className="flex h-24 w-full items-end justify-center gap-1">
                <div className="w-1/3 max-w-5 rounded-t-md bg-warning" style={{ height: `${(w.opened / weekMax) * 100}%`, minHeight: w.opened ? 3 : 0 }} />
                <div className="w-1/3 max-w-5 rounded-t-md bg-success" style={{ height: `${(w.resolved / weekMax) * 100}%`, minHeight: w.resolved ? 3 : 0 }} />
              </div>
              <span className="truncate text-[11px] text-faint">{weekDay(w.start)}</span>
            </Tip>
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
  );
}

function HourBar({ label, value, scale, color, tip }: { label: string; value: number; scale: number; color: string; tip: React.ReactNode }) {
  return (
    <Tip as="div" title={label} body={tip}>
      <p className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-muted">{label}</span>
        <span dir="ltr" className="tabular-nums">
          {formatILS(Math.round(value))}
        </span>
      </p>
      <div className="relative mt-1 h-3 rounded-full bg-track">
        <div className="absolute inset-y-0 rounded-full" style={{ insetInlineStart: 0, width: `${Math.min(100, (value / scale) * 100)}%`, background: color }} />
      </div>
    </Tip>
  );
}

function Lever({ label, value, tip }: { label: string; value: string; tip: string }) {
  return (
    <Tip as="li" title={label} body={tip} className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-muted">{label}</span>
      <span dir="ltr" className="font-serif-accent text-[22px] leading-none tabular-nums">
        {value}
      </span>
    </Tip>
  );
}

function Mini({ label, value, href, tip, warn = false }: { label: string; value: number; href: string; tip: string; warn?: boolean }) {
  return (
    <Tip as="div" title={label} body={tip} focusable={false} className="flex">
      <Link href={href} className="min-w-0 flex-1 rounded-xl bg-background p-3 hover:bg-brand-soft">
        <p className="font-serif-accent text-[26px] leading-none tabular-nums" style={warn ? { color: "var(--warning)" } : undefined}>
          {value}
        </p>
        <p className="mt-1.5 text-[12px] leading-4 text-muted">{label}</p>
      </Link>
    </Tip>
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
        <Tip mark body={t(KIND_TIP[it.kind])}>
          {t(KIND_LABEL[it.kind])}
        </Tip>{" "}
        · <span {...said(he, tr(it.area))}>{tr(it.area)}</span>
        {horizon && <span>· {t(horizon)}</span>}
        {it.facts.changed === true && <span className="text-danger">{t("· got worse")}</span>}
      </p>
      <p {...said(he, tr(shownTitle(it)), "mt-1.5 text-[15px] font-medium leading-5")}>{tr(shownTitle(it))}</p>
      <p {...said(he, tr(shownBody(it)), "mt-1 text-[13px] leading-5 text-muted")}>{tr(shownBody(it))}</p>
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
            <Tip mark body={t("First found on this day, and true at every check since.")} className="me-1 text-[12px]">
              {t("since {day}", { day: dayLabel(dayOf(it.firstSeen), t.locale) })}
            </Tip>
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
