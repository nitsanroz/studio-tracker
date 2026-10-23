"use client";

// Content options for Candidates, drawn with the app's own tokens and classes
// at life size, so what is compared here is what would ship. Invented people.
//
//   List  A  "Tidy table"      — today's table, with status views as tabs, the
//                                stage shown as progress, interviews counted
//         B  "By stage"        — the list grouped under each stage, each row
//                                carrying its readings, so no board is needed
//   Page  A  "Readings"        — one timeline of scorecards (application first),
//                                latest open; discussion and history beside it
//         B  "Summary + tabs"  — a strip of the scores up top, then tabs
//         C  "Side by side"    — one scorecard matrix: every subject down the
//                                side, every reading across, to compare at once

import { useEffect, useState, type ReactNode } from "react";
import {
  Archive,
  ArrowLeft,
  Calendar,
  ChevronDown,
  ChevronRight,
  CirclePause,
  ClipboardList,
  Ellipsis,
  FileText,
  History,
  Link2,
  List,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Search,
  SquareKanban,
  Upload,
  Users,
  type LucideIcon,
} from "lucide-react";

/* ── fixtures ──────────────────────────────────────────────────────────── */

const STAGES = ["Applied", "Phone interview", "Physical interview", "Try out", "Contract"];
const ROLES: Record<string, string> = { Designer: "#0b43ed", "Motion Designer": "#7c3aed", "Junior Designer": "#0d9488" };
const OWNERS: Record<string, { initials: string; color: string }> = {
  "Michal Ner-David": { initials: "MN", color: "#e879a0" },
  "Nitsan Rozenberg": { initials: "NR", color: "#dc2626" },
};

type Row = {
  name: string;
  email: string;
  role: string | null;
  stage: number;
  owner: string | null;
  score: number | null;
  readings: { kind: string; score: number | null }[];
  last: string;
  color: string;
};

const PEOPLE: Row[] = [
  // Matches READINGS below: 7.3 and 7.5, weighted 1 and 2 → 7.4 (the real page's rule).
  { name: "Maya Levin", email: "maya.levin@mail.com", role: "Designer", stage: 2, owner: "Michal Ner-David", score: 7.4,
    readings: [{ kind: "Application", score: 7.3 }, { kind: "Phone", score: 7.5 }, { kind: "Physical", score: null }], last: "yesterday", color: "#f59e0b" },
  { name: "Tom Golan", email: "tom.golan@mail.com", role: "Designer", stage: 2, owner: "Michal Ner-David", score: null,
    readings: [{ kind: "Application", score: null }, { kind: "Phone", score: null }], last: "yesterday", color: "#0ea5e9" },
  { name: "Noa Ashkenazi", email: "noa.ash@mail.com", role: "Motion Designer", stage: 3, owner: null, score: 7.5,
    readings: [{ kind: "Application", score: 7 }, { kind: "Phone", score: 7.8 }], last: "yesterday", color: "#10b981" },
  { name: "Dana Mor", email: "danamor@mail.com", role: "Designer", stage: 3, owner: "Michal Ner-David", score: 8.0,
    readings: [{ kind: "Application", score: 8.2 }, { kind: "Phone", score: 7.5 }, { kind: "Physical", score: 8.2 }], last: "16d", color: "#7c5cff" },
  { name: "Yoav Peretz", email: "yoav.p@mail.com", role: null, stage: 0, owner: null, score: null, readings: [], last: "today", color: "#ef4444" },
  { name: "Shira Katz", email: "shira.k@mail.com", role: "Junior Designer", stage: 1, owner: "Nitsan Rozenberg", score: 5.4,
    readings: [{ kind: "Application", score: 5.4 }], last: "3d", color: "#06b6d4" },
];

const SUBJECTS: { name: string; params: string[]; fromSubmission: boolean }[] = [
  { name: "Personality", params: ["Communication", "Energy", "Fit with the studio", "Takes feedback"], fromSubmission: false },
  { name: "Professionalism", params: ["Craft in the portfolio", "Typography", "Process & reasoning", "Attention to detail"], fromSubmission: true },
  { name: "Experience", params: ["Years in the field", "Range of work", "Tools & software"], fromSubmission: true },
];

type Reading = {
  kind: string;
  who: string | null;
  date: string;
  notes: string;
  scores: Record<string, number>;
};

