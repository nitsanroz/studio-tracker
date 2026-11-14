"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Info, Lightbulb, Minus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { StudioArrow } from "@/components/studio-arrow";
import type { AdviceRow } from "@/lib/finance/advice/merge";
import type { AdviceKind, Fix, PulseTile } from "@/lib/finance/advice/signals";
import type { AdviceView } from "@/lib/finance/advice/run";
import { pageContext, splitByPage, tilesFor } from "@/lib/finance/advice/context";
import { PNL_UPDATED } from "@/lib/finance/auto-rollup";
import { applyFix, scanMail } from "@/lib/finance/advice/client";
import { isoDate } from "@/lib/finance/format";
import { usePhone } from "@/lib/finance/use-phone";

/**
 * &advice in finance (v1.6.0) — the tracker's pane (its components/advice.tsx),
 * as Nitsan chose on 2026-10-24: the same Night briefing and corner ampersand,
 * with real amounts. Closed, a round Studio Black button with the aqua
 * ampersand in the bottom-right corner; open, a 440px pane over the page.
 *
 * ⚠️ ITS OWN COLOUR SCHEME IS TOKEN OVERRIDES on the pane's root (`NIGHT`), so
 * the app's classes — bg-surface, text-muted, text-faint — follow it.
 *
 * Mounted for full-finance users; the API answers 403 to anyone but the owner,
 * and then nothing renders. Desktop only, like the tracker's.
 */

const NIGHT: CSSProperties = {
  ["--foreground" as string]: "#ffffff",
  ["--muted" as string]: "#aab4d4",
  ["--faint" as string]: "#7c88ad",
  ["--surface" as string]: "#101c44",
  ["--surface-2" as string]: "#13225a",
  ["--background" as string]: "#06112f",
  ["--border" as string]: "#1f2c57",
  ["--brand-soft" as string]: "#13225a",
  ["--brand" as string]: "#74f3ef",
  ["--success" as string]: "#74f3ef",
};
const AQUA = "#74f3ef";
const CORAL = "#ff8f7d";
const TONE: Record<AdviceKind, string> = { now: CORAL, heads: "#ffd27a", idea: AQUA };
const KIND_LABEL: Record<AdviceKind, string> = { now: "Do now", heads: "Heads-up", idea: "Idea" };
const FILTER_LABEL: Record<AdviceKind, string> = { now: "Do now", heads: "Heads-ups", idea: "Ideas" };

