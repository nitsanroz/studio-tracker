"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, Check, ChevronDown, RotateCcw } from "lucide-react";
import { fmtHours, fmtNis } from "@/lib/leads/estimate";
import type { PublishedEstimate } from "@/lib/leads/estimates-data";
import {
  defaultSelection,
  lineKey,
  offerTotals,
  type OfferSelection,
  type OfferTotals,
} from "@/lib/leads/offer-selection";

// The client's copy of an estimate, drawn from the frozen snapshot only.
//
// Typography round (2026-11-09, Nitsan picked direction "A · Refined" from
// /design-lab/estimate, then adjusted it): the website's type scale — nothing
// a client reads is under 16px, meta (hours, dates) at 14–15. Each section's
// header is its own strip: the title in brand blue, its hours beside the
// timeframe chip on the right. Items are 18px. The total says "Total estimate ·
// N hrs of work" in Studio Black above a blue serif price.
//
// Interactive (2026-11-09, Nitsan): optional items carry a tick box and the
// options of a "choose one" group are selectable boxes side by side; section,
// group and total figures follow the client's choices live
// (`lib/leads/offer-selection.ts`). ⚠️ NOTHING IS SAVED OR SENT — it is a
// calculator on top of the frozen snapshot, and reloading starts again from
// what the studio published.
//
// History, so the next round doesn't repeat it (Nitsan, 2026-10-12): a pale
// brand tint on the header read as washed out, a full navy header was too
// heavy, and section numbers, cyan accents and a blue bar down the left edge
// were unwanted. The timeframe replaced the old separate Timeline section, so
// the snapshot's `timeline` text is not drawn. ⚠️ HOURS ONLY on sections and
// lines — money appears once, on the total (Nitsan, 2026-10-04).

type Phase = PublishedEstimate["phases"][number];
type Line = Phase["lines"][number];
type Range = { min: number; max: number };

const Para = ({ text, className = "" }: { text: string | null | undefined; className?: string }) =>
  text ? <div className={`bidi-auto whitespace-pre-wrap ${className}`}>{text}</div> : null;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** A quiet status pill; 13px meta beside an 18px name, so it never competes with it. */
const Tag = ({ children, tone = "muted" }: { children: string; tone?: "muted" | "brand" }) => (
  <span
    className={`ml-2 inline-block rounded-full px-2.5 py-0.5 align-[3px] text-[13px] font-medium leading-5 ${
      tone === "brand" ? "bg-brand-soft text-brand" : "bg-[var(--light-white)] text-muted ring-1 ring-border"
    }`}
  >
    {children}
  </span>
);

/** A price range that breaks (on a phone) only between its two figures, never inside one. */
function Price({ r }: { r: Range }) {
  const [a, b] = fmtNis(r).split("–");
  if (!b) return <span className="whitespace-nowrap">{a}</span>;
  return (
    <>
      <span className="whitespace-nowrap">{a}–</span>
      <wbr />
      <span className="whitespace-nowrap">{b}</span>
    </>
  );
}

/** What every section reads: the client's choices, the live totals, and the two ways to change them. */
interface OfferCtx {
  sel: OfferSelection;
  totals: OfferTotals;
  toggle: (key: string) => void;
  pick: (group: string, key: string) => void;
}
const Offer = createContext<OfferCtx | null>(null);
const useOffer = () => useContext(Offer)!;

/** The tick box for an optional item — 22px, brand-filled when on. Visual only; the input is the label's. */
const TickBox = ({ on }: { on: boolean }) => (
  <span
    aria-hidden
    className={`mt-[3px] flex size-[22px] shrink-0 items-center justify-center rounded-md transition-colors [-webkit-print-color-adjust:exact] [print-color-adjust:exact] ${
      on ? "bg-brand text-white" : "bg-surface ring-2 ring-border-strong group-hover:ring-brand/60"
    }`}
  >
    {on && <Check size={15} strokeWidth={3} />}
  </span>
);

/** The radio dot for an option box. */
const Dot = ({ on }: { on: boolean }) => (
  <span
    aria-hidden
    className={`flex size-[22px] shrink-0 items-center justify-center rounded-full transition-colors [-webkit-print-color-adjust:exact] [print-color-adjust:exact] ${
      on ? "bg-brand" : "bg-surface ring-2 ring-border-strong group-hover:ring-brand/60"
    }`}
  >
    {on && <span className="size-2 rounded-full bg-white" />}
  </span>
);

