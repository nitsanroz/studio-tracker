"use client";

// The client's offer page (`/estimate/[token]`), round 8: typography and
// hierarchy. "Current" is the REAL component, fed the fixture below; the three
// directions share its data and rules (hours per line, money only on the total,
// "choose one" only when a group really offers a choice) and change the type.
//
// Type basis = the website's Figma scale (H1 72/80 · H2 40/48 · H3 24/32 ·
// H4 20/28 · P 16/24 — nothing under 16 for reading text), Saans + the serif
// italic for the company name and the price. Meta (hours, dates) may go to 14.
//
//   A "Refined"       — today's layout, the scale fixed: black 24px section
//                       titles, 16px items, group headings as words not caps
//   B "Summary first" — the answer at the top: price, hours and a contents list
//                       of sections with their timeframes, then the detail
//   C "Document"      — a printed-proposal page: no cards, sections as rows
//                       with the title on the left and the items on the right
//
// Kept from earlier rounds (see public-estimate-view.tsx): no section numbers,
// no cyan, no blue edge bar, no navy header; the total is white with blue text.

import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, Clock } from "lucide-react";
import { fmtHours, fmtNis } from "@/lib/leads/estimate";
import type { PublishedEstimate } from "@/lib/leads/estimates-data";
import { PublicEstimateView } from "@/app/estimate/[token]/public-estimate-view";

type Phase = PublishedEstimate["phases"][number];
type Line = Phase["lines"][number];
type Range = { min: number; max: number };

/* ── fixture: an invented client ───────────────────────────────────────── */

const r = (min: number, max: number): Range => ({ min, max });
const L = (name: string, hours: Range, description: string | null = null, extra: Partial<Line> = {}): Line => ({
  name,
  description,
  hours,
  optional: false,
  altGroup: null,
  chosen: true,
  group: null,
  ...extra,
});

const FIXTURE: PublishedEstimate = {
  company: "Lumen Health",
  version: 2,
  rate: 350,
  vatPercent: 18,
  discountPercent: 10,
  discountNote: null,
  intro:
    "Thank you for inviting us in. Below is how we would take Lumen from a working name to a brand and website ready for launch — what we'll make, roughly how long each part takes, and what it comes to.",
  timeline: null,
  closing:
    "Hours are a range because the work is creative: we bill what we actually spend, and we'll tell you well before we near the top of a range. Happy to walk you through any of it.",
  phases: [
    {
      name: "Discovery & strategy",
      description: "We get to know Lumen, its audience and its competitors, and agree on where the brand should stand.",
      timeframe: "Weeks 1–2",
      hours: r(24, 32),
      groups: [],
      lines: [
        L("Kick-off workshop", r(6, 8), "A half-day session with your team to align on goals, audience and taste."),
        L("Competitor & audience review", r(10, 14)),
        L("Brand positioning brief", r(8, 10), "One page that every later decision is checked against."),
      ],
    },
    {
      name: "Brand identity",
      description: null,
      timeframe: "Weeks 3–6",
      hours: r(70, 96),
      groups: [
        { name: "Logo", hours: r(40, 56) },
        { name: "Visual system", hours: r(30, 40) },
      ],
      lines: [
        L("Two logo directions", r(24, 32), "Two distinct routes, presented in context.", { altGroup: "Concept rounds", chosen: true, group: 0 }),
        L("Three logo directions", r(36, 48), "A wider first look, if you'd like more to choose from.", { altGroup: "Concept rounds", chosen: false, group: 0 }),
        L("Refinement of the chosen logo", r(16, 24), null, { group: 0 }),
        L("Colour & typography", r(12, 16), null, { group: 1 }),
        L("Brand guidelines", r(18, 24), "A short, practical PDF your team and suppliers can work from.", { group: 1 }),
      ],
    },
    {
      name: "Website",
      description: "Design of the marketing site, ready for your developers.",
      timeframe: "Weeks 6–10",
      hours: r(100, 138.5),
      groups: [],
      lines: [
        L("UX & wireframes", r(30, 40), null, { category: "website" }),
        L("UI design — up to 8 pages", r(50, 70), "Desktop, with a small component library.", { category: "website" }),
        L("Three more page templates", r(12, 18), null, { category: "website", optional: true }),
        L("Mobile adaptation", r(12, 16.5), "15% of the website design.", {
          category: "website",
          percent: { of: "website", percent: 15 },
        }),
        L("Developer handoff", r(8, 12), null, { category: "other" }),
        L("Motion & micro-interactions", r(12, 20), null, { category: "other", optional: true }),
      ],
    },
    {
      name: "Launch kit",
      description: null,
      timeframe: "On request",
      hours: r(0, 0),
      groups: [],
      lines: [
        L("Social media templates", r(10, 14), null, { optional: true }),
        L("Launch presentation", r(12, 16), null, { optional: true }),
      ],
    },
  ],
  totalHours: r(194, 266.5),
  subtotal: r(67900, 93275),
  discount: r(6790, 9327.5),
  net: r(61110, 83947.5),
  publishedAt: "2026-11-09T10:00:00.000Z",
};