async function patch(id: string, body: object): Promise<boolean> {
  // A network failure rejects fetch: without the catch the card vanished and nothing was said.
  const res = await fetch(`/api/finance/advice/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return !!res?.ok;
}
/** An Undo that failed says so — it used to reload as if it had worked. */
const UNDO_FAILED = "Couldn't undo that — try again";

const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const plusDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * The snooze choices, in the studio's week (Sun–Thu): the next workday, the
 * start of the week after it, and two weeks. Never a Friday or Saturday. The
 * tracker's own rule (its advice.tsx `snoozeOptions`).
 */
function snoozeOptions(today: string): { label: string; until: string }[] {
  const d = parse(today);
  let next = plusDays(d, 1);
  while (next.getDay() > 4) next = plusDays(next, 1);
  const nextWeek = plusDays(next, 7 - next.getDay());
  let twoWeeks = plusDays(d, 14);
  while (twoWeeks.getDay() > 4) twoWeeks = plusDays(twoWeeks, 1);
  const name = next.toLocaleDateString("en-GB", { weekday: "long" });
  return [
    { label: isoDate(next) === isoDate(plusDays(d, 1)) ? "Tomorrow" : name, until: isoDate(next) },
    { label: "Next week", until: isoDate(nextWeek) },
    { label: "In 2 weeks", until: isoDate(twoWeeks) },
  ];
}
/** The card's one-click fix, if it has one (signals.ts `Fix`, stored as JSON in its facts). */
function fixOf(it: AdviceRow): Fix | null {
  if (typeof it.facts.fix !== "string") return null;
  try {
    return JSON.parse(it.facts.fix) as Fix;
  } catch {
    return null;
  }
}
const FIX_CLASS = "rounded-full px-3.5 py-1.5 text-[13px] font-medium text-[#06112f] hover:opacity-90 disabled:opacity-50";

const dayLabel = (s: string) => parse(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

type ItemRef = { signal: string; kind: AdviceKind };
type Notice = { text: string; undo?: () => void; key: number };

export function Advice() {
  const [allowed, setAllowed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [refs, setRefs] = useState<ItemRef[]>([]);
  const [open, setOpen] = useState(false);
  // The card whose link was followed: it floats over the page, its cells lit up.
  const [spot, setSpot] = useState<AdviceRow | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const pathname = usePathname();
  const peekRef = useRef<() => Promise<void>>(async () => {});

  const peek = useCallback(async () => {
    const res = await fetch("/api/finance/advice?peek=1").catch(() => null);
    // Only "not signed in" or "not the owner" hides the button; a blip retries in a minute.
    const retry = () => window.setTimeout(() => void peekRef.current(), 60_000);
    if (!res) return void retry();
    // 503 = reference/0010 not run yet: the owner still gets the button, to see why.
    if (res.status === 503) {
      setAllowed(true);
      return setMissing(true);
    }
    if (res.status === 401 || res.status === 403) return setAllowed(false);
    if (!res.ok) return void retry();
    const j = (await res.json()) as { items: ItemRef[]; mailDue?: boolean };
    setAllowed(true);
    setMissing(false);
    setRefs(j.items ?? []);
    // The billing mail is read in the background from any page when it's due (v1.13.0); then look again.
    if (j.mailDue) void scanMail().then((ok) => (ok ? peekRef.current() : undefined));
  }, []);
  useEffect(() => {
    peekRef.current = peek;
    void peek();
  }, [peek]);
  const close = useCallback(() => {
    setOpen(false);
    void peek();
  }, [peek]);

  // A notice fades after a few seconds; a newer one replaces it.
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice((n) => (n?.key === notice.key ? null : n)), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);
  const say = useCallback((text: string, undo?: () => void) => setNotice({ text, undo, key: Date.now() }), []);

  if (!allowed) return null;
  const toastEl = notice && (
    // Centred on the page; beside the pane while it's open, never across its edge.
    <div
      className={`fixed bottom-6 z-50 hidden items-center gap-4 rounded-xl bg-[#06112f] px-4 py-2.5 text-sm text-white shadow-[0_12px_30px_-8px_rgba(6,17,47,0.55)] md:flex ${
        open ? "right-[464px]" : "left-1/2 -translate-x-1/2"
      }`}
    >
      <span>{notice.text}</span>
      {notice.undo && (
        <button
          onClick={() => {
            notice.undo!();
            setNotice(null);
          }}
          className="font-medium"
          style={{ color: AQUA }}
        >
          Undo
        </button>
      )}
    </div>
  );
  if (open)
    return (
      <>
        <AdvicePane
          onClose={close}
          say={say}
          onFollow={(it) => {
            setSpot(it);
            setOpen(false);
          }}
        />
        {toastEl}
      </>
    );
  if (spot)
    return (
      <>
        <Spotlight
          it={spot}
          onClose={() => {
            setSpot(null);
            void peek();
          }}
          onBack={() => {
            setSpot(null);
            setOpen(true);
          }}
          onFix={async () => {
            const it = spot;
            const r = await applyFix(it.id);
            if ("error" in r) return say(r.error);
            setSpot(null);
            say(r.done, () =>
              void r.undo().then((ok) => {
                if (!ok) say(UNDO_FAILED);
                void peek();
              }),
            );
            void peek();
          }}
          onDone={() => {
            const it = spot;
            setSpot(null);
            void patch(it.id, { action: "done" }).then((ok) => {
              if (!ok) return say("Couldn't save that — try again");
              say(`Done — ${it.title}`, () =>
                void patch(it.id, { action: "undo" }).then((ok) => {
                  if (!ok) say(UNDO_FAILED);
                  void peek();
                }),
              );
              void peek();
            });
          }}
        />
        {toastEl}
      </>
    );
  // Nothing to say on this page → no button at all (the tracker's rule).
  const here = splitByPage(refs, pageContext(pathname)).here;
  if (here.length === 0 && !missing) return toastEl || null;
  const count = here.filter((r) => r.kind === "now").length;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="&advice"
        aria-label={count ? `&advice — ${count} ${count === 1 ? "thing needs" : "things need"} you` : "&advice"}
        className="fixed bottom-6 right-6 z-40 hidden size-14 items-center justify-center rounded-full bg-[#06112f] shadow-[0_12px_30px_-8px_rgba(6,17,47,0.55)] transition-transform hover:scale-105 md:flex"
      >
        <span className="brand-amp w-6" style={{ backgroundColor: AQUA }} />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-[#ff8f7d] text-[11px] font-medium text-[#06112f] ring-2 ring-[var(--background)]">
            {count}
          </span>
        )}
      </button>
      {toastEl}
    </>
  );
}

function AdvicePane({
  onClose,
  say,
  onFollow,
}: {
  onClose: () => void;
  say: (text: string, undo?: () => void) => void;
  /** an in-app action link was followed: float that card over its page */
  onFollow: (it: AdviceRow) => void;
}) {
  const [view, setView] = useState<AdviceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdviceKind | "all">("all");
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const [wording, setWording] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const pathname = usePathname();
  const wordAsked = useRef(false);

  // "Review the tools" (v1.11.0): one Claude call per click; its cards replace the last review's.
  const runReview = async () => {
    setReviewing(true);
    setReviewError(null);
    const res = await fetch("/api/finance/advice/tools", { method: "POST" }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) setReviewError((j as { error?: string }).error ?? "Couldn't reach the server.");
    else {
      setView(j as AdviceView);
      setFilter("all");
    }
    setReviewing(false);
  };

  const load = useCallback(async () => {
    const res = await fetch("/api/finance/advice").catch(() => null);
    if (!res) return setError("Couldn't reach the server.");
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setError(j.error ?? "Something went wrong.");
    setError(null);
    setView(j as AdviceView);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // The P&L recomputes in the background on Overview and Plan; re-check when it lands.
  useEffect(() => {
    const onUpdated = () => void load();
    window.addEventListener(PNL_UPDATED, onUpdated);
    return () => window.removeEventListener(PNL_UPDATED, onUpdated);
  }, [load]);

  // The day's first open asks Claude for wording in the background (finance has
  // no crons — Nitsan, 2026-10-24); the cards change when it lands.
  useEffect(() => {
    if (!view?.wordingDue || wordAsked.current) return;
    wordAsked.current = true;
    setWording(true);
    void fetch("/api/finance/advice/word", { method: "POST" })
      .then(async (res) => (res.ok ? setView((await res.json()) as AdviceView) : null))
      .catch(() => null)
      .finally(() => setWording(false));
  }, [view?.wordingDue]);

  // The day's billing-mail scan (v1.12.0), in the background like the wording; the cards refresh when it lands.
  const [readingMail, setReadingMail] = useState(false);
  const mailAsked = useRef(false);
  useEffect(() => {
    if (!view?.mailDue || mailAsked.current) return;
    mailAsked.current = true;
    setReadingMail(true);
    void scanMail()
      .then((ok) => (ok ? load() : null))
      .finally(() => setReadingMail(false));
  }, [view?.mailDue, load]);


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const items = view?.items ?? [];
  // Hide at once; the server write follows, and the notice's Undo reverses it.
  const hide = (it: AdviceRow, body: object, text: string) => {
    setView((v) => (v ? { ...v, items: v.items.filter((x) => x.id !== it.id), hidden: v.hidden + 1 } : v));
    setSnoozing(null);
    void patch(it.id, body).then((ok) => {
      if (!ok) {
        say("Couldn't save that — try again");
        void load();
        return;
      }
      say(text, () =>
        void patch(it.id, { action: "undo" }).then((ok) => {
          if (!ok) say(UNDO_FAILED);
          void load();
        }),
      );
    });
  };

  // A card's one-click fix (v1.13.0): the change is made, the card goes, the notice can undo it.
  const [fixing, setFixing] = useState<string | null>(null);
  const runFix = async (it: AdviceRow) => {
    setFixing(it.id);
    const r = await applyFix(it.id);
    setFixing(null);
    if ("error" in r) return say(r.error);
    setView((v) => (v ? { ...v, items: v.items.filter((x) => x.id !== it.id) } : v));
    say(r.done, () =>
      void r.undo().then((ok) => {
        if (!ok) say(UNDO_FAILED);
        void load();
      }),
    );
  };

  const counts = (k: AdviceKind) => items.filter((i) => i.kind === k).length;
  const nowCount = counts("now");
  const shown = items.filter((i) => filter === "all" || i.kind === filter);
  const ctx = pageContext(pathname);
  const [showElsewhere, setShowElsewhere] = useState(false);
  const { here, elsewhere } = splitByPage(shown, ctx);
  // This page's own figures — none where none fit (the tracker's v1.81.0).
  const tiles = view ? tilesFor(view.pulse, ctx) : [];

  const card = (it: AdviceRow) => {
    const target = typeof it.facts.href === "string" ? it.facts.href : null;
    const external = !!target && target.startsWith("http");
    // A link to the page you're on is noise — unless it points at cells on it.
    const href = target && (external || target.split("?")[0] !== pathname || typeof it.facts.focus === "string") ? target : null;
    const action = typeof it.facts.action === "string" ? it.facts.action : null;
    const figure = typeof it.facts.figure === "string" ? it.facts.figure : null;
    const fix = fixOf(it);
    const linkClass = "inline-flex items-center gap-1.5 font-medium text-brand hover:underline";
    return (
      <li key={it.id} className="group/item relative mt-2 rounded-2xl bg-surface p-4 pr-20">
        <p className="mb-1.5 flex items-center gap-2 text-[12px] text-muted">
          <span className="size-2 rounded-full" style={{ background: TONE[it.kind] }} />
          {KIND_LABEL[it.kind]} · {it.area}
          {it.facts.changed === true && <span style={{ color: CORAL }}>· got worse</span>}
        </p>
        <p className="text-[15px] font-medium leading-5">{it.wordedTitle ?? it.title}</p>
        <p className="mt-1 text-[13px] leading-5 text-muted">{it.wordedBody ?? it.body}</p>
        {/* The rule's exact amount — Claude's wording never carries one (word.ts). */}
        {figure && (
          <p className="font-serif-accent mt-2 text-[22px] leading-none tabular-nums" style={{ color: it.kind === "now" ? CORAL : undefined }}>
            {figure}
          </p>
        )}
        {snoozing === it.id ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-muted">Snooze until</span>
            {(view ? snoozeOptions(view.today) : []).map((o) => (
              <button
                key={o.label}
                onClick={() => hide(it, { action: "snooze", until: o.until }, `Snoozed until ${dayLabel(o.until)}`)}
                className="rounded-full bg-[#1f2c57] px-2.5 py-1 hover:bg-[#2a3a6e]"
              >
                {o.label}
              </button>
            ))}
            <button onClick={() => setSnoozing(null)} className="px-1.5 text-faint hover:text-foreground">
              Cancel
            </button>
          </div>
        ) : (
          (href || it.isReminder || fix) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
              {fix && (
                <button onClick={() => void runFix(it)} disabled={fixing === it.id} className={FIX_CLASS} style={{ background: AQUA }}>
                  {fixing === it.id ? "Saving…" : fix.label}
                </button>
              )}
              {href && action &&
                (external ? (
                  <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
                    {action}
                    <StudioArrow size={14} up />
                  </a>
                ) : (
                  <Link href={href} onClick={() => onFollow(it)} className={linkClass}>
                    {action}
                    <StudioArrow size={14} />
                  </Link>
                ))}
              {it.isReminder && (
                <button onClick={() => hide(it, { action: "done" }, `Done — ${it.title}`)} className="inline-flex items-center gap-1.5 text-muted hover:text-foreground">
                  <Check size={14} strokeWidth={2} /> Mark done
                </button>
              )}
            </div>
          )
        )}
        {/* Snooze brings it back on a date; dismiss for good (the tracker's v1.81.0). Either returns early if it gets worse. */}
        <div className="absolute right-2.5 top-2.5 flex gap-0.5 opacity-40 transition-opacity group-hover/item:opacity-100">
          <button
            onClick={() => setSnoozing(snoozing === it.id ? null : it.id)}
            title="Snooze"
            aria-label="Snooze"
            className="flex size-7 items-center justify-center rounded-lg text-muted hover:bg-[#1f2c57] hover:text-foreground"
          >
            <Clock3 size={16} strokeWidth={1.75} />
          </button>
          <button
            onClick={() => hide(it, { action: "done" }, "Dismissed")}
            title="Dismiss — it comes back only if it gets worse"
            aria-label="Dismiss"
            className="flex size-7 items-center justify-center rounded-lg text-muted hover:bg-[#1f2c57] hover:text-foreground"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
      </li>
    );
  };

  return (
    <aside
      style={NIGHT}
      aria-label="&advice"
      className="fixed inset-y-0 right-0 z-40 hidden w-[440px] flex-col bg-background text-foreground shadow-[-24px_0_60px_-20px_rgba(6,17,47,0.5)] md:flex"
    >
      <header className="flex items-center gap-3 px-6 pb-4 pt-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft">
          <span className="brand-amp w-4" style={{ backgroundColor: AQUA }} />
        </span>
        {/* No date line: opening the pane IS the check, so it's always now (the tracker's v1.81.0). */}
        <p className="min-w-0 flex-1 text-[20px] font-medium leading-7">&amp;advice</p>
        <button onClick={onClose} aria-label="Close" className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-foreground">
          <X size={20} strokeWidth={1.75} />
        </button>
      </header>

      {error ? (
        <div className="px-6">
          <p className="rounded-2xl bg-surface p-4 text-sm text-muted">{error}</p>
        </div>
      ) : !view ? (
        <div className="flex animate-pulse flex-col gap-2 px-6">
          <div className="h-8 w-56 rounded-lg bg-surface" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[92px] rounded-xl bg-surface" />
            ))}
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="mt-2 h-28 rounded-2xl bg-surface" />
          ))}
        </div>
      ) : (
        <>
          <div className="px-6">
            <p className="text-[22px] leading-8">
              {nowCount ? (
                <>
                  <span className="font-serif-accent">
                    {nowCount} {nowCount === 1 ? "thing needs" : "things need"}
                  </span>{" "}
                  you today.
                </>
              ) : (
                "Nothing urgent today."
              )}
            </p>
            {tiles.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {tiles.map((p, i, all) => (
                  // An odd last tile spans the row rather than leaving a hole beside it.
                  <Tile key={p.label} p={p} wide={all.length % 2 === 1 && i === all.length - 1} right={i % 2 === 1} />
                ))}
              </div>
            )}
            <div className="mt-5 flex gap-1 rounded-xl bg-surface p-1 text-[13px]">
              {(["all", "now", "heads", "idea"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`flex-1 rounded-lg py-1.5 ${filter === k ? "bg-[#1f2c57] font-medium text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  {k === "all" ? `All ${items.length}` : `${FILTER_LABEL[k]} ${counts(k)}`}
                </button>
              ))}
            </div>
          </div>

          <ul className="mt-3 flex-1 overflow-y-auto px-6 pb-6">
            {shown.length === 0 && (
              <li className="mt-6 flex flex-col items-center gap-2 text-sm text-muted">
                <span className="flex size-10 items-center justify-center rounded-xl bg-surface" style={{ color: AQUA }}>
                  {filter === "idea" ? <Lightbulb size={20} strokeWidth={1.75} /> : <Check size={20} strokeWidth={1.75} />}
                </span>
                {filter === "idea" ? "No ideas today." : "All clear."}
              </li>
            )}
            {pathname.startsWith("/finance/expenses") && (
              <li className="mt-2 rounded-2xl border border-border p-4">
                <p className="flex items-center gap-2 text-[14px] font-medium">
                  <Sparkles size={15} strokeWidth={1.75} style={{ color: AQUA }} />
                  Review the studio&apos;s tools
                </p>
                <p className="mt-1 text-[13px] leading-5 text-muted">
                  {view.review?.summary ??
                    "Claude looks over every live subscription and says what to cancel, merge, switch or downgrade. It sees names and plans, never an amount."}
                </p>
                <div className="mt-3 flex items-center gap-3 text-[13px]">
                  <button
                    onClick={() => void runReview()}
                    disabled={!view.reviewOn || reviewing}
                    className="rounded-full bg-brand px-3.5 py-1.5 font-medium text-background hover:opacity-90 disabled:opacity-50"
                  >
                    {reviewing ? "Reviewing…" : view.review && !view.review.error ? "Review again" : "Review now"}
                  </button>
                  <span className="text-faint">
                    {!view.reviewOn
                      ? "Needs a Claude API key"
                      : reviewing
                        ? "about a minute"
                        : view.review
                          ? `${view.review.error ? "Last try failed" : "Last review"} ${dayLabel(view.review.at.slice(0, 10))}`
                          : ""}
                  </span>
                </div>
                {reviewError && (
                  <p className="mt-2 text-[12px]" style={{ color: CORAL }}>
                    {reviewError}
                  </p>
                )}
              </li>
            )}
            {ctx.all || shown.length === 0 ? (
              shown.map(card)
            ) : (
              <>
                <li className="mt-1 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Here · {ctx.label}</li>
                {here.length ? here.map(card) : <li className="mt-2 rounded-2xl bg-surface px-4 py-3 text-[13px] text-muted">Nothing about this page today.</li>}
                {elsewhere.length > 0 && (
                  <li className="mt-5">
                    <button
                      onClick={() => setShowElsewhere((v) => !v)}
                      aria-expanded={showElsewhere}
                      className="flex w-full items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-muted hover:text-foreground"
                    >
                      Elsewhere · {elsewhere.length}
                      <ChevronDown size={14} strokeWidth={2} className={`transition-transform ${showElsewhere ? "rotate-180" : ""}`} />
                    </button>
                  </li>
                )}
                {showElsewhere && elsewhere.map(card)}
              </>
            )}
          </ul>
          <footer className="flex items-center justify-between gap-3 border-t border-border px-6 py-3 text-[12px] text-faint">
            <span>
              {wording
                ? "Wording today's advice…"
                : readingMail
                  ? "Reading billing mail…"
                  : (view.wordingOff ?? "Claude words it; the amounts are the app's own")}
            </span>
            {view.hidden > 0 && <span>{view.hidden} snoozed or dismissed</span>}
          </footer>
        </>
      )}
    </aside>
  );
}