const READINGS: Reading[] = [
  {
    kind: "Application review",
    who: null,
    date: "14/10",
    notes: "",
    scores: { "Craft in the portfolio": 8, Typography: 7, "Process & reasoning": 7, "Attention to detail": 8, "Years in the field": 6, "Range of work": 7, "Tools & software": 8 },
  },
  {
    kind: "Phone interview",
    who: "Michal Ner-David",
    date: "19/10",
    notes: "Warm, clear about why us. Two years at a branding agency, wants more product work. Asked good questions about process.",
    scores: { Communication: 8, Energy: 8, "Fit with the studio": 7, "Takes feedback": 8, "Craft in the portfolio": 8, Typography: 7, "Process & reasoning": 7, "Years in the field": 7 },
  },
  {
    kind: "Physical interview",
    who: "Nitsan Rozenberg",
    date: "21/10",
    notes: "",
    scores: {},
  },
];

const LETTER =
  "Hi Studio & More team,\n\nI saw your post yesterday about the Visual Designer role. I've followed the studio's work for a while — the NoTraffic launch especially — and I'd love to bring my branding background to product work. Portfolio and CV attached.\n\nThanks, Maya";

const DISCUSSION = [
  { who: "Michal Ner-David", when: "19/10", body: "Strong call. I'd bring her in this week — can you do Tuesday?", mine: false },
  { who: "Nitsan Rozenberg", when: "19/10", body: "Tuesday 11:00 works. Booked.", mine: true },
];

const HISTORY = [
  ["21/10", "Stage changed", "Physical interview"],
  ["21/10", "Interview added", "Physical interview"],
  ["19/10", "Interview added", "Phone interview"],
  ["19/10", "Stage changed", "Phone interview"],
  ["14/10", "Created", ""],
];

/* ── small pieces ──────────────────────────────────────────────────────── */

const band = (v: number | null) =>
  v == null ? "text-faint" : v >= 8 ? "text-success" : v >= 6 ? "text-[#855800]" : "text-danger";
const bandBg = (v: number | null) =>
  v == null ? "bg-background text-faint" : v >= 8 ? "bg-success/10 text-success" : v >= 6 ? "bg-warning/15 text-[#855800]" : "bg-danger/10 text-danger";
const fmt = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function Initials({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const t = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
    >
      {t}
    </span>
  );
}

function RoleChip({ role }: { role: string | null }) {
  if (!role) return <span className="text-[13px] text-faint">No role</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-2 py-0.5 text-xs text-muted">
      <span className="size-1.5 rounded-full" style={{ background: ROLES[role] }} />
      {role}
    </span>
  );
}

function Owner({ name }: { name: string | null }) {
  if (!name) return <span className="text-[13px] text-faint">Unassigned</span>;
  return (
    <span className="inline-flex items-center gap-2 text-[13px]">
      <Initials name={name} color={OWNERS[name].color} size={22} />
      {name.split(" ")[0]}
    </span>
  );
}

function ScorePill({ v }: { v: number | null }) {
  return <span className={`inline-flex min-w-11 justify-center rounded-lg px-2 py-1 text-[13px] font-medium tabular-nums ${bandBg(v)}`}>{fmt(v)}</span>;
}

function StageDots({ at }: { at: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`Stage ${at + 1} of ${STAGES.length}`}>
      {STAGES.map((s, i) => (
        <span key={s} className={`h-1.5 w-4 rounded-full ${i <= at ? "bg-brand" : "bg-track"}`} />
      ))}
    </span>
  );
}

