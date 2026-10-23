"use client";

// Before / after for the four ways the tracker could line up with the studio
// website's design system (Figma "Design Systems", read 2026-10-23). Each row
// draws the same example twice at life size: as the app is now, and aligned.

import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Check, Clock, Plus, Search, Users } from "lucide-react";

/* ── the website's arrow, redrawn ──────────────────────────────────────────
   From Sandbox → Icons → "24/Arrows & Directions/Right": a near-straight shaft
   and a head whose two arms sweep in to a sharp tip; flat-cut ends; ~2 units of
   stroke at 24. Drawn as strokes (so it takes currentColor and any size) with
   butt caps and a high miter limit, which keeps the tip pointed. */
function StudioArrow({ size = 24, up = false, className = "" }: { size?: number; up?: boolean; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="butt"
      strokeLinejoin="miter"
      strokeMiterlimit={12}
      className={className}
      aria-hidden
    >
      <g transform={up ? "rotate(-45 12 12)" : undefined}>
        <path d="M2.5 12.6 C7.5 11.7 13 11.7 19.6 12" />
        <path d="M12.2 4.6 C14.6 8.4 16.9 10.7 20.6 12 C16.9 13.3 14.6 15.6 12.2 19.4" />
      </g>
    </svg>
  );
}

/* ── layout pieces ─────────────────────────────────────────────────────── */

function Pair({ before, after, note }: { before: ReactNode; after: ReactNode; note?: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[
        ["Now", before],
        ["Aligned with the website", after],
      ].map(([label, body], i) => (
        <div key={i}>
          <div className={`mb-2 text-xs font-medium uppercase tracking-wide ${i ? "text-brand" : "text-muted"}`}>{label}</div>
          <div className="min-h-32 rounded-2xl bg-background p-6 ring-1 ring-black/5">{body}</div>
        </div>
      ))}
      {note && <p className="text-[13px] text-muted lg:col-span-2">{note}</p>}
    </div>
  );
}

