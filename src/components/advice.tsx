"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Clock3, Lightbulb, TrendingDown, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { StudioArrow } from "./studio-arrow";
import { EmptyState } from "./empty-state";
import { Skeleton } from "./skeleton";
import { toast } from "@/lib/toast";
import { parseISO, shiftDays, toISODate } from "@/lib/format";
import type { AdviceRow } from "@/lib/advice/merge";
import type { AdviceKind, PulseTile } from "@/lib/advice/signals";
import type { AdviceView } from "@/lib/advice/run";
import { pageContext, splitByPage } from "@/lib/advice/context";

/**
 * &advice — the owner's advisor (v1.80.0). Closed, a round Studio Black button
 * with the aqua ampersand in the bottom-right corner; open, a 440px pane over
 * the page. Picked on /design-lab/advisor (option A "Night briefing", with C's
 * corner button — Nitsan, 2026-10-24).
 *
 * ⚠️ ITS OWN COLOUR SCHEME IS TOKEN OVERRIDES on the pane's root (`NIGHT`), so
 * the app's classes — card-title, text-muted, bg-surface, EmptyState — follow
 * it. It's a sibling of `.app-canvas`, so the canvas's card rules don't reach in.
 *
 * Mounted for admins; the API answers 403 to anyone but the owner, and then
 * nothing renders. Desktop only for now.
 */

