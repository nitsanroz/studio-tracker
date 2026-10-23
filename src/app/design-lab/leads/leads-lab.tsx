"use client";

// Content options for Leads, drawn with the app's own tokens and classes at
// life size. Invented companies and people.
//
//   Board A "Calm card"        — same facts, one tone at a time: the attention
//                                note lives ON the card as a line, no bubbles
//   Board B "Next step first"  — the card's headline is what happens next;
//                                company and value become its caption
//   Page A  "Tidied"           — today's structure (tabs + side cards), unified
//   Page B  "Next step first"  — a "what's next" band and a row of the deal's
//                                facts above the tabs
//   Page C  "One feed"         — no tabs: calls, emails, offers and estimates in
//                                one timeline with filters
//
// Common to all: column headers and the stage track are neutral; each stage
// keeps its colour only as its icon (Nitsan's stage-bar decision, 2026-10-23).

import { useEffect, useState, type ReactNode } from "react";
import {
  AlarmClock,
  ArrowLeft,
  ArrowRightLeft,
  Calculator,
  Calendar,
  CalendarCheck,
  ChartPie,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleX,
  Compass,
  ExternalLink,
  FileText,
  Globe,
  Handshake,
  List,
  Mail,
  MailWarning,
  PanelRightClose,
  Pen,
  Phone,
  Plus,
  Scale,
  Search,
  Send,
  Settings,
  Sparkles,
  SquareKanban,
  StickyNote,
  Trash2,
  Trophy,
  UserRound,
  Users,
  Activity as ActivityIcon,
  type LucideIcon,
} from "lucide-react";

/* ── fixtures ──────────────────────────────────────────────────────────── */

type Stage = { name: string; color: string; Icon: LucideIcon; kind: "open" | "won" | "lost" };
const STAGES: Stage[] = [
  { name: "Relevant", color: "#ca8a04", Icon: Sparkles, kind: "open" },
  { name: "Discovery", color: "#0891b2", Icon: Compass, kind: "open" },
  { name: "Offer in prep", color: "#7c3aed", Icon: Pen, kind: "open" },
  { name: "Offer sent", color: "#0b43ed", Icon: Send, kind: "open" },
  { name: "Negotiation", color: "#ea580c", Icon: Scale, kind: "open" },
  { name: "Won", color: "#0f9d58", Icon: Trophy, kind: "won" },
  { name: "Lost", color: "#6b7280", Icon: CircleX, kind: "lost" },
];
const CLOSED_COUNTS: Record<string, number> = { Won: 18, Lost: 61 };

type Tone = "red" | "blue" | "purple" | "amber";
const TONE: Record<Tone, { text: string; bg: string; dot: string }> = {
  red: { text: "text-[#be123c]", bg: "bg-[#e11d48]/10", dot: "#e11d48" },
  blue: { text: "text-brand-dark", bg: "bg-brand-soft", dot: "#0b43ed" },
  purple: { text: "text-[#6d28d9]", bg: "bg-[#7c3aed]/10", dot: "#7c3aed" },
  amber: { text: "text-[#855800]", bg: "bg-warning/15", dot: "#ca8a04" },
};

type Lead = {
  company: string;
  contact: string;
  source: { label: string; Icon: LucideIcon };
  stage: string;
  value: number;
  hours: string | null;
  next: { text: string; due: string; overdue: boolean } | null;
  owner: string | null;
  days: number;
  isNew?: boolean;
  replyOwed?: boolean;
  nudge: { tone: Tone; Icon: LucideIcon; full: string; short: string } | null;
};

const WEB = { label: "Website form", Icon: Globe };
const LI = { label: "LinkedIn", Icon: Users };
const REF = { label: "Referral", Icon: Handshake };