/* ── shared logic (the same rules as the real page) ────────────────────── */

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const outOfTotal = (p: Phase) => p.lines.length > 0 && p.lines.every((l) => l.optional || (l.altGroup && !l.chosen));
const sumLines = (lines: Line[]) => lines.reduce((a, l) => ({ min: a.min + l.hours.min, max: a.max + l.hours.max }), { min: 0, max: 0 });
const phaseHours = (p: Phase) => (outOfTotal(p) ? sumLines(p.lines) : p.hours);

function segmentsOf(p: Phase) {
  const out: { group: NonNullable<Phase["groups"]>[number] | null; lines: Line[] }[] = [];
  let last: number | null | undefined;
  for (const l of p.lines) {
    const g = l.group ?? null;
    if (out.length && last === g) out[out.length - 1].lines.push(l);
    else out.push({ group: g === null ? null : (p.groups?.[g] ?? null), lines: [l] });
    last = g;
  }
  return out;
}

/** Runs of lines: a real "choose one" group as one block, everything else one by one. */
function blocksOf(lines: Line[]) {
  const seen = new Set<string>();
  const out: ({ kind: "line"; line: Line } | { kind: "choice"; name: string; options: Line[] })[] = [];
  for (const l of lines) {
    const options = l.altGroup ? lines.filter((x) => x.altGroup === l.altGroup) : [];
    if (l.altGroup && options.length > 1) {
      if (!seen.has(l.altGroup)) out.push({ kind: "choice", name: l.altGroup, options });
      seen.add(l.altGroup);
    } else out.push({ kind: "line", line: l });
  }
  return out;
}

const Para = ({ text, className = "" }: { text: string | null | undefined; className?: string }) =>
  text ? <div className={`bidi-auto whitespace-pre-wrap ${className}`}>{text}</div> : null;

const Wordmark = ({ w = "w-32 sm:w-40" }: { w?: string }) => (
  <span className="shrink-0">
    <span className={`brand-wordmark bg-brand ${w}`} role="img" aria-label="Studio&more" />
  </span>
);

/** Quiet status pill; 13px is meta, it sits beside a 16px name. */
const Pill = ({ children, brand }: { children: ReactNode; brand?: boolean }) => (
  <span
    className={`ml-2 inline-block rounded-full px-2.5 py-0.5 align-[2px] text-[13px] font-medium leading-5 ${
      brand ? "bg-brand-soft text-brand" : "bg-[var(--light-white)] text-muted ring-1 ring-border"
    }`}
  >
    {children}
  </span>
);

const Timeframe = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-[14px] font-medium text-brand">
    <CalendarDays size={15} strokeWidth={1.75} aria-hidden />
    <span className="bidi-auto">{children}</span>
  </span>
);

