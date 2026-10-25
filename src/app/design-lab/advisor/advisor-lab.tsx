"use client";

// The owner's advisor pane, three looks. Each is a pull-out panel on the right
// with its own colour scheme, drawn over a mocked app shell at life size. The
// scheme is a set of token overrides on the pane's root (--foreground, --muted,
// --surface…), so the app's own classes — card-title, text-muted, bg-surface —
// follow it instead of being restyled one by one.
//
//   A "Night briefing"  — Studio Black + aqua. Overlays the page from a header
//                          button. One feed: Do now / Heads-up / Ideas.
//   B "Paper desk"      — warm paper + ink + the serif. Pulled from a tab on
//                          the right edge; pushes the page narrower. Today /
//                          Pulse / Ideas as tabs, reminders tick off.
//   C "Aqua note"       — aqua wash + navy. A floating card from a corner
//                          button; the advisor talks in short notes with
//                          quick replies, and you can ask it things.
//
// "Tracker / Finance app" on the lab bar swaps every figure between the
// tracker's rule (percentages and trends only) and the finance app's (amounts).
// Invented clients, people and figures; nothing reads the database.

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  ChartPie,
  Check,
  Clock3,
  Handshake,
  History,
  House,
  Inbox,
  Lightbulb,
  Receipt,
  Search,
  SendHorizontal,
  Settings,
  SquareCheckBig,
  TreePalm,
  TrendingDown,
  TrendingUp,
  UserRoundPen,
  UserRoundSearch,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";
import { EmptyState } from "@/components/empty-state";
import { Toaster } from "@/components/toaster";
import { toast } from "@/lib/toast";
import { Advice } from "@/components/advice";
import type { AdviceView } from "@/lib/advice/run";

/* ── fixtures ──────────────────────────────────────────────────────────── */

type Kind = "now" | "heads" | "idea";
type Item = {
  id: string;
  kind: Kind;
  area: string;
  title: string;
  why: string;
  /** the same sentence with amounts, for the finance app */
  whyMoney?: string;
  figure?: { text: string; money?: string; dir?: "up" | "down"; bad?: boolean };
  action: string;
  /** a reminder can be ticked off; advice can only be dismissed */
  reminder?: boolean;
  replies?: string[];
};

const ITEMS: Item[] = [
  {
    id: "report",
    kind: "now",
    area: "Client reports",
    title: "Send Orchard Bank this week's report",
    why: "You publish it every Sunday. The last one went out 9 days ago, and 31h were logged since.",
    action: "Open the report",
    reminder: true,
    replies: ["Open the report", "Remind me Thursday"],
  },
  {
    id: "cap",
    kind: "now",
    area: "Budget",
    title: "Lumen Health is at 92% of October's cap",
    why: "Six working days left. At this month's pace it closes at 118% — worth a heads-up before it happens.",
    whyMoney: "Six working days left. At this month's pace it closes 26h over — ₪9,880 you can't bill without their OK.",
    figure: { text: "92% of cap", money: "₪34,960 of ₪38,000", dir: "up", bad: true },
    action: "Draft the over-budget note",
    replies: ["Draft the note", "They know already"],
  },
  {
    id: "scope",
    kind: "now",
    area: "Scope",
    title: "Halo Robotics: 14% of hours went to work outside the brief",
    why: "The \"Investor deck\" and \"Trade-show banners\" tasks aren't in the signed estimate. Tell them before the period closes.",
    whyMoney: "The \"Investor deck\" and \"Trade-show banners\" tasks aren't in the signed estimate — ₪6,240 of work so far.",
    figure: { text: "14% out of scope", money: "₪6,240 out of scope", dir: "up", bad: true },
    action: "Draft an out-of-scope note",
    replies: ["Draft the note", "It's covered"],
  },
  {
    id: "billable",
    kind: "heads",
    area: "Studio",
    title: "Billable share is down to 71%",
    why: "It was 84% across the last three months. Most of the gap is Studio-internal work on the new website.",
    figure: { text: "71%", money: "₪41,200 unbilled", dir: "down", bad: true },
    action: "See hours by client",
  },
  {
    id: "plan",
    kind: "heads",
    area: "Team",
    title: "Yoav is planned at 135% next week",
    why: "Three clients land on Sunday–Tuesday. Shira has 11h free that week.",
    action: "Open the weekly plan",
  },
  {
    id: "quiet",
    kind: "heads",
    area: "Team",
    title: "Dana hasn't logged hours since Wednesday",
    why: "Not on vacation and planned on Mosaic Foods both days. Usually logs daily.",
    action: "Send Dana a nudge",
    reminder: true,
  },
  {
    id: "leads",
    kind: "heads",
    area: "Leads",
    title: "Two leads have waited 6 days for an estimate",
    why: "Tidewater Hotels and Kinetic Labs. Your average reply is 3 days, and won leads were answered in 2.",
    action: "Open Leads",
    reminder: true,
  },
  {
    id: "freelancer",
    kind: "idea",
    area: "Freelancers",
    title: "Give the Mosaic cut-downs to Daniel, not Maya",
    why: "Daniel is 1.5h from his sliding rate — the next hours cost 18% less than Maya's. His last three jobs went through with no revision round.",
    whyMoney: "Daniel is 1.5h from his sliding rate: €45/h from here, against Maya's €55/h — about €400 less on a 40h job.",
    action: "Compare freelancers",
  },
  {
    id: "vacation",
    kind: "idea",
    area: "Team",
    title: "Omer has 14 vacation days and none booked",
    why: "December is the quietest month in the plan so far. A nudge now saves a pile-up in Q1.",
    action: "Open Vacation",
  },
];