const LEADS: Lead[] = [
  { company: "Mira Foods", contact: "Noa Peled", source: REF, stage: "Relevant", value: 40000, hours: "90–140 hrs",
    next: { text: "Answer her question about timelines", due: "23/10", overdue: false }, owner: "Nitsan", days: 2, replyOwed: true,
    nudge: { tone: "red", Icon: MailWarning, full: "Client waiting 2 days — reply", short: "Reply · 2d" } },
  { company: "Kite Robotics", contact: "Dana Mor", source: WEB, stage: "Discovery", value: 95000, hours: "443–824 hrs",
    next: null, owner: null, days: 19,
    nudge: { tone: "amber", Icon: AlarmClock, full: "Quiet 14 work days — check in", short: "Quiet · 14d" } },
  { company: "Orbit Health", contact: "Yael Ben-Ami", source: LI, stage: "Discovery", value: 60000, hours: "120–180 hrs",
    next: { text: "Send the discovery questions", due: "24/10", overdue: false }, owner: "Michal", days: 3, isNew: true, nudge: null },
  { company: "Lumen Energy", contact: "Tom Shalev", source: REF, stage: "Offer sent", value: 128000, hours: "300–420 hrs",
    next: { text: "Follow up on offer v1", due: "27/10", overdue: false }, owner: "Nitsan", days: 6,
    nudge: { tone: "blue", Icon: Send, full: "Offer sent 6 days ago — follow up", short: "Follow up · 6d" } },
  { company: "Northwind Labs", contact: "Rivi Cohen", source: WEB, stage: "Negotiation", value: 242900, hours: "762.5–1,164 hrs",
    next: { text: "Waiting for reply to renegotiate", due: "14/10", overdue: true }, owner: "Michal", days: 9,
    nudge: { tone: "red", Icon: Calendar, full: "9 days late: Waiting for reply to renegotiate", short: "Late · 9d" } },
];

const OWNERS: Record<string, string> = { Michal: "#e879a0", Nitsan: "#dc2626" };
const ils = (n: number) => `₪${n.toLocaleString("en-US")}`;

/* ── small pieces ──────────────────────────────────────────────────────── */

function Initials({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: OWNERS[name] ?? "#64748b", fontSize: size * 0.4 }}
    >
      {name[0]}
    </span>
  );
}

function Owner({ name }: { name: string | null }) {
  return name ? (
    <span className="flex items-center gap-1.5 text-[13px]">
      <Initials name={name} /> {name}
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-[13px] text-muted">
      <UserRound size={14} /> Unassigned
    </span>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-surface shadow-card ${className}`}>{children}</section>;
}

function CardTitle({ Icon, children, right, tone }: { Icon: LucideIcon; children: ReactNode; right?: ReactNode; tone?: string }) {
  return (
    <header className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-heading text-base">
        <Icon size={18} strokeWidth={1.75} className={tone ?? "text-brand"} />
        {children}
      </h2>
      {right}
    </header>
  );
}

function Seg({ items, active }: { items: { label: string; Icon: LucideIcon; count?: number }[]; active: number }) {
  return (
    <div className="flex w-max rounded-xl bg-track p-1">
      {items.map((it, i) => (
        <span
          key={it.label}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${
            i === active ? "bg-surface text-foreground shadow-sm" : "text-muted"
          }`}
        >
          <it.Icon size={16} strokeWidth={1.75} />
          {it.label}
          {it.count != null && <span className="text-xs tabular-nums text-faint">{it.count}</span>}
        </span>
      ))}
    </div>
  );
}

/* ── board ─────────────────────────────────────────────────────────────── */

function BoardHeader() {
  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Leads</h1>
          <p className="mt-1 text-sm text-muted">
            5 open · ₪565,900 in play · <span className="text-[#855800]">1 stalled</span> · 2 won, 17 lost this month
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-surface text-muted shadow-card">
            <Settings size={17} />
          </span>
          <span className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white">
            <Plus size={16} strokeWidth={2} /> Add lead
          </span>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Seg active={0} items={[{ label: "Board", Icon: SquareKanban }, { label: "List", Icon: List }]} />
        <span className="inline-flex h-10 items-center gap-2 rounded-xl bg-surface px-3.5 text-sm text-muted shadow-card">
          All sources <ChevronDown size={15} />
        </span>
        <span className="inline-flex h-10 items-center gap-2 rounded-xl bg-surface px-3.5 text-sm text-muted shadow-card">
          Show <ChevronDown size={15} />
        </span>
        <span className="ml-auto inline-flex h-10 w-72 items-center gap-2 rounded-xl bg-surface px-3.5 text-sm text-faint shadow-card">
          <Search size={16} /> Search company, contact, domain
        </span>
      </div>
    </>
  );
}

