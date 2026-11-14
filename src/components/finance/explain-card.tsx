"use client";

// The hover "explain" card shared by every page — "what is this number made
// of, and why did it move?". Any element with a `data-cell` key inside the box
// that carries `useExplainHover`'s handlers gets a card: the formula with real
// figures, its biggest ingredients, a mini chart, trend chips and a plain
// "Why" line. Source cells are outlined straight on the DOM (a class toggled)
// so hovering never re-renders the page underneath.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getClientMonthTasks } from "@/lib/finance/actions";
import { formatHours, formatILS } from "@/lib/finance/format";
import { MONTH_NAMES, MONTH_SHORT } from "@/lib/finance/finance";

export interface Trend {
  text: string;
  dir: "up" | "down";
  /** Is this direction good news? null = neither (hours of internal time…). */
  good: boolean | null;
}

export interface Explanation {
  title: string;
  value: string;
  formula?: string;
  items?: { label: string; value: string; n: number }[];
  more?: number;
  trends: Trend[];
  notes: string[];
  /** 12 monthly values for the mini chart; `current` is the hovered month. */
  series?: { values: number[]; current: number | null; labels?: string[] };
  /** A plain-language business reason for the change vs last month. */
  why?: string;
  /** Load the tracker tasks behind a client's month (shown once fetched). */
  tasks?: { client: string; year: number; month: number };
  sources: string[];
}

// The canonical lists live in finance.ts; re-exported so the many importers
// that take them from here keep their path.
export { MONTH_NAMES, MONTH_SHORT };

/** "▲ 12% vs last month" as a chip. `upIsGood` says which way is good news. */
export function trend(cur: number, prev: number | undefined, fmt: (n: number) => string, label: string, upIsGood: boolean | null): Trend | null {
  if (prev == null || prev === 0 || cur === 0) return null;
  if (Math.abs(cur - prev) < Math.abs(prev) * 0.005) return null; // flat — nothing to flag
  const dir = cur >= prev ? "up" : "down";
  const good = upIsGood == null ? null : (dir === "up") === upIsGood;
  // A % across a sign change (a loss turning into a profit) reads as nonsense
  // ("+267%"), so the difference is given in the figure's own units instead.
  const size =
    Math.sign(cur) !== Math.sign(prev) ? fmt(Math.abs(cur - prev)) : `${Math.abs(((cur - prev) / Math.abs(prev)) * 100).toFixed(0)}%`;
  return { text: `${size} vs ${label}`, dir, good };
}

/** Top N by size, the rest counted. */
export function top(items: { label: string; n: number }[], fmt: (n: number) => string, max = 6) {
  const sorted = items.filter((i) => Math.abs(i.n) >= 0.005).sort((a, b) => Math.abs(b.n) - Math.abs(a.n));
  return {
    items: sorted.slice(0, max).map((i) => ({ label: i.label, value: fmt(i.n), n: i.n })),
    more: Math.max(0, sorted.length - max),
  };
}

// ── "Why did it move?" ───────────────────────────────────────────────────────
// Compares this month's ingredients with last month's and names the biggest
// contributors to the change, in the direction of the change. Pure arithmetic
// on the figures already shown — never a guess about intent.

export type Move = "gone" | "fresh" | "up" | "down";
/** Plain words for what happened — no figures; the card shows those already. */
export type Noun = (label: string, move: Move) => string;
export const NOUNS: Record<string, Noun> = {
  person: (l, mv) => ({ gone: `${l} left`, fresh: `${l} joined`, up: `${l} earned more`, down: `${l} earned less` })[mv],
  freelancer: (l, mv) =>
    ({ gone: `${l} didn't invoice`, fresh: `${l} started`, up: `${l} invoiced more`, down: `${l} invoiced less` })[mv],
  vendor: (l, mv) => {
    const many = l.includes("\u2069 and \u2068");
    return {
      gone: `${l} ${many ? "weren't" : "wasn't"} charged this month`,
      fresh: `${l} ${many ? "are" : "is"} new this month`,
      up: `${l} cost more`,
      down: `${l} cost less`,
    }[mv];
  },
  client: (l, mv) => ({ gone: `${l} had no hours`, fresh: `${l} started`, up: `${l} had more hours`, down: `${l} had fewer hours` })[mv],
  line: (l, mv) => ({ gone: `${l} stopped`, fresh: `${l} started`, up: `${l} went up`, down: `${l} went down` })[mv],
};

