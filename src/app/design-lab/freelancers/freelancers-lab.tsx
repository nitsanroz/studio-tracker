"use client";

// Content options for Freelancers, drawn with the app's own tokens at life
// size. An invented freelancer; the figures follow the real sliding-rate rule
// (€55/h up to 50h a month, sliding to €45/h at 150h), so they add up.
//
//   List A "Cards + review"   — a review queue across everyone up top, then
//                               the cards as they are now
//   List B "One table"        — the month's totals as tiles, one row each
//   Page A "Review first"     — what waits for review is its own card above the
//                               month; settings become their own cards
//   Page B "Bill breakdown"   — how the bill is made (hours × sliding rate),
//                               the hours grouped by client, months as a chart

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FolderOpen,
  Link2,
  Plus,
  ReceiptText,
  RefreshCw,
  Scale,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

/* ── fixtures ──────────────────────────────────────────────────────────── */

const NAME = "Daniel Ross";
const TERMS = "€55.00/h up to 50h a month, sliding to €45.00/h from 150h";
const rateFor = (h: number) => (h <= 50 ? 55 : h >= 150 ? 45 : 55 - (h - 50) * 0.1);
const eur = (n: number) => `€${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const h = (n: number) => `${Number(n.toFixed(2))}h`;

type Log = { date: string; client: string | null; task: string; hint?: string; hours: number; did?: string; sheet?: boolean; waiting?: boolean };
const LOGS: Log[] = [
  { date: "Thu 1 Oct", client: "NoTraffic", task: "Sensor 3.0 Video", hours: 8.5, sheet: true },
  { date: "Fri 2 Oct", client: "NoTraffic", task: "Sensor 3.0 Video", hours: 8, sheet: true },
  { date: "Fri 2 Oct", client: "Visitt", task: "Lobby page motion", hours: 1.5, did: "Two loops for the hero" },
  { date: "Sun 4 Oct", client: "NoTraffic", task: "Sensor 3.0 Video", hours: 10.5, did: "Edit v2, sound pass" },
  { date: "Mon 5 Oct", client: "NoTraffic", task: "Sensor 3.0 Video", hours: 10, did: "Colour and titles" },
  { date: "Tue 6 Oct", client: "Visitt", task: "Lobby page motion", hours: 2.5, did: "Revisions after review" },
  { date: "Wed 21 Oct", client: null, task: "", hint: "West Alice edits", hours: 3, did: "Cut the 15s and 6s versions", waiting: true },
  { date: "Thu 22 Oct", client: "NoTraffic", task: "", hint: "Sensor 3.0 cutdowns", hours: 4.5, did: "Social cutdowns, 3 sizes", waiting: true },
];
const TOTAL_H = LOGS.reduce((s, l) => s + l.hours, 0); // 48.5
const RATE = rateFor(TOTAL_H);
const BILL = TOTAL_H * RATE;
const WAITING = LOGS.filter((l) => l.waiting);

const MONTHS: [string, number][] = [
  ["Oct 26", TOTAL_H],
  ["Sep 26", 155.75],
  ["Aug 26", 7.5],
  ["Jul 26", 66],
  ["Jun 26", 101.5],
  ["May 26", 66.5],
  ["Apr 26", 3.5],
  ["Mar 26", 29.97],
];
const CLIENTS = ["JustPlay", "NoTraffic", "Studio", "Visitt", "Voyantis", "Whitebox"];

/* ── pieces ────────────────────────────────────────────────────────────── */

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

function ClientTag({ name }: { name: string }) {
  const color = name === "NoTraffic" ? "#3b82f6" : "#1f7a4d";
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span className="size-2 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

function Picker({ label, value }: { label: string; value?: string }) {
  return (
    <span className={`inline-flex h-9 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-sm ${value ? "" : "text-muted"}`}>
      <span className="truncate">{value ?? label}</span>
      <ChevronDown size={15} className="shrink-0 text-muted" />
    </span>
  );
}

function Stepper() {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex size-9 items-center justify-center rounded-lg bg-surface text-muted shadow-card"><ChevronLeft size={16} /></span>
      <span className="min-w-32 text-center text-sm font-medium">October 2026</span>
      <span className="inline-flex size-9 items-center justify-center rounded-lg bg-surface text-faint shadow-card"><ChevronRight size={16} /></span>
    </div>
  );
}

/* ── list ──────────────────────────────────────────────────────────────── */

function ListHeader() {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className="page-title">Freelancers</h1>
        <p className="mt-1 text-sm text-muted">They log hours through a private link, with no login. October so far: {eur(BILL)} · {WAITING.length} logs waiting.</p>
      </div>
      <span className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white">
        <Plus size={16} strokeWidth={2} /> Add a freelancer
      </span>
    </div>
  );
}

function FreelancerCard() {
  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif-accent text-[28px] leading-9">{NAME}</h2>
          <p className="text-[13px] text-muted">{TERMS}</p>
        </div>
        <ArrowUpRight size={20} className="text-faint" />
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">October 2026</p>
        <p className="font-serif-accent text-[44px] leading-none text-brand">{eur(BILL)}</p>
        <p className="mt-1.5 text-[13px] text-muted">{h(TOTAL_H)} × {eur(RATE)}/h</p>
      </div>
      <span className="flex w-max items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-[13px] font-medium text-[#855800]">
        <Clock size={14} /> {WAITING.length} waiting for review
      </span>
    </Card>
  );
}

function ListA() {
  return (
    <>
      <ListHeader />
      <Card className="mt-6 p-6">
        <CardTitle Icon={Clock} tone="text-[#855800]" right={<span className="text-[13px] text-muted">Across everyone</span>}>
          Waiting for review <span className="rounded-full bg-warning/15 px-2 text-xs text-[#855800]">{WAITING.length}</span>
        </CardTitle>
        <ul className="flex flex-col gap-1">
          {WAITING.map((l) => (
            <li key={l.date} className="grid grid-cols-[160px_110px_minmax(0,1fr)_60px_auto] items-center gap-4 rounded-xl px-3 py-2.5 hover:bg-background">
              <span className="text-sm font-medium">{NAME}</span>
              <span className="text-[13px] text-muted">{l.date}</span>
              <span className="min-w-0 truncate text-sm">
                &ldquo;{l.hint}&rdquo; <span className="text-muted">· {l.did}</span>
              </span>
              <span className="text-right text-sm font-medium tabular-nums">{h(l.hours)}</span>
              <span className="inline-flex items-center gap-1 text-[13px] font-medium text-brand">
                Review <ArrowUpRight size={14} />
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <FreelancerCard />
      </div>
    </>
  );
}

function ListB() {
  const tiles: [string, string, string][] = [
    ["October so far", eur(BILL), "1 freelancer"],
    ["Hours", h(TOTAL_H), "not counting turned-down logs"],
    ["Waiting for review", String(WAITING.length), "logs to file on a task"],
  ];
  return (
    <>
      <ListHeader />
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {tiles.map(([l, v, s], i) => (
          <Card key={l} className={`p-5 ${i === 0 ? "bg-brand! text-white" : ""}`}>
            <div className={`text-xs uppercase tracking-wide ${i === 0 ? "text-white/75" : "text-muted"}`}>{l}</div>
            <div className={`font-serif-accent mt-1 text-[40px] leading-none ${i === 2 ? "text-[#855800]" : ""}`}>{v}</div>
            <div className={`mt-1 text-[13px] ${i === 0 ? "text-white/75" : "text-muted"}`}>{s}</div>
          </Card>
        ))}
      </div>
      <Card className="mt-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Freelancer</th>
              <th className="px-3 py-3 text-right font-medium">Hours</th>
              <th className="px-3 py-3 text-right font-medium">Rate</th>
              <th className="px-3 py-3 text-right font-medium">Bill</th>
              <th className="px-3 py-3 font-medium">Waiting</th>
              <th className="px-3 py-3 font-medium">Link</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border hover:bg-background/60">
              <td className="px-5 py-4">
                <div className="font-serif-accent text-[22px] leading-tight">{NAME}</div>
                <div className="text-[13px] text-muted">{TERMS}</div>
              </td>
              <td className="px-3 py-4 text-right tabular-nums">{h(TOTAL_H)}</td>
              <td className="px-3 py-4 text-right tabular-nums">{eur(RATE)}</td>
              <td className="px-3 py-4 text-right text-base font-medium tabular-nums text-brand">{eur(BILL)}</td>
              <td className="px-3 py-4">
                <span className="rounded-full bg-warning/15 px-2.5 py-1 text-[13px] font-medium text-[#855800]">{WAITING.length} logs</span>
              </td>
              <td className="px-3 py-4 text-[13px] text-success">On</td>
              <td className="px-5 py-4 text-right"><ArrowUpRight size={16} className="text-faint" /></td>
            </tr>
          </tbody>
        </table>
      </Card>
    </>
  );
}

/* ── one freelancer's month ────────────────────────────────────────────── */

function PageHeader({ withBill = true }: { withBill?: boolean }) {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 text-sm text-muted">
        <ArrowLeft size={15} /> Freelancers
      </span>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="font-serif-accent text-[44px] leading-tight">{NAME}</h1>
          <p className="text-sm text-muted">{TERMS}</p>
        </div>
        {withBill && (
          <div className="text-right">
            <div className="font-serif-accent text-[56px] leading-none text-brand">{eur(BILL)}</div>
            <div className="mt-1 text-[13px] text-muted">
              {h(TOTAL_H)} × {eur(RATE)}/h · October so far
            </div>
          </div>
        )}
      </div>
      <div className="mt-4">
        <Stepper />
      </div>
    </>
  );
}

function WaitingCard() {
  return (
    <Card className="p-6">
      <CardTitle Icon={Clock} tone="text-[#855800]" right={<span className="text-[13px] text-muted">File each on a task, then approve — it becomes tracker hours</span>}>
        Waiting for review <span className="rounded-full bg-warning/15 px-2 text-xs text-[#855800]">{WAITING.length}</span>
      </CardTitle>
      <ul className="flex flex-col gap-3">
        {WAITING.map((l) => (
          <li key={l.date} className="rounded-xl bg-background p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm font-medium">{l.date}</span>
              <span className="text-xl font-medium tabular-nums">{h(l.hours)}</span>
              <span className="text-sm">
                His name: <b className="font-medium">&ldquo;{l.hint}&rdquo;</b>
              </span>
              <span className="text-sm text-muted">· {l.did}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Picker label="Client…" value={l.client ?? undefined} />
              <Picker label="File on a task…" />
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-white opacity-40">
                <Check size={15} /> Approve
              </span>
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-muted hover:text-danger">
                <X size={15} /> Turn down
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FiledTable({ grouped = false }: { grouped?: boolean }) {
  const rows = LOGS.filter((l) => !l.waiting);
  const byClient = grouped
    ? Object.entries(
        LOGS.reduce<Record<string, Log[]>>((m, l) => {
          const k = l.client ?? "Not filed yet";
          (m[k] ??= []).push(l);
          return m;
        }, {}),
      )
    : [["", rows] as [string, Log[]]];
  return (
    <Card className="overflow-hidden">
      <div className="px-6 pt-5">
        <CardTitle Icon={ReceiptText}>{grouped ? "October's hours, by client" : "October's hours"}</CardTitle>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="px-6 pb-2 font-medium">Date</th>
            {!grouped && <th className="px-3 pb-2 font-medium">Client</th>}
            <th className="px-3 pb-2 font-medium">Task</th>
            <th className="px-3 pb-2 font-medium">What he did</th>
            <th className="px-6 pb-2 text-right font-medium">Hours</th>
          </tr>
        </thead>
        <tbody>
          {byClient.map(([client, list]) => (
            <Group key={client} client={client} list={list} grouped={grouped} />
          ))}
          <tr className="border-t border-border">
            <td className="px-6 py-3 font-medium" colSpan={grouped ? 3 : 4}>
              Total <span className="font-normal text-muted">{grouped ? "· every hour not turned down" : "· filed so far"}</span>
            </td>
            <td className="px-6 py-3 text-right font-medium tabular-nums">{h(grouped ? TOTAL_H : rows.reduce((s, l) => s + l.hours, 0))}</td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

function Group({ client, list, grouped }: { client: string; list: Log[]; grouped: boolean }) {
  return (
    <>
      {grouped && (
        <tr>
          <td colSpan={3} className="px-6 pb-1 pt-4">
            {client === "Not filed yet" ? (
              <span className="text-[13px] font-medium text-[#855800]">Not filed yet</span>
            ) : (
              <span className="font-medium"><ClientTag name={client} /></span>
            )}
          </td>
          <td className="px-6 pb-1 pt-4 text-right text-[13px] font-medium tabular-nums text-muted">{h(list.reduce((s, l) => s + l.hours, 0))}</td>
        </tr>
      )}
      {list.map((l, i) => (
        <tr key={l.date + i} className={`border-t border-border ${l.waiting ? "bg-warning/5" : ""}`}>
          <td className="whitespace-nowrap px-6 py-2.5">{l.date}</td>
          {!grouped && <td className="px-3 py-2.5">{l.client && <ClientTag name={l.client} />}</td>}
          <td className="px-3 py-2.5">
            {l.waiting ? (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-[#855800]">
                <Clock size={13} /> &ldquo;{l.hint}&rdquo; · waiting
              </span>
            ) : (
              l.task
            )}
          </td>
          <td className="px-3 py-2.5 text-muted">{l.sheet ? <span className="text-[13px]">From his sheet</span> : l.did}</td>
          <td className="px-6 py-2.5 text-right tabular-nums">{h(l.hours)}</td>
        </tr>
      ))}
    </>
  );
}

function MonthsCard() {
  return (
    <Card className="p-5">
      <CardTitle Icon={ReceiptText}>Months</CardTitle>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="pb-2 font-medium">Month</th>
            <th className="pb-2 text-right font-medium">Hours</th>
            <th className="pb-2 text-right font-medium">Rate</th>
            <th className="pb-2 text-right font-medium">Bill</th>
          </tr>
        </thead>
        <tbody>
          {MONTHS.map(([m, hours], i) => (
            <tr key={m} className={i === 0 ? "font-medium text-brand" : ""}>
              <td className="py-1.5">{m}</td>
              <td className="py-1.5 text-right tabular-nums">{h(hours)}</td>
              <td className="py-1.5 text-right tabular-nums">{eur(rateFor(hours))}</td>
              <td className="py-1.5 text-right tabular-nums">{eur(hours * rateFor(hours))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function SettingRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted">
        {title} {title !== "His private link" && title !== "Deliverables" && <span className="normal-case tracking-normal text-brand">Edit</span>}
      </div>
      {children}
    </div>
  );
}

function SettingsCards({ combined = false }: { combined?: boolean }) {
  const link = (
    <>
      <code className="block truncate rounded-lg bg-background px-3 py-2 text-xs">tracker.studionmore.com/log/daniel-ross-7f3a…</code>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[13px]">
        {[["Copy", Copy], ["Open his page", ExternalLink], ["New link", RefreshCw]].map(([t, I]) => {
          const Icon = I as LucideIcon;
          return (
            <span key={t as string} className="inline-flex items-center gap-1.5 rounded-lg bg-background px-2.5 py-1.5">
              <Icon size={13} /> {t as string}
            </span>
          );
        })}
        <span className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-danger">Switch off</span>
      </div>
    </>
  );
  const clients = <p className="text-sm">{CLIENTS.join(" · ")}</p>;
  const terms = <p className="text-sm">{TERMS}. The bill counts every hour not turned down.</p>;
  const deliverables = (
    <span className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-1.5 text-brand"><ExternalLink size={13} /> NoTraffic Sensor 3 — Drive folder</span>
      <span className="text-[13px] text-muted">13 Oct</span>
    </span>
  );
  if (combined) {
    return (
      <Card className="flex flex-col gap-5 p-5">
        <SettingRow title="His private link">{link}</SettingRow>
        <SettingRow title="Clients he can log against">{clients}</SettingRow>
        <SettingRow title="Terms">{terms}</SettingRow>
        <SettingRow title="Deliverables">{deliverables}</SettingRow>
      </Card>
    );
  }
  return (
    <>
      <Card className="p-5"><CardTitle Icon={Link2}>His private link</CardTitle>{link}</Card>
      <Card className="p-5"><CardTitle Icon={Users} right={<span className="text-[13px] text-brand">Edit</span>}>Clients he can log against</CardTitle>{clients}</Card>
      <Card className="p-5"><CardTitle Icon={Scale} right={<span className="text-[13px] text-brand">Edit</span>}>Terms</CardTitle>{terms}</Card>
      <Card className="p-5"><CardTitle Icon={FolderOpen}>Deliverables &amp; folders</CardTitle>{deliverables}</Card>
    </>
  );
}

/** A: what waits for review is the first thing; settings are their own cards. */
function PageA() {
  return (
    <>
      <PageHeader />
      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <WaitingCard />
          <FiledTable />
        </div>
        <div className="flex flex-col gap-4">
          <MonthsCard />
          <SettingsCards />
        </div>
      </div>
    </>
  );
}

/** B: how the bill is made, the hours by client, the months as a chart. */
function PageB() {
  const pos = (x: number) => `${Math.min(x / 200, 1) * 100}%`;
  const max = Math.max(...MONTHS.map(([, hrs]) => hrs * rateFor(hrs)));
  return (
    <>
      <PageHeader withBill={false} />
      <Card className="mt-5 p-6">
        <CardTitle Icon={Scale}>October&apos;s bill</CardTitle>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {[
            ["Hours", h(TOTAL_H), `${WAITING.length} logs still to file`],
            ["×", "", ""],
            ["Rate", `${eur(RATE)}/h`, "under 50h — the full rate"],
            ["+", "", ""],
            ["Extras", eur(0), "nothing added"],
            ["=", "", ""],
          ].map(([l, v, s], i) =>
            v === "" ? (
              <span key={i} className="pb-6 text-2xl text-faint">{l}</span>
            ) : (
              <div key={l}>
                <div className="text-xs uppercase tracking-wide text-muted">{l}</div>
                <div className="mt-1 text-2xl font-medium tabular-nums">{v}</div>
                <div className="text-[13px] text-muted">{s}</div>
              </div>
            ),
          )}
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">The bill</div>
            <div className="font-serif-accent text-[48px] leading-none text-brand">{eur(BILL)}</div>
            <div className="text-[13px] text-muted">October so far</div>
          </div>
        </div>
        {/* the sliding scale, with where he is on it */}
        <div className="mt-6">
          <div className="relative h-2.5 rounded-full bg-track">
            <span className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: pos(TOTAL_H) }} />
            <span className="absolute -top-1 h-4.5 w-0.5 rounded bg-foreground" style={{ left: pos(TOTAL_H) }} />
          </div>
          <div className="relative mt-2 h-10 text-xs text-muted">
            {[[0, "0h"], [50, "50h · €55"], [150, "150h · €45"], [200, "200h"]].map(([x, t]) => (
              <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pos(x as number) }}>
                {t}
              </span>
            ))}
            <span className="absolute top-5 -translate-x-1/2 whitespace-nowrap font-medium text-foreground" style={{ left: pos(TOTAL_H) }}>
              He&apos;s at {h(TOTAL_H)} — {h(50 - TOTAL_H)} more and the rate starts sliding
            </span>
          </div>
        </div>
      </Card>
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <FiledTable grouped />
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <CardTitle Icon={ReceiptText} right={<span className="text-[13px] text-muted">All months {eur(MONTHS.reduce((s, [, x]) => s + x * rateFor(x), 0))}</span>}>
              Months
            </CardTitle>
            <div className="flex h-40 items-end gap-2">
              {[...MONTHS].reverse().map(([m, hrs], i, arr) => {
                const bill = hrs * rateFor(hrs);
                const last = i === arr.length - 1;
                return (
                  <div key={m} className="flex flex-1 flex-col items-center justify-end gap-1.5" title={`${m}: ${h(hrs)} · ${eur(bill)}`}>
                    <span className={`w-full rounded-md ${last ? "bg-brand" : "bg-brand/25"}`} style={{ height: `${(bill / max) * 120}px` }} />
                    <span className={`text-[11px] ${last ? "font-medium text-brand" : "text-muted"}`}>{m.slice(0, 3)}</span>
                  </div>
                );
              })}
            </div>
          </Card>
          <SettingsCards combined />
        </div>
      </div>
    </>
  );
}

/* ── the lab ───────────────────────────────────────────────────────────── */

type View = "listA" | "listB" | "pageA" | "pageB";
const VIEWS: { id: View; label: string; tip: string }[] = [
  { id: "listA", label: "List A · Cards + review", tip: "A review queue across everyone, then the cards" },
  { id: "listB", label: "List B · One table", tip: "The month's totals as tiles, one row per freelancer" },
  { id: "pageA", label: "Page A · Review first", tip: "What waits for review is its own card above the month" },
  { id: "pageB", label: "Page B · Bill breakdown", tip: "How the bill is made, hours by client, months as a chart" },
];

export function FreelancersLab() {
  const [view, setView] = useState<View>("listA");
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
        {view === "listA" && <ListA />}
        {view === "listB" && <ListB />}
        {view === "pageA" && <PageA />}
        {view === "pageB" && <PageB />}
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
