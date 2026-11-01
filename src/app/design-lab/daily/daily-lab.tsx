"use client";

// My Tasks and the Time Feed, three ways each, at life size with the app's
// tokens. What a designer sees (Nadav's shape of week); invented clients.
//
// My Tasks
//   A "Grouped"  — a one-line summary under the title, the table split into
//                  Overdue / This week / Later, hours drawn against the budget
//   B "Cards"    — one card per task, grouped the same way; the bar and the
//                  Add-time button on the card
//   C "Next up"  — the most pressing task as a blue hero card, the rest as the
//                  grouped table below
// Time Feed (the Timesheet view)
//   A "Week strip" — five day tiles across the top (hours against the day's 8h),
//                    the table below at full width, today marked as in the plan
//   B "Days"       — the week as five columns, each day's entries stacked as cards
//   C "Headline"   — a big serif week total with a pace line, then the table

import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus, Rows3, Table2, TriangleAlert } from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";

/* ── fixtures ──────────────────────────────────────────────────────────── */

const CLIENTS: Record<string, string> = { Northwind: "#7c3aed", Lumen: "#0b43ed", Harbor: "#db2777" };

type Task = { client: string; section: string; title: string; due: string; late?: boolean; week?: boolean; status?: string; hours: number; budget: number; mine: number };
const TASKS: Task[] = [
  { client: "Lumen", section: "Brand upscale & visuals", title: "Branding", due: "27 Oct", late: true, status: "In design", hours: 114.75, budget: 100, mine: 94 },
  { client: "Northwind", section: "Branding", title: "Branding", due: "29 Oct", late: true, status: "In design", hours: 139.25, budget: 98, mine: 87 },
  { client: "Northwind", section: "Branding", title: "Logo design", due: "4 Nov", week: true, hours: 12, budget: 40, mine: 12 },
  { client: "Harbor", section: "Website", title: "Home page — visuals", due: "5 Nov", week: true, status: "Client approval", hours: 18.5, budget: 24, mine: 16 },
  { client: "Northwind", section: "Branding", title: "Brand strategy", due: "24 Nov", status: "Approved", hours: 31, budget: 30, mine: 26.5 },
];
const GROUPS: { label: string; tone?: string; pick: (t: Task) => boolean }[] = [
  { label: "Overdue", tone: "text-danger", pick: (t) => !!t.late },
  { label: "Due this week", pick: (t) => !!t.week },
  { label: "Later", pick: (t) => !t.late && !t.week },
];

const DAYS = ["Sun 1", "Mon 2", "Tue 3", "Wed 4", "Thu 5"];
const TODAY = 1; // Monday
type Entry = { day: number; client: string; task: string; hours: number; text: string };
const ENTRIES: Entry[] = [
  { day: 0, client: "Harbor", task: "Home page — visuals", hours: 5, text: "Hero options, three directions" },
  { day: 0, client: "Harbor", task: "Home page — visuals", hours: 2.5, text: "Section graphics" },
  { day: 0, client: "Northwind", task: "Logo design", hours: 1, text: "Sketches" },
  { day: 1, client: "Northwind", task: "Logo design", hours: 4, text: "Vector pass on two routes" },
  { day: 1, client: "Lumen", task: "Branding", hours: 2.5, text: "Type pairing" },
];
const dayTotal = (d: number) => ENTRIES.filter((e) => e.day === d).reduce((s, e) => s + e.hours, 0);
const WEEK = ENTRIES.reduce((s, e) => s + e.hours, 0);
const h = (n: number) => `${Number(n.toFixed(2))}h`;

/* ── pieces ────────────────────────────────────────────────────────────── */

const card = "rounded-[20px] bg-surface shadow-card";

function Chip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--light-white)] py-0.5 pl-0.5 pr-2.5 text-xs font-medium">
      <span className="flex size-5 items-center justify-center rounded-full text-[10px] text-white" style={{ background: CLIENTS[name] }}>
        {name[0]}
      </span>
      {name}
    </span>
  );
}