/**
 * One figure. Hovering (or focusing) it opens a box saying what it is and how
 * it's counted — anchored to the tile's outer edge so it never leaves the pane.
 */
function Tile({ p, wide, right }: { p: PulseTile; wide: boolean; right: boolean }) {
  const color = p.good ? AQUA : CORAL;
  return (
    <div tabIndex={0} className={`group/tile relative cursor-help rounded-xl bg-surface px-3.5 py-3 outline-none ${wide ? "col-span-2" : ""}`}>
      <p className="flex items-center gap-1.5 text-[12px] text-muted">
        <span className="truncate">{p.label}</span>
        <Info size={12} strokeWidth={2} className="shrink-0 text-faint" />
      </p>
      <p className="font-serif-accent mt-1.5 text-[26px] leading-none tabular-nums" style={p.display != null && !p.good ? { color } : undefined}>
        {p.display ?? "–"}
      </p>
      {p.series.length >= 2 && <Spark series={p.series} color={color} />}
      <p className="mt-1 truncate text-[11px] text-faint">{p.note}</p>
      <div
        role="tooltip"
        className={`pointer-events-none absolute top-full z-10 mt-1.5 w-[260px] rounded-xl bg-[#1f2c57] px-3.5 py-3 text-[12px] leading-[18px] text-foreground opacity-0 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.6)] transition-opacity group-hover/tile:opacity-100 group-focus/tile:opacity-100 ${right && !wide ? "right-0" : "left-0"}`}
      >
        {p.help}
      </div>
    </div>
  );
}