const NIGHT: CSSProperties = {
  ["--foreground" as string]: "#ffffff",
  ["--muted" as string]: "#aab4d4",
  ["--faint" as string]: "#7c88ad",
  ["--surface" as string]: "#101c44",
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
  const res = await fetch(`/api/advice/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.ok;
}

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

export function Advice() {
  const [allowed, setAllowed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [refs, setRefs] = useState<ItemRef[]>([]);
  const [open, setOpen] = useState(false);
  const ctx = usePageContext();
  const peekRef = useRef<() => Promise<void>>(async () => {});

  const peek = useCallback(async () => {
    const res = await fetch("/api/advice?peek=1").catch(() => null);
    // Only "not signed in" or "not the owner" hides the button. Anything else
    // (a blip, a 500) keeps what we had and tries again in a minute — it used
    // to hide the owner's button until a reload.
    const retry = () => window.setTimeout(() => void peekRef.current(), 60_000);
    if (!res) return void retry();
    // 503 = migration not run yet: the owner still gets the button, to see why.
    if (res.status === 503) {
      setAllowed(true);
      return setMissing(true);
    }
    if (res.status === 401 || res.status === 403) return setAllowed(false);
    if (!res.ok) return void retry();
    const j = (await res.json()) as { items: ItemRef[] };
    setAllowed(true);
    setMissing(false);
    setRefs(j.items ?? []);
  }, []);
  useEffect(() => {
    peekRef.current = peek;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one fetch on mount
    void peek();
  }, [peek]);
  const close = useCallback(() => {
    setOpen(false);
    void peek();
  }, [peek]);

  if (!allowed) return null;
  if (open) return <AdvicePane onClose={close} />;
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

function AdvicePane({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<AdviceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdviceKind | "all">("all");
  const [snoozing, setSnoozing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/advice").catch(() => null);
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
      toast(text, { tone, onUndo: () => void patch(it.id, { action: "undo" }).then(load) });
    });
  };

  const counts = (k: AdviceKind) => items.filter((i) => i.kind === k).length;
  const nowCount = counts("now");
  const shown = items.filter((i) => filter === "all" || i.kind === filter);

  // The page you're on decides what comes first (Nitsan, 2026-10-24): Home owns
  // everything; a client's page or its Client Reports tab puts that client
  // first; the rest folds under "Elsewhere".
  const ctx = usePageContext();
  const [showElsewhere, setShowElsewhere] = useState(false);
  const { here, elsewhere } = splitByPage(shown, ctx);
  const clientName = ctx.clientId ? items.find((i) => i.clientId === ctx.clientId && typeof i.facts.client === "string")?.facts.client : null;
  const hereLabel = typeof clientName === "string" ? clientName : ctx.label;

  const card = (it: AdviceRow) => {
    // A link to the page you're already on is noise ("Open the weekly plan" on the plan);
    // query included, so another client's item on Client Reports still links to its tab.
    const target = typeof it.facts.href === "string" ? it.facts.href : null;
    const href = target && !isCurrent(target, ctx.pathname, ctx.params) ? target : null;
    const action = typeof it.facts.action === "string" ? it.facts.action : null;
    return (
      <li key={it.id} className="group/item relative mt-2 rounded-2xl bg-surface p-4 pr-12">
        <p className="mb-1.5 flex items-center gap-2 text-[12px] text-muted">
          <span className="size-2 rounded-full" style={{ background: TONE[it.kind] }} />
          {KIND_LABEL[it.kind]} · {it.area}
          {it.facts.changed === true && <span style={{ color: CORAL }}>· got worse</span>}
        </p>
        <p className="bidi-auto text-[15px] font-medium leading-5">{it.wordedTitle ?? it.title}</p>
        <p className="bidi-auto mt-1 text-[13px] leading-5 text-muted">{it.wordedBody ?? it.body}</p>
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
          (href || it.isReminder) && (
            <div className="mt-3 flex items-center gap-4 text-[13px]">
              {href && action && (
                <Link href={href} onClick={onClose} className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                  {action}
                  <StudioArrow size={14} />
                </Link>
              )}
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
        {/* Snooze is the only way out (Nitsan, 2026-10-24): it comes back if still true, sooner if it gets worse. */}
        <button
          onClick={() => setSnoozing(snoozing === it.id ? null : it.id)}
          title="Snooze"
          aria-label="Snooze"
          className="absolute right-2.5 top-2.5 flex size-7 items-center justify-center rounded-lg text-muted opacity-40 transition-opacity hover:bg-[#1f2c57] hover:text-foreground group-hover/item:opacity-100"
        >
          <Clock3 size={16} strokeWidth={1.75} />
        </button>
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
        <div className="min-w-0 flex-1">
          <p className="card-title">&amp;advice</p>
          <p className="text-[12px] text-faint">{view ? parseISO(view.today).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : " "}</p>
        </div>
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
            <div className="mt-4 grid grid-cols-2 gap-2">
              {view.pulse.map((p, i, all) => (
                // An odd last tile spans the row rather than leaving a hole beside it.
                <Tile key={p.label} p={p} wide={all.length % 2 === 1 && i === all.length - 1} />
              ))}
            </div>
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
            <span>{view.wordingOff ?? "Percentages and trends only — amounts stay in the finance app"}</span>
            {view.hidden > 0 && <span>{view.hidden} snoozed or done</span>}
          </footer>
        </>
      )}
    </aside>
  );
}

function Tile({ p, wide }: { p: PulseTile; wide: boolean }) {
  const delta = p.value != null && p.against != null && p.unit === "%" ? p.value - p.against : null;
  const color = p.good ? AQUA : CORAL;
  return (
    <div className={`rounded-xl bg-surface px-3.5 py-3 ${wide ? "col-span-2" : ""}`}>
      <p className="flex items-center gap-2 text-[12px] text-muted">
        {p.label}
        {delta != null && delta !== 0 && (
          <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap" style={{ color }}>
            {delta > 0 ? <TrendingUp size={14} strokeWidth={2} /> : <TrendingDown size={14} strokeWidth={2} />}
            {delta > 0 ? "+" : "−"}
            {Math.abs(delta)} pts
          </span>
        )}
      </p>
      <p className="font-serif-accent mt-1.5 text-[26px] leading-none" style={p.value != null && !p.good ? { color } : undefined}>
        {p.value == null ? "–" : `${p.value}${p.unit}`}
      </p>
      {p.series.length >= 2 && <Spark series={p.series} color={color} />}
      {/* What the figure is measured against — "+18 pts" means nothing without it. */}
      <p className="mt-1 truncate text-[11px] text-faint">{p.note}</p>
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