function Status({ s }: { s?: string }) {
  if (!s) return <span className="text-faint">—</span>;
  const tone = s === "Approved" ? "bg-success/10 text-success" : s === "Client approval" ? "bg-warning/10 text-[#8a5a09]" : "bg-brand-soft text-brand";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${tone}`}>{s}</span>;
}

/** Hours against the budget: brand while inside it, danger past it. */
function Budget({ t, wide }: { t: Task; wide?: boolean }) {
  const over = t.hours > t.budget;
  const pct = Math.min(100, (t.hours / t.budget) * 100);
  return (
    <span className={`flex flex-col gap-1 ${wide ? "w-full" : "w-36"}`}>
      <span className="flex justify-between text-xs tabular-nums">
        <span className={over ? "font-medium text-danger" : ""}>{h(t.hours)}</span>
        <span className="text-faint">of {h(t.budget)}</span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-[var(--light-white)]">
        <span className={`block h-full rounded-full ${over ? "bg-danger" : "bg-brand"}`} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

function AddTime({ solid }: { solid?: boolean }) {
  return (
    <span
      className={`inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-xl px-3 text-xs font-medium ${
        solid ? "bg-white text-brand" : "bg-[var(--light-white)] text-brand hover:bg-brand-soft"
      }`}
    >
      <Plus size={14} /> Add time
    </span>
  );
}

function Due({ t }: { t: Task }) {
  return <span className={`tabular-nums ${t.late ? "font-medium text-danger" : ""}`}>{t.due}</span>;
}

function TasksHeader() {
  const late = TASKS.filter((t) => t.late).length;
  return (
    <div>
      <h1 className="page-title">
        My <span className="font-serif-accent">tasks</span>
      </h1>
      <p className="mt-1 text-sm text-muted">
        {TASKS.length} open · <span className="text-danger">{late} overdue</span> · 2 due this week
      </p>
    </div>
  );
}

/* ── My Tasks ──────────────────────────────────────────────────────────── */

function TaskRows({ list }: { list: Task[] }) {
  return (
    <>
      {list.map((t, i) => (
        <tr key={i} className="border-t border-border first:border-t-0 hover:bg-[var(--light-white)]/60">
          <td className="py-3 pl-5 pr-3"><Chip name={t.client} /></td>
          <td className="px-3 py-3 text-muted">{t.section}</td>
          <td className="px-3 py-3 font-medium">{t.title}</td>
          <td className="px-3 py-3"><Due t={t} /></td>
          <td className="px-3 py-3"><Status s={t.status} /></td>
          <td className="px-3 py-3"><Budget t={t} /></td>
          <td className="px-3 py-3 text-right tabular-nums text-muted">{h(t.mine)}</td>
          <td className="py-3 pl-3 pr-5 text-right"><AddTime /></td>
        </tr>
      ))}
    </>
  );
}

function GroupedTable() {
  return (
    <section className={`${card} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-faint">
            <th className="py-3 pl-5 pr-3 font-medium">Client</th>
            <th className="px-3 py-3 font-medium">Section</th>
            <th className="px-3 py-3 font-medium">Task</th>
            <th className="px-3 py-3 font-medium">Due</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">Hours</th>
            <th className="px-3 py-3 text-right font-medium">By me</th>
            <th className="py-3 pl-3 pr-5" />
          </tr>
        </thead>
        {GROUPS.map((g) => {
          const list = TASKS.filter(g.pick);
          return (
            <tbody key={g.label}>
              <tr>
                <td colSpan={8} className={`bg-[var(--light-white)] px-5 py-2 text-xs font-medium ${g.tone ?? "text-muted"}`}>
                  {g.label} <span className="text-faint">· {list.length}</span>
                </td>
              </tr>
              <TaskRows list={list} />
            </tbody>
          );
        })}
      </table>
    </section>
  );
}

function TasksA() {
  return (
    <div className="flex flex-col gap-5">
      <TasksHeader />
      <GroupedTable />
    </div>
  );
}

function TaskCard({ t }: { t: Task }) {
  return (
    <div className={`${card} flex flex-col gap-4 p-5`}>
      <div className="flex items-center justify-between gap-2">
        <Chip name={t.client} />
        <Status s={t.status} />
      </div>
      <div>
        <p className="card-title">{t.title}</p>
        <p className="mt-0.5 text-sm text-muted">{t.section}</p>
      </div>
      <Budget t={t} wide />
      <div className="mt-auto flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted">
          <CalendarDays size={15} strokeWidth={1.75} /> <Due t={t} />
          <span className="text-faint">· {h(t.mine)} by me</span>
        </span>
        <AddTime />
      </div>
    </div>
  );
}

