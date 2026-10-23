"use client";

// The UI-revamp sandbox, round 2. Direction A ("Electric, softened") was chosen;
// this round puts each open question on a switch so they can be mixed:
//   Menu      — how rounded the sidebar is, and how the active page is marked
//   Cards     — the card edge (round 1's hairline border read as a "rounded divider")
//   Graphs    — the hours chart + hours-by-client pair
//   This week — replacements for the hard-to-read rings
//   Pace      — the studio-pace notice, which had no contrast
// Fixture data only; nothing here reads the database.

import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChartPie,
  Handshake,
  History,
  House,
  Inbox,
  Info,
  Plus,
  Receipt,
  Search,
  Settings,
  Sparkles,
  SquareCheckBig,
  TreePalm,
  UserRoundPen,
  UserRoundSearch,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

type Screen = "home" | "clients";
type Opts = { menu: 1 | 2 | 3; card: 1 | 2 | 3; graph: 1 | 2 | 3; week: 1 | 2 | 3; pace: 1 | 2 | 3 };
type OptKey = keyof Opts;

const OPTION_SETS: { key: OptKey; label: string; names: [string, string, string]; tips: [string, string, string] }[] = [
  {
    key: "menu",
    label: "Menu",
    names: ["Squared", "Flush", "Indicator"],
    tips: [
      "Floating panel, tighter corners, white tab for the active page",
      "Full-height sidebar with no outer rounding, small-radius tabs",
      "Floating panel, no tab: a bar on the left marks the active page",
    ],
  },
  {
    key: "card",
    label: "Cards",
    names: ["Shadow", "Hairline", "Flat"],
    tips: [
      "No outline at all, a soft shadow lifts the card",
      "Smaller corners, a thin outline, no shadow",
      "Smaller corners, no outline, no shadow; a darker background separates",
    ],
  },
  {
    key: "graph",
    label: "Graphs",
    names: ["Pace line", "Daily bars", "Blue panel"],
    tips: [
      "Hours added up through the month against the goal line; client bars in client colours",
      "One bar per day split billable / non-billable, weekends shaded; one stacked client bar",
      "The pace line on a solid blue card; clients as proportional tiles",
    ],
  },
  {
    key: "week",
    label: "This week",
    names: ["Bars", "Days", "Columns"],
    tips: [
      "One row per designer: a bar of logged hours inside their planned hours",
      "Each designer's Sun–Thu, one cell per day, shaded by hours",
      "One column per designer, filled up to logged hours",
    ],
  },
  {
    key: "pace",
    label: "Pace",
    names: ["Blue", "Navy", "Card"],
    tips: ["Solid brand blue, white text", "Studio Black, white text", "White card with a progress bar"],
  },
];

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const NAV: { label: string; Icon: LucideIcon; admin?: boolean; badge?: number }[] = [
  { label: "Home", Icon: House },
  { label: "Weekly Plan", Icon: CalendarDays },
  { label: "My Tasks", Icon: SquareCheckBig },
  { label: "Vacation", Icon: TreePalm },
  { label: "Time Feed", Icon: History },
  { label: "Settings", Icon: Settings },
  { label: "Intake", Icon: Inbox, admin: true, badge: 2 },
  { label: "Clients", Icon: Users, admin: true },
  { label: "Reports", Icon: ChartPie, admin: true },
  { label: "Client Reports", Icon: Receipt, admin: true },
  { label: "Team", Icon: UsersRound, admin: true },
  { label: "Candidates", Icon: UserRoundSearch, admin: true },
  { label: "Leads", Icon: Handshake, admin: true },
  { label: "Freelancers", Icon: UserRoundPen, admin: true },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu"];
/** Sun–Thu of this week; `null` = a day off. Thursday is today, so it's partial. */
const TEAM: { name: string; initials: string; color: string; planned: number; days: (number | null)[] }[] = [
  { name: "Aki", initials: "AK", color: "#b45309", planned: 36, days: [8, 7.5, 8, 8, 0] },
  { name: "Dmitry", initials: "DM", color: "#db2777", planned: 40, days: [8, 8, 8, 8, 6] },
  { name: "Michal", initials: "MI", color: "#0d9488", planned: 32, days: [7, 6.25, 7, 7, 0] },
  { name: "Nadav", initials: "NA", color: "#2563eb", planned: 24, days: [null, null, 6, 8, 0] },
  { name: "Nitsan", initials: "NR", color: "#dc2626", planned: 20, days: [3, 2.75, 4, 3, 0] },
];
const logged = (days: (number | null)[]) => days.reduce<number>((s, d) => s + (d ?? 0), 0);

const BY_CLIENT = [
  { name: "NoTraffic", color: "#3b82f6", hours: 142 },
  { name: "Variant", color: "#7c3aed", hours: 135.25 },
  { name: "Studio", color: "#0b43ed", hours: 45 },
  { name: "Visitt", color: "#1f7a4d", hours: 27 },
  { name: "Maccabi", color: "#1e2a6b", hours: 25.5 },
  { name: "DualBird", color: "#f07a4a", hours: 9 },
  { name: "Baseline", color: "#5b6abf", hours: 8.75 },
];

/** October 2026, hours per day for days 1–22 (today is Thu 22). Fri/Sat near zero. */
const DAILY = [24, 1.5, 0, 27, 26, 23.5, 27, 24, 0, 1, 22.5, 26.5, 25, 28, 21.5, 0, 0, 26, 24, 27.5, 25, 12.5];
const BILLABLE_SHARE = [0.9, 0, 0, 0.88, 0.86, 0.9, 0.85, 0.88, 0, 0, 0.84, 0.9, 0.87, 0.86, 0.9, 0, 0, 0.88, 0.85, 0.87, 0.89, 0.8];
const MONTH_DAYS = 31;
const GOAL = 490;
/** Oct 1 2026 is a Thursday; 0 = Sunday. */
const weekday = (day: number) => (4 + day - 1) % 7;
const isWorkday = (day: number) => weekday(day) <= 4;
const WORKDAYS = Array.from({ length: MONTH_DAYS }, (_, i) => i + 1).filter(isWorkday).length;
const GOAL_CUM = Array.from({ length: MONTH_DAYS }, (_, i) => {
  const done = Array.from({ length: i + 1 }, (_, j) => j + 1).filter(isWorkday).length;
  return (GOAL * done) / WORKDAYS;
});
const CUM = DAILY.reduce<number[]>((acc, v) => [...acc, (acc.at(-1) ?? 0) + v], []);
const TOTAL = CUM.at(-1)!;

type Tone = "bad" | "warn" | "good" | "neutral";

const ATTENTION: { tone: Tone; title: string; why: string }[] = [
  { tone: "bad", title: "NoTraffic is 12h over its October cap", why: "142 of 130h · cap from the client's billing period" },
  { tone: "warn", title: "Variant's weekly report goes out Sunday", why: "Hours through Thu 22/10 not checked yet" },
  { tone: "warn", title: "Baseline revised its brief", why: "2 answers changed since you last replied" },
  { tone: "neutral", title: "3 new website leads", why: "Arrived since Tuesday" },
];
const TONE_WORD: Record<Tone, string> = { bad: "Urgent", warn: "Check", good: "Good", neutral: "FYI" };

const COMING = [
  { emoji: "🎨", title: "International Artist's Day", when: "25/10 · in 3 days" },
  { emoji: "🗳️", title: "Elections", when: "27/10 · in 5 days" },
  { emoji: "🎉", title: "Dmitry — 2 years at the studio", when: "01/11 · in 10 days" },
];

type ClientRow = {
  name: string;
  color: string;
  open: number;
  week: number | null;
  month: number | null;
  total: number;
  cap: { used: number; of: number } | null;
};

const CLIENTS: ClientRow[] = [
  { name: "NoTraffic", color: "#3b82f6", open: 9, week: 17.5, month: 142, total: 3324.65, cap: { used: 142, of: 130 } },
  { name: "Variant", color: "#7c3aed", open: 61, week: 42, month: 135.25, total: 194.25, cap: { used: 135.25, of: 150 } },
  { name: "Baseline", color: "#5b6abf", open: 23, week: 0.5, month: 8.75, total: 2065.83, cap: { used: 8.75, of: 40 } },
  { name: "Maccabi", color: "#1e2a6b", open: 4, week: 3.25, month: 25.5, total: 919.5, cap: null },
  { name: "Visitt", color: "#1f7a4d", open: 6, week: null, month: 27, total: 1174.5, cap: { used: 27, of: 30 } },
  { name: "DualBird", color: "#f07a4a", open: 9, week: null, month: 9, total: 1180.4, cap: null },
  { name: "JustPlay", color: "#e879f9", open: 2, week: null, month: null, total: 1102.5, cap: null },
  { name: "Blazepod", color: "#1e293b", open: 27, week: null, month: null, total: 6535.5, cap: null },
  { name: "Checkmarx", color: "#6d28d9", open: 2, week: null, month: null, total: 5795.75, cap: null },
];

/* ── Small pieces ──────────────────────────────────────────────────────── */

const fmtH = (h: number | null) => (h == null ? "–" : `${Number(h.toFixed(2))}h`);

function Num({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`lx-num ${className}`}>{children}</span>;
}

function Explain({ tip }: { tip: string }) {
  return (
    <span className="lx-tip" data-tip={tip} tabIndex={0} aria-label={tip}>
      <Info size={13} strokeWidth={1.75} />
    </span>
  );
}

function Avatar({ initials, color, size = 28 }: { initials: string; color: string; size?: number }) {
  return (
    <span className="lx-avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.36 }}>
      {initials}
    </span>
  );
}

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`lx-chip lx-chip-${tone}`}>
      <span className="lx-chip-dot" />
      {children}
    </span>
  );
}

