"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Info, Lightbulb, Minus, RotateCw, Sparkles, TrendingDown, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { StudioArrow } from "./studio-arrow";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";
import { toast } from "@/lib/toast";
import { parseISO, shiftDays, toISODate } from "@/lib/format";
import { useDataMaybe } from "@/lib/store";
import type { AdviceRow } from "@/lib/advice/merge";
import type { AdviceKind, FindingLink } from "@/lib/advice/signals";
import type { AdviceView, PaneTile } from "@/lib/advice/run";
import { pageContext, splitByPage, tilesFor } from "@/lib/advice/context";
import type { Fix } from "@/lib/finance/advice/signals";
import { applyFix, scanMail } from "@/lib/finance/advice/client";
import { PNL_UPDATED } from "@/lib/finance/auto-rollup";
import { usePhone } from "@/lib/finance/use-phone";

/**
 * &advice — the owner's advisor, ONE pane for the whole app since the finance
 * merge (stage 4). It was two: the tracker's (v1.80.0, percentages only) and
 * finance's (its v1.6.0, with amounts), each reading half the studio. Closed, a
 * round Studio Black button with the aqua ampersand in the bottom-right corner;
 * open, a 440px pane over the page. Picked on /design-lab/advisor (option A
 * "Night briefing", with C's corner button — Nitsan, 2026-10-24).
 *
 * ⚠️ IT SHOWS AMOUNTS, ON EVERY PAGE. So it is the OWNER's alone — AppShell
 * mounts it only for that tier and never while previewing someone, and the API
 * answers 403 to anyone else, and then nothing renders. With "Hide numbers" on
 * (finance's switch) every digit in it is smudged, wherever it is open.
 *
 * ⚠️ ITS OWN COLOUR SCHEME IS TOKEN OVERRIDES on the pane's root (`NIGHT`), so
 * the app's classes — card-title, text-muted, bg-surface, EmptyState — follow
 * it. It's a sibling of `.app-canvas`, so the canvas's card rules don't reach in.
 *
 * Not a second dashboard (Nitsan, 2026-10-25): what a page already shows stays
 * on the page. The figures are the page's own, each with a hover box saying
 * what it is, and the cards read figures from different pages together.
 * Desktop only for now.
 */