const KIND: Record<Kind, { label: string; plural: string }> = {
  now: { label: "Do now", plural: "Do now" },
  heads: { label: "Heads-up", plural: "Heads-ups" },
  idea: { label: "Idea", plural: "Ideas" },
};

type Pulse = { label: string; value: string; money: string; delta: string; dir: "up" | "down"; good: boolean; series: number[]; note: string };
const PULSE: Pulse[] = [
  { label: "Billable share", value: "71%", money: "₪186,400 billable", delta: "13 pts", dir: "down", good: false, series: [82, 85, 84, 86, 83, 78, 71], note: "vs 84% average" },
  { label: "Studio pace", value: "94%", money: "₪212,000 of ₪226,000", delta: "of the month's goal", dir: "up", good: true, series: [40, 52, 61, 70, 78, 88, 94], note: "day 17 of 22" },
  { label: "Income vs costs", value: "112%", money: "₪23,600 margin", delta: "4 pts", dir: "down", good: true, series: [118, 121, 116, 119, 117, 114, 112], note: "income covers costs" },
  { label: "Freelancer share", value: "12%", money: "€8,420 this month", delta: "5 pts", dir: "up", good: false, series: [5, 6, 4, 7, 9, 10, 12], note: "of hours delivered" },
];

/* ── shared bits ───────────────────────────────────────────────────────── */

function Spark({ series, className = "" }: { series: number[]; className?: string }) {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 24}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`h-7 w-full ${className}`} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Trend({ dir, className = "" }: { dir: "up" | "down"; className?: string }) {
  const Icon = dir === "up" ? TrendingUp : TrendingDown;
  return <Icon size={14} strokeWidth={2} className={className} aria-hidden />;
}

/** Which items are still showing, and the dismiss / snooze / done handlers that report through a toast. */
function useItems() {
  const [gone, setGone] = useState<Record<string, "dismissed" | "snoozed">>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const hide = (it: Item, how: "dismissed" | "snoozed") => {
    setGone((g) => ({ ...g, [it.id]: how }));
    toast(how === "snoozed" ? "Snoozed until Sunday" : "Dismissed", {
      tone: "info",
      onUndo: () =>
        setGone((g) => {
          const rest = { ...g };
          delete rest[it.id];
          return rest;
        }),
    });
  };
  const tick = (it: Item) => {
    setDone((d) => ({ ...d, [it.id]: !d[it.id] }));
    if (!done[it.id]) toast(`Done — ${it.title}`, { onUndo: () => setDone((d) => ({ ...d, [it.id]: false })) });
  };
  const live = ITEMS.filter((i) => !gone[i.id]);
  const reset = () => {
    setGone({});
    setDone({});
  };
  return { live, done, hide, tick, hidden: Object.keys(gone).length, reset };
}

/* ── the mocked app behind the pane ────────────────────────────────────── */

const NAV: { label: string; Icon: LucideIcon; admin?: boolean }[] = [
  { label: "Home", Icon: House },
  { label: "Weekly Plan", Icon: CalendarDays },
  { label: "My Tasks", Icon: SquareCheckBig },
  { label: "Vacation", Icon: TreePalm },
  { label: "Time Feed", Icon: History },
  { label: "Settings", Icon: Settings },
  { label: "Intake", Icon: Inbox, admin: true },
  { label: "Clients", Icon: Users, admin: true },
  { label: "Reports", Icon: ChartPie, admin: true },
  { label: "Client Reports", Icon: Receipt, admin: true },
  { label: "Team", Icon: UsersRound, admin: true },
  { label: "Candidates", Icon: UserRoundSearch, admin: true },
  { label: "Leads", Icon: Handshake, admin: true },
  { label: "Freelancers", Icon: UserRoundPen, admin: true },
];

