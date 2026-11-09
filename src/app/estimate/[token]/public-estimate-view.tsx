"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { fmtHours, fmtNis } from "@/lib/leads/estimate";
import type { PublishedEstimate } from "@/lib/leads/estimates-data";

// The client's copy of an estimate, drawn from the frozen snapshot only.
//
// Typography round (2026-11-09, Nitsan picked direction "A · Refined" from
// /design-lab/estimate, then adjusted it): the website's type scale — nothing
// a client reads is under 16px, meta (hours, dates) at 14–15. Each section's
// header is its own strip: the title in brand blue, its hours beside the
// timeframe chip on the right. Items are 18px. The total says "Total estimate ·
// N hrs of work" in Studio Black above a blue serif price.
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

function Item({ name, hours, description, tag }: { name: string; hours: Line["hours"]; description: string | null; tag?: ReactNode }) {
  return (
    <div>
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
 */
function LineList({ lines }: { lines: Line[] }) {
  const seen = new Set<string>();
  return (
    <ul className="flex flex-col gap-6">
      {lines.map((l, j) => {
        const options = l.altGroup ? lines.filter((x) => x.altGroup === l.altGroup) : [];
        if (l.altGroup && options.length > 1) {
          if (seen.has(l.altGroup)) return null;
          seen.add(l.altGroup);
          return (
            <li key={j}>
              <p className="bidi-auto text-[15px] font-medium text-muted">
                Choose one · <span className="text-foreground">{l.altGroup}</span>
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {options.map((o, k) => (
                  <div
                    key={k}
                    className={`rounded-xl p-4 ${
                      o.chosen ? "bg-brand-soft/60 ring-2 ring-brand/50" : "bg-[var(--light-white)] ring-1 ring-border"
                    }`}
                  >
                    <Item
                      name={`Option ${k + 1}: ${o.name}`}
                      hours={o.hours}
                      description={o.description}
                      tag={o.chosen ? <Tag tone="brand">Recommended</Tag> : undefined}
                    />
                  </div>
                ))}
              </div>
            </li>
          );
        }
        return (
          <li key={j}>
            <Item name={l.name} hours={l.hours} description={l.description} tag={l.optional ? <Tag>Optional</Tag> : undefined} />
          </li>
        );
      })}
    </ul>
  );
}

/** True when nothing in the section counts toward the total (all optional / not chosen). */
const allOutOfTotal = (p: Phase) => p.lines.length > 0 && p.lines.every((l) => l.optional || (l.altGroup && !l.chosen));

/** A section's own range when every line in it is out of the total — its COUNTED hours are 0, which read as "0 hrs" before. */
function sumLines(lines: Line[]) {
  return lines.reduce((a, l) => ({ min: a.min + l.hours.min, max: a.max + l.hours.max }), { min: 0, max: 0 });
}

function Section({ phase: p }: { phase: Phase }) {
  const [open, setOpen] = useState(true);
  // Groups first, each a sub-heading with its own subtotal, then the loose lines —
  // the editor's order (0049). A snapshot from before groups renders flat.
  const segments: { group: number | null; lines: Line[] }[] = [];
  for (const l of p.lines) {
    const g = l.group ?? null;
    const last = segments[segments.length - 1];
    if (last && last.group === g) last.lines.push(l);
    else segments.push({ group: g, lines: [l] });
  }
  const optionalOnly = allOutOfTotal(p);
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
              {optionalOnly ? (
                <>
                  {fmtHours(sumLines(p.lines))} <span className="font-normal text-muted">· optional</span>
                </>
              ) : (
                fmtHours(p.hours)
              )}
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
            {optionalOnly && <span className="block">Optional — not included in the total.</span>}
          </span>
        )}
      </button>
      {/* Folded sections still print: a client saving the page as a PDF wants all of it. */}
      <div className={`px-6 pb-7 pt-6 sm:px-8 ${open ? "" : "hidden print:block"}`}>
        <div className="flex flex-col gap-10">
          {segments.map((seg, k) => {
            const g = seg.group !== null ? p.groups?.[seg.group] : undefined;
            if (!g) return <LineList key={k} lines={seg.lines} />;
            return (
              <div key={k} className="break-inside-avoid">
                <h3 className="mb-4 flex items-baseline justify-between gap-3 text-[16px] font-medium leading-6 text-brand">
                  <span className="bidi-auto">{g.name}</span>
                  <span className="shrink-0 text-[15px] font-normal tabular-nums text-muted">{fmtHours(g.hours)}</span>
                </h3>
                <LineList lines={seg.lines} />
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
  return (
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

        <div className="mt-12 flex flex-col gap-5">
          {s.phases.map((p, i) => (
            <Section key={i} phase={p} />
          ))}
        </div>

        {/* The total: white, topped by the finance product's brand → light-blue strip so it
            reads as the bottom line. The heading line is Studio Black, the price blue. */}
        <section className="mt-8 overflow-hidden rounded-3xl bg-surface shadow-card break-inside-avoid-page">
          <div className="h-1.5 bg-gradient-to-r from-[#0b43ed] to-[#6181e8] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]" />
          <div className="p-6 sm:p-10">
            <p className="text-[20px] font-medium leading-7">
              Total estimate <span className="font-normal tabular-nums">· {fmtHours(s.totalHours)} of work</span>
            </p>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 text-brand">
              <span className="font-serif-accent text-[36px] leading-tight tabular-nums sm:text-[48px]">
                <Price r={s.net} />
              </span>
              <span className="text-[16px] text-brand/75">+ VAT</span>
            </div>
            {discounted && (
              <dl className="mt-6 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[15px] text-muted">
                <dt>Before discount</dt>
                <dd className="text-right tabular-nums">{fmtNis(s.subtotal)}</dd>
                <dt>Discount {s.discountPercent}%</dt>
                <dd className="text-right tabular-nums">−{fmtNis(s.discount)}</dd>
              </dl>
            )}
            <p className="mt-6 text-[15px] leading-6 text-muted">
              We work on an hourly basis — {s.rate} NIS + VAT per hour. Optional items and options not chosen are not
              included in the total.
            </p>
          </div>
        </section>

        <Para text={s.closing} className="mt-10 max-w-[62ch] text-[18px] leading-7" />

        <p className="mt-12 text-[14px] text-faint print:hidden">Use your browser&rsquo;s Print to save this offer as a PDF.</p>
      </div>
    </main>
  );
}