function ColumnHeader({ s, list }: { s: Stage; list: Lead[] }) {
  const total = list.reduce((a, l) => a + l.value, 0);
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      <s.Icon size={16} strokeWidth={1.75} style={{ color: s.color }} />
      <span className="text-sm font-medium">{s.name}</span>
      <span className="rounded-full bg-track px-2 text-xs tabular-nums text-muted">{list.length}</span>
      {total > 0 && <span className="ml-auto text-[13px] tabular-nums text-muted">{ils(total)}</span>}
    </div>
  );
}

function FoldedColumn({ s, n }: { s: Stage; n: number }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-2 rounded-xl bg-surface py-3 shadow-card">
      <ChevronRight size={15} className="text-muted" />
      <s.Icon size={16} strokeWidth={1.75} style={{ color: s.color }} />
      <span className="rounded-full bg-track px-1.5 text-xs tabular-nums text-muted">{n}</span>
      <span className="mt-1 text-[13px] font-medium text-muted [writing-mode:vertical-rl]">{s.name}</span>
    </div>
  );
}

/** A: the same facts, the attention note as one line on the card. */
function CardA({ l }: { l: Lead }) {
  const lateIsTheNudge = l.nudge && l.next?.overdue;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-card">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{l.company}</span>
          {l.isNew && <span className="rounded-full bg-brand px-1.5 text-[11px] leading-[18px] text-white">New</span>}
          <span className="text-sm font-medium tabular-nums">{ils(l.value)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted">
          <l.source.Icon size={13} />
          <span className="min-w-0 flex-1 truncate">{l.contact}</span>
          {l.hours && <span className="tabular-nums">{l.hours}</span>}
        </div>
      </div>
      {l.nudge && !lateIsTheNudge && (
        <div className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium ${TONE[l.nudge.tone].bg} ${TONE[l.nudge.tone].text}`}>
          <l.nudge.Icon size={14} className="shrink-0" />
          <span className="min-w-0 truncate">{l.nudge.full}</span>
        </div>
      )}
      {l.next ? (
        <div className={`flex gap-2 text-[13px] ${l.next.overdue ? "text-[#be123c]" : ""}`}>
          <Calendar size={14} className={`mt-0.5 shrink-0 ${l.next.overdue ? "" : "text-muted"}`} />
          <span>
            {l.next.text}
            <span className={l.next.overdue ? "font-medium" : "text-muted"}>
              {" "}
              · {l.next.overdue ? `9 days late, due ${l.next.due}` : l.next.due}
            </span>
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[13px] text-[#855800]">
          <CircleDashed size={14} /> No next step yet
        </div>
      )}
      <div className="flex items-center justify-between">
        <Owner name={l.owner} />
        <span className="text-xs text-muted">{l.days}d in stage</span>
      </div>
    </div>
  );
}

/** B: the card reads as a to-do — what happens next, then who and for how much. */
function CardB({ l }: { l: Lead }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-surface p-4 shadow-card">
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        <span className="min-w-0 flex-1 truncate">
          <b className="font-medium text-foreground">{l.company}</b> · {l.contact}
        </span>
        <span className="tabular-nums">{ils(l.value)}</span>
      </div>
      {l.next ? (
        <p className="text-[15px] font-medium leading-snug">{l.next.text}</p>
      ) : (
        <p className="text-[15px] font-medium leading-snug text-[#855800]">No next step — set one</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {l.next && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              l.next.overdue ? "bg-[#e11d48]/10 text-[#be123c]" : "bg-background text-muted"
            }`}
          >
            <Calendar size={12} /> {l.next.overdue ? `Late · due ${l.next.due}` : `Due ${l.next.due}`}
          </span>
        )}
        {l.nudge && !l.next?.overdue && (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[l.nudge.tone].bg} ${TONE[l.nudge.tone].text}`} title={l.nudge.full}>
            <l.nudge.Icon size={12} /> {l.nudge.short}
          </span>
        )}
        {l.isNew && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-white">New</span>}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <Owner name={l.owner} />
        <span className="text-xs text-muted">
          {l.hours && <span className="mr-2 tabular-nums">{l.hours}</span>}
          {l.days}d
        </span>
      </div>
    </div>
  );
}

function TodayPane() {
  const sections: { Icon: LucideIcon; tone: Tone; title: string; hint: string; items: [string, string, string][] }[] = [
    { Icon: MailWarning, tone: "red", title: "Replies we owe", hint: "The last message came from them", items: [["Mira Foods", "Relevant", "Waiting since 21/10"]] },
    { Icon: Calendar, tone: "red", title: "Next steps due", hint: "Due today or overdue", items: [["Northwind Labs", "Negotiation", "Waiting for reply to renegotiate · due 14/10"]] },
    { Icon: AlarmClock, tone: "amber", title: "Gone quiet", hint: "Past their stage's stall limit", items: [["Kite Robotics", "Discovery", "Last activity 4/10"]] },
  ];
  return (
    <Card className="w-[340px] shrink-0 self-start p-5">
      <div className="mb-4 flex items-center justify-between">
        <Seg active={0} items={[{ label: "Today", Icon: CalendarCheck, count: 3 }, { label: "Summary", Icon: ChartPie }]} />
        <PanelRightClose size={17} className="text-muted" />
      </div>
      <div className="flex flex-col gap-5">
        {sections.map((s) => (
          <div key={s.title}>
            <div className="mb-2 flex items-center gap-2">
              <span className={`flex size-7 items-center justify-center rounded-lg ${TONE[s.tone].bg} ${TONE[s.tone].text}`}>
                <s.Icon size={15} />
              </span>
              <span className="text-sm font-medium">{s.title}</span>
              <span className="rounded-full bg-track px-1.5 text-xs text-muted">{s.items.length}</span>
            </div>
            {s.items.map(([co, st, line]) => (
              <div key={co} className="rounded-lg px-2 py-1.5 hover:bg-background">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{co}</span>
                  <span className="text-xs text-muted">{st}</span>
                </div>
                <div className="text-[13px] text-muted">{line}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Board({ variant }: { variant: "A" | "B" }) {
  const C = variant === "A" ? CardA : CardB;
  return (
    <>
      <BoardHeader />
      <div className="mt-4 flex items-start gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3 overflow-x-auto pb-4">
          {STAGES.map((s) => {
            const list = LEADS.filter((l) => l.stage === s.name);
            if (s.kind !== "open") return <FoldedColumn key={s.name} s={s} n={CLOSED_COUNTS[s.name]} />;
            if (list.length === 0) return <FoldedColumn key={s.name} s={s} n={0} />;
            return (
              <div key={s.name} className="min-w-[210px] flex-1">
                <ColumnHeader s={s} list={list} />
                <div className="flex flex-col gap-2.5 rounded-2xl bg-track/50 p-2">
                  {list.map((l) => (
                    <C key={l.company} l={l} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <TodayPane />
      </div>
    </>
  );
}

/* ── the lead page ─────────────────────────────────────────────────────── */

const ME = LEADS[4];

function PageHeader() {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 text-sm text-muted">
        <ArrowLeft size={15} /> Leads
      </span>
      <div className="mt-3 flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">{ME.company}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <Globe size={14} /> Website form · Created 2/10/26 · 9d in Negotiation · Last activity 14/10/26
          </p>
        </div>
        <span className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-surface px-3.5 text-sm text-muted shadow-card">
          <Trash2 size={15} /> Delete
        </span>
      </div>
      <div className="mt-5 flex items-stretch gap-2">
        <ol className="flex flex-1 gap-1 rounded-xl bg-surface p-1 shadow-card">
          {STAGES.filter((s) => s.kind === "open").map((s, i) => {
            const at = s.name === ME.stage;
            const passed = i < 4;
            return (
              <li key={s.name} className="flex-1">
                <span
                  className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm ${
                    at ? "bg-brand font-medium text-white" : passed ? "text-muted" : ""
                  }`}
                >
                  {at ? <s.Icon size={15} /> : passed ? <Check size={15} className="text-faint" /> : <span className="size-2 rounded-full" style={{ background: s.color }} />}
                  {s.name}
                </span>
              </li>
            );
          })}
        </ol>
        {STAGES.filter((s) => s.kind !== "open").map((s) => (
          <span key={s.name} className="inline-flex items-center gap-2 rounded-xl bg-surface px-4 text-sm font-medium shadow-card">
            <s.Icon size={15} style={{ color: s.color }} /> {s.name}
          </span>
        ))}
      </div>
    </>
  );
}