function Spark({ series, color }: { series: number[]; color: string }) {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-1 h-7 w-full opacity-70" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The page's elements an item points at: `data-advice` holds space-separated tokens. */
const spotSelector = (tokens: string[]) => tokens.map((t) => `[data-advice~="${t.replace(/["\\]/g, "")}"]`).join(",");

/**
 * A followed card, floating bottom-right over its page while the cells it
 * talks about are lit up (Nitsan, 2026-10-25: "highlight what I should look
 * at, and keep the comment while I look at the numbers"). The highlight is a
 * style rule on the cells' `data-advice` tokens, so it survives the grid
 * loading late or re-rendering. It closes by itself on leaving the page.
 * An outline only, so the cell's own state colour still shows through; with
 * several places, ‹ › steps through them. It moves to the left when what it
 * points at is under it, and on a phone it's a folded bar along the bottom.
 */
function Spotlight({ it, onClose, onBack, onDone, onFix }: { it: AdviceRow; onClose: () => void; onBack: () => void; onDone: () => void; onFix: () => Promise<void> }) {
  const fix = fixOf(it);
  const [fixing, setFixing] = useState(false);
  const pathname = usePathname();
  const phone = usePhone();
  const [small, setSmall] = useState(phone);
  const [found, setFound] = useState<number | null>(null);
  const [at, setAt] = useState(0);
  const [left, setLeft] = useState(false);
  const places = useRef<Element[]>([]);
  const target = typeof it.facts.href === "string" ? it.facts.href.split("?")[0] : null;
  const tokens = typeof it.facts.focus === "string" ? it.facts.focus.split(" ").filter(Boolean) : [];
  // Rows and boxes are what to look at; a month column only frames them.
  const cells = tokens.filter((t) => !t.startsWith("month:"));
  const months = tokens.filter((t) => t.startsWith("month:"));
  const figure = typeof it.facts.figure === "string" ? it.facts.figure : null;
  const arrived = useRef(false);

  // Leaving the page it points at closes it (the link lands a moment after the click).
  useEffect(() => {
    if (pathname === target) arrived.current = true;
    else if (arrived.current) onClose();
  }, [pathname, target, onClose]);

  /** Bring place `i` into view; the note steps aside if it would cover it. */
  function show(i: number) {
    const el = places.current[i];
    if (!el) return;
    setAt(i);
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    // After the smooth scroll settles: under the note's corner → note goes left.
    window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      setLeft(r.right > window.innerWidth - 420 && r.bottom > window.innerHeight - 320);
    }, 500);
  }

  // The grid loads after the page: look for the cells for a while, then bring the first into view.
  useEffect(() => {
    if (!cells.length || pathname !== target) return;
    const sel = spotSelector(cells);
    let tries = 0;
    const t = window.setInterval(() => {
      const els = document.querySelectorAll(sel);
      if (els.length || ++tries > 40) {
        window.clearInterval(t);
        places.current = [...els];
        setFound(els.length);
        show(0);
      }
    }, 250);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the tokens are fixed for this item
  }, [it.id, pathname, target]);

  // No Esc here: on a grid, Esc clears the cell selection, and it must not
  // also close the note you're working from. Its ✕ closes it.

  const css =
    (cells.length
      ? `${spotSelector(cells)}{outline:2px solid var(--brand)!important;outline-offset:-2px;animation:advice-spot 1.1s ease-in-out 3}`
      : "") +
    // A month column frames the cells the same way: a brand line, no fill.
    (months.length ? `${spotSelector(months)}{color:var(--brand)!important;box-shadow:inset 0 -2px 0 var(--brand)}` : "") +
    `@keyframes advice-spot{50%{outline-color:${AQUA}}}`;

  return (
    <>
      {tokens.length > 0 && <style>{css}</style>}
      <aside
        style={NIGHT}
        aria-label="&advice note"
        className={`fixed inset-x-3 bottom-3 z-40 rounded-2xl bg-background text-foreground shadow-[0_18px_44px_-12px_rgba(6,17,47,0.6)] md:inset-x-auto md:bottom-6 ${left ? "md:left-6" : "md:right-6"} ${small ? "md:w-[300px]" : "md:w-[380px]"}`}
      >
        <div className="flex items-center gap-2 px-4 pt-3 text-[12px] text-muted">
          <span className="brand-amp w-3" style={{ backgroundColor: AQUA }} />
          <span className="size-2 rounded-full" style={{ background: TONE[it.kind] }} />
          <span className="min-w-0 flex-1 truncate">
            {KIND_LABEL[it.kind]} · {it.area}
          </span>
          <button onClick={() => setSmall((v) => !v)} title={small ? "Show the note" : "Fold the note"} aria-label={small ? "Show the note" : "Fold the note"} className="flex size-7 items-center justify-center rounded-lg hover:bg-surface hover:text-foreground">
            {small ? <ChevronDown size={16} strokeWidth={1.75} className="rotate-180" /> : <Minus size={16} strokeWidth={1.75} />}
          </button>
          <button onClick={onClose} title="Close — the advice stays in &advice" aria-label="Close" className="flex size-7 items-center justify-center rounded-lg hover:bg-surface hover:text-foreground">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="px-4 pb-4 pt-1.5">
          <p className={`text-[15px] font-medium leading-5 ${small ? "truncate" : ""}`}>{it.wordedTitle ?? it.title}</p>
          {!small && (
            <>
              <p className="mt-1 text-[13px] leading-5 text-muted">{it.wordedBody ?? it.body}</p>
              {figure && (
                <p className="font-serif-accent mt-2 text-[22px] leading-none tabular-nums" style={{ color: it.kind === "now" ? CORAL : undefined }}>
                  {figure}
                </p>
              )}
              {cells.length > 0 && found != null && (
                <div role="status" className="mt-2 flex items-center gap-2 text-[12px]" style={{ color: found ? AQUA : CORAL }}>
                  <span className="min-w-0 flex-1">
                    {found ? `Highlighted on the page${found > 1 ? ` · ${at + 1} of ${found}` : ""}` : "Couldn't find it on the page — a hidden row, or another year?"}
                  </span>
                  {found > 1 && (
                    <>
                      <button onClick={() => show((at - 1 + found) % found)} aria-label="Previous place" className="flex size-6 items-center justify-center rounded-md hover:bg-surface">
                        <ChevronLeft size={15} strokeWidth={1.75} />
                      </button>
                      <button onClick={() => show((at + 1) % found)} aria-label="Next place" className="flex size-6 items-center justify-center rounded-md hover:bg-surface">
                        <ChevronRight size={15} strokeWidth={1.75} />
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
                {fix && (
                  <button
                    onClick={() => {
                      setFixing(true);
                      void onFix().finally(() => setFixing(false));
                    }}
                    disabled={fixing}
                    className={FIX_CLASS}
                    style={{ background: AQUA }}
                  >
                    {fixing ? "Saving…" : fix.label}
                  </button>
                )}
                <button onClick={onBack} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                  Back to &amp;advice
                </button>
                {it.isReminder && (
                  <button onClick={onDone} className="inline-flex items-center gap-1.5 text-muted hover:text-foreground">
                    <Check size={14} strokeWidth={2} /> Mark done
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