export interface Driver {
  label: string;
  cur: number;
  prev: number;
  delta: number;
}

export function drivers(cur: Map<string, number>, prev: Map<string, number>, total: number): Driver[] {
  const labels = new Set([...cur.keys(), ...prev.keys()]);
  const out: Driver[] = [];
  for (const label of labels) {
    const c = cur.get(label) ?? 0;
    const p = prev.get(label) ?? 0;
    const delta = c - p;
    // Only what pushed in the direction the total moved.
    if (Math.abs(delta) < 0.5 || Math.sign(delta) !== Math.sign(total)) continue;
    out.push({ label, cur: c, prev: p, delta });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/** Isolate a name so a Hebrew one doesn't reorder the English sentence around it, and keep it on one line. */
export const iso = (label: string) => `\u2068${label.replace(/ /g, "\u00a0")}\u2069`;

export const moveOf = (dr: Driver): Move =>
  Math.abs(dr.prev) < 0.5 ? "fresh" : Math.abs(dr.cur) < 0.5 ? "gone" : dr.delta > 0 ? "up" : "down";

/** Words for one driver; `say` lets a caller word a case more precisely (e.g. a rate change). */
export type Say = (dr: Driver, move: Move) => string | null;

/** "Up 12%" — the percentage only when last month is a positive base to measure from. */
export const dirText = (delta: number, base: number) => {
  const pct = base > 0 ? Math.round((Math.abs(delta) / base) * 100) : 0;
  return `${delta > 0 ? "Up" : "Down"}${pct >= 1 && pct <= 500 ? ` ${pct}%` : ""}`;
};

export const sumOf = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

/** The reason alone — "Sofia and Liza left" — or null when nothing stands out. */
export function reason(cur: Map<string, number>, prev: Map<string, number>, noun: Noun, say?: Say): string | null {
  const total = sumOf(cur) - sumOf(prev);
  const ds = drivers(cur, prev, total);
  if (!ds.length) return null;
  // A second reason only when it's a real part of the story.
  const picked = ds[1] && Math.abs(ds[1].delta) >= Math.abs(total) * 0.25 ? ds.slice(0, 2) : ds.slice(0, 1);
  const words = picked.map((dr) => ({ dr: { ...dr, label: iso(dr.label) }, move: moveOf(dr), custom: say?.(dr, moveOf(dr)) ?? null }));
  const [a, b] = words;
  // "Sofia and Liza left" rather than "Sofia left and Liza left".
  if (b && !a.custom && !b.custom && a.move === b.move) return noun(`${a.dr.label} and ${b.dr.label}`, a.move);
  return words.map((w) => w.custom ?? noun(w.dr.label, w.move)).join(" and ");
}

/** "Down vs last month, mainly because Sofia and Liza left." */
export function why(cur: Map<string, number>, prev: Map<string, number>, noun: Noun, say?: Say): string | undefined {
  const total = sumOf(cur) - sumOf(prev);
  const base = Math.abs(sumOf(prev));
  // Nothing worth saying for a flat month — the card stays quiet.
  if (!base || Math.abs(total) < Math.max(1, base * 0.02)) return undefined;
  const r = reason(cur, prev, noun, say);
  return r ? `${dirText(total, sumOf(prev))} vs last month, mainly because ${r}.` : undefined;
}

export const toMap = (items: { label: string; n: number }[]) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.label, (m.get(i.label) ?? 0) + i.n);
  return m;
};

/** Profit's "Why": which side moved it — revenue or expenses — and inside
 * each side, what moved most. `parts` are [this period, previous period]. */