/** One item at reading size: 16/24 name, 15/24 description, hours as 15px meta. */
function Item({ l, label, tag }: { l: Line; label?: string; tag?: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-6">
        <span className="bidi-auto text-[16px] font-medium leading-6">
          {label ?? l.name}
          {tag ?? (l.optional ? <Pill>Optional</Pill> : null)}
        </span>
        <span className="shrink-0 text-[15px] leading-6 tabular-nums text-muted">{fmtHours(l.hours)}</span>
      </div>
      <Para text={l.description} className="mt-1 max-w-[60ch] text-[15px] leading-6 text-muted" />
    </div>
  );
}

function Lines({ lines }: { lines: Line[] }) {
  return (
    <ul className="keep-lines divide-y divide-border">
      {blocksOf(lines).map((b, i) =>
        b.kind === "line" ? (
          <li key={i} className="py-4 first:pt-0 last:pb-0">
            <Item l={b.line} />
          </li>
        ) : (
          <li key={i} className="py-4 first:pt-0 last:pb-0">
            <p className="bidi-auto text-[14px] font-medium text-muted">
              Choose one · <span className="text-foreground">{b.name}</span>
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {b.options.map((o, k) => (
                <div
                  key={k}
                  className={`rounded-xl p-4 ${o.chosen ? "bg-brand-soft/60 ring-2 ring-brand/50" : "bg-[var(--light-white)] ring-1 ring-border"}`}
                >
                  <Item l={o} tag={o.chosen ? <Pill brand>Recommended</Pill> : <span />} />
                </div>
              ))}
            </div>
          </li>
        ),
      )}
    </ul>
  );
}

/** Groups as words (16px, Studio Black) with their subtotal — not 12px caps. */
function Body({ p }: { p: Phase }) {
  return (
    <div className="flex flex-col gap-8">
      {segmentsOf(p).map((seg, k) =>
        seg.group ? (
          <div key={k}>
            <h4 className="mb-4 flex items-baseline justify-between gap-3 border-b border-foreground/80 pb-2 text-[16px] font-medium leading-6">
              <span className="bidi-auto">{seg.group.name}</span>
              <span className="shrink-0 text-[15px] font-normal tabular-nums text-muted">{fmtHours(seg.group.hours)}</span>
            </h4>
            <Lines lines={seg.lines} />
          </div>
        ) : (
          <Lines key={k} lines={seg.lines} />
        ),
      )}
    </div>
  );
}

const hoursNote = (p: Phase) => (outOfTotal(p) ? `${fmtHours(phaseHours(p))} · optional, not in the total` : fmtHours(p.hours));

/** A foldable section card (A and B). */
function SectionCard({ p, id }: { p: Phase; id?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <section id={id} className="scroll-mt-6 overflow-hidden rounded-3xl bg-surface shadow-card break-inside-avoid-page">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-6 pb-5 pt-6 text-left transition-colors hover:bg-[var(--light-white)] sm:px-8"
      >
        <span className="min-w-0 flex-1">
          <span className="bidi-auto block text-[24px] font-medium leading-8">{p.name}</span>
          <span className="mt-1 block text-[15px] tabular-nums text-muted">
            {hoursNote(p)}
            {!open && ` · ${p.lines.length} ${p.lines.length === 1 ? "item" : "items"}`}
          </span>
        </span>
        {p.timeframe && (
          <span className="mt-0.5">
            <Timeframe>{p.timeframe}</Timeframe>
          </span>
        )}
        <ChevronDown size={20} aria-hidden className={`mt-1.5 shrink-0 text-faint transition-transform print:hidden ${open ? "" : "-rotate-90"}`} />
      </button>
      <div className={`px-6 pb-7 sm:px-8 ${open ? "" : "hidden print:block"}`}>
        <Para text={p.description} className="mb-6 max-w-[60ch] text-[16px] leading-6 text-muted" />
        <Body p={p} />
      </div>
    </section>
  );
}