function Seg({ items, active }: { items: { label: string; Icon: LucideIcon; count?: number }[]; active: number }) {
  return (
    <div className="flex rounded-xl bg-track p-1">
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

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-border bg-surface shadow-card ${className}`}>{children}</section>;
}

function CardTitle({ Icon, children, right }: { Icon: LucideIcon; children: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-heading text-base">
        <Icon size={18} strokeWidth={1.75} className="text-brand" />
        {children}
      </h2>
      {right}
    </header>
  );
}

/* ── list ──────────────────────────────────────────────────────────────── */

function ListHeader() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Candidates</h1>
          <p className="mt-1 text-sm text-muted">5 in play · 1 on hold · 2 interviews this week</p>
        </div>
        <span className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white">
          <Plus size={16} strokeWidth={2} /> Add candidate
        </span>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Seg
          active={0}
          items={[
            { label: "In play", Icon: Users, count: 5 },
            { label: "On hold", Icon: CirclePause, count: 1 },
            { label: "Archive", Icon: Archive, count: 276 },
          ]}
        />
        <span className="inline-flex h-10 items-center gap-2 rounded-xl bg-surface px-3.5 text-sm text-muted shadow-card">
          All roles <ChevronDown size={15} />
        </span>
        <span className="ml-auto inline-flex h-10 w-72 items-center gap-2 rounded-xl bg-surface px-3.5 text-sm text-faint shadow-card">
          <Search size={16} /> Name, email, source
        </span>
        <Seg
          active={1}
          items={[
            { label: "Board", Icon: SquareKanban },
            { label: "List", Icon: List },
          ]}
        />
      </div>
    </>
  );
}

function ListA() {
  return (
    <>
      <ListHeader />
      <Card className="mt-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
              <th className="px-5 py-3 font-medium">Candidate</th>
              <th className="px-3 py-3 font-medium">Stage</th>
              <th className="px-3 py-3 font-medium">Owner</th>
              <th className="px-3 py-3 font-medium">Readings</th>
              <th className="px-3 py-3 text-right font-medium">Score</th>
              <th className="px-5 py-3 text-right font-medium">Last activity ↓</th>
            </tr>
          </thead>
          <tbody>
            {PEOPLE.map((p) => (
              <tr key={p.name} className="border-t border-border hover:bg-background/60">
                <td className="px-5 py-3">
                  <span className="flex items-center gap-3">
                    <Initials name={p.name} color={p.color} size={34} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{p.name}</span>
                        <RoleChip role={p.role} />
                      </span>
                      <span className="block text-[13px] text-muted">{p.email}</span>
                    </span>
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className="block text-[13px]">{STAGES[p.stage]}</span>
                  <span className="mt-1 block">
                    <StageDots at={p.stage} />
                  </span>
                </td>
                <td className="px-3 py-3">
                  <Owner name={p.owner} />
                </td>
                <td className="px-3 py-3 text-[13px] text-muted">
                  {p.readings.length === 0 ? (
                    <span className="text-faint">None yet</span>
                  ) : (
                    <span className="flex flex-wrap gap-x-3">
                      {p.readings.map((r) => (
                        <span key={r.kind}>
                          {r.kind} <b className={`tabular-nums ${band(r.score)}`}>{fmt(r.score)}</b>
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <ScorePill v={p.score} />
                </td>
                <td className="px-5 py-3 text-right text-[13px] text-muted">{p.last}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function ListB() {
  return (
    <>
      <ListHeader />
      <div className="mt-4 flex flex-col gap-6">
        {STAGES.map((stage, si) => {
          const rows = PEOPLE.filter((p) => p.stage === si);
          return (
            <section key={stage}>
              <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-medium">
                {stage}
                <span className="rounded-full bg-track px-2 text-xs tabular-nums text-muted">{rows.length}</span>
              </h2>
              {rows.length === 0 ? (
                <p className="px-1 text-[13px] text-faint">Nobody here.</p>
              ) : (
                <Card className="p-1.5">
                  {rows.map((p) => (
                    <div key={p.name} className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_minmax(0,1fr)_auto_auto] items-center gap-4 rounded-xl px-4 py-3 hover:bg-background">
                      <span className="flex items-center gap-3">
                        <Initials name={p.name} color={p.color} size={38} />
                        <span className="min-w-0">
                          <span className="block font-medium">{p.name}</span>
                          <RoleChip role={p.role} />
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {p.readings.length === 0 ? (
                          <span className="text-[13px] text-faint">No readings yet</span>
                        ) : (
                          p.readings.map((r) => (
                            <span key={r.kind} className="inline-flex items-center gap-1.5 rounded-lg bg-background px-2 py-1 text-xs text-muted">
                              {r.kind}
                              <b className={`tabular-nums ${band(r.score)}`}>{fmt(r.score)}</b>
                            </span>
                          ))
                        )}
                      </span>
                      <Owner name={p.owner} />
                      <span className="text-[13px] text-muted">{p.last}</span>
                      <span className={`font-serif-accent w-14 text-right text-[30px] leading-none tabular-nums ${band(p.score)}`}>{fmt(p.score)}</span>
                    </div>
                  ))}
                </Card>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

/* ── candidate page ────────────────────────────────────────────────────── */

const ME = PEOPLE[0];

function PageHeader() {
  return (
    <>
      <span className="inline-flex items-center gap-1.5 text-sm text-muted">
        <ArrowLeft size={15} /> Candidates
      </span>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif-accent text-[44px] leading-tight">{ME.name}</h1>
            <RoleChip role={ME.role} />
            <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted">from Email</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5"><Phone size={15} /> 052-000-0000</span>
            <span className="inline-flex items-center gap-1.5"><Mail size={15} /> {ME.email}</span>
            <span className="inline-flex items-center gap-1.5"><Calendar size={15} /> Applied 14/10/2026</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
            {[["Maya_Levin_CV.pdf", FileText], ["mayalevin.design", Link2], ["Behance", Link2]].map(([t, I]) => {
              const Icon = I as LucideIcon;
              return (
                <span key={t as string} className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 shadow-card">
                  <Icon size={14} className="text-brand" /> {t as string}
                </span>
              );
            })}
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-muted"><Upload size={14} /> Upload a CV</span>
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-muted"><Plus size={14} /> Add a link</span>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="text-right">
            <div className={`font-serif-accent text-[56px] leading-none tabular-nums ${band(ME.score)}`}>{fmt(ME.score)}</div>
            <div className="mt-1 text-xs text-muted">across 2 readings</div>
          </div>
          <span className="mt-1 inline-flex size-10 items-center justify-center rounded-xl bg-surface text-muted shadow-card">
            <Ellipsis size={18} />
          </span>
        </div>
      </div>
      {/* the stage as the same neutral track the lead page uses */}
      <div className="mt-5 flex items-stretch gap-2">
        <ol className="flex flex-1 gap-1 rounded-xl bg-surface p-1 shadow-card">
          {STAGES.map((s, i) => (
            <li key={s} className="flex-1">
              <span
                className={`flex h-10 items-center justify-center gap-2 rounded-lg text-sm ${
                  i === ME.stage ? "bg-brand font-medium text-white" : i < ME.stage ? "text-muted" : ""
                }`}
              >
                {i < ME.stage && <span className="text-faint">✓</span>}
                {s}
              </span>
            </li>
          ))}
        </ol>
        <span className="inline-flex items-center gap-2 rounded-xl bg-surface px-4 text-sm shadow-card">
          <Initials name="Michal Ner-David" color={OWNERS["Michal Ner-David"].color} size={24} /> Michal <ChevronDown size={15} className="text-muted" />
        </span>
      </div>
    </>
  );
}

function ScoreGrid({ scores, subjects }: { scores: Record<string, number>; subjects: typeof SUBJECTS }) {
  return (
    <div className="grid gap-x-8 gap-y-5" style={{ gridTemplateColumns: `repeat(${subjects.length}, minmax(0,1fr))` }}>
      {subjects.map((s) => {
        const avg = mean(s.params.map((p) => scores[p]).filter((x) => x != null));
        return (
          <div key={s.name}>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">{s.name}</span>
              <span className={`text-sm font-medium tabular-nums ${band(avg)}`}>{fmt(avg)}</span>
            </div>
            {s.params.map((p) => (
              <div key={p} className="flex items-center justify-between py-1 text-sm">
                <span>{p}</span>
                <span className={`tabular-nums ${band(scores[p] ?? null)}`}>{scores[p] ?? "—"}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SideColumn({ withApplication = false }: { withApplication?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {withApplication && (
        <Card className="p-6">
          <CardTitle Icon={FileText} right={<span className="text-xs text-muted">14/10</span>}>
            What they sent
          </CardTitle>
          <p className="bidi-auto whitespace-pre-line text-sm leading-relaxed">{LETTER}</p>
        </Card>
      )}
      <Card className="p-6">
        <CardTitle Icon={MessageSquare}>Discussion</CardTitle>
        <div className="flex flex-col gap-3">
          {DISCUSSION.map((m) => (
            <div key={m.body} className={`flex gap-2.5 ${m.mine ? "flex-row-reverse" : ""}`}>
              <Initials name={m.who} color={OWNERS[m.who].color} size={26} />
              <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${m.mine ? "bg-brand-soft" : "bg-background"}`}>
                <div className="mb-0.5 text-xs text-muted">
                  {m.who.split(" ")[0]} · {m.when}
                </div>
                {m.body}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl bg-background px-3.5 py-3 text-sm text-faint">Write a message…</div>
      </Card>
      <Card className="p-6">
        <CardTitle Icon={History}>History</CardTitle>
        <ul className="flex flex-col gap-2 text-sm">
          {HISTORY.map(([d, k, x]) => (
            <li key={d + k + x} className="flex gap-3">
              <span className="w-12 shrink-0 tabular-nums text-muted">{d}</span>
              <span>
                {k}
                {x && <b className="font-medium"> · {x}</b>}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function readingAvg(r: Reading) {
  return mean(Object.values(r.scores));
}

/** A: one timeline of readings; the application is the first reading. */
function PageA() {
  const [open, setOpen] = useState(2);
  return (
    <>
      <PageHeader />
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="p-6">
          <CardTitle
            Icon={ClipboardList}
            right={
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white">
                <Plus size={14} /> Add an interview
              </span>
            }
          >
            Readings
          </CardTitle>
          <ol className="flex flex-col gap-2">
            {READINGS.map((r, i) => {
              const isOpen = open === i;
              const avg = readingAvg(r);
              return (
                <li key={r.kind} className={`rounded-xl ${isOpen ? "bg-background" : ""}`}>
                  <button onClick={() => setOpen(isOpen ? -1 : i)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                    {isOpen ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
                    {r.who ? (
                      <Initials name={r.who} color={OWNERS[r.who].color} size={28} />
                    ) : (
                      <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand">
                        <FileText size={14} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{r.kind}</span>
                      <span className="block text-[13px] text-muted">
                        {r.who ? `${r.who.split(" ")[0]} · ` : ""}
                        {r.date} · {Object.keys(r.scores).length ? `${Object.keys(r.scores).length} scores` : "nothing scored yet"}
                      </span>
                    </span>
                    <span className={`font-serif-accent text-[30px] leading-none tabular-nums ${band(avg)}`}>{fmt(avg)}</span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-5 pl-14">
                      {i === 0 ? (
                        <p className="bidi-auto mb-5 whitespace-pre-line text-sm leading-relaxed">{LETTER}</p>
                      ) : (
                        <div className="mb-5 rounded-xl bg-surface px-4 py-3 text-sm text-muted">
                          {r.notes || "What you heard. A few lines is plenty…"}
                        </div>
                      )}
                      <ScoreGrid scores={r.scores} subjects={i === 0 ? SUBJECTS.filter((s) => s.fromSubmission) : SUBJECTS} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
        <SideColumn />
      </div>
    </>
  );
}

/** B: the scores as a strip, then tabs. */
function PageB() {
  const tabs: { label: string; Icon: LucideIcon; count?: number }[] = [
    { label: "Interviews", Icon: ClipboardList, count: 2 },
    { label: "Application", Icon: FileText },
    { label: "Discussion", Icon: MessageSquare, count: 2 },
    { label: "History", Icon: History },
  ];
  return (
    <>
      <PageHeader />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-brand! p-5 text-white">
          <div className="text-xs uppercase tracking-wide text-white/75">Overall</div>
          <div className="font-serif-accent mt-1 text-[40px] leading-none">{fmt(ME.score)}</div>
          <div className="mt-1 text-xs text-white/75">later readings count more</div>
        </Card>
        {READINGS.map((r) => {
          const avg = readingAvg(r);
          return (
            <Card key={r.kind} className="p-5">
              <div className="text-xs uppercase tracking-wide text-muted">{r.kind.replace(" review", "")}</div>
              <div className={`font-serif-accent mt-1 text-[40px] leading-none ${band(avg)}`}>{fmt(avg)}</div>
              <div className="mt-1 text-xs text-muted">
                {r.who ? r.who.split(" ")[0] : "From the submission"} · {r.date}
              </div>
            </Card>
          );
        })}
        <div className="flex items-center justify-center rounded-2xl bg-track/60 text-sm font-medium text-muted">
          <Plus size={16} className="mr-1.5" /> Add an interview
        </div>
      </div>
      <div className="mt-6">
        <Seg items={tabs} active={0} />
      </div>
      <div className="mt-4 flex flex-col gap-4">
        {READINGS.slice(1).reverse().map((r, i) => (
          <Card key={r.kind} className="p-6">
            <div className="mb-4 flex items-center gap-3">
              <Initials name={r.who!} color={OWNERS[r.who!].color} size={30} />
              <span className="flex-1">
                <span className="block font-medium">{r.kind}</span>
                <span className="block text-[13px] text-muted">
                  {r.who} · {r.date}
                </span>
              </span>
              <span className={`font-serif-accent text-[30px] leading-none ${band(readingAvg(r))}`}>{fmt(readingAvg(r))}</span>
            </div>
            {i === 0 && <div className="mb-5 rounded-xl bg-background px-4 py-3 text-sm text-muted">What you heard. A few lines is plenty…</div>}
            {r.notes && <p className="mb-5 text-sm leading-relaxed">{r.notes}</p>}
            <ScoreGrid scores={r.scores} subjects={SUBJECTS} />
          </Card>
        ))}
      </div>
    </>
  );
}

/** C: one matrix — every subject down the side, every reading across. */
function PageC() {
  const cols = READINGS;
  return (
    <>
      <PageHeader />
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-4">
          <Card className="p-6">
            <CardTitle
              Icon={ClipboardList}
              right={
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white">
                  <Plus size={14} /> Add an interview
                </span>
              }
            >
              Scorecard
            </CardTitle>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th />
                  {cols.map((r) => (
                    <th key={r.kind} className="px-3 pb-3 text-left align-bottom font-normal">
                      <span className="flex items-center gap-2">
                        {r.who ? (
                          <Initials name={r.who} color={OWNERS[r.who].color} size={24} />
                        ) : (
                          <span className="inline-flex size-6 items-center justify-center rounded-full bg-brand-soft text-brand">
                            <FileText size={12} />
                          </span>
                        )}
                        <span>
                          <span className="block font-medium">{r.kind.replace(" review", "")}</span>
                          <span className="block text-xs text-muted">
                            {r.who ? `${r.who.split(" ")[0]} · ` : ""}
                            {r.date}
                          </span>
                        </span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {SUBJECTS.map((s) => (
                  <SubjectRows key={s.name} subject={s} cols={cols} />
                ))}
                <tr className="border-t border-border">
                  <td className="pt-4 font-medium">Average</td>
                  {cols.map((r) => (
                    <td key={r.kind} className="px-3 pt-4">
                      <span className={`font-serif-accent text-[30px] leading-none ${band(readingAvg(r))}`}>{fmt(readingAvg(r))}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </Card>
          <Card className="p-6">
            <CardTitle Icon={MessageSquare}>What they said</CardTitle>
            <div className="flex flex-col gap-4">
              {READINGS.slice(1).map((r) => (
                <div key={r.kind} className="flex gap-3">
                  <Initials name={r.who!} color={OWNERS[r.who!].color} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-muted">
                      {r.kind} · {r.who} · {r.date}
                    </div>
                    <p className="mt-0.5 text-sm leading-relaxed">{r.notes || <span className="text-faint">No notes yet.</span>}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <SideColumn withApplication />
      </div>
    </>
  );
}

function SubjectRows({ subject, cols }: { subject: (typeof SUBJECTS)[number]; cols: Reading[] }) {
  return (
    <>
      <tr>
        <td className="pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted">{subject.name}</td>
        {cols.map((r, i) => {
          const na = i === 0 && !subject.fromSubmission;
          const avg = mean(subject.params.map((p) => r.scores[p]).filter((x) => x != null));
          return (
            <td key={r.kind} className={`px-3 pb-1 pt-4 text-[13px] font-medium tabular-nums ${na ? "text-faint" : band(avg)}`}>
              {na ? "n/a" : fmt(avg)}
            </td>
          );
        })}
      </tr>
      {subject.params.map((p) => (
        <tr key={p}>
          <td className="py-1.5 pr-3">{p}</td>
          {cols.map((r, i) => {
            const na = i === 0 && !subject.fromSubmission;
            const v = r.scores[p];
            return (
              <td key={r.kind} className="px-3 py-1.5">
                {na ? (
                  <span className="text-faint">·</span>
                ) : (
                  <span className={`inline-flex min-w-9 justify-center rounded-md px-1.5 py-0.5 tabular-nums ${bandBg(v ?? null)}`}>
                    {v ?? "—"}
                  </span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

/* ── the lab ───────────────────────────────────────────────────────────── */

type View = "listA" | "listB" | "pageA" | "pageB" | "pageC";
const VIEWS: { id: View; label: string; tip: string }[] = [
  { id: "listA", label: "List A · Tidy table", tip: "Today's table: status views as tabs, stage as progress, readings per row" },
  { id: "listB", label: "List B · By stage", tip: "Grouped under each stage, readings as chips, score as the figure" },
  { id: "pageA", label: "Page A · Readings", tip: "One timeline of scorecards, application first, latest open" },
  { id: "pageB", label: "Page B · Summary + tabs", tip: "Scores as a strip up top, then tabs" },
  { id: "pageC", label: "Page C · Side by side", tip: "One matrix: subjects down, readings across" },
];

export function CandidatesLab() {
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