function Section({ n, title, line, children }: { n: number; title: string; line: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-baseline gap-3 text-2xl font-medium tracking-tight">
          <span className="text-brand">{n}</span> {title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">{line}</p>
      </div>
      {children}
    </section>
  );
}

const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-[20px] bg-surface p-5 shadow-card ${className}`}>{children}</div>
);

/* ── 1. serif-italic emphasis ──────────────────────────────────────────── */

function GreetingNow() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-12 items-center justify-center rounded-full bg-[#dc2626] font-medium text-white">NR</span>
      <div>
        <p className="text-sm text-muted">Good afternoon</p>
        <p className="font-serif-accent text-[26px] leading-8">Nitsan</p>
      </div>
      <div className="ml-8">
        <div className="font-serif-accent text-[30px] leading-9">
          10<span className="text-base">y</span> 4<span className="text-base">m</span> 22<span className="text-base">d</span>
        </div>
        <p className="text-xs text-muted">In the studio</p>
      </div>
    </div>
  );
}

function GreetingAligned() {
  return (
    <div>
      <p className="text-[40px] font-medium leading-[48px] tracking-[-0.02em]">
        Good afternoon, <span className="font-serif-accent font-normal text-brand">Nitsan</span>
      </p>
      <p className="mt-1 text-sm text-muted">10 years, 4 months and 22 days in the studio</p>
    </div>
  );
}

function VacationNow() {
  return (
    <div>
      <h1 className="page-title">Vacation</h1>
      <p className="mt-1 text-sm text-muted">Days come from your latest payslip; the owner approves each request.</p>
      <div className="mt-4 font-serif-accent text-[56px] leading-none">
        68<span className="ml-1.5 font-sans text-lg not-italic text-muted">days left</span>
      </div>
    </div>
  );
}

function VacationAligned() {
  return (
    <div>
      <p className="text-[40px] font-medium leading-[48px] tracking-[-0.02em]">
        Vacation — <span className="font-serif-accent font-normal text-brand">68 days</span> left
      </p>
      <p className="mt-1 text-sm text-muted">Days come from your latest payslip; the owner approves each request.</p>
    </div>
  );
}

/* ── 2. the website's arrow ────────────────────────────────────────────── */

function FreelancerCard({ aligned }: { aligned: boolean }) {
  return (
    <Card className="w-full max-w-sm p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-serif-accent text-[28px] leading-9">Daniel Ross</p>
          <p className="text-[13px] text-muted">€55.00/h up to 50h a month</p>
        </div>
        {aligned ? (
          <StudioArrow size={48} up className="-mr-2 -mt-2 text-faint" />
        ) : (
          <ArrowUpRight size={48} strokeWidth={2.25} strokeLinecap="butt" strokeLinejoin="miter" className="-mr-2 -mt-2 text-faint" />
        )}
      </div>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">October 2026</p>
      <p className="font-serif-accent text-[44px] leading-none text-brand">€2,667.50</p>
    </Card>
  );
}

function Links({ aligned }: { aligned: boolean }) {
  const A = aligned ? <StudioArrow size={16} /> : <ArrowRight size={12} />;
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center justify-between py-3">
        <span className="font-heading text-sm">My tasks (4)</span>
        <span className={`flex items-center gap-1 text-brand ${aligned ? "text-sm" : "text-xs"}`}>All tasks {A}</span>
      </Card>
      <Card className="flex items-center justify-between py-3">
        <span className="font-heading text-sm">The studio · 6 designers</span>
        <span className={`flex items-center gap-1 text-brand ${aligned ? "text-sm" : "text-xs"}`}>View team {A}</span>
      </Card>
      <div className="flex gap-2">
        <span className={`inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white`}>
          Open the client {aligned ? <StudioArrow size={18} /> : <ArrowRight size={15} />}
        </span>
      </div>
    </div>
  );
}

/* ── 3. Light White for quiet surfaces ─────────────────────────────────── */

function Surfaces({ well }: { well: string }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2 font-heading text-base">
        <Users size={18} strokeWidth={1.75} className="text-brand" /> The team
      </div>
      <div className="flex h-10 items-center gap-2 rounded-xl px-3.5 text-sm text-faint" style={{ background: well }}>
        <Search size={16} /> Search people
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Aki", "0"],
          ["Michal", "1.6"],
          ["Nitsan", "68"],
        ].map(([n, d]) => (
          <div key={n} className="rounded-xl px-3.5 py-3" style={{ background: well }}>
            <div className="text-[13px] font-medium">{n}</div>
            <div className="mt-0.5 text-2xl tabular-nums">
              {d}
              <span className="ml-1 text-sm text-muted">days</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {["International Artist's Day · 25/10", "Elections · 27/10"].map((t, i) => (
          <div key={t} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: i === 0 ? well : undefined }}>
            {i === 0 ? <Clock size={14} className="text-muted" /> : <Check size={14} className="text-muted" />} {t}
            {i === 0 && <span className="ml-auto text-xs text-muted">hover</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── 4. page title at the website's H2 ─────────────────────────────────── */

function TitleRow({ size }: { size: "now" | "aligned" }) {
  const cls = size === "now" ? "text-[34px] leading-[1.1] tracking-[-0.025em]" : "text-[40px] leading-[48px] tracking-[-0.025em]";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className={`font-medium ${cls}`}>Clients</p>
          <p className="mt-1 text-sm text-muted">24 active · 6 paused</p>
        </div>
        <span className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white">
          <Plus size={16} strokeWidth={2} /> New client
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-xl bg-[#7c3aed] text-lg text-white">V</span>
        <p className={`font-medium ${cls}`}>Variant</p>
      </div>
    </div>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

export function AlignLab() {
  return (
    <div className="app-canvas min-h-screen bg-background">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-14 px-6 pb-24 pt-10">
        <header>
          <h1 className="page-title">Aligning with the website</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Each example twice at real size — as the tracker is now, and with the website&apos;s design system applied.
            Brand blue, Saans and the serif are already shared; these are the four places they differ.
          </p>
        </header>

        <Section
          n={1}
          title="Serif italic for the word that matters"
          line="The website sets its headlines in Saans and puts the key word in brand-blue serif italic (“Want to apply?”). The tracker uses the serif for names and figures on their own. Aligned, a few headers read as one sentence with that one word picked out."
        >
          <Pair before={<GreetingNow />} after={<GreetingAligned />} />
          <Pair before={<VacationNow />} after={<VacationAligned />} />
        </Section>

        <Section
          n={2}
          title="The website's arrow"
          line="The website draws its own arrows: a near-straight shaft and a head whose arms sweep in to a sharp tip, flat-cut ends. The tracker uses the stock icon set's arrow."
        >
          <Pair
            before={<FreelancerCard aligned={false} />}
            after={<FreelancerCard aligned />}
            note="The corner arrow on a card that opens."
          />
          <Pair before={<Links aligned={false} />} after={<Links aligned />} note="Links and buttons that take you somewhere." />
        </Section>

        <Section
          n={3}
          title="Light White for quiet surfaces"
          line="The website's off-white is #F7F9FC, almost white with a cool tint. The tracker paints its quiet surfaces inside cards — fields, tiles, hovers — in the canvas grey #EEF0F6. Aligned, they use Light White; the canvas behind the cards stays as it is, so the cards still stand off the page."
        >
          <Pair before={<Surfaces well="var(--background)" />} after={<Surfaces well="#F7F9FC" />} />
        </Section>

        <Section
          n={4}
          title="Page titles at the website's H2"
          line="The website's headline steps are 72, 40, 24, 20 and 16px. The tracker's page titles are 34px, between two of them. Aligned, they use the website's H2: 40px on a 48px line. The work below them stays at the app's denser sizes."
        >
          <Pair before={<TitleRow size="now" />} after={<TitleRow size="aligned" />} />
        </Section>
      </div>
    </div>
  );
}