/** The bottom line: white, blue text, the gradient strip — as agreed in earlier rounds, at the new scale. */
function TotalCard({ s, compact }: { s: PublishedEstimate; compact?: boolean }) {
  const discounted = (s.discountPercent ?? 0) > 0;
  return (
    <section className="overflow-hidden rounded-3xl bg-surface text-brand shadow-card break-inside-avoid-page">
      <div className="h-1.5 bg-gradient-to-r from-[#0b43ed] to-[#6181e8] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]" />
      <div className={compact ? "p-6 sm:p-8" : "p-6 sm:p-10"}>
        <p className="text-[16px] font-medium">Total estimate</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
          <span className={`font-serif-accent leading-none tabular-nums ${compact ? "text-[40px] sm:text-[56px]" : "text-[40px] sm:text-[64px]"}`}>
            <Price r={s.net} />
          </span>
          <span className="text-[16px] text-brand/75">+ VAT</span>
        </div>
        <p className="mt-3 flex items-center gap-2 text-[16px] tabular-nums">
          <Clock size={17} strokeWidth={1.75} aria-hidden />
          {fmtHours(s.totalHours)} of work
        </p>
        {discounted && (
          <dl className="mt-6 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[15px] text-brand/75">
            <dt>Before discount</dt>
            <dd className="text-right tabular-nums">{fmtNis(s.subtotal)}</dd>
            <dt>Discount {s.discountPercent}%</dt>
            <dd className="text-right tabular-nums">−{fmtNis(s.discount)}</dd>
          </dl>
        )}
        <p className="mt-6 border-t border-brand/15 pt-4 text-[15px] leading-6 text-brand/75">
          We work on an hourly basis — {s.rate} NIS + VAT per hour. Optional items and options not chosen are not in the total.
        </p>
      </div>
    </section>
  );
}

/** A price range that breaks (on a phone) only between its two figures, never inside one. */
function Price({ r }: { r: Range }) {
  const [a, b] = fmtNis(r).split("–");
  return b ? (
    <>
      <span className="whitespace-nowrap">{a}–</span>
      <wbr />
      <span className="whitespace-nowrap">{b}</span>
    </>
  ) : (
    <span className="whitespace-nowrap">{a}</span>
  );
}

const PrintNote = () => (
  <p className="mt-12 text-[14px] text-faint print:hidden">Use your browser&rsquo;s Print to save this offer as a PDF.</p>
);

/* ── A · Refined ───────────────────────────────────────────────────────── */

function DirA({ s }: { s: PublishedEstimate }) {
  return (
    <main className="min-h-dvh bg-[var(--light-white)] print:bg-white">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 text-foreground sm:px-6 sm:py-16">
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[16px] text-muted">Offer for</p>
            <h1 className="bidi-auto mt-1 font-serif-accent text-[48px] leading-[56px] sm:text-[72px] sm:leading-[80px]">{s.company}</h1>
            <p className="mt-3 text-[18px] leading-7 text-muted">
              Scope, pricing &amp; timeline · {fmtDate(s.publishedAt)}
            </p>
          </div>
          <span className="mt-2">
            <Wordmark />
          </span>
        </header>
        <Para text={s.intro} className="mt-10 max-w-[62ch] text-[18px] leading-7" />
        <div className="mt-12 flex flex-col gap-5">
          {s.phases.map((p, i) => (
            <SectionCard key={i} p={p} />
          ))}
        </div>
        <div className="mt-8">
          <TotalCard s={s} />
        </div>
        <Para text={s.closing} className="mt-10 max-w-[62ch] text-[18px] leading-7" />
        <PrintNote />
      </div>
    </main>
  );
}

/* ── B · Summary first ─────────────────────────────────────────────────── */