type Ev = { kind: string; Icon: LucideIcon; label: string; who?: string; date: string; body?: ReactNode; filter: string };
const FEED: Ev[] = [
  { kind: "stage", Icon: ArrowRightLeft, label: "Stage · Offer sent → Negotiation", who: "Michal", date: "14/10", filter: "Stages" },
  {
    kind: "email", Icon: Mail, label: "Email · Re: Proposal v2", date: "14/10", filter: "Emails",
    body: (
      <span className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted">Waiting on them</span>
        Rivi, Michal · 6 messages · They asked to revisit the motion package before signing.
      </span>
    ),
  },
  { kind: "call", Icon: Phone, label: "Call", who: "Michal", date: "12/10", filter: "Calls", body: "Went through the scope. They want to cut the motion package and look at the price again." },
  {
    kind: "offer", Icon: FileText, label: "Offer v2 · ₪242,900", who: "Nitsan", date: "10/10", filter: "Offers",
    body: (
      <span className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-dark">Sent 10/10</span>
        Approved by Nitsan · Brand, website and launch motion
      </span>
    ),
  },
  {
    kind: "estimate", Icon: Calculator, label: "Estimate v2", who: "Michal", date: "8/10", filter: "Estimates",
    body: (
      <span className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">Approved</span>
        762.5–1,164 hrs · ₪229k–350k + VAT
      </span>
    ),
  },
  { kind: "stage", Icon: ArrowRightLeft, label: "Stage · Offer in prep → Offer sent", who: "Michal", date: "4/10", filter: "Stages" },
  { kind: "created", Icon: Sparkles, label: "Lead created", date: "2/10", filter: "All", body: "From the website form" },
];

