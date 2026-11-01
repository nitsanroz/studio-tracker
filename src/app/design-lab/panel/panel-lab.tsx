"use client";

// The task panel three ways, at its real width (max-w-xl, 576px) over a dimmed
// page, with the app's tokens. One invented task with every section filled.
//
//   A "Aligned"   — the same order, in the refresh's vocabulary: client and
//                   section above the title, the fields on a Light White well,
//                   the hours as a serif figure with its bar, icon headings
//   B "Headline"  — a brand-blue head holding the client, title, status and
//                   the hours figure; the fields and sections below as in A
//   C "Tabs"      — A's head, then Brief / Time / Discussion as tabs on the
//                   laptop too (the phone already has them): one section at a time

import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ClipboardList,
  Clock,
  ExternalLink,
  PenTool,
  Link2,
  Maximize2,
  MessageSquare,
  Paperclip,
  Plus,
  X,
  type LucideIcon,
} from "lucide-react";

type Opt = "A" | "B" | "C";

/* ── fixtures ──────────────────────────────────────────────────────────── */

const TASK = {
  client: "Northwind",
  color: "#7c3aed",
  section: "Branding",
  title: "Brand strategy",
  assignee: "Dana Levi",
  dates: "17/9 – 24/9",
  type: "Strategy",
  status: "Approved",
  hours: 31,
  budget: 30,
  brief:
    "Review the workshop summary and mark where you disagree.\nStart visual research and two concept directions for Tuesday afternoon's review.",
  link: "Strategy summary doc",
};
const TIME = [
  { who: "DL", date: "24/9", h: "8h", text: "Concept directions, round two" },
  { who: "MN", date: "23/9", h: "4h 30m", text: "Research boards" },
  { who: "DL", date: "22/9", h: "7h", text: "Strategy deck, first pass" },
];
const TALK = [
  { who: "Michal", at: "22 Sep", text: "Client asked to keep the tagline from the old deck." },
  { who: "Dana", at: "23 Sep", text: "Noted — it's on slide 4 now." },
];

/* ── pieces ────────────────────────────────────────────────────────────── */

const well = "rounded-2xl bg-[var(--light-white)]";

function Avatar({ i, size = 24 }: { i: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-medium text-brand" style={{ width: size, height: size }}>
      {i}
    </span>
  );
}

function Chip() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface py-0.5 pl-0.5 pr-2.5 text-xs font-medium shadow-card">
      <span className="flex size-5 items-center justify-center rounded-full text-[10px] text-white" style={{ background: TASK.color }}>N</span>
      {TASK.client}
    </span>
  );
}

function Heading({ Icon, children, right }: { Icon: LucideIcon; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h3 className="flex items-center gap-2 text-[15px] font-medium">
        <Icon size={17} strokeWidth={1.75} className="text-brand" /> {children}
      </h3>
      {right}
    </div>
  );
}

function Toolbar({ light }: { light?: boolean }) {
  const icon = light ? "text-white/80 hover:bg-white/15" : "text-muted hover:bg-[var(--light-white)]";
  return (
    <div className="flex items-center justify-between">
      <span
        className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium ${
          light ? "bg-white/15 text-white" : "bg-[var(--light-white)] text-muted hover:text-success"
        }`}
      >
        <Check size={15} strokeWidth={2.25} /> Mark complete
      </span>
      <span className="flex items-center gap-0.5">
        {[Link2, Maximize2, X].map((I, k) => (
          <span key={k} className={`flex size-9 items-center justify-center rounded-xl ${icon}`}>
            <I size={16} />
          </span>
        ))}
      </span>
    </div>
  );
}

function HoursFigure({ light }: { light?: boolean }) {
  const over = TASK.hours > TASK.budget;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={`font-serif-accent text-[40px] leading-none ${over && !light ? "text-danger" : ""}`}>{TASK.hours}h</span>
        <span className={light ? "text-white/70" : "text-muted"}>of {TASK.budget}h budget</span>
        {over && <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${light ? "bg-white text-danger" : "bg-danger/10 text-danger"}`}>1h over</span>}
      </div>
      <span className={`mt-2 block h-1.5 overflow-hidden rounded-full ${light ? "bg-white/20" : "bg-[var(--light-white)]"}`}>
        <span className={`block h-full w-full rounded-full ${light ? "bg-white" : over ? "bg-danger" : "bg-brand"}`} />
      </span>
    </div>
  );
}