function Sidebar() {
  const item = ({ label, Icon }: (typeof NAV)[number]) => {
    const active = label === "Home";
    return (
      <span
        key={label}
        className={`font-heading flex items-center gap-3 rounded-md px-3 py-2.5 text-sm ${active ? "is-current" : ""}`}
        style={active ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" } : { color: "var(--sb-muted)" }}
      >
        <Icon size={20} strokeWidth={1.75} />
        {label}
      </span>
    );
  };
  return (
    <aside
      className="fixed inset-y-0 left-0 z-30 flex w-52 flex-col border-r"
      style={{ backgroundColor: "var(--sb-bg)", color: "var(--sb-fg)", borderColor: "var(--sb-border)" }}
    >
      <div className="flex items-center gap-2 px-4 pb-4 pt-5">
        <span className="brand-ampmore w-24" style={{ backgroundColor: "var(--sb-fg)" }} />
      </div>
      <nav className="flex flex-col gap-2 px-2">
        {NAV.filter((n) => !n.admin).map(item)}
        <div className="mx-3 my-2 border-t" style={{ borderColor: "var(--sb-border)" }} />
        {NAV.filter((n) => n.admin).map(item)}
      </nav>
    </aside>
  );
}

function Header({ trigger }: { trigger?: ReactNode }) {
  return (
    <header className="app-header sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border px-6 backdrop-blur" style={{ backgroundColor: "var(--header-bg)" }}>
      <div className="flex h-10 w-[400px] items-center gap-2.5 rounded-xl bg-surface px-3.5 text-sm text-faint shadow-card">
        <Search size={16} strokeWidth={1.75} />
        Search tasks, clients…
      </div>
      <div className="ml-auto flex items-center gap-2.5">
        {trigger}
        <span className="flex size-10 items-center justify-center rounded-xl bg-surface shadow-card">
          <Bell size={18} strokeWidth={1.75} />
        </span>
        <span className="flex h-10 items-center gap-2 rounded-xl bg-surface pl-1.5 pr-3 shadow-card">
          <span className="flex size-[26px] items-center justify-center rounded-full bg-[#dc2626] text-[11px] font-medium text-white">NR</span>
          <span className="text-sm font-medium">Nitsan</span>
        </span>
      </div>
    </header>
  );
}

const BY_CLIENT: [string, number, number][] = [
  ["Lumen Health", 118.5, 0.92],
  ["Orchard Bank", 96, 0.61],
  ["Halo Robotics", 74.25, 0.78],
  ["Mosaic Foods", 51, 0.4],
  ["Studio", 47.5, 0],
];

/** A slice of the admin Home, in invented figures, so the pane is judged over a real page. */
function HomeBehind() {
  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="flex items-end justify-between gap-4 pb-6 pt-2">
        <div>
          <h1 className="page-title">
            Good afternoon, <span className="font-serif-accent">Nitsan</span>
          </h1>
          <p className="mt-1 text-sm text-muted">10 years and 4 months in the studio</p>
        </div>
      </div>
      <div className="mb-4 flex items-center justify-between rounded-2xl bg-[#001e6c] px-6 py-4 text-white">
        <span className="text-sm">
          <b className="font-medium">Studio pace</b> · 17 of 22 working days · on track for the month&apos;s goal
        </span>
        <StudioArrow size={20} />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[
          ["Studio hours", "387h"],
          ["Billable", "71%"],
          ["Tasks worked", "34"],
          ["Per designer", "64.5h"],
        ].map(([l, v]) => (
          <section key={l} className="min-w-0 rounded-2xl border border-border bg-surface p-5 shadow-card">
            <p className="text-[13px] text-muted">{l}</p>
            <p className="font-serif-accent mt-2 text-[clamp(28px,2.6vw,40px)] leading-none">{v}</p>
          </section>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4">
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <h2 className="card-title">Hours over time</h2>
          <div className="mt-6 flex h-48 items-end gap-2">
            {[22, 24, 0, 26, 25, 23.5, 27, 24, 0, 21, 22.5, 26.5, 25, 28, 21.5, 0, 26].map((v, i) => (
              <span key={i} className="flex-1 rounded-md bg-brand/80" style={{ height: `${(v / 28) * 100}%`, opacity: v ? 1 : 0 }} />
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <h2 className="card-title">Hours by client</h2>
          <ul className="mt-5 flex flex-col gap-4">
            {BY_CLIENT.map(([name, hrs, share]) => (
              <li key={name} className="text-sm">
                <div className="mb-1.5 flex justify-between">
                  <span>{name}</span>
                  <span className="text-muted">{hrs}h</span>
                </div>
                <div className="h-2 rounded-full bg-track">
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${(hrs / 118.5) * 100}%`, opacity: share ? 1 : 0.35 }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ── A · Night briefing ────────────────────────────────────────────────── */

const NIGHT: CSSProperties = {
  // Studio Black and the brand's aqua: the app's own colours, inverted
  ["--foreground" as string]: "#ffffff",
  ["--muted" as string]: "#aab4d4",
  ["--faint" as string]: "#7c88ad",
  ["--surface" as string]: "#101c44",
  ["--background" as string]: "#06112f",
  ["--border" as string]: "#1f2c57",
  ["--track" as string]: "#1f2c57",
  ["--brand-soft" as string]: "#13225a",
  ["--brand" as string]: "#74f3ef",
};
const NIGHT_TONE: Record<Kind, string> = { now: "#ff8f7d", heads: "#ffd27a", idea: "#74f3ef" };

/** Closed, the advisor is a round Studio Black button in the corner (Nitsan's pick: C's placement, A's colours). */
function NightButton({ onClick, count }: { onClick: () => void; count: number }) {
  return (
    <button
      onClick={onClick}
      title="Advisor"
      aria-label={`Advisor — ${count} things need you`}
      className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-[#06112f] shadow-[0_12px_30px_-8px_rgba(6,17,47,0.55)] transition-transform hover:scale-105"
    >
      <span className="brand-amp w-6" style={{ backgroundColor: "#74f3ef" }} />
      <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-[#ff8f7d] text-[11px] font-medium text-[#06112f] ring-2 ring-background">{count}</span>
    </button>
  );
}

function NightPane({ onClose, money }: { onClose: () => void; money: boolean }) {
  const { live, done, hide, tick, hidden, reset } = useItems();
  const [filter, setFilter] = useState<Kind | "all">("all");
  const shown = live.filter((i) => filter === "all" || i.kind === filter);
  const counts = (k: Kind) => live.filter((i) => i.kind === k).length;
  return (
    <aside style={NIGHT} className="fixed inset-y-0 right-0 z-40 flex w-[440px] flex-col bg-background text-foreground shadow-[-24px_0_60px_-20px_rgba(6,17,47,0.5)]">
      <header className="flex items-center gap-3 px-6 pb-4 pt-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-soft">
          <span className="brand-amp w-4" style={{ backgroundColor: "#74f3ef" }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="card-title">&amp;advice</p>
          <p className="text-[12px] text-faint">Sunday 25 October · updated 07:00</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-foreground">
          <X size={20} strokeWidth={1.75} />
        </button>
      </header>

      <div className="px-6">
        <p className="text-[22px] leading-8">
          {counts("now") ? (
            <>
              <span className="font-serif-accent">{counts("now")} things</span> need you today.
            </>
          ) : (
            "Nothing urgent today."
          )}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {PULSE.map((p) => (
            <div key={p.label} className="rounded-xl bg-surface px-3.5 py-3">
              <p className="flex items-center gap-2 text-[12px] text-muted">
                {p.label}
                <span className="ml-auto inline-flex items-center gap-1 whitespace-nowrap" style={{ color: p.good ? "#74f3ef" : "#ff8f7d" }}>
                  <Trend dir={p.dir} />
                  {p.dir === "down" && p.delta.includes("pts") ? `−${p.delta}` : p.delta.includes("pts") ? `+${p.delta}` : ""}
                </span>
              </p>
              <p className={`mt-1.5 ${money ? "text-[15px] font-medium leading-[26px]" : "font-serif-accent text-[26px] leading-none"}`}>
                {money ? p.money.replace(/ (billable|margin|this month)$/, "") : p.value}
              </p>
              <Spark series={p.series} className={p.good ? "mt-1 text-[#74f3ef]/70" : "mt-1 text-[#ff8f7d]/70"} />
            </div>
          ))}
        </div>
        <div className="mt-5 flex gap-1 rounded-xl bg-surface p-1 text-[13px]">
          {(["all", "now", "heads", "idea"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`flex-1 rounded-lg py-1.5 ${filter === k ? "bg-[#1f2c57] font-medium text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {k === "all" ? `All ${live.length}` : `${KIND[k].plural} ${counts(k)}`}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-3 flex-1 overflow-y-auto px-6 pb-6">
        {shown.length === 0 && <EmptyState icon={Check} tone="success" text="All clear. New advice lands here at 07:00." compact />}
        {shown.map((it) => (
          <li key={it.id} className="group/item relative mt-2 rounded-2xl bg-surface p-4 pr-12">
            <p className="mb-1.5 flex items-center gap-2 text-[12px] text-muted">
              <span className="size-2 rounded-full" style={{ background: NIGHT_TONE[it.kind] }} />
              {KIND[it.kind].label} · {it.area}
            </p>
            <p className={`text-[15px] font-medium leading-5 ${done[it.id] ? "text-muted line-through" : ""}`}>{it.title}</p>
            <p className="mt-1 text-[13px] leading-5 text-muted">{money && it.whyMoney ? it.whyMoney : it.why}</p>
            {it.figure && (
              <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-[#1f2c57] px-2 py-1 text-[12px]" style={{ color: it.figure.bad ? "#ff8f7d" : "#74f3ef" }}>
                {it.figure.dir && <Trend dir={it.figure.dir} />}
                {money && it.figure.money ? it.figure.money : it.figure.text}
              </span>
            )}
            <div className="mt-3 flex items-center gap-4 text-[13px]">
              <span className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-brand hover:underline">
                {it.action}
                <StudioArrow size={14} />
              </span>
              {it.reminder && (
                <button onClick={() => tick(it)} className="inline-flex items-center gap-1.5 text-muted hover:text-foreground">
                  <Check size={14} strokeWidth={2} /> {done[it.id] ? "Undo done" : "Mark done"}
                </button>
              )}
            </div>
            {/* Snooze is the only way out (Nitsan, 2026-10-24): it comes back if still true, sooner if it gets worse. */}
            <div className="absolute right-2.5 top-2.5 opacity-40 transition-opacity group-hover/item:opacity-100">
              <button onClick={() => hide(it, "snoozed")} title="Snooze until Sunday" className="flex size-7 items-center justify-center rounded-lg text-muted hover:bg-[#1f2c57] hover:text-foreground">
                <Clock3 size={16} strokeWidth={1.75} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <footer className="flex items-center justify-between border-t border-border px-6 py-3 text-[12px] text-faint">
        <span>{money ? "Finance app · amounts shown" : "Percentages and trends only — no amounts here"}</span>
        {hidden > 0 && (
          <button onClick={reset} className="text-muted hover:text-foreground">
            {hidden} snoozed · show
          </button>
        )}
      </footer>
    </aside>
  );
}

/* ── B · Paper desk ────────────────────────────────────────────────────── */

const PAPER: CSSProperties = {
  ["--foreground" as string]: "#1d1a16",
  ["--muted" as string]: "#5f574b",
  ["--faint" as string]: "#8a8173",
  ["--surface" as string]: "#fffdf8",
  ["--background" as string]: "#f3eee3",
  ["--border" as string]: "#e2d9c8",
  ["--track" as string]: "#e8e0d0",
  ["--brand-soft" as string]: "#f3dfd5",
  ["--brand" as string]: "#b4441f",
};
const PAPER_TONE: Record<Kind, string> = { now: "#b4441f", heads: "#a57312", idea: "#2f6b55" };

function PaperTab({ onClick, count }: { onClick: () => void; count: number }) {
  return (
    <button
      onClick={onClick}
      style={PAPER}
      className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-2xl bg-background py-4 pl-2.5 pr-2 text-foreground shadow-[-8px_0_24px_-8px_rgba(29,26,22,0.35)] transition-[padding] hover:pr-3.5"
    >
      <Lightbulb size={18} strokeWidth={1.75} className="text-brand" />
      <span className="font-serif-accent text-[17px] [writing-mode:vertical-rl]">Advisor</span>
      <span className="flex size-5 items-center justify-center rounded-full bg-brand text-[11px] text-white">{count}</span>
    </button>
  );
}

function PaperPane({ onClose, money }: { onClose: () => void; money: boolean }) {
  const { live, done, hide, tick } = useItems();
  const [tab, setTab] = useState<"today" | "pulse" | "ideas">("today");
  const today = live.filter((i) => i.kind !== "idea");
  const ideas = live.filter((i) => i.kind === "idea");
  return (
    <aside style={PAPER} className="flex h-screen w-[420px] shrink-0 flex-col border-l border-border bg-background text-foreground">
      <header className="flex items-start gap-3 px-7 pb-3 pt-6">
        <div className="flex-1">
          <p className="text-[12px] uppercase tracking-[0.12em] text-faint">Sunday 25 October</p>
          <p className="mt-1 text-[30px] leading-9">
            Your <span className="font-serif-accent">desk</span>
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="mt-1 flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface">
          <X size={20} strokeWidth={1.75} />
        </button>
      </header>
      <nav className="mx-7 flex gap-6 border-b border-border text-sm">
        {(
          [
            ["today", `Today · ${today.length}`],
            ["pulse", "Pulse"],
            ["ideas", `Ideas · ${ideas.length}`],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 pb-2.5 ${tab === k ? "border-brand font-medium" : "border-transparent text-muted"}`}>
            {l}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto px-7 py-5">
        {tab === "pulse" ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-5 text-muted">
              {money ? "This month in amounts — the finance app's view." : "This month against the last six. Percentages and trends only; amounts stay in the finance app."}
            </p>
            {PULSE.map((p) => (
              <section key={p.label} className="rounded-2xl bg-surface p-5 shadow-[0_1px_2px_rgba(29,26,22,0.06)]">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-medium">{p.label}</h3>
                  <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: p.good ? "#2f6b55" : "#b4441f" }}>
                    <Trend dir={p.dir} /> {p.delta}
                  </span>
                </div>
                <div className="mt-2 flex items-end gap-4">
                  <span className={money ? "text-[20px] font-medium" : "font-serif-accent text-[44px] leading-none"}>{money ? p.money : p.value}</span>
                  <Spark series={p.series} className={`flex-1 ${p.good ? "text-[#2f6b55]" : "text-[#b4441f]"}`} />
                </div>
                <p className="mt-1.5 text-[12px] text-faint">{p.note}</p>
              </section>
            ))}
          </div>
        ) : (
          <ol className="flex flex-col">
            {(tab === "today" ? today : ideas).map((it, n) => (
              <li key={it.id} className="group/item flex gap-3.5 border-b border-border py-4 last:border-0">
                {it.reminder ? (
                  <button
                    onClick={() => tick(it)}
                    aria-label="Mark done"
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px] ${done[it.id] ? "border-brand bg-brand text-white" : "border-[#b9ad98] hover:border-brand"}`}
                  >
                    {done[it.id] && <Check size={13} strokeWidth={3} />}
                  </button>
                ) : (
                  <span className="font-serif-accent mt-[-2px] w-5 shrink-0 text-center text-[18px]" style={{ color: PAPER_TONE[it.kind] }}>
                    {n + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-[0.1em]" style={{ color: PAPER_TONE[it.kind] }}>
                    {KIND[it.kind].label} · {it.area}
                  </p>
                  <p className={`mt-1 text-[15px] font-medium leading-5 ${done[it.id] ? "text-faint line-through" : ""}`}>{it.title}</p>
                  <p className="mt-1 text-[13px] leading-5 text-muted">{money && it.whyMoney ? it.whyMoney : it.why}</p>
                  <div className="mt-2.5 flex items-center gap-4 text-[13px]">
                    <span className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-brand hover:underline">
                      {it.action} <StudioArrow size={14} />
                    </span>
                    <span className="ml-auto flex gap-3 text-faint opacity-0 transition-opacity group-hover/item:opacity-100">
                      <button onClick={() => hide(it, "snoozed")} className="hover:text-foreground">Later</button>
                      <button onClick={() => hide(it, "dismissed")} className="hover:text-foreground">Dismiss</button>
                    </span>
                  </div>
                </div>
              </li>
            ))}
            {(tab === "today" ? today : ideas).length === 0 && <EmptyState icon={Check} tone="success" text="Nothing on the desk." compact />}
          </ol>
        )}
      </div>
    </aside>
  );
}

/* ── C · Aqua note ─────────────────────────────────────────────────────── */

const AQUA: CSSProperties = {
  ["--foreground" as string]: "#001e6c",
  ["--muted" as string]: "#2f4a86",
  ["--faint" as string]: "#5a6f9e",
  ["--surface" as string]: "#ffffff",
  ["--background" as string]: "#d9fbfa",
  ["--border" as string]: "#a8ecea",
  ["--brand" as string]: "#001e6c",
  ["--brand-soft" as string]: "#bff5f3",
};

function AquaButton({ onClick, count }: { onClick: () => void; count: number }) {
  return (
    <button
      onClick={onClick}
      title="Advisor"
      className="fixed bottom-6 right-6 z-40 flex size-14 items-center justify-center rounded-full bg-[#74f3ef] text-[#001e6c] shadow-[0_12px_30px_-8px_rgba(0,30,108,0.45)] transition-transform hover:scale-105"
    >
      <span className="brand-amp w-5" style={{ backgroundColor: "#001e6c" }} />
      <span className="absolute -right-0.5 -top-0.5 flex size-5 items-center justify-center rounded-full bg-[#001e6c] text-[11px] text-white">{count}</span>
    </button>
  );
}

function AquaPane({ onClose, money }: { onClose: () => void; money: boolean }) {
  const { live, done, hide, tick } = useItems();
  const pulse = PULSE.slice(0, 3);
  return (
    <aside
      style={AQUA}
      className="fixed bottom-6 right-6 top-20 z-40 flex w-[420px] flex-col overflow-hidden rounded-3xl bg-background text-foreground shadow-[0_24px_60px_-16px_rgba(0,30,108,0.45)]"
    >
      <header className="flex items-center gap-3 bg-[#74f3ef] px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-full bg-[#001e6c]">
          <span className="brand-amp w-3.5" style={{ backgroundColor: "#74f3ef" }} />
        </span>
        <div className="flex-1">
          <p className="text-[15px] font-medium leading-5">Advisor</p>
          <p className="text-[12px] text-muted">Read the studio at 07:00 · {live.length} notes</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="flex size-9 items-center justify-center rounded-lg hover:bg-white/40">
          <X size={20} strokeWidth={1.75} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="mb-3 text-center text-[12px] text-faint">This morning</p>
        <div className="mb-3 max-w-[340px] rounded-2xl rounded-tl-md bg-surface p-4">
          <p className="text-sm leading-5">
            Good morning. October is <b className="font-medium">{money ? "₪212,000 of ₪226,000" : "94% of the way"}</b> to goal with five working days left — but billable work is slipping.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {pulse.map((p) => (
              <div key={p.label} className="flex items-center gap-3 text-[13px]">
                <span className="w-28 text-muted">{p.label}</span>
                <span className="w-24 font-medium">{money ? p.money : p.value}</span>
                <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: p.good ? "#0f7a5c" : "#c0392b" }}>
                  <Trend dir={p.dir} />
                </span>
                <Spark series={p.series} className={`h-5 flex-1 ${p.good ? "text-[#0f7a5c]" : "text-[#c0392b]"}`} />
              </div>
            ))}
          </div>
        </div>
        {live.map((it) => (
          <div key={it.id} className="group/item mb-3">
            <div className="relative max-w-[360px] rounded-2xl rounded-tl-md bg-surface p-4 pr-10">
              <p className="mb-1 text-[12px] text-faint">
                {KIND[it.kind].label} · {it.area}
              </p>
              <p className={`text-sm font-medium leading-5 ${done[it.id] ? "text-faint line-through" : ""}`}>{it.title}</p>
              <p className="mt-1 text-[13px] leading-5 text-muted">{money && it.whyMoney ? it.whyMoney : it.why}</p>
              <button onClick={() => hide(it, "dismissed")} title="Dismiss" className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg text-faint opacity-0 hover:bg-background group-hover/item:opacity-100">
                <X size={15} strokeWidth={1.75} />
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
              {(it.replies ?? [it.action]).map((r, i) => (
                <span key={r} className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 text-[12px] ${i === 0 ? "bg-[#001e6c] text-white" : "bg-[#bff5f3] hover:bg-[#a8ecea]"}`}>
                  {r} {i === 0 && <StudioArrow size={12} />}
                </span>
              ))}
              {it.reminder && (
                <button onClick={() => tick(it)} className="inline-flex items-center gap-1 rounded-full bg-[#bff5f3] px-3 py-1 text-[12px] hover:bg-[#a8ecea]">
                  <Check size={12} strokeWidth={2.5} /> {done[it.id] ? "Undo" : "Done"}
                </button>
              )}
              <button onClick={() => hide(it, "snoozed")} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-faint hover:text-foreground">
                <Clock3 size={12} strokeWidth={2} /> Later
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border bg-[#ecfdfc] p-3">
        <div className="flex items-center gap-2 rounded-2xl bg-surface py-1.5 pl-4 pr-1.5">
          <span className="flex-1 text-sm text-faint">Ask about the studio — “who has room next week?”</span>
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#001e6c] text-white">
            <SendHorizontal size={16} strokeWidth={1.75} />
          </span>
        </div>
      </div>
    </aside>
  );
}

/* ── the built component, against fixtures ─────────────────────────────── */

const row = (key: string, kind: "now" | "heads" | "idea", area: string, title: string, body: string, facts: Record<string, string | number | boolean | null>, isReminder = false, severity = 1) => ({
  id: key, key, signal: key.split(":")[0], kind, area, clientId: null, severity, facts, title, body,
  wordedTitle: null, wordedBody: null, isReminder, firstSeen: "2026-10-20T05:00:00Z", lastSeen: "2026-10-22T05:00:00Z",
  resolvedAt: null, doneAt: null, snoozedUntil: null, snoozedAtSeverity: null,
});
const FIXTURE: AdviceView = {
  today: "2026-10-22",
  items: [
    row("report-due:orchard", "now", "Client reports", "Send Orchard Bank this week's report", "Last published 9 days ago, and 31h were logged since.", { href: "#", action: "Open the report" }, true),
    row("cap:lumen", "now", "Budget", "Lumen Health is at 92% of October 2026's cap", "6 working days left. At this pace it closes at 118% — worth a heads-up before it happens.", { href: "#", action: "Send a heads-up", changed: true }, true, 2),
    row("scope:halo", "now", "Scope", "Halo Robotics: 14% of hours went to work outside the estimate", "\"Investor deck\" and \"Trade-show banners\" aren't in the published estimate — 21h since 2026-09-01.", { href: "#", action: "Send an out-of-scope note" }, true),
    row("unpaid:mosaic", "heads", "Billing", "Mosaic Foods: September 2026 isn't marked paid", "It ended 22 days ago with 64h logged.", { href: "#", action: "Open the billing periods" }, true),
    row("idea:1", "idea", "Planning", "Lumen and Halo both need a client note this week", "Send both notes on Sunday, before either period closes.", {}),
  ],
  pulse: [
    { label: "Income vs costs", unit: "%", value: 112, against: 116, series: [118, 121, 116, 119, 117, 116, 112], good: true, note: "income ÷ costs, 2026-09", help: "Each finished month's income divided by its costs.", scope: "money", clientId: null },
    { label: "Biggest client", unit: "%", value: 46, against: null, series: [38, 41, 44, 46, 47, 46], good: false, note: "Lumen Health, last 90 days", help: "The biggest client's share of billable hours.", scope: "concentration", clientId: null },
    { label: "Over cap", unit: "", value: 1, against: null, series: [], good: false, note: "of 6 capped clients", help: "Clients past their period's hour cap.", scope: "billing", clientId: null },
  ],
  hidden: 2,
  wordingOff: "Plain wording — no Claude API key",
};

/** components/advice.tsx as built, with its API answered here — the lab never reads the database. */
function LiveAdvice() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const real = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/api/advice?peek=1")) return Response.json({ count: 3, total: 6 });
      if (url.includes("/api/advice/")) return Response.json({ ok: true });
      if (url.includes("/api/advice")) return Response.json(FIXTURE);
      return real(input, init);
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount the component only once fetch is answered here
    setReady(true);
    return () => {
      window.fetch = real;
    };
  }, []);
  return ready ? <Advice /> : null;
}

/* ── the lab ───────────────────────────────────────────────────────────── */

type View = "a" | "b" | "c" | "live";
const VIEWS: { id: View; label: string; tip: string }[] = [
  { id: "a", label: "A · Night briefing", tip: "Studio Black + aqua, from a header button, overlays the page" },
  { id: "b", label: "B · Paper desk", tip: "Warm paper + ink, from a tab on the right edge, pushes the page" },
  { id: "c", label: "C · Aqua note", tip: "Aqua + navy, a floating card from a corner button, notes with quick replies" },
  { id: "live", label: "Built · the real component", tip: "components/advice.tsx itself, with /api/advice answered by fixtures" },
];

export function AdvisorLab() {
  const [view, setView] = useState<View>("a");
  const [open, setOpen] = useState(true);
  const [money, setMoney] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const v = q.get("v") as View | null;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the URL */
    if (v && VIEWS.some((x) => x.id === v)) setView(v);
    if (q.get("open") === "0") setOpen(false);
    if (q.get("fin") === "1") setMoney(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    window.history.replaceState(null, "", `?v=${view}&open=${open ? 1 : 0}&fin=${money ? 1 : 0}`);
  }, [view, open, money]);

  const count = ITEMS.filter((i) => i.kind === "now").length;
  const close = () => setOpen(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="app-canvas ml-52 flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-w-0 flex-1 p-6 pb-32">
          <HomeBehind />
        </main>
      </div>
      {view === "a" && (open ? <NightPane key="a" onClose={close} money={money} /> : <NightButton onClick={() => setOpen(true)} count={count} />)}
      {view === "b" && (open ? <div className="sticky top-0 self-start"><PaperPane key="b" onClose={close} money={money} /></div> : <PaperTab onClick={() => setOpen(true)} count={count} />)}
      {view === "live" && <LiveAdvice />}
      {view === "c" && (open ? <AquaPane key="c" onClose={close} money={money} /> : <AquaButton onClick={() => setOpen(true)} count={count} />)}

      <div className="fixed bottom-4 left-56 z-50 flex gap-1 rounded-2xl bg-[#111] p-1.5 text-xs text-white shadow-2xl">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            title={v.tip}
            onClick={() => {
              setView(v.id);
              setOpen(true);
            }}
            className={`whitespace-nowrap rounded-xl px-3 py-2 ${view === v.id ? "bg-white text-[#111]" : "text-white/75 hover:text-white"}`}
          >
            {v.label}
          </button>
        ))}
        <span className="mx-1 w-px bg-white/20" />
        <button onClick={() => setOpen(!open)} className="whitespace-nowrap rounded-xl px-3 py-2 text-white/75 hover:text-white">
          {open ? "Close pane" : "Open pane"}
        </button>
        <span className="mx-1 w-px bg-white/20" />
        {[false, true].map((m) => (
          <button key={String(m)} onClick={() => setMoney(m)} className={`whitespace-nowrap rounded-xl px-3 py-2 ${money === m ? "bg-white text-[#111]" : "text-white/75 hover:text-white"}`}>
            {m ? "Finance app" : "Tracker"}
          </button>
        ))}
      </div>
      <Toaster />
    </div>
  );
}