function Composer() {
  return (
    <div className="rounded-xl bg-background p-3">
      <div className="mb-2 flex items-center gap-1">
        {[["Call", Phone], ["Meeting", Users], ["Email", Mail], ["Note", StickyNote]].map(([l, I], i) => {
          const Icon = I as LucideIcon;
          return (
            <span key={l as string} className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] ${i === 0 ? "bg-surface font-medium shadow-sm" : "text-muted"}`}>
              <Icon size={14} /> {l as string}
            </span>
          );
        })}
        <span className="ml-auto text-[13px] text-muted">When · today</span>
      </div>
      <div className="rounded-lg bg-surface px-3 py-2.5 text-sm text-faint">What was said, what was agreed…</div>
      <div className="mt-2 flex justify-end">
        <span className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white">Log call</span>
      </div>
    </div>
  );
}

function Timeline({ events }: { events: Ev[] }) {
  return (
    <ol className="mt-5 flex flex-col gap-4">
      {events.map((e, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-muted">
            <e.Icon size={15} />
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">{e.label}</span>
              {e.who && (
                <span className="flex items-center gap-1 text-[13px] text-muted">
                  · <Initials name={e.who} size={18} /> {e.who}
                </span>
              )}
              <span className="ml-auto text-[13px] text-muted">{e.date}</span>
            </div>
            {e.body && <div className="mt-1.5 text-sm text-foreground/85">{e.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function NextStepCard() {
  return (
    <Card className="p-5">
      <CardTitle Icon={Calendar} tone="text-[#be123c]" right={<span className="rounded-full bg-[#e11d48]/10 px-2 py-0.5 text-xs font-medium text-[#be123c]">9 days late</span>}>
        Next step
      </CardTitle>
      <p className="text-sm">{ME.next!.text}</p>
      <p className="mt-3 text-[13px] text-muted">Due 14/10/26</p>
    </Card>
  );
}

function DealCard({ withFigure = true }: { withFigure?: boolean }) {
  return (
    <Card className="p-5">
      <CardTitle Icon={Handshake}>The deal</CardTitle>
      {withFigure && (
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-muted">Estimated value</div>
          <div className="font-serif-accent text-[40px] leading-tight">{ils(ME.value)}</div>
        </div>
      )}
      <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 text-sm">
        <dt className="text-muted">Owner</dt>
        <dd><Owner name="Michal" /></dd>
        <dt className="text-muted">Source</dt>
        <dd className="flex items-center gap-1.5"><Globe size={14} className="text-muted" /> Website form</dd>
        <dt className="text-muted">Website</dt>
        <dd className="flex items-center gap-1.5 text-brand">northwindlabs.com <ExternalLink size={13} /></dd>
        <dt className="text-muted">Asked for</dt>
        <dd>Brand strategy, website, launch motion</dd>
      </dl>
    </Card>
  );
}

function ContactsCard() {
  return (
    <Card className="p-5">
      <CardTitle Icon={Users} right={<span className="flex items-center gap-1 text-[13px] text-brand"><Plus size={14} /> Add</span>}>
        Contacts
      </CardTitle>
      <div className="text-sm font-medium">Rivi Cohen</div>
      <div className="text-[13px] text-muted">Chief Business Officer</div>
      <div className="mt-2 flex flex-col gap-1 text-[13px]">
        <span className="flex items-center gap-2"><Mail size={14} className="text-muted" /> rivi@northwindlabs.com</span>
        <span className="flex items-center gap-2"><Phone size={14} className="text-muted" /> 054-000-0000</span>
      </div>
    </Card>
  );
}

const TABS = [
  { label: "Activity", Icon: ActivityIcon, count: 7 },
  { label: "Emails", Icon: Mail, count: 4 },
  { label: "Offers", Icon: FileText, count: 1 },
  { label: "Estimates", Icon: Calculator },
];

/** A: today's structure, unified. */
function PageA() {
  return (
    <>
      <PageHeader />
      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="p-5">
          <div className="mb-4">
            <Seg items={TABS} active={0} />
          </div>
          <Composer />
          <Timeline events={FEED.filter((e) => e.kind !== "email" && e.kind !== "estimate")} />
        </Card>
        <div className="flex flex-col gap-4">
          <NextStepCard />
          <DealCard />
          <ContactsCard />
        </div>
      </div>
    </>
  );
}

/** B: what happens next, and the deal's facts, before any history. */
function PageB() {
  const facts: [string, ReactNode, string?][] = [
    ["Estimated value", <span key="v" className="font-serif-accent text-[34px] leading-none">{ils(ME.value)}</span>],
    ["Estimate", <span key="e" className="text-xl font-medium tabular-nums">762.5–1,164 hrs</span>, "v2 · approved"],
    ["In Negotiation", <span key="d" className="text-xl font-medium tabular-nums">9 days</span>, "limit 7"],
    ["Last activity", <span key="l" className="text-xl font-medium">14/10</span>, "call with Rivi"],
  ];
  return (
    <>
      <PageHeader />
      <Card className="mt-5 flex flex-wrap items-center gap-5 p-5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#e11d48]/10 text-[#be123c]">
          <Calendar size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
            What&apos;s next <span className="rounded-full bg-[#e11d48]/10 px-2 py-0.5 normal-case tracking-normal text-[#be123c]">9 days late · due 14/10</span>
          </div>
          <p className="mt-1 text-xl font-medium">{ME.next!.text}</p>
        </div>
        <Owner name="Michal" />
        <span className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white">
          <Phone size={15} /> Log a call
        </span>
        <span className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-background px-4 text-sm font-medium">
          <Check size={15} /> Done — set the next
        </span>
      </Card>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {facts.map(([label, v, sub]) => (
          <Card key={label} className="p-5">
            <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
            <div className="mt-2">{v}</div>
            {sub && <div className="mt-1 text-[13px] text-muted">{sub}</div>}
          </Card>
        ))}
      </div>
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="p-5">
          <div className="mb-4">
            <Seg items={TABS} active={0} />
          </div>
          <Composer />
          <Timeline events={FEED.filter((e) => e.kind !== "email" && e.kind !== "estimate")} />
        </Card>
        <div className="flex flex-col gap-4">
          <ContactsCard />
          <DealCard withFigure={false} />
        </div>
      </div>
    </>
  );
}

/** C: one feed with filters instead of four tabs. */
function PageC() {
  const filters = ["All", "Calls", "Emails", "Offers", "Estimates", "Stages"];
  const [f, setF] = useState("All");
  const shown = f === "All" ? FEED : FEED.filter((e) => e.filter === f);
  return (
    <>
      <PageHeader />
      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="p-5">
          <CardTitle
            Icon={ActivityIcon}
            right={
              <span className="flex items-center gap-2 text-[13px] text-muted">
                <Mail size={14} /> Gmail · new mail arrives on its own
              </span>
            }
          >
            Everything so far
          </CardTitle>
          <Composer />
          <div className="mt-5 flex flex-wrap gap-1.5">
            {filters.map((x) => (
              <button
                key={x}
                onClick={() => setF(x)}
                className={`rounded-full px-3 py-1 text-[13px] ${x === f ? "bg-foreground text-white" : "bg-background text-muted hover:text-foreground"}`}
              >
                {x}
                <span className="ml-1 opacity-60">{x === "All" ? FEED.length : FEED.filter((e) => e.filter === x).length}</span>
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1.5 text-[13px] text-brand">
              <Plus size={14} /> Offer
            </span>
            <span className="flex items-center gap-1.5 text-[13px] text-brand">
              <Plus size={14} /> Estimate
            </span>
          </div>
          <Timeline events={shown} />
        </Card>
        <div className="flex flex-col gap-4">
          <NextStepCard />
          <DealCard />
          <ContactsCard />
        </div>
      </div>
    </>
  );
}

/* ── the lab ───────────────────────────────────────────────────────────── */

type View = "boardA" | "boardB" | "pageA" | "pageB" | "pageC";
const VIEWS: { id: View; label: string; tip: string }[] = [
  { id: "boardA", label: "Board A · Calm card", tip: "Same facts; the attention note as one line on the card, no bubbles" },
  { id: "boardB", label: "Board B · Next step first", tip: "The card's headline is what happens next" },
  { id: "pageA", label: "Page A · Tidied", tip: "Today's structure, unified" },
  { id: "pageB", label: "Page B · Next step first", tip: "A what's-next band and the deal's facts above the tabs" },
  { id: "pageC", label: "Page C · One feed", tip: "No tabs: one timeline with filters" },
];

export function LeadsLab() {
  const [view, setView] = useState<View>("boardA");
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("v") as View | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL
    if (v && VIEWS.some((x) => x.id === v)) setView(v);
  }, []);
  useEffect(() => {
    window.history.replaceState(null, "", `?v=${view}`);
  }, [view]);

  return (
    <div className="app-canvas min-h-screen bg-background">
      <div className="mx-auto max-w-[1500px] px-6 pb-32 pt-8">
        {view === "boardA" && <Board variant="A" />}
        {view === "boardB" && <Board variant="B" />}
        {view === "pageA" && <PageA />}
        {view === "pageB" && <PageB />}
        {view === "pageC" && <PageC />}
      </div>
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-1 rounded-2xl bg-[#111] p-1.5 text-xs text-white shadow-2xl">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            title={v.tip}
            onClick={() => setView(v.id)}
            className={`whitespace-nowrap rounded-xl px-3 py-2 ${view === v.id ? "bg-white text-[#111]" : "text-white/75 hover:text-white"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
    </div>
  );
}