/* ── Graphs ────────────────────────────────────────────────────────────── */

const CW = 760;
const CH = 250;
const PAD = { l: 44, r: 16, t: 14, b: 30 };
const plotW = CW - PAD.l - PAD.r;
const plotH = CH - PAD.t - PAD.b;
const xDay = (day: number) => PAD.l + ((day - 0.5) / MONTH_DAYS) * plotW;

/** Hover read-out shared by both charts: a column per day catches the pointer. */
function HoverCatcher({ onHover }: { onHover: (day: number | null) => void }) {
  return (
    <g onMouseLeave={() => onHover(null)}>
      {Array.from({ length: MONTH_DAYS }, (_, i) => (
        <rect
          key={i}
          x={PAD.l + (i / MONTH_DAYS) * plotW}
          y={PAD.t}
          width={plotW / MONTH_DAYS}
          height={plotH}
          fill="transparent"
          onMouseEnter={() => onHover(i + 1)}
        />
      ))}
    </g>
  );
}

function ReadOut({ day, lines, onBlue }: { day: number; lines: string[]; onBlue?: boolean }) {
  const w = 150;
  const x = Math.min(Math.max(xDay(day) - w / 2, PAD.l), CW - PAD.r - w);
  return (
    <g pointerEvents="none">
      <line x1={xDay(day)} x2={xDay(day)} y1={PAD.t} y2={PAD.t + plotH} className={onBlue ? "lx-cross-blue" : "lx-cross"} />
      <rect x={x} y={PAD.t} width={w} height={18 + lines.length * 17} rx={10} className={onBlue ? "lx-readout-bg-blue" : "lx-readout-bg"} />
      <text x={x + 12} y={PAD.t + 19} className={onBlue ? "lx-readout-h-blue" : "lx-readout-h"}>
        {WEEKDAYS[weekday(day)] ?? (weekday(day) === 5 ? "Fri" : "Sat")} {day}/10
      </text>
      {lines.map((l, i) => (
        <text key={l} x={x + 12} y={PAD.t + 37 + i * 17} className={onBlue ? "lx-readout-blue" : "lx-readout"}>
          {l}
        </text>
      ))}
    </g>
  );
}