function TasksB() {
  return (
    <div className="flex flex-col gap-5">
      <TasksHeader />
      {GROUPS.map((g) => (
        <div key={g.label}>
          <p className={`mb-2 text-sm font-medium ${g.tone ?? "text-muted"}`}>{g.label}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {TASKS.filter(g.pick).map((t, i) => (
              <TaskCard key={i} t={t} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TasksC() {
  const next = TASKS[1];
  return (
    <div className="flex flex-col gap-5">
      <TasksHeader />
      <section className="flex flex-wrap items-center gap-6 rounded-[20px] bg-brand p-6 text-white">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm text-white/75">
            <TriangleAlert size={15} strokeWidth={1.75} /> Next up · overdue since {next.due}
          </p>
          <p className="mt-1 text-[32px] font-medium leading-10 tracking-[-0.02em]">
            {next.client} · <span className="font-serif-accent">{next.title}</span>
          </p>
          <p className="mt-1 text-sm text-white/75">
            {next.section} · {h(next.hours)} of {h(next.budget)} budget · {h(next.mine)} by you
          </p>
        </div>
        <AddTime solid />
        <span className="inline-flex items-center gap-1.5 text-sm text-white/85">
          Open task <StudioArrow size={16} />
        </span>
      </section>
      <GroupedTable />
    </div>
  );
}

/* ── Time Feed ─────────────────────────────────────────────────────────── */

function FeedHeader({ big }: { big?: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="page-title">
          Time <span className="font-serif-accent">feed</span>
        </h1>
        <p className="mt-1 text-sm text-muted">Your weekly timesheet — click a cell for that day&apos;s entries.</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-medium text-white">
          <Plus size={16} /> Add new hours
        </span>
        <span className="flex rounded-xl bg-surface p-1 shadow-card">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm text-muted"><Rows3 size={15} /> Feed</span>
          <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand-soft px-3 text-sm text-brand"><Table2 size={15} /> Timesheet</span>
        </span>
      </div>
      {!big && <WeekNav />}
    </div>
  );
}

function WeekNav({ light }: { light?: boolean }) {
  const btn = light ? "bg-white/15 text-white" : "bg-surface text-muted shadow-card";
  return (
    <div className="flex basis-full items-center gap-2">
      <span className={`inline-flex size-9 items-center justify-center rounded-xl ${btn}`}><ChevronLeft size={16} /></span>
      <span className={`min-w-36 text-center text-sm font-medium ${light ? "text-white" : ""}`}>1 – 5 November</span>
      <span className={`inline-flex size-9 items-center justify-center rounded-xl ${btn}`}><ChevronRight size={16} /></span>
    </div>
  );
}

function Sheet() {
  const rows = [...new Set(ENTRIES.map((e) => `${e.client}|${e.task}`))];
  return (
    <section className={`${card} overflow-hidden`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-faint">
            <th className="py-3 pl-5 pr-3 text-left font-medium">Task</th>
            {DAYS.map((d, i) => (
              <th key={d} className={`px-3 py-3 text-right font-medium ${i === TODAY ? "bg-brand text-white" : ""}`}>
                {d}
              </th>
            ))}
            <th className="py-3 pl-3 pr-5 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const [client, task] = r.split("|");
            const cells = DAYS.map((_, d) => ENTRIES.filter((e) => e.day === d && e.client === client && e.task === task).reduce((s, e) => s + e.hours, 0));
            return (
              <tr key={r} className="border-t border-border">
                <td className="py-3 pl-5 pr-3">
                  <span className="flex items-center gap-2"><Chip name={client} /> {task}</span>
                </td>
                {cells.map((c, d) => (
                  <td key={d} className={`px-3 py-3 text-right tabular-nums ${d === TODAY ? "bg-brand-soft/50" : ""} ${c ? "" : "text-faint"}`}>
                    {c ? h(c) : "–"}
                  </td>
                ))}
                <td className="py-3 pl-3 pr-5 text-right font-medium tabular-nums">{h(cells.reduce((a, b) => a + b, 0))}</td>
              </tr>
            );
          })}
          <tr className="border-t border-border bg-[var(--light-white)] font-medium">
            <td className="py-3 pl-5 pr-3 text-muted">Day total</td>
            {DAYS.map((_, d) => (
              <td key={d} className="px-3 py-3 text-right tabular-nums">{dayTotal(d) ? h(dayTotal(d)) : "–"}</td>
            ))}
            <td className="py-3 pl-3 pr-5 text-right tabular-nums">{h(WEEK)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function FeedA() {
  return (
    <div className="flex flex-col gap-5">
      <FeedHeader />
      <div className="grid grid-cols-5 gap-3">
        {DAYS.map((d, i) => {
          const t = dayTotal(i);
          const future = i > TODAY;
          return (
            <div key={d} className={`${card} p-4 ${i === TODAY ? "ring-2 ring-brand" : ""}`}>
              <p className={`text-xs ${i === TODAY ? "font-medium text-brand" : "text-muted"}`}>{i === TODAY ? `Today · ${d}` : d}</p>
              <p className={`mt-1 font-serif-accent text-[32px] leading-10 ${future ? "text-faint" : ""}`}>{t ? h(t) : "–"}</p>
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--light-white)]">
                <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (t / 8) * 100)}%` }} />
              </span>
              <p className="mt-1.5 text-[11px] text-faint">of 8h</p>
            </div>
          );
        })}
      </div>
      <Sheet />
    </div>
  );
}

function FeedB() {
  return (
    <div className="flex flex-col gap-5">
      <FeedHeader />
      <div className="grid grid-cols-5 gap-3">
        {DAYS.map((d, i) => {
          const list = ENTRIES.filter((e) => e.day === i);
          return (
            <div key={d} className={`flex min-h-80 flex-col gap-2 rounded-[20px] p-3 ${i === TODAY ? "bg-brand-soft" : "bg-[var(--light-white)]"}`}>
              <div className="flex items-baseline justify-between px-1">
                <span className={`text-sm font-medium ${i === TODAY ? "text-brand" : ""}`}>{d}</span>
                <span className="font-serif-accent text-[22px]">{list.length ? h(dayTotal(i)) : ""}</span>
              </div>
              {list.map((e, j) => (
                <div key={j} className="rounded-2xl bg-surface p-3 shadow-card">
                  <div className="flex items-center justify-between gap-2">
                    <Chip name={e.client} />
                    <span className="text-sm font-medium tabular-nums">{h(e.hours)}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium">{e.task}</p>
                  <p className="text-xs text-muted">{e.text}</p>
                </div>
              ))}
              {i <= TODAY && (
                <span className="flex h-10 items-center justify-center gap-1 rounded-2xl text-sm text-brand hover:bg-surface">
                  <Plus size={15} /> Add
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FeedC() {
  const target = 40;
  const sofar = 16; // two days of 8h
  return (
    <div className="flex flex-col gap-5">
      <FeedHeader big />
      <section className="flex flex-wrap items-center gap-8 rounded-[20px] bg-brand p-6 text-white">
        <div>
          <WeekNav light />
          <p className="mt-4 text-sm text-white/75">This week</p>
          <p className="font-serif-accent text-[72px] leading-[72px]">{h(WEEK)}</p>
        </div>
        <div className="min-w-72 flex-1">
          <div className="flex justify-between text-sm text-white/80">
            <span className="flex items-center gap-1.5"><Clock size={15} strokeWidth={1.75} /> {h(WEEK)} of {h(sofar)} expected by today</span>
            <span>{h(target)} week</span>
          </div>
          <span className="mt-2 block h-2 overflow-hidden rounded-full bg-white/20">
            <span className="block h-full rounded-full bg-white" style={{ width: `${(WEEK / target) * 100}%` }} />
          </span>
          <div className="mt-3 grid grid-cols-5 gap-2 text-center text-xs text-white/75">
            {DAYS.map((d, i) => (
              <span key={d} className={i === TODAY ? "font-medium text-white" : ""}>
                {d} · {dayTotal(i) ? h(dayTotal(i)) : "–"}
              </span>
            ))}
          </div>
        </div>
      </section>
      <Sheet />
    </div>
  );
}

/* ── the switch ────────────────────────────────────────────────────────── */

type Page = "tasks" | "feed";
type Opt = "A" | "B" | "C";
const NAMES: Record<Page, Record<Opt, string>> = {
  tasks: { A: "Grouped", B: "Cards", C: "Next up" },
  feed: { A: "Week strip", B: "Days", C: "Headline" },
};

export function DailyLab() {
  const [page, setPage] = useState<Page>("tasks");
  const [opt, setOpt] = useState<Opt>("A");
  const [read, setRead] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("p") as Page | null;
    const o = q.get("o") as Opt | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL
    if (p === "tasks" || p === "feed") setPage(p);
    if (o === "A" || o === "B" || o === "C") setOpt(o);
    setRead(true);
  }, []);
  useEffect(() => {
    if (read) window.history.replaceState(null, "", `?p=${page}&o=${opt}`);
  }, [read, page, opt]);

  const body: ReactNode =
    page === "tasks" ? (opt === "A" ? <TasksA /> : opt === "B" ? <TasksB /> : <TasksC />) : opt === "A" ? <FeedA /> : opt === "B" ? <FeedB /> : <FeedC />;

  return (
    <div className="app-canvas min-h-screen bg-background">
      <div className="mx-auto max-w-[1500px] px-6 pb-32 pt-8">{body}</div>
      <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-3 rounded-2xl bg-[#111] p-1.5 text-xs text-white shadow-2xl">
        <div className="flex gap-1">
          {(["tasks", "feed"] as Page[]).map((p) => (
            <button key={p} onClick={() => setPage(p)} className={`whitespace-nowrap rounded-xl px-3 py-2 ${page === p ? "bg-white text-[#111]" : "text-white/75 hover:text-white"}`}>
              {p === "tasks" ? "My Tasks" : "Time Feed"}
            </button>
          ))}
        </div>
        <div className="flex gap-1 border-l border-white/20 pl-3">
          {(["A", "B", "C"] as Opt[]).map((o) => (
            <button key={o} onClick={() => setOpt(o)} className={`whitespace-nowrap rounded-xl px-3 py-2 ${opt === o ? "bg-white text-[#111]" : "text-white/75 hover:text-white"}`}>
              {o} · {NAMES[page][o]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
