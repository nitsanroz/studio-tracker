"use client";

import { useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { fmtHours, fmtNis } from "@/lib/leads/estimate";
import type { PublishedEstimate } from "@/lib/leads/estimates-data";

// The client's copy of an estimate, drawn from the frozen snapshot only.
// Restyled 2026-10-12 (Nitsan): each section is a foldable card with its
// timeframe beside the title — which replaces the old separate Timeline section,
// so the snapshot's `timeline` text is not drawn — sections are plain white cards, the total is a white card in brand-blue text under the finance product's gradient strip, and the
// studio's fonts and logo carry the page — the same register as the shared
// timeline and the client hours report.

type Phase = PublishedEstimate["phases"][number];
type Line = Phase["lines"][number];

const Para = ({ text, className = "" }: { text: string | null | undefined; className?: string }) =>
  text ? <div className={`bidi-auto whitespace-pre-wrap leading-relaxed ${className}`}>{text}</div> : null;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** A pill naming a line's status; quiet so it never competes with the item name. */
const Tag = ({ children, tone = "muted" }: { children: string; tone?: "muted" | "brand" }) => (
  <span
    className={`ml-2 inline-block rounded-full px-2 py-0.5 align-middle text-[11.5px] font-medium ${
      tone === "brand" ? "bg-brand-soft text-brand" : "bg-background text-muted"
    }`}
  >
    {children}
  </span>
);

function Item({ name, hours, description, tag }: { name: string; hours: Line["hours"]; description: string | null; tag?: ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="bidi-auto text-[15px] font-medium">
          {name}
          {tag}
        </span>
        <span className="shrink-0 text-[14px] tabular-nums text-muted">{fmtHours(hours)}</span>
      </div>
      <Para text={description} className="mt-1 text-[14px] text-muted" />
    </div>
  );
}

/**
 * One run of lines. Lines sharing a "choose one" group print together as
 * options — but ⚠️ ONLY when the group really offers a choice. A group holding a
 * single line is just an item: printing "(choose one)" and "Option 1" over it
 * (as DNA Travel's Strategy section did) asks the client to choose from nothing.
 * ⚠️ HOURS ONLY — money appears once, on the total (Nitsan, 2026-10-04).
 */
function LineList({ lines }: { lines: Line[] }) {
  const seen = new Set<string>();
  return (
    <ul className="divide-y divide-border">
      {lines.map((l, j) => {
        const options = l.altGroup ? lines.filter((x) => x.altGroup === l.altGroup) : [];
        if (l.altGroup && options.length > 1) {
          if (seen.has(l.altGroup)) return null;
          seen.add(l.altGroup);
          return (
            <li key={j} className="py-4 first:pt-0 last:pb-0">
              <div className="text-[12px] font-medium uppercase tracking-wide text-muted">
                {l.altGroup} · choose one
              </div>
              <div className="mt-3 flex flex-col gap-3">
                {options.map((o, k) => (
                  <div key={k} className={`rounded-xl border p-3 ${o.chosen ? "border-brand/40 bg-brand-soft/40" : "border-border"}`}>
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
          <li key={j} className="py-4 first:pt-0 last:pb-0">
            <Item name={l.name} hours={l.hours} description={l.description} tag={l.optional ? <Tag>Optional</Tag> : undefined} />
          </li>
        );
      })}
    </ul>
  );
}

/** True when nothing in the section counts toward the total (all optional / not chosen). */
const allOutOfTotal = (p: Phase) => p.lines.length > 0 && p.lines.every((l) => l.optional || (l.altGroup && !l.chosen));

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
    <section className="overflow-hidden rounded-2xl bg-surface shadow-card break-inside-avoid-page">
      {/* History, so the next round doesn't repeat it (Nitsan, 2026-10-12): a pale brand
          tint read as washed out, a full navy header was too heavy, and section numbers
          and cyan accents were unwanted, and so was a blue bar down the left edge. What stays: a white header with the title in
          Studio Black on a white card, and the timeframe in a brand-soft pill. */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-background/60 sm:gap-4 sm:px-6"
      >
        <span className="min-w-0 flex-1">
          <span className="bidi-auto block text-[19px] font-medium leading-snug text-brand">{p.name}</span>
          <span className="mt-0.5 block text-[13px] tabular-nums text-muted">
            {optionalOnly ? `${fmtHours(sumLines(p.lines))} · optional, not in the total` : fmtHours(p.hours)}
            {!open && ` · ${p.lines.length} ${p.lines.length === 1 ? "item" : "items"}`}
          </span>
        </span>
        {p.timeframe && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-[13px] font-medium text-brand">
            <CalendarDays size={14} aria-hidden />
            <span className="bidi-auto">{p.timeframe}</span>
          </span>
        )}
        <ChevronDown
          size={18}
          aria-hidden
          className={`shrink-0 text-faint transition-transform print:hidden ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {/* Folded sections still print: a client saving the page as a PDF wants all of it. */}
      <div className={`mx-5 border-t border-border/70 pb-5 pt-4 sm:mx-6 ${open ? "" : "hidden print:block"}`}>
        <Para text={p.description} className="mb-4 text-[14.5px] text-muted" />
        <div className="flex flex-col gap-6">
          {segments.map((seg, k) => {
            const g = seg.group !== null ? p.groups?.[seg.group] : undefined;
            if (!g) return <LineList key={k} lines={seg.lines} />;
            return (
              <div key={k} className="break-inside-avoid">
                <h3 className="mb-3 flex items-baseline justify-between gap-3 text-[12px] font-medium uppercase tracking-wide text-muted">
                  <span className="bidi-auto">{g.name}</span>
                  <span className="shrink-0 tabular-nums normal-case tracking-normal">{fmtHours(g.hours)}</span>
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

/** A section's own range when every line in it is out of the total — its COUNTED hours are 0, which read as "0 hrs" before. */
function sumLines(lines: Line[]) {
  return lines.reduce((a, l) => ({ min: a.min + l.hours.min, max: a.max + l.hours.max }), { min: 0, max: 0 });
}

export function PublicEstimateView({ s }: { s: PublishedEstimate }) {
  const discounted = (s.discountPercent ?? 0) > 0;
  return (
    <main className="min-h-dvh bg-background print:bg-white">
      <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 text-foreground sm:px-6 sm:py-12 print:py-0">
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[13px] text-muted">Offer · {fmtDate(s.publishedAt)}</p>
            <h1 className="bidi-auto mt-2 font-serif-accent text-4xl leading-tight sm:text-5xl">{s.company}</h1>
            <p className="mt-2 text-[15px] text-muted">Estimated scope, pricing &amp; timeline</p>
          </div>
          {/* ⚠️ Responsive sizing on a WRAPPER: `.brand-wordmark` sets display unlayered. */}
          <span className="mt-1 shrink-0">
            <span className="brand-wordmark w-28 bg-brand sm:w-36" role="img" aria-label="Studio&more" />
          </span>
        </header>

        <Para text={s.intro} className="mt-8 max-w-prose text-[16px]" />

        <div className="mt-8 flex flex-col gap-4">
          {s.phases.map((p, i) => (
            <Section key={i} phase={p} />
          ))}
        </div>

        {/* The total: white with brand-blue text (Nitsan: "only blue texts"), topped by the
            finance product's brand → light-blue strip so it reads as the bottom line rather
            than one more section. */}
        <section className="mt-6 overflow-hidden rounded-2xl bg-surface text-brand shadow-card break-inside-avoid-page">
          <div className="h-1.5 bg-gradient-to-r from-[#0b43ed] to-[#6181e8] [-webkit-print-color-adjust:exact] [print-color-adjust:exact]" />
          <div className="p-6 sm:p-8">
            <p className="text-[12.5px] font-medium uppercase tracking-wide text-brand/75">Total estimate</p>
            {discounted && (
              <div className="mt-3 flex flex-col gap-1 text-[14px] text-brand/75">
                <div className="flex justify-between gap-4">
                  <span>Before discount</span>
                  <span className="tabular-nums">{fmtNis(s.subtotal)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Discount {s.discountPercent}%</span>
                  <span className="tabular-nums">−{fmtNis(s.discount)}</span>
                </div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1">
              <div className="font-serif-accent text-4xl leading-tight tabular-nums sm:text-5xl">
                {fmtNis(s.net)}
                <span className="ml-2 font-sans text-[15px] text-brand/75">+ VAT</span>
              </div>
              <div className="text-[15px] font-medium tabular-nums">{fmtHours(s.totalHours)}</div>
            </div>
            <p className="mt-5 border-t border-brand/15 pt-3 text-[13px] leading-relaxed text-brand/75">
              We work on an hourly basis ({s.rate} NIS + VAT per hour). Optional items and options not chosen are not
              included in the total.
            </p>
          </div>
        </section>

        <Para text={s.closing} className="mt-8 max-w-prose text-[15px]" />

        <p className="mt-10 text-[12px] text-faint print:hidden">Use your browser&rsquo;s Print to save this offer as a PDF.</p>
      </div>
    </main>
  );
}