function DirB({ s }: { s: PublishedEstimate }) {
  return (
    <main className="min-h-dvh bg-[var(--light-white)] print:bg-white">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 text-foreground sm:px-6 sm:py-16">
        <header className="flex items-center justify-between gap-6">
          <Wordmark w="w-28 sm:w-32" />
          <p className="text-[15px] text-muted">{fmtDate(s.publishedAt)}</p>
        </header>
        <h1 className="mt-14 text-[40px] font-medium leading-[48px] sm:text-[56px] sm:leading-[64px]">
          An offer for <span className="bidi-auto font-serif-accent font-normal text-brand">{s.company}</span>
        </h1>
        <Para text={s.intro} className="mt-6 max-w-[62ch] text-[18px] leading-7 text-muted" />

        {/* At a glance: the three answers a client opens the link for. */}
        <section className="mt-10 overflow-hidden rounded-3xl bg-surface shadow-card">
          <div className="grid gap-px bg-border sm:grid-cols-[1.6fr_1fr]">
            <div className="bg-surface p-6 text-brand sm:p-8">
              <p className="text-[16px] font-medium">Total estimate</p>
              <p className="mt-2 font-serif-accent text-[36px] leading-tight tabular-nums sm:text-[44px]"><Price r={s.net} /></p>
              <p className="mt-2 text-[15px] text-brand/75">+ VAT{s.discountPercent ? ` · includes a ${s.discountPercent}% discount` : ""}</p>
            </div>
            <div className="flex flex-col justify-center gap-4 bg-surface p-6 sm:p-8">
              <div>
                <p className="text-[14px] text-muted">Hours</p>
                <p className="text-[20px] font-medium leading-7 tabular-nums">{fmtHours(s.totalHours)}</p>
              </div>
              <div>
                <p className="text-[14px] text-muted">Hourly rate</p>
                <p className="text-[20px] font-medium leading-7 tabular-nums">{s.rate} NIS + VAT</p>
              </div>
            </div>
          </div>
          <ol className="keep-lines divide-y divide-border border-t border-border">
            {s.phases.map((p, i) => (
              <li key={i}>
                <a
                  href={`#sec-${i}`}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 px-6 py-4 transition-colors hover:bg-[var(--light-white)] sm:grid-cols-[1fr_9rem_8rem] sm:px-8"
                >
                  <span className="bidi-auto text-[16px] font-medium">
                    {p.name}
                    {outOfTotal(p) && <Pill>Optional</Pill>}
                  </span>
                  <span className="text-right text-[15px] tabular-nums text-muted sm:order-last">{fmtHours(phaseHours(p))}</span>
                  <span className="bidi-auto col-span-2 text-[15px] text-brand sm:col-span-1">{p.timeframe}</span>
                </a>
              </li>
            ))}
          </ol>
        </section>

        <h2 className="mt-20 text-[32px] font-medium leading-10 sm:text-[40px] sm:leading-[48px]">
          The work, <span className="font-serif-accent font-normal">in detail</span>
        </h2>
        <div className="mt-8 flex flex-col gap-5">
          {s.phases.map((p, i) => (
            <SectionCard key={i} id={`sec-${i}`} p={p} />
          ))}
        </div>
        <div className="mt-8">
          <TotalCard s={s} compact />
        </div>
        <Para text={s.closing} className="mt-10 max-w-[62ch] text-[18px] leading-7" />
        <PrintNote />
      </div>
    </main>
  );
}

/* ── C · Document ──────────────────────────────────────────────────────── */