function YAxis({ max, step, unit = "h", onBlue }: { max: number; step: number; unit?: string; onBlue?: boolean }) {
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  return (
    <g>
      {ticks.map((t) => {
        const y = PAD.t + plotH - (t / max) * plotH;
        return (
          <g key={t}>
            <line x1={PAD.l} x2={CW - PAD.r} y1={y} y2={y} className={onBlue ? "lx-grid-blue" : "lx-grid"} />
            <text x={PAD.l - 10} y={y + 4} textAnchor="end" className={onBlue ? "lx-axis-blue" : "lx-axis"}>
              {t}
              {t ? unit : ""}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function XAxis({ onBlue }: { onBlue?: boolean }) {
  return (
    <g>
      {[1, 8, 15, 22, 29].map((d) => (
        <text key={d} x={xDay(d)} y={CH - 8} textAnchor="middle" className={onBlue ? "lx-axis-blue" : "lx-axis"}>
          {d}/10
        </text>
      ))}
    </g>
  );
}

/** Cumulative hours against the goal's pace — the chart answers "are we on track?" */
function PaceChart({ onBlue = false }: { onBlue?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = 500;
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const actual = CUM.map((v, i) => `${i ? "L" : "M"}${xDay(i + 1)},${y(v)}`).join(" ");
  const goal = GOAL_CUM.map((v, i) => `${i ? "L" : "M"}${xDay(i + 1)},${y(v)}`).join(" ");
  const today = CUM.length;
  const id = onBlue ? "lx-fill-blue" : "lx-fill";
  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} className="lx-chart">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={onBlue ? "#74f3ef" : "#0b43ed"} stopOpacity={onBlue ? 0.5 : 0.28} />
          <stop offset="100%" stopColor={onBlue ? "#74f3ef" : "#0b43ed"} stopOpacity={0} />
        </linearGradient>
      </defs>
      {Array.from({ length: MONTH_DAYS }, (_, i) => i + 1)
        .filter((d) => !isWorkday(d))
        .map((d) => (
          <rect key={d} x={xDay(d) - plotW / MONTH_DAYS / 2} y={PAD.t} width={plotW / MONTH_DAYS} height={plotH} className={onBlue ? "lx-weekend-blue" : "lx-weekend"} />
        ))}
      <YAxis max={max} step={100} onBlue={onBlue} />
      <XAxis onBlue={onBlue} />
      <path d={`${actual} L${xDay(today)},${y(0)} L${xDay(1)},${y(0)} Z`} fill={`url(#${id})`} />
      <path d={goal} className={onBlue ? "lx-goal-blue" : "lx-goal"} />
      <text x={xDay(MONTH_DAYS)} y={y(GOAL) - 8} textAnchor="end" className={onBlue ? "lx-goal-label-blue" : "lx-goal-label"}>
        Goal {GOAL}h
      </text>
      <path d={actual} className={onBlue ? "lx-line-blue" : "lx-line"} />
      <circle cx={xDay(today)} cy={y(TOTAL)} r={5} className={onBlue ? "lx-dot-blue" : "lx-dot"} />
      <text x={xDay(today) + 10} y={y(TOTAL) - 8} className={onBlue ? "lx-today-blue" : "lx-today"}>
        Today · {TOTAL}h
      </text>
      <HoverCatcher onHover={setHover} />
      {hover != null && (
        <ReadOut
          day={hover}
          onBlue={onBlue}
          lines={[
            hover <= today ? `${fmtH(CUM[hover - 1])} so far` : "Still to come",
            `Goal pace ${Math.round(GOAL_CUM[hover - 1])}h`,
          ]}
        />
      )}
    </svg>
  );
}

/** One bar per day, billable at the base; weekends shaded, days still to come as empty tracks. */
function DailyBars() {
  const [hover, setHover] = useState<number | null>(null);
  const max = 30;
  const y = (v: number) => PAD.t + plotH - (v / max) * plotH;
  const slot = plotW / MONTH_DAYS;
  const bw = slot * 0.62;
  const workdayHours = DAILY.filter((_, i) => isWorkday(i + 1));
  const avg = workdayHours.reduce((s, v) => s + v, 0) / workdayHours.length;
  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} className="lx-chart">
      {Array.from({ length: MONTH_DAYS }, (_, i) => i + 1)
        .filter((d) => !isWorkday(d))
        .map((d) => (
          <rect key={d} x={xDay(d) - slot / 2} y={PAD.t} width={slot} height={plotH} className="lx-weekend" />
        ))}
      <YAxis max={max} step={10} />
      <XAxis />
      {Array.from({ length: MONTH_DAYS }, (_, i) => {
        const d = i + 1;
        const x = xDay(d) - bw / 2;
        const v = DAILY[i];
        if (v == null) {
          return isWorkday(d) ? <rect key={d} x={x} y={y(avg)} width={bw} height={y(0) - y(avg)} rx={4} className="lx-bar-future" /> : null;
        }
        const bill = v * BILLABLE_SHARE[i];
        const isToday = d === DAILY.length;
        return (
          <g key={d} opacity={hover != null && hover !== d ? 0.45 : 1}>
            <rect x={x} y={y(v)} width={bw} height={y(0) - y(v)} rx={4} className="lx-bar-non" />
            <rect x={x} y={y(bill)} width={bw} height={y(0) - y(bill)} rx={4} className={isToday ? "lx-bar-today" : "lx-bar-bill"} />
          </g>
        );
      })}
      <line x1={PAD.l} x2={CW - PAD.r} y1={y(avg)} y2={y(avg)} className="lx-goal" />
      <text x={CW - PAD.r} y={y(avg) - 7} textAnchor="end" className="lx-goal-label">
        Workday average {avg.toFixed(1)}h
      </text>
      <HoverCatcher onHover={setHover} />
      {hover != null && DAILY[hover - 1] != null && (
        <ReadOut
          day={hover}
          lines={[`${fmtH(DAILY[hover - 1])} logged`, `${fmtH(DAILY[hover - 1] * BILLABLE_SHARE[hover - 1])} billable`]}
        />
      )}
    </svg>
  );
}

function HoursCard({ graph }: { graph: Opts["graph"] }) {
  const blue = graph === 3;
  return (
    <article className={`lx-card lx-chart-card ${blue ? "lx-card-blue" : ""}`}>
      <header className="lx-card-head">
        <div>
          <h2>{graph === 2 ? "Hours per day" : "October against the goal"}</h2>
          <div className="lx-figure lx-figure-sm">
            <Num className="lx-serif">{TOTAL}</Num>
            <span className="lx-figure-unit">h</span>
            <Chip tone="good">
              <Num>5%</Num> ahead of pace
            </Chip>
          </div>
        </div>
        <div className="lx-legend">
          {graph === 2 ? (
            <>
              <span><i className="lx-key-bill" />Billable</span>
              <span><i className="lx-key-non" />Non-billable</span>
            </>
          ) : (
            <>
              <span><i className="lx-key-line" />Logged</span>
              <span><i className="lx-key-goal" />Goal pace</span>
            </>
          )}
        </div>
      </header>
      {graph === 2 ? <DailyBars /> : <PaceChart onBlue={blue} />}
    </article>
  );
}

function ByClient({ graph }: { graph: Opts["graph"] }) {
  const total = BY_CLIENT.reduce((s, c) => s + c.hours, 0);
  const pct = (h: number) => `${((h / total) * 100).toFixed(1)}%`;
  return (
    <article className="lx-card lx-byclient">
      <header className="lx-card-head">
        <h2>Hours by client</h2>
        <span className="lx-muted">This month</span>
      </header>
      {graph === 1 && (
        <ul className="lx-bc-bars">
          {BY_CLIENT.map((c) => (
            <li key={c.name}>
              <span className="lx-bc-name">{c.name}</span>
              <span className="lx-bc-track">
                <span style={{ width: `${(c.hours / BY_CLIENT[0].hours) * 100}%`, background: c.color }} />
              </span>
              <Num className="lx-bc-h">{fmtH(c.hours)}</Num>
              <Num className="lx-muted lx-bc-p">{pct(c.hours)}</Num>
            </li>
          ))}
        </ul>
      )}
      {graph === 2 && (
        <>
          <div className="lx-bc-stack">
            {BY_CLIENT.map((c) => (
              <span key={c.name} style={{ flexGrow: c.hours, background: c.color }} title={`${c.name} ${fmtH(c.hours)}`} />
            ))}
          </div>
          <ul className="lx-bc-legend">
            {BY_CLIENT.map((c) => (
              <li key={c.name}>
                <i style={{ background: c.color }} />
                <span>{c.name}</span>
                <Num className="lx-strong">{fmtH(c.hours)}</Num>
                <Num className="lx-muted">{pct(c.hours)}</Num>
              </li>
            ))}
          </ul>
        </>
      )}
      {graph === 3 && (
        <div className="lx-tree">
          {[BY_CLIENT.slice(0, 2), BY_CLIENT.slice(2)].map((row, r) => (
            <div key={r} className="lx-tree-row" style={{ flexGrow: row.reduce((s, c) => s + c.hours, 0) }}>
              {row.map((c) => (
                <div key={c.name} className="lx-tree-tile" style={{ flexGrow: c.hours, background: c.color }} title={`${c.name} ${fmtH(c.hours)}`}>
                  {c.hours >= 20 && (
                    <>
                      <span>{c.name}</span>
                      <Num className="lx-tree-h">{fmtH(c.hours)}</Num>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/* ── This week ─────────────────────────────────────────────────────────── */

function WeekCard({ week }: { week: Opts["week"] }) {
  return (
    <article className="lx-card lx-week">
      <header className="lx-card-head">
        <h2>This week</h2>
        <span className="lx-muted">Logged of planned · Sun–Thu</span>
      </header>
      {week === 1 && (
        <ul className="lx-wb">
          {TEAM.map((m) => {
            const h = logged(m.days);
            const light = h / m.planned < 0.6;
            return (
              <li key={m.name}>
                <span className="lx-wb-who">
                  <Avatar initials={m.initials} color={m.color} size={26} />
                  {m.name}
                </span>
                <span className="lx-wb-track">
                  <span className={light ? "is-light" : ""} style={{ width: `${Math.min(h / m.planned, 1) * 100}%` }} />
                </span>
                <span className="lx-wb-num">
                  <Num className="lx-strong">{fmtH(h)}</Num>
                  <span className="lx-muted"> / <Num>{m.planned}h</Num></span>
                </span>
                <span className={light ? "lx-warn-text lx-wb-word" : "lx-muted lx-wb-word"}>
                  {light ? "Light week" : `${Math.round((h / m.planned) * 100)}%`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {week === 2 && (
        <table className="lx-wd">
          <thead>
            <tr>
              <th />
              {WEEKDAYS.map((d, i) => (
                <th key={d} className={i === 4 ? "is-today" : ""}>{i === 4 ? "Today" : d}</th>
              ))}
              <th className="r">Week</th>
            </tr>
          </thead>
          <tbody>
            {TEAM.map((m) => (
              <tr key={m.name}>
                <td>
                  <span className="lx-wb-who">
                    <Avatar initials={m.initials} color={m.color} size={24} />
                    {m.name}
                  </span>
                </td>
                {m.days.map((d, i) => {
                  const share = d == null ? 0 : Math.min(d / 9, 1);
                  return (
                    <td key={i}>
                      <span
                        className={`lx-wd-cell ${d == null ? "is-off" : ""} ${share > 0.55 ? "is-dark" : ""}`}
                        style={d ? { background: `color-mix(in oklab, var(--accent) ${Math.round(share * 100)}%, var(--neutral-tint))` } : undefined}
                      >
                        {d == null ? "Off" : d ? <Num>{fmtH(d)}</Num> : "–"}
                      </span>
                    </td>
                  );
                })}
                <td className="r">
                  <Num className="lx-strong">{fmtH(logged(m.days))}</Num>
                  <span className="lx-muted lx-wd-of"> of <Num>{m.planned}h</Num></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {week === 3 && (
        <div className="lx-wc">
          {TEAM.map((m) => {
            const h = logged(m.days);
            const light = h / m.planned < 0.6;
            return (
              <div key={m.name} className="lx-wc-col">
                <Num className="lx-wc-num">{fmtH(h)}</Num>
                <span className="lx-wc-track" style={{ height: (m.planned / 40) * 150 }}>
                  <span className={light ? "is-light" : ""} style={{ height: `${Math.min(h / m.planned, 1) * 100}%` }} />
                </span>
                <span className="lx-wb-who lx-wc-who">
                  <Avatar initials={m.initials} color={m.color} size={20} />
                  {m.name}
                </span>
                <span className={light ? "lx-warn-text" : "lx-muted"}>
                  {light ? "Light week" : <>of <Num>{m.planned}h</Num></>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

/* ── Pace notice ───────────────────────────────────────────────────────── */

function PaceNotice({ pace }: { pace: Opts["pace"] }) {
  const daysLeft = 5;
  const perDay = (GOAL - TOTAL) / daysLeft;
  const text = (
    <span className="lx-pace-text">
      <b>Studio pace: 5% ahead</b> of the October goal — <Num>{TOTAL}h</Num> of <Num>{GOAL}h</Num>, {daysLeft} working
      days left, about <Num>{perDay.toFixed(1)}h</Num> a day keeps it.
    </span>
  );
  return (
    <div className={`lx-pace lx-pace-${pace}`}>
      <span className="lx-pace-icon">
        <Sparkles size={16} strokeWidth={2} />
      </span>
      {text}
      <span className="lx-pace-bar" aria-label={`${Math.round((TOTAL / GOAL) * 100)}% of the goal`}>
        <span style={{ width: `${(TOTAL / GOAL) * 100}%` }} />
        <i style={{ left: `${(GOAL_CUM[DAILY.length - 1] / GOAL) * 100}%` }} title="Where the goal's pace is today" />
      </span>
      <Num className="lx-pace-pct">{Math.round((TOTAL / GOAL) * 100)}%</Num>
    </div>
  );
}

/* ── Shell ─────────────────────────────────────────────────────────────── */

function Sidebar({ active }: { active: string }) {
  const items = (admin: boolean) =>
    NAV.filter((n) => !!n.admin === admin).map(({ label, Icon, badge }) => (
      <a key={label} className={`lx-nav ${label === active ? "is-active" : ""}`} href="#" onClick={(e) => e.preventDefault()}>
        <Icon size={18} strokeWidth={1.75} className="lx-nav-icon" />
        <span>{label}</span>
        {badge ? <span className="lx-badge">{badge}</span> : null}
      </a>
    ));
  return (
    <aside className="lx-side">
      <div className="lx-logo">
        <span className="brand-ampmore lx-logo-mark" aria-label="Studio&more" />
      </div>
      <nav className="lx-nav-group">{items(false)}</nav>
      <div className="lx-nav-rule" />
      <nav className="lx-nav-group">{items(true)}</nav>
    </aside>
  );
}

function TopBar() {
  return (
    <header className="lx-top">
      <label className="lx-search">
        <Search size={16} strokeWidth={1.75} />
        <span>Search tasks, clients…</span>
        <kbd>⌘K</kbd>
      </label>
      <div className="lx-top-right">
        <button className="lx-icon-btn" aria-label="Notifications">
          <Bell size={18} strokeWidth={1.75} />
          <span className="lx-badge lx-badge-dot" />
        </button>
        <span className="lx-me">
          <Avatar initials="NR" color="#dc2626" size={30} />
          <span>Nitsan</span>
        </span>
      </div>
    </header>
  );
}

function Segmented({ options, active }: { options: string[]; active: number }) {
  return (
    <div className="lx-seg">
      {options.map((o, i) => (
        <button key={o} className={i === active ? "is-active" : ""}>
          {o}
        </button>
      ))}
    </div>
  );
}

/* ── Screens ───────────────────────────────────────────────────────────── */

function StatTiles() {
  const tiles = [
    { label: "Studio hours", value: String(TOTAL), unit: "h", tip: "All hours logged this month by active designers, from time entries.", hero: true,
      foot: <Chip tone="good"><Num>+30%</Num> vs Sept</Chip> },
    { label: "Billable", value: "87", unit: "%", tip: "Hours on clients marked billable ÷ all hours. Internal: Studio, OFFF tlv.",
      foot: <span className="lx-muted">341.5h of {TOTAL}h</span> },
    { label: "Tasks worked", value: "30", unit: "", tip: "Distinct tasks with at least one entry this month.",
      foot: <span className="lx-muted">across 11 clients</span> },
    { label: "Per designer", value: "65.4", unit: "h", tip: "Studio hours ÷ designers who logged time this month.",
      foot: <span className="lx-muted">6 designers</span> },
  ];
  return (
    <div className="lx-tiles">
      {tiles.map((t) => (
        <article key={t.label} className={`lx-card lx-tile ${t.hero ? "lx-tile-hero" : ""}`}>
          <header className="lx-tile-label">
            {t.label}
            <Explain tip={t.tip} />
          </header>
          <div className="lx-figure">
            <Num className="lx-serif">{t.value}</Num>
            <span className="lx-figure-unit">{t.unit}</span>
          </div>
          <footer>{t.foot}</footer>
        </article>
      ))}
    </div>
  );
}

function Home({ o }: { o: Opts }) {
  return (
    <>
      <section className="lx-head">
        <div>
          <p className="lx-kicker">Good afternoon,</p>
          <h1 className="lx-h1">
            <span className="lx-serif">Nitsan</span>
            <span className="lx-tenure">10y 4m 21d in the studio</span>
          </h1>
        </div>
        <Segmented options={["Week", "Month", "Year", "All"]} active={1} />
      </section>
      <div className="lx-body">
        <PaceNotice pace={o.pace} />
        <StatTiles />
        <div className="lx-row lx-row-graphs">
          <HoursCard graph={o.graph} />
          <ByClient graph={o.graph} />
        </div>
        <div className="lx-row lx-row-2">
          <article className="lx-card lx-attn">
            <header className="lx-card-head">
              <h2>Needs you</h2>
              <span className="lx-muted">Sorted by what to do</span>
            </header>
            <ul>
              {ATTENTION.map((a) => (
                <li key={a.title} className="lx-attn-row">
                  <Chip tone={a.tone}>{TONE_WORD[a.tone]}</Chip>
                  <span className="lx-attn-text">
                    <span className="lx-strong">{a.title}</span>
                    <span className="lx-muted">{a.why}</span>
                  </span>
                  <ArrowUpRight size={16} strokeWidth={1.75} className="lx-corner" />
                </li>
              ))}
            </ul>
          </article>
          <WeekCard week={o.week} />
        </div>
        <article className="lx-card lx-coming">
          <header className="lx-card-head">
            <h2>Coming up</h2>
          </header>
          <ul>
            {COMING.map((c) => (
              <li key={c.title}>
                <span className="lx-coming-emoji">{c.emoji}</span>
                <span>
                  <span className="lx-strong">{c.title}</span>
                  <span className="lx-muted">{c.when}</span>
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </>
  );
}

function capState(cap: ClientRow["cap"]): { tone: Tone; word: string } {
  if (!cap) return { tone: "neutral", word: "No cap" };
  const f = cap.used / cap.of;
  if (f > 1) return { tone: "bad", word: "Over cap" };
  if (f >= 0.85) return { tone: "warn", word: "Near cap" };
  return { tone: "good", word: "On track" };
}

function Clients() {
  const order: Record<Tone, number> = { bad: 0, warn: 1, good: 2, neutral: 3 };
  const rows = [...CLIENTS].sort((a, b) => order[capState(a.cap).tone] - order[capState(b.cap).tone]);
  return (
    <>
      <section className="lx-head">
        <h1 className="lx-h1">Clients</h1>
        <button className="lx-btn-primary">
          <Plus size={16} strokeWidth={2} /> New client
        </button>
      </section>
      <div className="lx-body">
        <Segmented options={["Active 24", "Paused 6", "Internal 3"]} active={0} />
        <article className="lx-card lx-table-card">
          <div className="lx-table-tools">
            <label className="lx-search lx-search-inline">
              <Search size={16} strokeWidth={1.75} />
              <span>Search clients…</span>
            </label>
            <span className="lx-muted">Sorted by what needs you</span>
          </div>
          <table className="lx-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>This period</th>
                <th className="r">Open</th>
                <th className="r">Week</th>
                <th className="r">Month</th>
                <th className="r">Total</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const s = capState(c.cap);
                return (
                  <tr key={c.name}>
                    <td>
                      <span className="lx-client">
                        <span className="lx-client-icon" style={{ background: c.color }}>{c.name[0]}</span>
                        {c.name}
                      </span>
                    </td>
                    <td>
                      <span className="lx-period">
                        <Chip tone={s.tone}>{s.word}</Chip>
                        {c.cap && (
                          <span className="lx-muted">
                            <Num>{fmtH(c.cap.used)}</Num> of <Num>{c.cap.of}h</Num>
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="r"><Num>{c.open}</Num></td>
                    <td className="r"><Num>{fmtH(c.week)}</Num></td>
                    <td className="r"><Num>{fmtH(c.month)}</Num></td>
                    <td className="r"><Num className="lx-strong">{fmtH(c.total)}</Num></td>
                    <td className="r"><ArrowUpRight size={16} strokeWidth={1.75} className="lx-corner" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </article>
      </div>
    </>
  );
}

/* ── The lab ───────────────────────────────────────────────────────────── */

const DEFAULTS: Opts = { menu: 1, card: 1, graph: 1, week: 1, pace: 1 };

export function DesignLab() {
  const [screen, setScreen] = useState<Screen>("home");
  const [o, setO] = useState<Opts>(DEFAULTS);

  // Read the starting state from the URL once, so a link reopens the same combination.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const next = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as OptKey[]) {
      const v = Number(q.get(k));
      if (v === 1 || v === 2 || v === 3) next[k] = v;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration from the URL */
    setO(next);
    if (q.get("s") === "clients") setScreen("clients");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    const q = new URLSearchParams({ s: screen, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
    window.history.replaceState(null, "", `?${q}`);
  }, [screen, o]);

  return (
    <div className="lx" data-menu={o.menu} data-card={o.card}>
      <style>{CSS}</style>
      <div className="lx-shell">
        <Sidebar active={screen === "home" ? "Home" : "Clients"} />
        <main className="lx-main">
          <div className="lx-glow" />
          <TopBar />
          <div className="lx-page">{screen === "home" ? <Home o={o} /> : <Clients />}</div>
        </main>
      </div>

      <div className="lab-bar" role="toolbar" aria-label="Design lab">
        <div className="lab-group">
          <button className={screen === "home" ? "on" : ""} onClick={() => setScreen("home")}>Home</button>
          <button className={screen === "clients" ? "on" : ""} onClick={() => setScreen("clients")}>Clients</button>
        </div>
        {OPTION_SETS.map((set) => (
          <div key={set.key} className="lab-group">
            <span className="lab-label">{set.label}</span>
            {set.names.map((n, i) => (
              <button
                key={n}
                title={set.tips[i]}
                className={o[set.key] === i + 1 ? "on" : ""}
                onClick={() => setO({ ...o, [set.key]: i + 1 })}
              >
                <b>{i + 1}</b> {n}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const CSS = /* css */ `
.lx {
  --brand: #0b43ed; --aqua: #74f3ef; --navy: #06112f;
  --bg: #eef0f6; --surface: #fff; --ink: #06112f; --muted: #5c6478; --faint: #98a0b3;
  --line: #e7e9f1; --tint: #e4eafd; --accent: var(--brand); --neutral-tint: #eef0f5;
  --good: #1e8e5a; --good-tint: #e3f4ea; --warn: #855800; --warn-tint: #fdf1d8; --bad: #c0392b; --bad-tint: #fbe6e3;
  --r-card: 20px; --r-tile: 18px;
  --shadow: 0 1px 2px rgba(6,17,47,.04), 0 6px 24px -6px rgba(6,17,47,.09);
  --card-border: 0; --sb-w: 236px;
  font-family: "Saans", var(--font-rubik), system-ui, sans-serif;
  font-weight: 380; font-size: 14px; line-height: 1.45;
  color: var(--ink); background: var(--bg); min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

/* Cards: 1 shadow · 2 hairline · 3 flat */
.lx[data-card="2"] { --r-card: 12px; --r-tile: 12px; --shadow: none; --card-border: 1px solid #e1e4ec; --bg: #f4f5f9; }
.lx[data-card="3"] { --r-card: 14px; --r-tile: 14px; --shadow: none; --bg: #e6e9f1; --neutral-tint: #f1f3f7; }

.lx * { box-sizing: border-box; }
.lx button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.lx ul { list-style: none; margin: 0; padding: 0; }
.lx h1, .lx h2, .lx p { margin: 0; }
.lx-serif { font-family: "PP Fragment Glare", Georgia, serif; font-style: italic; font-weight: 400; letter-spacing: 0; }
.lx-num { font-variant-numeric: tabular-nums; white-space: nowrap; unicode-bidi: isolate; direction: ltr; }
.lx-muted { color: var(--muted); }
.lx-strong { font-weight: 570; }
.lx-warn-text { color: var(--warn); font-weight: 570; }

/* ── shell & menu ── */
.lx-shell { display: grid; grid-template-columns: calc(var(--sb-w) + 12px) minmax(0,1fr); min-height: 100vh; }
.lx-side { position: sticky; top: 12px; height: calc(100vh - 24px); margin: 12px 0 12px 12px; overflow: auto; padding: 22px 12px; background: var(--brand); color: #fff; display: flex; flex-direction: column; gap: 2px; border-radius: 18px; box-shadow: 0 10px 30px -12px rgba(11,67,237,.55); }
.lx-logo { height: 36px; display: flex; align-items: center; padding: 0 12px; margin-bottom: 18px; }
.lx-logo-mark { height: 26px; background-color: #fff; }
.lx-nav-group { display: flex; flex-direction: column; gap: 2px; }
.lx-nav-rule { height: 1px; margin: 12px; background: rgba(255,255,255,.18); }
.lx-nav { position: relative; display: flex; align-items: center; gap: 11px; min-height: 38px; padding: 0 12px; border-radius: 10px; color: #fff; text-decoration: none; font-size: 14px; transition: background-color .15s; }
.lx-nav-icon { color: #c3cffb; flex-shrink: 0; }
.lx-nav:hover { background: rgba(255,255,255,.12); }
.lx-nav.is-active { background: #fff; color: var(--brand); font-weight: 570; }
.lx-nav.is-active .lx-nav-icon { color: inherit; }

/* Menu 2: flush, full height */
.lx[data-menu="2"] .lx-shell { grid-template-columns: var(--sb-w) minmax(0,1fr); }
.lx[data-menu="2"] .lx-side { top: 0; height: 100vh; margin: 0; border-radius: 0; box-shadow: none; }
.lx[data-menu="2"] .lx-nav { border-radius: 6px; }

/* Menu 3: indicator bar instead of a white tab */
.lx[data-menu="3"] .lx-nav { border-radius: 6px; }
.lx[data-menu="3"] .lx-nav.is-active { background: rgba(255,255,255,.14); color: #fff; }
.lx[data-menu="3"] .lx-nav.is-active::before { content: ""; position: absolute; left: -12px; top: 8px; bottom: 8px; width: 4px; border-radius: 0 4px 4px 0; background: var(--aqua); }
.lx[data-menu="3"] .lx-nav.is-active .lx-nav-icon { color: var(--aqua); }

.lx-badge { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: #ef4444; color: #fff; font-size: 11px; font-weight: 570; display: inline-flex; align-items: center; justify-content: center; }
.lx-badge-dot { position: absolute; top: 9px; right: 10px; min-width: 0; width: 8px; height: 8px; padding: 0; border: 2px solid var(--surface); box-sizing: content-box; }

.lx-main { position: relative; min-width: 0; padding: 0 32px 150px; }
.lx-glow { position: absolute; inset: 0 0 auto 0; height: 380px; pointer-events: none; background: radial-gradient(50% 60% at 25% 0%, rgba(11,67,237,.09), transparent 70%); }
.lx-page { position: relative; max-width: 1500px; margin: 0 auto; }
.lx-top { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 16px; height: 72px; max-width: 1500px; margin: 0 auto; }
.lx-search { display: flex; align-items: center; gap: 10px; width: min(420px, 50%); height: 42px; padding: 0 8px 0 16px; border-radius: 12px; background: var(--surface); color: var(--faint); box-shadow: var(--shadow); border: var(--card-border); }
.lx-search span { flex: 1; }
.lx-search kbd { font: inherit; font-size: 11px; padding: 2px 7px; border-radius: 6px; background: var(--neutral-tint); color: var(--muted); }
.lx-top-right { display: flex; align-items: center; gap: 10px; }
.lx-icon-btn { position: relative; width: 42px; height: 42px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; background: var(--surface); box-shadow: var(--shadow); border: var(--card-border); }
.lx-me { display: inline-flex; align-items: center; gap: 8px; height: 42px; padding: 0 14px 0 6px; border-radius: 12px; font-weight: 570; background: var(--surface); box-shadow: var(--shadow); border: var(--card-border); }
.lx-avatar { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; color: #fff; font-weight: 570; flex-shrink: 0; letter-spacing: .02em; }
.lx-btn-primary { display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 16px; border-radius: 10px; font-weight: 570; background: var(--accent) !important; color: #fff !important; }

/* ── page head ── */
.lx-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 18px 0 22px; flex-wrap: wrap; }
.lx-kicker { color: var(--muted); font-size: 15px; }
.lx-h1 { font-size: 44px; line-height: 1.05; font-weight: 570; letter-spacing: -0.03em; display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
.lx-h1 .lx-serif { letter-spacing: -0.01em; }
.lx-tenure { font-size: 14px; letter-spacing: 0; color: var(--muted); font-weight: 380; }
.lx-seg { display: inline-flex; align-self: flex-start; padding: 4px; border-radius: 12px; background: #e3e7f2; }
.lx[data-card="3"] .lx-seg { background: #d9deea; }
.lx-seg button { height: 32px; padding: 0 14px; border-radius: 8px; color: var(--muted); font-size: 13px; }
.lx-seg button.is-active { background: var(--surface); color: var(--ink); font-weight: 570; box-shadow: 0 1px 3px rgba(6,17,47,.12); }
.lx-head .lx-seg { align-self: auto; }

/* ── cards ── */
.lx-body { display: flex; flex-direction: column; gap: 16px; }
.lx-row { display: grid; gap: 16px; }
.lx-row-graphs { grid-template-columns: minmax(0, 1.75fr) minmax(300px, 1fr); }
.lx-row-2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); }
.lx-card { background: var(--surface); border-radius: var(--r-card); box-shadow: var(--shadow); border: var(--card-border); padding: 22px 24px; min-width: 0; }
.lx-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 16px; }
.lx-card-head h2 { font-size: 17px; font-weight: 570; letter-spacing: -0.01em; }
.lx-card-head > .lx-muted { font-size: 13px; padding-top: 2px; }

.lx-tiles { display: grid; gap: 16px; grid-template-columns: repeat(4, minmax(0,1fr)); }
.lx-tile { border-radius: var(--r-tile); padding: 18px 20px; display: flex; flex-direction: column; gap: 6px; }
.lx-tile-label { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
.lx-figure { display: flex; align-items: baseline; gap: 2px; }
.lx-figure > .lx-num { font-size: 50px; line-height: 1; letter-spacing: -0.01em; }
.lx-figure-unit { font-size: 20px; color: var(--muted); margin-left: 1px; }
.lx-figure-sm { gap: 4px; align-items: center; margin-top: 6px; }
.lx-figure-sm > .lx-num { font-size: 36px; }
.lx-figure-sm .lx-chip { margin-left: 10px; }
.lx-tile footer { font-size: 13px; margin-top: 2px; }
.lx-tile-hero { background: var(--brand); color: #fff; border-color: transparent; box-shadow: 0 14px 30px -10px rgba(11,67,237,.55); }
.lx-tile-hero .lx-tile-label, .lx-tile-hero .lx-figure-unit, .lx-tile-hero .lx-tip { color: rgba(255,255,255,.75); }
.lx-tile-hero .lx-chip-good { background: rgba(255,255,255,.16); color: #fff; }
.lx-tile-hero .lx-chip-good .lx-chip-dot { background: var(--aqua); }

.lx-tip { position: relative; display: inline-flex; color: var(--faint); cursor: help; outline: none; }
.lx-tip::after { content: attr(data-tip); position: absolute; left: 50%; bottom: calc(100% + 8px); transform: translate(-50%, 4px); width: 240px; padding: 10px 12px; border-radius: 10px; background: var(--ink); color: #fff; font-size: 12px; line-height: 1.4; font-weight: 380; text-transform: none; letter-spacing: 0; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity .12s, transform .12s, visibility .12s; z-index: 10; }
.lx-tip:hover::after, .lx-tip:focus::after { opacity: 1; visibility: visible; transform: translate(-50%, 0); }

.lx-chip { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 570; white-space: nowrap; }
.lx-chip-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.lx-chip-good { background: var(--good-tint); color: var(--good); }
.lx-chip-warn { background: var(--warn-tint); color: var(--warn); }
.lx-chip-bad { background: var(--bad-tint); color: var(--bad); }
.lx-chip-neutral { background: var(--neutral-tint); color: var(--muted); }

/* ── pace notice: 1 blue · 2 navy · 3 card ── */
.lx-pace { display: grid; grid-template-columns: auto minmax(0,1fr) minmax(140px, 240px) auto; align-items: center; gap: 14px; padding: 14px 20px; border-radius: var(--r-tile); font-size: 14px; }
.lx-pace-icon { width: 30px; height: 30px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; }
.lx-pace-bar { position: relative; height: 8px; border-radius: 999px; }
.lx-pace-bar span { position: absolute; inset: 0 auto 0 0; border-radius: 999px; }
.lx-pace-bar i { position: absolute; top: -5px; width: 2px; height: 18px; border-radius: 2px; }
.lx-pace-pct { font-weight: 570; font-size: 15px; }
.lx-pace-1 { background: var(--brand); color: #fff; box-shadow: 0 12px 28px -14px rgba(11,67,237,.7); }
.lx-pace-1 .lx-pace-icon { background: rgba(255,255,255,.16); color: var(--aqua); }
.lx-pace-1 .lx-pace-bar { background: rgba(255,255,255,.22); }
.lx-pace-1 .lx-pace-bar span { background: var(--aqua); }
.lx-pace-1 .lx-pace-bar i { background: #fff; }
.lx-pace-2 { background: var(--navy); color: #fff; }
.lx-pace-2 b { color: var(--aqua); }
.lx-pace-2 .lx-pace-icon { background: var(--brand); color: #fff; }
.lx-pace-2 .lx-pace-bar { background: rgba(255,255,255,.14); }
.lx-pace-2 .lx-pace-bar span { background: linear-gradient(90deg, var(--brand), var(--aqua)); }
.lx-pace-2 .lx-pace-bar i { background: #fff; }
.lx-pace-3 { background: var(--surface); color: var(--ink); box-shadow: var(--shadow); border: var(--card-border); border-left: 4px solid var(--brand); }
.lx-pace-3 .lx-pace-icon { background: var(--brand); color: #fff; }
.lx-pace-3 .lx-pace-bar { background: var(--neutral-tint); }
.lx-pace-3 .lx-pace-bar span { background: var(--brand); }
.lx-pace-3 .lx-pace-bar i { background: var(--ink); }
.lx-pace-3 .lx-pace-pct { color: var(--brand); }

/* ── graphs ── */
.lx-chart { width: 100%; height: auto; display: block; overflow: visible; }
.lx-grid { stroke: var(--line); stroke-width: 1; }
.lx-axis { font-size: 12px; fill: var(--faint); font-variant-numeric: tabular-nums; }
.lx-weekend { fill: #f6f7fa; }
.lx[data-card="3"] .lx-weekend { fill: #f5f6f9; }
.lx-line { fill: none; stroke: var(--brand); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
.lx-goal { fill: none; stroke: var(--ink); stroke-width: 1.5; stroke-dasharray: 5 5; opacity: .45; }
.lx-goal-label { font-size: 13px; fill: var(--muted); font-weight: 570; }
.lx-dot { fill: var(--brand); stroke: #fff; stroke-width: 3; }
.lx-today { font-size: 13px; fill: var(--brand); font-weight: 570; }
.lx-cross { stroke: var(--ink); stroke-width: 1; opacity: .25; }
.lx-readout-bg { fill: var(--navy); }
.lx-readout-h { font-size: 12px; fill: #fff; font-weight: 570; }
.lx-readout { font-size: 12px; fill: rgba(255,255,255,.75); font-variant-numeric: tabular-nums; }
.lx-bar-bill { fill: var(--brand); }
.lx-bar-today { fill: var(--brand); opacity: .55; }
.lx-bar-non { fill: #b9c8f9; }
.lx-bar-future { fill: var(--neutral-tint); }
/* the blue panel */
.lx-card-blue { background: var(--brand); color: #fff; border-color: transparent; box-shadow: 0 16px 34px -14px rgba(11,67,237,.6); }
.lx-card-blue .lx-figure-unit, .lx-card-blue .lx-legend { color: rgba(255,255,255,.75); }
.lx-card-blue .lx-chip-good { background: rgba(255,255,255,.16); color: #fff; }
.lx-card-blue .lx-chip-good .lx-chip-dot { background: var(--aqua); }
.lx-card-blue .lx-key-line { background: var(--aqua); }
.lx-card-blue .lx-key-goal { border-color: #fff; }
.lx-grid-blue { stroke: rgba(255,255,255,.14); }
.lx-axis-blue { font-size: 12px; fill: rgba(255,255,255,.6); }
.lx-weekend-blue { fill: rgba(255,255,255,.05); }
.lx-line-blue { fill: none; stroke: var(--aqua); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
.lx-goal-blue { fill: none; stroke: #fff; stroke-width: 1.5; stroke-dasharray: 5 5; opacity: .6; }
.lx-goal-label-blue { font-size: 12px; fill: rgba(255,255,255,.85); font-weight: 570; }
.lx-dot-blue { fill: var(--aqua); stroke: var(--brand); stroke-width: 3; }
.lx-today-blue { font-size: 12px; fill: #fff; font-weight: 570; }
.lx-cross-blue { stroke: #fff; stroke-width: 1; opacity: .35; }
.lx-readout-bg-blue { fill: #fff; }
.lx-readout-h-blue { font-size: 12px; fill: var(--navy); font-weight: 570; }
.lx-readout-blue { font-size: 12px; fill: var(--muted); }
.lx-legend { display: flex; gap: 14px; font-size: 13px; color: var(--muted); }
.lx-legend span { display: inline-flex; align-items: center; gap: 6px; }
.lx-legend i { width: 14px; height: 3px; border-radius: 3px; }
.lx-key-line { background: var(--brand); }
.lx-key-goal { height: 0 !important; border-top: 2px dashed var(--ink); opacity: .6; border-radius: 0 !important; }
.lx-key-bill { background: var(--brand); height: 10px !important; width: 10px !important; }
.lx-key-non { background: #b9c8f9; height: 10px !important; width: 10px !important; }

.lx-byclient { display: flex; flex-direction: column; }
.lx-bc-bars { display: flex; flex-direction: column; gap: 14px; }
.lx-bc-bars li { display: grid; grid-template-columns: 78px minmax(0,1fr) 62px 44px; align-items: center; gap: 12px; font-size: 13px; }
.lx-bc-name { font-weight: 570; }
.lx-bc-track { height: 14px; border-radius: 4px; background: var(--neutral-tint); overflow: hidden; }
.lx-bc-track span { display: block; height: 100%; border-radius: 4px; }
.lx-bc-h, .lx-bc-p { text-align: right; }
.lx-bc-stack { display: flex; gap: 3px; height: 40px; margin-bottom: 20px; }
.lx-bc-stack span { min-width: 4px; border-radius: 6px; }
.lx-bc-legend { display: grid; grid-template-columns: 1fr; gap: 10px; font-size: 13px; }
.lx-bc-legend li { display: grid; grid-template-columns: 10px minmax(0,1fr) auto 46px; gap: 10px; align-items: center; }
.lx-bc-legend i { width: 10px; height: 10px; border-radius: 3px; }
.lx-bc-legend .lx-num { text-align: right; }
.lx-tree { flex: 1; min-height: 280px; display: flex; flex-direction: column; gap: 4px; }
.lx-tree-row { display: flex; gap: 4px; min-height: 0; }
.lx-tree-tile { min-width: 6px; border-radius: 8px; padding: 10px 12px; color: #fff; display: flex; flex-direction: column; justify-content: space-between; font-size: 13px; font-weight: 570; overflow: hidden; }
.lx-tree-h { font-size: 22px; font-family: "PP Fragment Glare", Georgia, serif; font-style: italic; font-weight: 400; }

/* ── this week ── */
.lx-wb-who { display: inline-flex; align-items: center; gap: 8px; font-weight: 570; }
.lx-wb { display: flex; flex-direction: column; gap: 16px; }
.lx-wb li { display: grid; grid-template-columns: 110px minmax(0,1fr) 104px 74px; align-items: center; gap: 14px; }
.lx-wb-track { height: 12px; border-radius: 4px; background: var(--neutral-tint); overflow: hidden; }
.lx-wb-track span { display: block; height: 100%; border-radius: 4px; background: var(--brand); }
.lx-wb-track span.is-light { background: #f0b44c; }
.lx-wb-num { text-align: right; font-size: 13px; }
.lx-wb-word { font-size: 13px; text-align: right; }
.lx-wd { width: 100%; border-collapse: separate; border-spacing: 4px; font-size: 13px; }
.lx-wd th { font-weight: 380; color: var(--muted); font-size: 12px; text-align: center; padding-bottom: 2px; }
.lx-wd th.is-today { color: var(--brand); font-weight: 570; }
.lx-wd th.r, .lx-wd td.r { text-align: right; white-space: nowrap; }
.lx-wd td:first-child { padding-right: 6px; width: 120px; }
.lx-wd th.r, .lx-wd td.r { width: 116px; }
.lx-wd-cell { display: flex; align-items: center; justify-content: center; height: 34px; border-radius: 6px; background: var(--neutral-tint); color: var(--faint); font-size: 12px; }
.lx-wd-cell.is-dark { color: #fff; font-weight: 570; }
.lx-wd-cell:not(.is-dark):not(.is-off) .lx-num { color: var(--ink); }
.lx-wd-cell.is-off { background: repeating-linear-gradient(135deg, var(--neutral-tint) 0 6px, transparent 6px 10px); color: var(--muted); }
.lx-wd-of { font-size: 12px; }
.lx-wc { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 12px; height: 250px; }
.lx-wc-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; font-size: 12px; min-height: 0; }
.lx-wc-num { font-size: 17px; font-weight: 570; letter-spacing: -0.02em; }
.lx-wc-track { position: relative; width: 44px; flex-shrink: 0; border-radius: 8px; background: var(--neutral-tint); overflow: hidden; display: flex; align-items: flex-end; }
.lx-wc-track span { width: 100%; border-radius: 8px; background: var(--brand); }
.lx-wc-track span.is-light { background: #f0b44c; }
.lx-wc-who { font-size: 13px; margin-top: 4px; }

/* ── lists ── */
.lx-attn ul { display: flex; flex-direction: column; }
.lx-attn-row { display: grid; grid-template-columns: 76px minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 12px 0; cursor: pointer; }
.lx-attn-row + .lx-attn-row { border-top: 1px solid var(--line); }
.lx-attn-row .lx-chip { justify-self: start; }
.lx-attn-text { display: flex; flex-direction: column; min-width: 0; }
.lx-attn-text > .lx-muted, .lx-coming .lx-muted { font-size: 13px; }
.lx-corner { color: var(--faint); transition: transform .15s, color .15s; }
.lx-attn-row:hover .lx-strong { color: var(--brand); }
.lx-attn-row:hover .lx-corner, .lx-table tr:hover .lx-corner { color: var(--brand); transform: translate(2px,-2px) scale(1.15); }
.lx-coming ul { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
.lx-coming li { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 12px; background: var(--neutral-tint); }
.lx-coming li > span:last-child { display: flex; flex-direction: column; }
.lx-coming-emoji { font-size: 22px; }

/* ── clients ── */
.lx-table-card { padding: 8px 8px 12px; }
.lx-table-tools { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px 14px; font-size: 13px; }
.lx-search-inline { box-shadow: none; border: 0; background: var(--neutral-tint); height: 38px; }
.lx-table { width: 100%; border-collapse: collapse; }
.lx-table th { text-align: left; font-size: 11px; font-weight: 380; color: var(--muted); padding: 8px 16px; white-space: nowrap; text-transform: uppercase; letter-spacing: .06em; }
.lx-table td { padding: 12px 16px; border-top: 1px solid var(--line); white-space: nowrap; }
.lx-table .r { text-align: right; }
.lx-table tbody tr { cursor: pointer; transition: background-color .12s; }
.lx-table tbody tr:hover { background: #f6f7fb; }
.lx-client { display: inline-flex; align-items: center; gap: 12px; font-weight: 570; }
.lx-client-icon { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 13px; }
.lx-period { display: inline-flex; align-items: center; gap: 10px; font-size: 13px; }

/* lab chrome — deliberately not part of the design */
.lab-bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 50; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; width: max-content; max-width: calc(100vw - 32px); padding: 6px; border-radius: 18px; background: #111; color: #fff; box-shadow: 0 12px 40px rgba(0,0,0,.35); font-family: system-ui, sans-serif; font-size: 12px; }
.lab-group { display: flex; align-items: center; gap: 2px; padding: 2px; border-radius: 999px; background: rgba(255,255,255,.08); }
.lab-label { padding: 0 8px 0 10px; color: rgba(255,255,255,.45); text-transform: uppercase; font-size: 10px; letter-spacing: .08em; }
.lab-bar button { height: 28px; padding: 0 11px; border-radius: 999px; color: rgba(255,255,255,.75); white-space: nowrap; }
.lab-bar button.on { background: #fff; color: #111; }
.lab-bar b { font-weight: 700; margin-right: 2px; opacity: .6; }

@media (max-width: 1180px) {
  .lx-row-graphs, .lx-row-2 { grid-template-columns: minmax(0,1fr); }
  .lx-tiles { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .lx-pace { grid-template-columns: auto minmax(0,1fr); }
  .lx-pace-bar { grid-column: 1 / -1; }
  .lx-pace-pct { display: none; }
}
`;