export function profitWhy(o: {
  rev: { cur: number; prev: number; parts: [Map<string, number>, Map<string, number>] };
  exp: { cur: number; prev: number; parts: [Map<string, number>, Map<string, number>] };
  label: string;
}): string | undefined {
  const dRev = o.rev.cur - o.rev.prev;
  const dExp = o.exp.cur - o.exp.prev;
  const profit = o.rev.cur - o.exp.cur;
  const prevProfit = o.rev.prev - o.exp.prev;
  const dP = profit - prevProfit;
  if (Math.abs(dP) < 1) return undefined;
  const revTop = drivers(o.rev.parts[0], o.rev.parts[1], dRev)[0];
  const expTop = drivers(o.exp.parts[0], o.exp.parts[1], dExp)[0];
  // Only the side that helped the profit move this way, biggest first.
  const sides = [
    { n: dRev, text: `${dRev > 0 ? "more" : "less"} revenue${revTop ? ` (mostly ${iso(revTop.label)})` : ""}` },
    { n: -dExp, text: `${dExp > 0 ? "higher" : "lower"} expenses${expTop ? ` (mostly ${iso(expTop.label)})` : ""}` },
  ]
    .filter((x) => Math.abs(x.n) >= 1 && Math.sign(x.n) === Math.sign(dP))
    .sort((x, y) => Math.abs(y.n) - Math.abs(x.n));
  if (!sides.length) return undefined;
  // A profit that crossed zero has no meaningful percentage.
  const base = profit > 0 && prevProfit > 0 ? prevProfit : 0;
  return `${dirText(dP, base)} vs ${o.label}, mainly because of ${sides.map((x) => x.text).join(" and ")}.`;
}

/** A total and its parts — the common card shape: top parts, a trend chip and
 * a "Why" against the previous period's parts. */
export function breakdownCard(o: {
  title: string;
  value: number;
  fmt?: (n: number) => string;
  items: { label: string; n: number }[];
  /** The same parts one period earlier, for the trend and the "Why". */
  prev?: { items: { label: string; n: number }[]; label: string };
  noun: Noun;
  say?: Say;
  /** Is a rise good news? (revenue yes, costs no) */
  upIsGood: boolean | null;
  formula?: string;
  series?: Explanation["series"];
  notes?: (string | null | undefined)[];
  sources?: string[];
  max?: number;
}): Explanation {
  const fmt = o.fmt ?? formatILS;
  const prevTotal = o.prev ? o.prev.items.reduce((s, i) => s + i.n, 0) : undefined;
  return {
    title: o.title,
    value: fmt(o.value),
    formula: o.formula,
    // Shown: the parts that add to the total (a negative balancing part only feeds the "Why").
    ...top([...toMap(o.items)].map(([label, n]) => ({ label, n })).filter((i) => i.n > 0), fmt, o.max),
    trends: o.prev ? [trend(o.value, prevTotal, fmt, o.prev.label, o.upIsGood)].filter((t): t is Trend => t != null) : [],
    why: o.prev ? why(toMap(o.items), toMap(o.prev.items), o.noun, o.say)?.replace("vs last month", `vs ${o.prev.label}`) : undefined,
    notes: (o.notes ?? []).filter((n): n is string => !!n),
    series: o.series,
    sources: o.sources ?? [],
  };
}

const SRC_CLASS = "explain-src";
const SELF_CLASS = "explain-self";
const DELAY_MS = 350;

/** Attach to the box holding `data-cell` elements. `resolve` turns a hovered
 * key into its explanation. Returns the handlers and the card node. */