function DirC({ s }: { s: PublishedEstimate }) {
  const discounted = (s.discountPercent ?? 0) > 0;
  return (
    <main className="min-h-dvh bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 text-foreground sm:px-10 sm:py-16">
        <header className="flex items-center justify-between gap-6 border-b border-foreground pb-5">
          <Wordmark w="w-28 sm:w-32" />
          <p className="text-[15px] text-muted">Offer · {fmtDate(s.publishedAt)}</p>
        </header>
        <div className="grid gap-8 pt-14 md:grid-cols-[1fr_2fr] md:gap-12">
          <p className="text-[16px] font-medium text-brand">Scope, pricing &amp; timeline</p>
          <div>
            <h1 className="bidi-auto font-serif-accent text-[56px] leading-[60px] sm:text-[88px] sm:leading-[92px]">{s.company}</h1>
            <Para text={s.intro} className="mt-8 max-w-[58ch] text-[20px] leading-8" />
          </div>
        </div>

        <div className="mt-20">
          {s.phases.map((p, i) => (
            <section
              key={i}
              className="grid gap-6 border-t border-border py-10 break-inside-avoid-page md:grid-cols-[1fr_2fr] md:gap-12"
            >
              <div>
                <h2 className="bidi-auto text-[24px] font-medium leading-8">{p.name}</h2>
                <p className="mt-2 text-[15px] tabular-nums text-muted">{hoursNote(p)}</p>
                {p.timeframe && <p className="bidi-auto mt-1 text-[15px] font-medium text-brand">{p.timeframe}</p>}
              </div>
              <div>
                <Para text={p.description} className="mb-6 max-w-[58ch] text-[17px] leading-7" />
                <Body p={p} />
              </div>
            </section>
          ))}
        </div>

        <section className="grid gap-6 border-t-2 border-brand pt-8 text-brand break-inside-avoid-page md:grid-cols-[1fr_2fr] md:gap-12">
          <div>
            <h2 className="text-[24px] font-medium leading-8">Total estimate</h2>
            <p className="mt-2 text-[15px] tabular-nums text-brand/75">{fmtHours(s.totalHours)}</p>
          </div>
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-serif-accent text-[40px] leading-tight tabular-nums md:text-[44px] lg:text-[64px]"><Price r={s.net} /></span>
              <span className="text-[16px] text-brand/75">+ VAT</span>
            </div>
            {discounted && (
              <dl className="mt-6 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[15px] text-brand/75">
                <dt>Before discount</dt>
                <dd className="text-right tabular-nums">{fmtNis(s.subtotal)}</dd>
                <dt>Discount {s.discountPercent}%</dt>
                <dd className="text-right tabular-nums">−{fmtNis(s.discount)}</dd>
              </dl>
            )}
            <p className="mt-6 max-w-[58ch] text-[15px] leading-6 text-brand/75">
              We work on an hourly basis — {s.rate} NIS + VAT per hour. Optional items and options not chosen are not in the total.
            </p>
          </div>
        </section>

        <div className="mt-16 grid gap-6 border-t border-border pt-10 md:grid-cols-[1fr_2fr] md:gap-12">
          <span />
          <div>
            <Para text={s.closing} className="max-w-[58ch] text-[18px] leading-7" />
            <PrintNote />
          </div>
        </div>
      </div>
    </main>
  );
}

/* ── the switch ────────────────────────────────────────────────────────── */

type Dir = "now" | "A" | "B" | "C";
const DIRS: { id: Dir; label: string; tip: string }[] = [
  { id: "now", label: "Live page", tip: "The real offer page component — A, adjusted (2026-11-09)" },
  { id: "A", label: "A · first draft", tip: "Same layout, the type scale fixed and the hierarchy cleared up" },
  { id: "B", label: "B · Summary first", tip: "Price, hours and a contents list at the top, the detail below" },
  { id: "C", label: "C · Document", tip: "A printed-proposal page: no cards, title left, items right" },
];

export function EstimateLab() {
  const [dir, setDir] = useState<Dir>("now");
  const [read, setRead] = useState(false);
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("d") as Dir | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL
    if (d && DIRS.some((x) => x.id === d)) setDir(d);
    setRead(true);
  }, []);
  useEffect(() => {
    if (read) window.history.replaceState(null, "", `?d=${dir}`);
  }, [read, dir]);

  return (
    <div>
      {dir === "now" && <PublicEstimateView s={FIXTURE} />}
      {dir === "A" && <DirA s={FIXTURE} />}
      {dir === "B" && <DirB s={FIXTURE} />}
      {dir === "C" && <DirC s={FIXTURE} />}
      <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 gap-1 rounded-2xl bg-[#111] p-1.5 text-xs text-white shadow-2xl print:hidden">
        {DIRS.map((d) => (
          <button
            key={d.id}
            title={d.tip}
            onClick={() => {
              setDir(d.id);
              window.scrollTo(0, 0);
            }}
            className={`whitespace-nowrap rounded-xl px-3 py-2 ${dir === d.id ? "bg-white text-[#111]" : "text-white/75 hover:text-white"}`}
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}