const NIGHT: CSSProperties = {
  ["--foreground" as string]: "#ffffff",
  ["--muted" as string]: "#aab4d4",
  ["--faint" as string]: "#7c88ad",
  ["--surface" as string]: "#101c44",
  ["--surface-2" as string]: "#13225a",
  ["--background" as string]: "#06112f",
  ["--border" as string]: "#1f2c57",
  ["--track" as string]: "#1f2c57",
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
  const res = await fetch(`/api/advice/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return !!res?.ok;
}
/** An Undo that failed says so — it used to reload as if it had worked. */
const UNDO_FAILED = "Couldn't undo that — try again";

/**
 * The snooze choices, in the studio's week (Sun–Thu): the next workday, the
 * start of the week after it, and two weeks. Never a Friday or Saturday, and
 * never two buttons for one date (on a Saturday "tomorrow" IS Sunday).
 */
export function snoozeOptions(today: string): { label: string; until: string }[] {
  const d = parseISO(today);
  let next = shiftDays(d, 1);
  while (next.getDay() > 4) next = shiftDays(next, 1);
  const nextWeek = shiftDays(next, 7 - next.getDay());
  let twoWeeks = shiftDays(d, 14);
  while (twoWeeks.getDay() > 4) twoWeeks = shiftDays(twoWeeks, 1);
  const name = next.toLocaleDateString("en-GB", { weekday: "long" });
  return [
    { label: toISODate(next) === toISODate(shiftDays(d, 1)) ? "Tomorrow" : name, until: toISODate(next) },
    { label: "Next week", until: toISODate(nextWeek) },
    { label: "In 2 weeks", until: toISODate(twoWeeks) },
  ];
}
const dayLabel = (iso: string) => parseISO(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** The card's one-click fix, if it has one (finance's `Fix`, stored as JSON in its facts). */
function fixOf(it: AdviceRow): Fix | null {
  if (typeof it.facts.fix !== "string") return null;
  try {
    return JSON.parse(it.facts.fix) as Fix;
  } catch {
    return null;
  }
}
const FIX_CLASS = "rounded-full px-3.5 py-1.5 text-[13px] font-medium text-[#06112f] hover:opacity-90 disabled:opacity-50";

type ItemRef = { signal: string; clientId: string | null; kind: AdviceKind };

/**
 * The page you're on, as &advice sees it. `useSearchParams` follows a page that
 * keeps its state in the address (Client Reports' tab, written with
 * `replaceState`, which Next keeps in sync) — no page has to announce itself.
 * It needs a Suspense boundary, which AppShell gives <Advice />.
 */
function usePageContext() {
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.toString();
  return { ...pageContext(pathname, search ? `?${search}` : ""), pathname, params };
}

/** Is `href` the page you're on — same path, same query, in any order? */
function isCurrent(href: string, pathname: string, params: URLSearchParams): boolean {
  const url = new URL(href, "http://x");
  if (url.pathname !== pathname) return false;
  const a = [...url.searchParams].sort().join("&");
  const b = [...params].sort().join("&");
  return a === b;
}

/**
 * "Hide numbers" (finance's switch, lib key `finance-privacy-hold`) holds here
 * too. On finance's pages PrivacyBlur smudges the amounts itself; anywhere else
 * nothing is running to do it, so the pane smudges every digit it shows
 * (`advice-hold`, globals.css).
 */
function useHold(pathname: string): boolean {
  const [hold, setHold] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once per page, from storage
      setHold(window.localStorage.getItem("finance-privacy-hold") === "1");
    } catch {
      setHold(false);
    }
  }, [pathname]);
  return hold && !pathname.startsWith("/finance");
}

/** A card whose link stays in the money pages floats over them while you look (finance's Spotlight). */
const floats = (it: AdviceRow, target: string) => typeof it.facts.focus === "string" || target.startsWith("/finance");

export function Advice() {
  const [allowed, setAllowed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [refs, setRefs] = useState<ItemRef[]>([]);
  const [open, setOpen] = useState(false);
  // The card whose link was followed: it floats over the page, its cells lit up.
  const [spot, setSpot] = useState<AdviceRow | null>(null);
  const ctx = usePageContext();
  const hold = useHold(ctx.pathname);
  const peekRef = useRef<(fresh?: boolean) => Promise<void>>(async () => {});
  // ⚠️ ONE retry timer: every failed peek used to start its own 60s loop, so an
  // outage stacked them (one more per close) and they outlived the button.
  const retryRef = useRef<number | null>(null);

  const peek = useCallback(async (fresh = false) => {
    const res = await fetch(`/api/advice?peek=1${fresh ? "&fresh=1" : ""}`).catch(() => null);
    // Only "not signed in" or "not the owner" hides the button. Anything else
    // (a blip, a 500) keeps what we had and tries again in a minute.
    const retry = () => {
      if (retryRef.current != null) window.clearTimeout(retryRef.current);
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null;
        void peekRef.current();
      }, 60_000);
    };
    if (!res) return void retry();
    // 503 = a table isn't there yet: the owner still gets the button, to see why.
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
    // The billing mail is read in the background from any page when it's due; then check again.
    if (j.mailDue) void scanMail().then((ok) => (ok ? peekRef.current(true) : undefined));
  }, []);
  useEffect(() => {
    peekRef.current = peek;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one fetch on mount
    void peek();
    return () => {
      if (retryRef.current != null) window.clearTimeout(retryRef.current);
    };
  }, [peek]);
  const close = useCallback(() => {
    setOpen(false);
    void peek();
  }, [peek]);
  const closeSpot = useCallback(() => {
    setSpot(null);
    void peek();
  }, [peek]);

  if (!allowed) return null;
  if (open)
    return (
      <AdvicePane
        hold={hold}
        onClose={close}
        onFollow={(it, target) => {
          if (floats(it, target)) setSpot(it);
          setOpen(false);
        }}
      />
    );
  if (spot)
    return (
      <Spotlight
        it={spot}
        hold={hold}
        onClose={closeSpot}
        onBack={() => {
          setSpot(null);
          setOpen(true);
        }}
        onFix={async () => {
          const r = await applyFix(spot.id);
          if ("error" in r) return toast(r.error, { tone: "info" });
          setSpot(null);
          toast(r.done, {
            onUndo: () =>
              void r.undo().then((ok) => {
                if (!ok) toast(UNDO_FAILED, { tone: "info" });
                void peek();
              }),
          });
          void peek();
        }}
        onDone={() => {
          const it = spot;
          setSpot(null);
          void patch(it.id, { action: "done" }).then((ok) => {
            if (!ok) return toast("Couldn't save that — try again", { tone: "info" });
            toast(`Done — ${it.title}`, {
              onUndo: () =>
                void patch(it.id, { action: "undo" }).then((undone) => {
                  if (!undone) toast(UNDO_FAILED, { tone: "info" });
                  void peek();
                }),
            });
            void peek();
          });
        }}
      />
    );
  // Nothing to say on this page → no button at all (Nitsan, 2026-10-24). Home
  // owns every item, so there it shows whenever anything waits.
  const here = splitByPage(refs, ctx).here;
  if (here.length === 0 && !missing) return null;
  const count = here.filter((r) => r.kind === "now").length;
  return (
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
  );
}

/** "14:32", Israel time — the studio's clock wherever the laptop is. */
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
/** "Sun", for a time on another day than the check. */
const weekday = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", timeZone: "Asia/Jerusalem" });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });

/** "Checked 14:32 · worded 07:40" — the check is live, the wording is the day's first open. */
function checkedLine(view: AdviceView): string {
  const parts = [`Checked ${clock(view.checkedAt)}`];
  if (view.wordedAt) {
    const sameDay = dayOf(view.wordedAt) === dayOf(view.checkedAt);
    parts.push(`worded ${sameDay ? "" : weekday(view.wordedAt) + " "}${clock(view.wordedAt)}`);
  }
  return parts.join(" · ");
}

function AdvicePane({
  hold,
  onClose,
  onFollow,
}: {
  hold: boolean;
  onClose: () => void;
  /** an in-app action link was followed: the pane closes, and a money card floats over its page */
  onFollow: (it: AdviceRow, target: string) => void;
}) {
  const [view, setView] = useState<AdviceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdviceKind | "all">("all");
  const [snoozing, setSnoozing] = useState<string | null>(null);
  /** cards whose list is shown in full */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [wording, setWording] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const wordAsked = useRef(false);
  const openTask = useDataMaybe()?.openTask;

  /** a check is running — the refresh icon spins while the cards stay put */
  const [checking, setChecking] = useState(false);
  const load = useCallback(async () => {
    setChecking(true);
    const res = await fetch("/api/advice").catch(() => null);
    setChecking(false);
    if (!res) return setError("Couldn't reach the tracker.");
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setError(j.error ?? "Something went wrong.");
    setError(null);
    setView(j as AdviceView);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the open IS the refresh
    void load();
  }, [load]);
  // The P&L recomputes in the background on finance's Overview and Plan; re-check when it lands.
  useEffect(() => {
    const onUpdated = () => void load();
    window.addEventListener(PNL_UPDATED, onUpdated);
    return () => window.removeEventListener(PNL_UPDATED, onUpdated);
  }, [load]);

  // "Review the business": Claude reads the studio as a consultant would — one call per click.
  const [consulting, setConsulting] = useState(false);
  const [consultError, setConsultError] = useState<string | null>(null);
  const runBusiness = async () => {
    setConsulting(true);
    setConsultError(null);
    const res = await fetch("/api/advice/business", { method: "POST" }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) setConsultError((j as { error?: string }).error ?? "Couldn't reach the server.");
    else {
      setView(j as AdviceView);
      setFilter("idea");
    }
    setConsulting(false);
  };

  // "Review the tools" (finance's v1.11.0): one Claude call per click; its cards replace the last review's.
  const runReview = async () => {
    setReviewing(true);
    setReviewError(null);
    const res = await fetch("/api/advice/tools", { method: "POST" }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) setReviewError((j as { error?: string }).error ?? "Couldn't reach the server.");
    else {
      setView(j as AdviceView);
      setFilter("all");
    }
    setReviewing(false);
  };

  // The day's first open asks Claude for wording in the background (there is
  // no cron step — Nitsan, 2026-10-24); the cards change when it lands.
  useEffect(() => {
    if (!view?.wordingDue || wordAsked.current) return;
    wordAsked.current = true;
    setWording(true);
    void fetch("/api/advice/word", { method: "POST" })
      .then(async (res) => (res.ok ? setView((await res.json()) as AdviceView) : null))
      .catch(() => null)
      .finally(() => setWording(false));
  }, [view?.wordingDue]);

  // The billing-mail scan, in the background like the wording; the cards refresh when it lands.
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

  const items = view?.items ?? [];
  // `onClose` is stable (useCallback in <Advice />), so this listener is set once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Hide at once; the server write follows, and the toast's Undo reverses it.
  const hide = (it: AdviceRow, body: object, text: string, tone: "done" | "info") => {
    setView((v) => (v ? { ...v, items: v.items.filter((x) => x.id !== it.id), hidden: v.hidden + 1 } : v));
    setSnoozing(null);
    void patch(it.id, body).then((ok) => {
      if (!ok) {
        toast("Couldn't save that — try again", { tone: "info" });
        void load();
        return;
      }
      toast(text, {
        tone,
        onUndo: () =>
          void patch(it.id, { action: "undo" }).then((undone) => {
            if (!undone) toast(UNDO_FAILED, { tone: "info" });
            void load();
          }),
      });
    });
  };

  // A card's one-click fix (finance's v1.13.0): the change is made, the card goes, the toast can undo it.
  const [fixing, setFixing] = useState<string | null>(null);
  const runFix = async (it: AdviceRow) => {
    setFixing(it.id);
    const r = await applyFix(it.id);
    setFixing(null);
    if ("error" in r) return toast(r.error, { tone: "info" });
    setView((v) => (v ? { ...v, items: v.items.filter((x) => x.id !== it.id) } : v));
    toast(r.done, {
      onUndo: () =>
        void r.undo().then((ok) => {
          if (!ok) toast(UNDO_FAILED, { tone: "info" });
          void load();
        }),
    });
  };

  const counts = (k: AdviceKind) => items.filter((i) => i.kind === k).length;
  const nowCount = counts("now");
  const shown = items.filter((i) => filter === "all" || i.kind === filter);

  // The page you're on decides what comes first (Nitsan, 2026-10-24): Home owns
  // everything; a client's page or its Client Reports tab puts that client
  // first; finance's Overview everything about money; the rest folds under
  // "Elsewhere".
  const ctx = usePageContext();
  const [showElsewhere, setShowElsewhere] = useState(false);
  const { here, elsewhere } = splitByPage(shown, ctx);
  // The figures of the page you're on — none where none fit (Nitsan, 2026-10-25).
  const tiles = view ? tilesFor(view.pulse, ctx) : [];
  const clientName = ctx.clientId ? items.find((i) => i.clientId === ctx.clientId && typeof i.facts.client === "string")?.facts.client : null;
  const hereLabel = typeof clientName === "string" ? clientName : ctx.label;

  const card = (it: AdviceRow) => {
    const target = typeof it.facts.href === "string" ? it.facts.href : null;
    const external = !!target && target.startsWith("http");
    // A link to the page you're already on is noise ("Open the weekly plan" on
    // the plan) — unless it points at cells on it. Query included, so another
    // client's item on Client Reports still links to its tab.
    const href = target && (external || typeof it.facts.focus === "string" || !isCurrent(target, ctx.pathname, ctx.params)) ? target : null;
    const action = typeof it.facts.action === "string" ? it.facts.action : null;
    const figure = typeof it.facts.figure === "string" ? it.facts.figure : null;
    const fix = fixOf(it);
    const list = (Array.isArray(it.facts.list) ? it.facts.list : []) as FindingLink[];
    const full = expanded.has(it.id);
    const linkClass = "inline-flex items-center gap-1.5 font-medium text-brand hover:underline";
    return (
      <li key={it.id} className="group/item relative mt-2 rounded-2xl bg-surface p-4 pr-20">
        <p className="mb-1.5 flex items-center gap-2 text-[12px] text-muted">
          <span className="size-2 rounded-full" style={{ background: TONE[it.kind] }} />
          {KIND_LABEL[it.kind]} · {it.area}
          {it.facts.changed === true && <span style={{ color: CORAL }}>· got worse</span>}
        </p>
        <p className="bidi-auto text-[15px] font-medium leading-5">{it.wordedTitle ?? it.title}</p>
        <p className="bidi-auto mt-1 text-[13px] leading-5 text-muted">{it.wordedBody ?? it.body}</p>
        {/* The rule's exact amount — Claude's wording never carries one (word.ts). */}
        {figure && (
          <p className="font-serif-accent mt-2 text-[22px] leading-none tabular-nums" style={{ color: it.kind === "now" ? CORAL : undefined }}>
            {figure}
          </p>
        )}
        {list.length > 0 && (
          <ul className="-mx-2 mt-2.5">
            {(full ? list : list.slice(0, LIST_SHOWN)).map((l, i) => (
              <li key={l.taskId ?? l.href ?? i}>
                <ListLink link={l} onOpenTask={openTask} onClose={onClose} />
              </li>
            ))}
            {list.length > LIST_SHOWN && (
              <li>
                <button
                  onClick={() =>
                    setExpanded((s) => {
                      const next = new Set(s);
                      if (full) next.delete(it.id);
                      else next.add(it.id);
                      return next;
                    })
                  }
                  className="px-2 py-1 text-[12px] text-muted hover:text-foreground"
                >
                  {full ? "Show fewer" : `Show all ${list.length}`}
                </button>
              </li>
            )}
          </ul>
        )}
        {snoozing === it.id ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-muted">Snooze until</span>
            {(view ? snoozeOptions(view.today) : []).map((o) => (
              <button
                key={o.label}
                onClick={() => hide(it, { action: "snooze", until: o.until }, `Snoozed until ${dayLabel(o.until)}`, "info")}
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
              {href &&
                action &&
                (external ? (
                  <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
                    {action}
                    <StudioArrow size={14} up />
                  </a>
                ) : (
                  <Link href={href} onClick={() => onFollow(it, href)} className={linkClass}>
                    {action}
                    <StudioArrow size={14} />
                  </Link>
                ))}
              {it.isReminder && (
                <button
                  onClick={() => hide(it, { action: "done" }, `Done — ${it.title}`, "done")}
                  className="inline-flex items-center gap-1.5 text-muted hover:text-foreground"
                >
                  <Check size={14} strokeWidth={2} /> Mark done
                </button>
              )}
            </div>
          )
        )}
        {/* Snooze brings it back on a date; dismiss for good (2026-10-25). Either returns early if it gets worse. */}
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
            onClick={() => hide(it, { action: "done" }, "Dismissed", "info")}
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
      className={`advice-pane fixed inset-y-0 right-0 z-40 hidden w-[440px] flex-col bg-background text-foreground shadow-[-24px_0_60px_-20px_rgba(6,17,47,0.5)] md:flex ${hold ? "advice-hold" : ""}`}
    >
      <header className="flex items-center gap-3 px-6 pb-4 pt-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft">
          <span className="brand-amp w-4" style={{ backgroundColor: AQUA }} />
        </span>
        {/*
          Opening the pane IS the check, but the time is shown anyway (Nitsan,
          2026-11-10): a note that outlived a fix should say how old it is, and
          the wording comes from the day's first open, not from this check.
        */}
        <div className="min-w-0 flex-1">
          <p className="card-title">&amp;advice</p>
          {view && <p className="text-[12px] leading-4 text-faint">{checkedLine(view)}</p>}
        </div>
        <button
          onClick={() => void load()}
          disabled={checking}
          aria-label="Check again"
          title="Check again"
          className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-foreground disabled:hover:bg-transparent"
        >
          <RotateCw size={18} strokeWidth={1.75} className={checking ? "animate-spin" : ""} />
        </button>
        <button onClick={onClose} aria-label="Close" className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-foreground">
          <X size={20} strokeWidth={1.75} />
        </button>
      </header>

      {error ? (
        <div className="px-6">
          <p className="rounded-2xl bg-surface p-4 text-sm text-muted">{error}</p>
        </div>
      ) : !view ? (
        <div className="flex flex-col gap-2 px-6">
          <Skeleton className="h-8 w-56 rounded-lg" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[92px] rounded-xl" />
            ))}
          </div>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="mt-2 h-28 rounded-2xl" />
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
                  <Tile key={`${p.scope}:${p.label}`} p={p} wide={all.length % 2 === 1 && i === all.length - 1} right={i % 2 === 1} />
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
              <EmptyState icon={filter === "idea" ? Lightbulb : Check} tone="success" text={filter === "idea" ? "No ideas today." : "All clear."} compact />
            )}
            {/* The consultant's read of the whole studio — on Home and on finance's Overview, where the whole picture is. */}
            {(ctx.pathname === "/" || ctx.pathname === "/finance") && (
              <li className="mt-2 rounded-2xl border border-border p-4">
                <p className="flex items-center gap-2 text-[14px] font-medium">
                  <Sparkles size={15} strokeWidth={1.75} style={{ color: AQUA }} />
                  Review the business
                </p>
                <p className="bidi-auto mt-1 text-[13px] leading-5 text-muted">
                  {view.business?.summary ??
                    "Claude reads the last three months the way a business consultant would — price, team size, which clients are worth the hours, costs, tax timing — and says what it would do. It sees shares, percentages and hours, never an amount."}
                </p>
                {!!view.business?.questions.length && (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] leading-5 text-muted">
                    {view.business.questions.map((q) => (
                      <li key={q} className="bidi-auto">
                        {q}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex items-center gap-3 text-[13px]">
                  <button
                    onClick={() => void runBusiness()}
                    disabled={!view.reviewOn || !view.businessReady || consulting}
                    className="rounded-full bg-brand px-3.5 py-1.5 font-medium text-background hover:opacity-90 disabled:opacity-50"
                  >
                    {consulting ? "Reviewing…" : view.business && !view.business.error ? "Review again" : "Review now"}
                  </button>
                  <span className="text-faint">
                    {!view.reviewOn
                      ? "Needs a Claude API key"
                      : !view.businessReady
                        ? "The last three months aren't booked yet"
                        : consulting
                          ? "about a minute"
                          : view.business
                            ? `${view.business.error ? "Last try failed" : "Last review"} ${dayLabel(dayOf(view.business.at))}`
                            : ""}
                  </span>
                </div>
                {consultError && (
                  <p className="mt-2 text-[12px]" style={{ color: CORAL }}>
                    {consultError}
                  </p>
                )}
              </li>
            )}
            {ctx.pathname.startsWith("/finance/expenses") && (
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
                          ? `${view.review.error ? "Last try failed" : "Last review"} ${dayLabel(dayOf(view.review.at))}`
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
                <li className="mt-1 text-[12px] font-medium uppercase tracking-[0.08em] text-muted">Here · {hereLabel}</li>
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
              {wording ? "Wording today's advice…" : readingMail ? "Reading billing mail…" : (view.wordingOff ?? "Claude words it; the amounts are the app's own")}
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
 * it's counted (Nitsan, 2026-10-25) — anchored to the tile's outer edge so it
 * never leaves the pane.
 */
function Tile({ p, wide, right }: { p: PaneTile; wide: boolean; right: boolean }) {
  const color = p.good ? AQUA : CORAL;
  return (
    <div tabIndex={0} className={`group/tile relative cursor-help rounded-xl bg-surface px-3.5 py-3 outline-none ${wide ? "col-span-2" : ""}`}>
      <p className="flex items-center gap-1.5 text-[12px] text-muted">
        <span className="truncate">{p.label}</span>
        <Info size={12} strokeWidth={2} className="shrink-0 text-faint" />
        {p.delta != null && p.delta !== 0 && (
          <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap" style={{ color }}>
            {p.delta > 0 ? <TrendingUp size={14} strokeWidth={2} /> : <TrendingDown size={14} strokeWidth={2} />}
            {p.delta > 0 ? "+" : "−"}
            {Math.abs(p.delta)} pts
          </span>
        )}
      </p>
      <p className="font-serif-accent mt-1.5 text-[26px] leading-none tabular-nums" style={p.display != null && !p.good ? { color } : undefined}>
        {p.display ?? "–"}
      </p>
      {p.series.length >= 2 && <Spark series={p.series} color={color} />}
      {/* What the figure is measured against — "+18 pts" means nothing without it. */}
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

/** How many of a card's things show before "Show all". */
const LIST_SHOWN = 5;

/** One thing a card is about: a task opens in the task pane (closing this one), a lead or page navigates. */
function ListLink({ link, onOpenTask, onClose }: { link: FindingLink; onOpenTask?: (id: string) => void; onClose: () => void }) {
  // The arrow makes each row read as a button (Nitsan, 2026-10-25); it brightens on hover.
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className="bidi-auto block truncate text-[13px] text-foreground">{link.label}</span>
        {link.sub && <span className="block truncate text-[11px] text-faint">{link.sub}</span>}
      </span>
      <StudioArrow size={14} className="shrink-0 text-faint transition-colors group-hover/link:text-brand" />
    </>
  );
  const cls = "group/link flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[#1f2c57]";
  if (link.taskId && onOpenTask)
    return (
      <button
        onClick={() => {
          onClose();
          onOpenTask(link.taskId!);
        }}
        className={cls}
      >
        {inner}
      </button>
    );
  return (
    <Link href={link.href ?? (link.taskId ? `/?task=${link.taskId}` : "#")} onClick={onClose} className={cls}>
      {inner}
    </Link>
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
 * A followed money card, floating bottom-right over its page while the cells
 * it talks about are lit up (Nitsan, 2026-10-25: "highlight what I should look
 * at, and keep the comment while I look at the numbers"). The highlight is a
 * style rule on the cells' `data-advice` tokens, so it survives the grid
 * loading late or re-rendering. It closes by itself on leaving the page.
 * An outline only, so the cell's own state colour still shows through; with
 * several places, ‹ › steps through them. It moves to the left when what it
 * points at is under it, and on a phone it's a folded bar along the bottom.
 */
function Spotlight({
  it,
  hold,
  onClose,
  onBack,
  onDone,
  onFix,
}: {
  it: AdviceRow;
  hold: boolean;
  onClose: () => void;
  onBack: () => void;
  onDone: () => void;
  onFix: () => Promise<void>;
}) {
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
    (cells.length ? `${spotSelector(cells)}{outline:2px solid var(--brand)!important;outline-offset:-2px;animation:advice-spot 1.1s ease-in-out 3}` : "") +
    // A month column frames the cells the same way: a brand line, no fill.
    (months.length ? `${spotSelector(months)}{color:var(--brand)!important;box-shadow:inset 0 -2px 0 var(--brand)}` : "") +
    `@keyframes advice-spot{50%{outline-color:${AQUA}}}`;

  return (
    <>
      {tokens.length > 0 && <style>{css}</style>}
      <aside
        style={NIGHT}
        aria-label="&advice note"
        className={`advice-pane fixed inset-x-3 bottom-3 z-40 rounded-2xl bg-background text-foreground shadow-[0_18px_44px_-12px_rgba(6,17,47,0.6)] md:inset-x-auto md:bottom-6 ${left ? "md:left-6" : "md:right-6"} ${small ? "md:w-[300px]" : "md:w-[380px]"} ${hold ? "advice-hold" : ""}`}
      >
        <div className="flex items-center gap-2 px-4 pt-3 text-[12px] text-muted">
          <span className="brand-amp w-3" style={{ backgroundColor: AQUA }} />
          <span className="size-2 rounded-full" style={{ background: TONE[it.kind] }} />
          <span className="min-w-0 flex-1 truncate">
            {KIND_LABEL[it.kind]} · {it.area}
          </span>
          <button
            onClick={() => setSmall((v) => !v)}
            title={small ? "Show the note" : "Fold the note"}
            aria-label={small ? "Show the note" : "Fold the note"}
            className="flex size-7 items-center justify-center rounded-lg hover:bg-surface hover:text-foreground"
          >
            {small ? <ChevronDown size={16} strokeWidth={1.75} className="rotate-180" /> : <Minus size={16} strokeWidth={1.75} />}
          </button>
          <button onClick={onClose} title="Close — the advice stays in &advice" aria-label="Close" className="flex size-7 items-center justify-center rounded-lg hover:bg-surface hover:text-foreground">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="px-4 pb-4 pt-1.5">
          <p className={`bidi-auto text-[15px] font-medium leading-5 ${small ? "truncate" : ""}`}>{it.wordedTitle ?? it.title}</p>
          {!small && (
            <>
              <p className="bidi-auto mt-1 text-[13px] leading-5 text-muted">{it.wordedBody ?? it.body}</p>
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