function Item({ name, hours, description, tag }: { name: string; hours: Line["hours"]; description: string | null; tag?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-6">
        <span className="bidi-auto text-[18px] font-medium leading-7">
          {name}
          {tag}
        </span>
        <span className="shrink-0 text-[15px] tabular-nums text-muted">{fmtHours(hours)}</span>
      </div>
      <Para text={description} className="mt-1 max-w-[60ch] text-[16px] leading-6 text-muted" />
    </div>
  );
}

/**
 * One run of lines. Lines sharing a "choose one" group print together as
 * options — but ⚠️ ONLY when the group really offers a choice. A group holding a
 * single line is just an item: printing "(choose one)" and "Option 1" over it
 * (as DNA Travel's Strategy section did) asks the client to choose from nothing.
 *
 * Interactive (2026-11-09, Nitsan): an optional item has a tick box and an
 * option is a selectable box, side by side; both feed the live total.
 */
function LineList({ lines, keys }: { lines: Line[]; keys: string[] }) {
  const { sel, totals, toggle, pick } = useOffer();
  // A percentage line's hours follow the client's choices (offer-selection.ts).
  const hrs = (l: Line, key: string) => totals.line.get(key) ?? l.hours;
  const seen = new Set<string>();
  return (
    <ul className="flex flex-col gap-6">
      {lines.map((l, j) => {
        const options = l.altGroup ? lines.map((x, i) => ({ x, key: keys[i] })).filter((o) => o.x.altGroup === l.altGroup) : [];
        if (l.altGroup && options.length > 1) {
          if (seen.has(l.altGroup)) return null;
          seen.add(l.altGroup);
          const group = l.altGroup;
          return (
            <li key={j}>
              <p className="bidi-auto text-[15px] font-medium text-muted">
                Choose one · <span className="text-foreground">{group}</span>
              </p>
              <div
                role="radiogroup"
                aria-label={group}
                className={`mt-3 grid gap-3 ${options.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
              >
                {options.map(({ x: o, key }, k) => {
                  const on = sel.picks.get(group) === key;
                  return (
                    <label
                      key={k}
                      className={`group flex cursor-pointer flex-col gap-3 rounded-2xl p-5 transition-colors [-webkit-print-color-adjust:exact] [print-color-adjust:exact] ${
                        on ? "bg-brand-soft/60 ring-2 ring-brand" : "bg-[var(--light-white)] ring-1 ring-border hover:ring-brand/40"
                      }`}
                    >
                      <input type="radio" name={`opt-${group}`} checked={on} onChange={() => pick(group, key)} className="sr-only" />
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2.5 text-[14px] font-medium text-muted">
                          <Dot on={on} />
                          Option {k + 1}
                        </span>
                        {o.chosen && <Tag tone="brand">Recommended</Tag>}
                      </span>
                      <span className="bidi-auto block text-[18px] font-medium leading-7">{o.name}</span>
                      <span className="-mt-2 block text-[15px] tabular-nums text-muted">{fmtHours(hrs(o, key))}</span>
                      <Para text={o.description} className="text-[16px] leading-6 text-muted" />
                    </label>
                  );
                })}
              </div>
            </li>
          );
        }
        if (l.optional) {
          const on = sel.optional.has(keys[j]);
          return (
            <li key={j}>
              <label className="group flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={on} onChange={() => toggle(keys[j])} className="sr-only" />
                <TickBox on={on} />
                <Item name={l.name} hours={hrs(l, keys[j])} description={l.description} tag={<Tag>Optional</Tag>} />
              </label>
            </li>
          );
        }
        return (
          <li key={j}>
            <Item name={l.name} hours={hrs(l, keys[j])} description={l.description} />
          </li>
        );
      })}
    </ul>
  );
}

/** A range of every line, counted or not — what an all-optional section or group could add. */
function sumLines(lines: Line[]) {
  return lines.reduce((a, l) => ({ min: a.min + l.hours.min, max: a.max + l.hours.max }), { min: 0, max: 0 });
}
const isZero = (r: Range) => r.min === 0 && r.max === 0;

/** Counted hours, or — when nothing in it counts yet — what it could add, marked optional. */
function HoursNote({ counted, lines }: { counted: Range; lines: Line[] }) {
  if (!isZero(counted) || lines.length === 0) return <>{fmtHours(counted)}</>;
  return (
    <>
      {fmtHours(sumLines(lines))} <span className="font-normal text-muted">· optional</span>
    </>
  );
}

function Section({ phase: p, index: pi }: { phase: Phase; index: number }) {
  const [open, setOpen] = useState(true);
  const { totals } = useOffer();
  // Groups first, each a sub-heading with its own subtotal, then the loose lines —
  // the editor's order (0049). A snapshot from before groups renders flat.
  const segments: { group: number | null; lines: Line[]; keys: string[] }[] = [];
  p.lines.forEach((l, li) => {
    const g = l.group ?? null;
    const last = segments[segments.length - 1];
    if (last && last.group === g) {
      last.lines.push(l);
      last.keys.push(lineKey(pi, li));
    } else segments.push({ group: g, lines: [l], keys: [lineKey(pi, li)] });
  });
  const counted = totals.phase[pi];
  const optionalOnly = isZero(counted) && p.lines.length > 0;
  return (
    <section className="overflow-hidden rounded-3xl bg-surface shadow-card break-inside-avoid-page">
      {/* The section's header strip, Light White, holding everything that should stay
          visible when the section is folded: title, hours, timeframe AND the section's
          description, under the name — shown only while the section is open, folded it
          hides with the items (Nitsan, 2026-11-09), and prints either way. No
          hairlines anywhere in the card — spacing separates. */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="block w-full bg-[var(--light-white)] px-6 py-5 text-left transition-colors hover:bg-brand-soft/50 sm:px-8 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]"
      >
        <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="bidi-auto min-w-0 flex-1 basis-60 text-[24px] font-medium leading-8 text-brand">{p.name}</span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="text-[15px] font-medium tabular-nums">
              <HoursNote counted={counted} lines={p.lines} />
            </span>
            {p.timeframe && (
              <span className="flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-[14px] font-medium text-brand">
                <CalendarDays size={15} strokeWidth={1.75} aria-hidden />
                <span className="bidi-auto">{p.timeframe}</span>
              </span>
            )}
            <ChevronDown
              size={20}
              aria-hidden
              className={`text-faint transition-transform print:hidden ${open ? "" : "-rotate-90"}`}
            />
          </span>
        </span>
        {(p.description || optionalOnly) && (
          <span className={`mt-2 max-w-[60ch] text-[16px] leading-6 text-muted ${open ? "block" : "hidden print:block"}`}>
            {p.description && <span className="bidi-auto block whitespace-pre-wrap">{p.description}</span>}
            {optionalOnly && <span className="block">Optional — tick what you&rsquo;d like to add to the total.</span>}
          </span>
        )}
      </button>
      {/* Folded sections still print: a client saving the page as a PDF wants all of it. */}
      <div className={`px-6 pb-7 pt-6 sm:px-8 ${open ? "" : "hidden print:block"}`}>
        <div className="flex flex-col gap-10">
          {segments.map((seg, k) => {
            const g = seg.group !== null ? p.groups?.[seg.group] : undefined;
            if (!g) return <LineList key={k} lines={seg.lines} keys={seg.keys} />;
            return (
              <div key={k} className="break-inside-avoid">
                <h3 className="mb-4 flex items-baseline justify-between gap-3 text-[16px] font-medium leading-6 text-brand">
                  <span className="bidi-auto">{g.name}</span>
                  <span className="shrink-0 text-[15px] font-normal tabular-nums text-muted">
                    <HoursNote counted={totals.group[pi]?.[seg.group!] ?? g.hours} lines={seg.lines} />
                  </span>
                </h3>
                <LineList lines={seg.lines} keys={seg.keys} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function PublicEstimateView({ s }: { s: PublishedEstimate }) {
  const discounted = (s.discountPercent ?? 0) > 0;
  const [sel, setSel] = useState<OfferSelection>(() => defaultSelection(s));
  const totals = useMemo(() => offerTotals(s, sel), [s, sel]);
  const published = useMemo(() => offerTotals(s, defaultSelection(s)), [s]);
  const ctx = useMemo<OfferCtx>(
    () => ({
      sel,
      totals,
      toggle: (key) =>
        setSel((v) => {
          const optional = new Set(v.optional);
          if (!optional.delete(key)) optional.add(key);
          return { ...v, optional };
        }),
      pick: (group, key) => setSel((v) => ({ ...v, picks: new Map(v.picks).set(group, key) })),
    }),
    [sel, totals],
  );
  const interactive = s.phases.some((p) => p.lines.some((l) => l.optional || (l.altGroup && p.lines.filter((x) => x.altGroup === l.altGroup).length > 1)));
  return (
    <Offer.Provider value={ctx}>
      <main className="min-h-dvh bg-[#e9edf4] print:bg-white">
        <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-10 text-foreground sm:px-6 sm:py-16 print:py-0">
          <header className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="text-[16px] text-muted">Offer for</p>
              <h1 className="bidi-auto mt-1 font-serif-accent text-[48px] leading-[56px] sm:text-[72px] sm:leading-[80px]">{s.company}</h1>
              <p className="mt-3 text-[18px] leading-7 text-muted">Scope, pricing &amp; timeline · {fmtDate(s.publishedAt)}</p>
            </div>
            {/* ⚠️ Responsive sizing on a WRAPPER: `.brand-wordmark` sets display unlayered. */}
            <span className="mt-2 shrink-0">
              <span className="brand-wordmark w-32 bg-brand sm:w-40" role="img" aria-label="Studio&more" />
            </span>
          </header>

          <Para text={s.intro} className="mt-10 max-w-[62ch] text-[18px] leading-7" />
          {interactive && (
            <p className="mt-6 max-w-[62ch] text-[16px] leading-6 text-muted print:hidden">
              Tick optional items and choose between options below — the total estimate updates as you go.
            </p>
          )}

          <div className="mt-12 flex flex-col gap-5">
            {s.phases.map((p, i) => (
              <Section key={i} phase={p} index={i} />
            ))}
          </div>

          {/* The total: white, topped by the finance product's brand → light-blue strip so it
              reads as the bottom line. The heading line is Studio Black, the price blue. */}
          <section className="mt-8 overflow-hidden rounded-3xl bg-surface shadow-card break-inside-avoid-page">
            <div className="h-1.5 bg-gradient-to-r from-[#0b43ed] to-[#6181e8] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]" />
            <div className="p-6 sm:p-10">
              <p className="text-[20px] font-medium leading-7">
                Total estimate <span className="font-normal tabular-nums">· {fmtHours(totals.totalHours)} of work</span>
              </p>
              <div className="mt-3 flex flex-wrap items-baseline gap-x-3 text-brand">
                <span className="font-serif-accent text-[36px] leading-tight tabular-nums sm:text-[48px]">
                  <Price r={totals.net} />
                </span>
                <span className="text-[16px] text-brand/75">+ VAT</span>
              </div>
              {totals.changed && (
                <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-muted">
                  <span>
                    With your choices · as offered: <span className="tabular-nums">{fmtNis(published.net)}</span>
                  </span>
                  <button
                    onClick={() => setSel(defaultSelection(s))}
                    className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline print:hidden"
                  >
                    <RotateCcw size={14} strokeWidth={2} aria-hidden />
                    Back to our recommendation
                  </button>
                </p>
              )}
              {discounted && (
                <dl className="mt-6 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[15px] text-muted">
                  <dt>Before discount</dt>
                  <dd className="text-right tabular-nums">{fmtNis(totals.subtotal)}</dd>
                  <dt>Discount {s.discountPercent}%</dt>
                  <dd className="text-right tabular-nums">−{fmtNis(totals.discount)}</dd>
                </dl>
              )}
              <p className="mt-6 text-[15px] leading-6 text-muted">
                We work on an hourly basis — {s.rate} NIS + VAT per hour. Only ticked optional items and the chosen
                options are included in the total.
              </p>
            </div>
          </section>

          <Para text={s.closing} className="mt-10 max-w-[62ch] text-[18px] leading-7" />

          <p className="mt-12 text-[14px] text-faint print:hidden">Use your browser&rsquo;s Print to save this offer as a PDF.</p>
        </div>
      </main>
    </Offer.Provider>
  );
}