export function useExplainHover(resolve: (key: string) => Explanation | null) {
  const [open, setOpen] = useState<{ key: string; rect: DOMRect } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const container = useRef<HTMLElement | null>(null);
  const lit = useRef<Element[]>([]);

  const clearLit = useCallback(() => {
    for (const el of lit.current) el.classList.remove(SRC_CLASS, SELF_CLASS);
    lit.current = [];
  }, []);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(null);
    clearLit();
  }, [clearLit]);

  const onMouseOver = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      container.current = e.currentTarget;
      if (e.buttons) return; // mid drag-select — don't pop cards over the selection
      // A cell's comment badge has its own hover box — one box at a time.
      if ((e.target as HTMLElement).closest("[data-no-explain]")) {
        close();
        return;
      }
      const td = (e.target as HTMLElement).closest<HTMLElement>("[data-cell]");
      const key = td?.dataset.cell;
      if (!td || !key) {
        close();
        return;
      }
      if (open?.key === key) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOpen({ key, rect: td.getBoundingClientRect() }), DELAY_MS);
    },
    [open, close],
  );

  const explanation = open ? resolve(open.key) : null;

  // Outline the source cells (and the hovered one) while the card is open.
  useEffect(() => {
    clearLit();
    const root = container.current;
    if (!open || !explanation || !root) return;
    const els: Element[] = [];
    const self = root.querySelector(`[data-cell="${CSS.escape(open.key)}"]`);
    if (self) {
      self.classList.add(SELF_CLASS);
      els.push(self);
    }
    for (const k of explanation.sources) {
      const el = root.querySelector(`[data-cell="${CSS.escape(k)}"]`);
      if (el) {
        el.classList.add(SRC_CLASS);
        els.push(el);
      }
    }
    lit.current = els;
    return clearLit;
    // explanation is derived from open+data; keyed on the open cell only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clearLit]);

  // Any scroll (the page or a grid) moves the cell away from its card.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open, close]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const card = open && explanation ? createPortal(<ExplainCard ex={explanation} rect={open.rect} />, document.body) : null;

  return { onMouseOver, onMouseLeave: close, onScroll: close, card };
}

/** Tasks per client/month, cached for the session so re-hovering is instant. */
const taskCache = new Map<string, Promise<{ title: string; hours: number }[]>>();
function useTasks(req: Explanation["tasks"]) {
  const [tasks, setTasks] = useState<{ key: string; list: { title: string; hours: number }[] } | null>(null);
  const key = req ? `${req.client}|${req.year}|${req.month}` : null;
  useEffect(() => {
    if (!req || !key) return;
    let alive = true;
    let p = taskCache.get(key);
    if (!p) {
      // A failed fetch shows as no tasks this once, but leaves the cache — cached,
      // it read as "no entries" on every hover until a reload.
      p = getClientMonthTasks(req.client, req.year, req.month).catch(() => {
        taskCache.delete(key);
        return [];
      });
      taskCache.set(key, p);
    }
    void p.then((list) => alive && setTasks({ key, list }));
    return () => {
      alive = false;
    };
  }, [key, req]);
  return key && tasks?.key === key ? tasks.list : null;
}

function MiniBars({ values, current, labels = MONTH_SHORT.map((m) => m[0]) }: { values: number[]; current: number | null; labels?: string[] }) {
  const max = Math.max(...values.map((v) => Math.abs(v)), 0);
  if (!max) return null;
  return (
    <div className="mt-3">
      <div className="flex h-9 items-end gap-[3px]">
        {values.map((v, i) => (
          <div
            key={i}
            title={labels[i]}
            style={{ height: `${Math.max(4, (Math.abs(v) / max) * 100)}%` }}
            className={`flex-1 rounded-sm ${
              current === i + 1 ? "bg-[#6181e8]" : v < 0 ? "bg-rose-400/50" : "bg-white/20"
            }`}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-[9px] text-white/40">
        {labels.map((m, i) => (
          <span key={i} className={`flex-1 text-center ${current === i + 1 ? "font-semibold text-white" : ""}`}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}

function ExplainCard({ ex, rect }: { ex: Explanation; rect: DOMRect }) {
  // Beside the cell, not above/below it: a number's sources are usually in
  // the same column, and a card over them would hide what it highlights.
  const W = 320;
  const roomRight = window.innerWidth - rect.right - 12 >= W;
  const left = roomRight ? rect.right + 8 : Math.max(8, rect.left - W - 8);
  // Start level with the cell; once the real height is known, lift it so it
  // never runs off the bottom of the window.
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(Math.max(8, rect.top - 8));
  const tasks = useTasks(ex.tasks);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    setTop(Math.max(8, Math.min(rect.top - 8, window.innerHeight - h - 8)));
  }, [rect, ex, tasks]);
  const maxItem = Math.max(...(ex.items ?? []).map((i) => Math.abs(i.n)), 0);
  const taskTop = tasks ? tasks.slice(0, 6) : null;
  const taskMax = taskTop?.[0]?.hours ?? 0;
  return (
    <div
      ref={ref}
      style={{ top, left, width: W }}
      className="pointer-events-none fixed z-[80] overflow-hidden rounded-2xl bg-[#06112f] text-white shadow-2xl ring-1 ring-white/10"
    >
      <div className="h-1 bg-gradient-to-r from-[#0b43ed] to-[#6181e8]" />
      <div className="p-3.5">
        <div className="bidi-auto truncate text-[10px] font-medium uppercase tracking-wider text-white/50">{ex.title}</div>
        <div className="mt-0.5 text-2xl font-semibold tabular-nums leading-tight">{ex.value}</div>
        {ex.trends.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ex.trends.map((t) => (
              <span
                key={t.text}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${
                  t.good == null ? "bg-white/10 text-white/80" : t.good ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"
                }`}
              >
                {t.dir === "up" ? "▲" : "▼"} {t.text}
              </span>
            ))}
          </div>
        )}
        {ex.why && (
          <p className="mt-2.5 rounded-lg border-l-2 border-[#6181e8] bg-[#0b43ed]/20 px-2.5 py-1.5 text-[11.5px] leading-snug text-white/90">
            <span className="mr-1 font-semibold text-[#9db3f5]">Why</span>
            {ex.why}
          </p>
        )}
        {ex.series && <MiniBars values={ex.series.values} current={ex.series.current} labels={ex.series.labels} />}
        {ex.formula && (
          <p className="mt-3 rounded-lg bg-white/[0.06] px-2.5 py-1.5 font-mono text-[11px] leading-snug text-white/85">{ex.formula}</p>
        )}
        {ex.items && ex.items.length > 0 && (
          <ul className="mt-2.5 space-y-1.5">
            {ex.items.map((it) => (
              <li key={it.label} className="text-[11px]">
                <div className="flex justify-between gap-3">
                  <span className="bidi-auto truncate text-white/70">{it.label}</span>
                  <span className="shrink-0 tabular-nums">{it.value}</span>
                </div>
                {maxItem > 0 && (
                  <div className="mt-0.5 h-1 rounded-full bg-white/10">
                    <div className="h-1 rounded-full bg-[#6181e8]" style={{ width: `${(Math.abs(it.n) / maxItem) * 100}%` }} />
                  </div>
                )}
              </li>
            ))}
            {ex.more ? <li className="text-[11px] text-white/40">+ {ex.more} more</li> : null}
          </ul>
        )}
        {ex.tasks && (
          <div className="mt-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wider text-white/40">Tasks</div>
            {taskTop == null ? (
              <p className="mt-1 text-[11px] text-white/40">Loading from the tracker…</p>
            ) : taskTop.length === 0 ? (
              <p className="mt-1 text-[11px] text-white/40">No tracker entries for this month</p>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {taskTop.map((t) => (
                  <li key={t.title} className="text-[11px]">
                    <div className="flex justify-between gap-3">
                      <span className="bidi-auto truncate text-white/70">{t.title}</span>
                      <span className="shrink-0 tabular-nums">{formatHours(t.hours)} h</span>
                    </div>
                    <div className="mt-0.5 h-1 rounded-full bg-white/10">
                      <div className="h-1 rounded-full bg-[#6181e8]" style={{ width: `${(t.hours / taskMax) * 100}%` }} />
                    </div>
                  </li>
                ))}
                {tasks && tasks.length > taskTop.length && <li className="text-[11px] text-white/40">+ {tasks.length - taskTop.length} more</li>}
              </ul>
            )}
          </div>
        )}
        {ex.notes.length > 0 && (
          <ul className="mt-2.5 space-y-0.5 border-t border-white/10 pt-2 text-[11px] text-white/60">
            {ex.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {ex.sources.length > 0 && <p className="mt-2 text-[10px] text-white/35">Outlined: what it&apos;s built from</p>}
      </div>
    </div>
  );
}