function Fields({ withStatus = true }: { withStatus?: boolean }) {
  const rows: [string, ReactNode][] = [
    ["Assignee", <span key="a" className="flex items-center gap-2"><Avatar i="DL" size={22} /> {TASK.assignee}</span>],
    ["Dates", TASK.dates],
    ["Type", <span key="t" className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-success" /> {TASK.type}</span>],
    ...(withStatus ? ([["Status", <span key="s" className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">{TASK.status}</span>]] as [string, ReactNode][]) : []),
    ["Billable", <span key="b" className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Billable</span>],
  ];
  return (
    <div className={`${well} grid grid-cols-2 gap-x-5 gap-y-3 p-4 text-sm`}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs text-muted">{k}</span>
          <span className="min-w-0">{v}</span>
        </div>
      ))}
    </div>
  );
}

function FigmaRow() {
  return (
    <div>
      <Heading Icon={PenTool}>Figma</Heading>
      <div className={`${well} flex h-11 items-center px-4 text-sm text-faint`}>Paste a Figma link…</div>
    </div>
  );
}

function Brief() {
  return (
    <div>
      <Heading Icon={ClipboardList} right={<span className="text-xs text-brand">+ Add link</span>}>Brief</Heading>
      <div className={`${well} whitespace-pre-line p-4 text-sm leading-relaxed`}>{TASK.brief}</div>
      <span className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-sm text-brand shadow-card">
        <ExternalLink size={14} /> {TASK.link}
      </span>
    </div>
  );
}

function Attachments() {
  return (
    <div>
      <Heading Icon={Paperclip}>Attachments</Heading>
      <div className="flex h-14 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted">
        <Plus size={14} className="mr-1" /> Add files (up to 25MB each)
      </div>
    </div>
  );
}

function Time() {
  return (
    <div>
      <Heading Icon={Clock} right={<span className="text-xs text-muted">31h total</span>}>Time</Heading>
      <div className={`${well} p-1.5`}>
        <div className="mb-1 flex h-10 items-center gap-2 rounded-xl bg-surface px-3 text-sm text-faint shadow-card">
          <Plus size={14} className="text-brand" /> Log time…
        </div>
        {TIME.map((t, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm">
            <Avatar i={t.who} size={22} />
            <span className="w-10 text-xs tabular-nums text-muted">{t.date}</span>
            <span className="w-14 font-medium tabular-nums">{t.h}</span>
            <span className="min-w-0 truncate text-muted">{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Talk() {
  return (
    <div>
      <Heading Icon={MessageSquare}>Discussion</Heading>
      <div className="flex flex-col gap-3">
        {TALK.map((c, i) => (
          <div key={i} className="flex gap-2.5">
            <Avatar i={c.who[0]} size={26} />
            <div className={`${well} min-w-0 flex-1 px-3.5 py-2.5 text-sm`}>
              <p className="text-xs text-muted">
                <span className="font-medium text-foreground">{c.who}</span> · {c.at}
              </p>
              <p className="mt-0.5">{c.text}</p>
            </div>
          </div>
        ))}
        <div className={`${well} h-20 px-4 py-3 text-sm text-faint`}>Write a message…</div>
      </div>
    </div>
  );
}

function TitleBlock() {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted">
        <Chip /> <span>· {TASK.section}</span>
      </div>
      <h2 className="mt-2 text-[28px] font-medium leading-9 tracking-[-0.02em]">{TASK.title}</h2>
    </div>
  );
}

/* ── the three ─────────────────────────────────────────────────────────── */

function PanelA() {
  return (
    <div className="flex flex-col gap-6 px-6 py-4">
      <Toolbar />
      <TitleBlock />
      <Fields />
      <HoursFigure />
      <FigmaRow />
      <Brief />
      <Attachments />
      <Time />
      <Talk />
    </div>
  );
}

function PanelB() {
  return (
    <>
      <div className="flex flex-col gap-5 bg-brand px-6 pb-6 pt-4 text-white">
        <Toolbar light />
        <div>
          <p className="text-sm text-white/75">
            {TASK.client} · {TASK.section} · <span className="text-white">{TASK.status}</span>
          </p>
          <h2 className="mt-1 text-[28px] font-medium leading-9 tracking-[-0.02em]">{TASK.title}</h2>
        </div>
        <HoursFigure light />
      </div>
      <div className="flex flex-col gap-6 px-6 py-5">
        <Fields withStatus={false} />
        <FigmaRow />
        <Brief />
        <Attachments />
        <Time />
        <Talk />
      </div>
    </>
  );
}

function PanelC() {
  const [tab, setTab] = useState<"brief" | "time" | "talk">("brief");
  return (
    <div className="flex flex-col gap-6 px-6 py-4">
      <Toolbar />
      <TitleBlock />
      <Fields />
      <HoursFigure />
      <div className="flex rounded-xl bg-[var(--light-white)] p-1 text-sm">
        {(
          [
            ["brief", "Brief & files"],
            ["time", `Time · ${TIME.length}`],
            ["talk", `Discussion · ${TALK.length}`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`h-9 flex-1 rounded-lg ${tab === id ? "bg-surface font-medium text-brand shadow-card" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "brief" && (
        <>
          <Brief />
          <FigmaRow />
          <Attachments />
        </>
      )}
      {tab === "time" && <Time />}
      {tab === "talk" && <Talk />}
    </div>
  );
}

/* ── the switch ────────────────────────────────────────────────────────── */

const NAMES: Record<Opt, string> = { A: "Aligned", B: "Headline", C: "Tabs" };

export function PanelLab() {
  const [opt, setOpt] = useState<Opt>("A");
  const [read, setRead] = useState(false);
  useEffect(() => {
    const o = new URLSearchParams(window.location.search).get("o") as Opt | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL
    if (o === "A" || o === "B" || o === "C") setOpt(o);
    setRead(true);
  }, []);
  useEffect(() => {
    if (read) window.history.replaceState(null, "", `?o=${opt}`);
  }, [read, opt]);

  return (
    <div className="min-h-screen bg-background">
      <div className="fixed inset-0 bg-[#06112f]/20" />
      <aside className="fixed inset-y-0 right-0 w-full max-w-xl overflow-y-auto bg-surface shadow-2xl">
        {opt === "A" && <PanelA />}
        {opt === "B" && <PanelB />}
        {opt === "C" && <PanelC />}
      </aside>
      <div className="fixed bottom-4 left-8 z-50 flex gap-1 rounded-2xl bg-[#111] p-1.5 text-xs text-white shadow-2xl">
        {(["A", "B", "C"] as Opt[]).map((o) => (
          <button key={o} onClick={() => setOpt(o)} className={`whitespace-nowrap rounded-xl px-3 py-2 ${opt === o ? "bg-white text-[#111]" : "text-white/75 hover:text-white"}`}>
            {o} · {NAMES[o]}
          </button>
        ))}
      </div>
    </div>
  );
}
