"use client";

// Motion, loaders, feedback, hover, gestures, empty states and icons — each a
// live demo with three options to try by hand. Two rules hold for every option:
//   - nothing waits for an animation: content is clickable the moment it is
//     drawn, and no entrance runs longer than ~250ms per element;
//   - everything is switched off by `prefers-reduced-motion` (the guard in
//     globals.css already covers any CSS animation and transition).

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Calendar,
  Check,
  ChartPie,
  Clock,
  Copy,
  Handshake,
  History,
  House,
  Inbox,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  SquareCheckBig,
  Trash2,
  TreePalm,
  Users,
  type LucideIcon,
} from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";

type V = 1 | 2 | 3;

/* ── shared pieces ─────────────────────────────────────────────────────── */

function Options({ value, onChange, names }: { value: V; onChange: (v: V) => void; names: [string, string, string] }) {
  return (
    <div className="flex w-max rounded-xl bg-track p-1">
      {names.map((n, i) => (
        <button
          key={n}
          onClick={() => onChange((i + 1) as V)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            value === i + 1 ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          <span className="mr-1 opacity-50">{i + 1}</span> {n}
        </button>
      ))}
    </div>
  );
}

function Section({
  n,
  title,
  line,
  controls,
  children,
}: {
  n: number;
  title: string;
  line: string;
  controls: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="flex items-baseline gap-3 text-2xl font-medium tracking-tight">
            <span className="text-brand">{n}</span> {title}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">{line}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">{controls}</div>
      </div>
      <div className="rounded-3xl bg-background p-6 ring-1 ring-black/5">{children}</div>
    </section>
  );
}

function Replay({ onClick, label = "Replay" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="mx-press inline-flex h-10 items-center gap-1.5 rounded-lg bg-surface px-3.5 text-sm font-medium shadow-card">
      <History size={15} /> {label}
    </button>
  );
}

const Card = ({ children, className = "", style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) => (
  <div className={`rounded-[20px] bg-surface p-5 shadow-card ${className}`} style={style}>
    {children}
  </div>
);

/* ── 1. screens loading in ─────────────────────────────────────────────── */

function useCountUp(target: number, run: boolean, ms = 450) {
  const [v, setV] = useState(run ? 0 : target);
  useEffect(() => {
    if (!run) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no animation: show the final value
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - t0) / ms, 1);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

function Tile({ label, value, unit, i, v, decimals = 0 }: { label: string; value: number; unit: string; i: number; v: V; decimals?: number }) {
  const shown = useCountUp(value, v === 3);
  return (
    <Card className={`mx-in-${v}`} style={{ animationDelay: `${i * (v === 2 ? 40 : 25)}ms` }}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="font-serif-accent mt-1 text-[40px] leading-none">
        {shown.toFixed(decimals)}
        <span className="text-xl text-muted">{unit}</span>
      </div>
    </Card>
  );
}

function LoadIn() {
  const [v, setV] = useState<V>(2);
  const [k, setK] = useState(0);
  return (
    <Section
      n={1}
      title="Screens loading in"
      line="How a page arrives. Every option is clickable from the first frame; the motion only decorates the arrival. Replay to watch it again."
      controls={
        <>
          <Options value={v} onChange={(x) => { setV(x); setK(k + 1); }} names={["Instant", "Rise", "Settle + count"]} />
          <Replay onClick={() => setK(k + 1)} />
        </>
      }
    >
      <div key={k} className="grid gap-4 md:grid-cols-4">
        <Tile i={0} v={v} label="Studio hours" value={398.5} unit="h" decimals={1} />
        <Tile i={1} v={v} label="Billable" value={87} unit="%" />
        <Tile i={2} v={v} label="Tasks worked" value={30} unit="" />
        <Tile i={3} v={v} label="Per designer" value={66.4} unit="h" decimals={1} />
        <Card className={`mx-in-${v} md:col-span-3`} style={{ animationDelay: `${4 * (v === 2 ? 40 : 25)}ms` }}>
          <div className="mb-3 font-heading text-base">Hours over time</div>
          <svg viewBox="0 0 600 120" className="w-full">
            <path d="M0 110 C80 100 120 80 200 74 S320 60 400 40 S520 22 600 14" fill="none" stroke="#0b43ed" strokeWidth="3" className={v !== 1 ? "mx-draw-line" : ""} />
          </svg>
        </Card>
        <Card className={`mx-in-${v}`} style={{ animationDelay: `${5 * (v === 2 ? 40 : 25)}ms` }}>
          <div className="mb-3 font-heading text-base">Coming up</div>
          {["Artist's Day", "Elections", "Dmitry · 2 years"].map((t) => (
            <div key={t} className="py-1 text-sm">{t}</div>
          ))}
        </Card>
      </div>
      <p className="mt-4 text-[13px] text-muted">
        {v === 1 && "Today's behaviour: everything appears at once."}
        {v === 2 && "Each card fades in and rises 8px, 40ms apart — the whole screen settles in under 0.4s. The chart line draws itself."}
        {v === 3 && "Cards settle from 98.5% scale, 25ms apart, and the headline figures count up to their value in 0.45s."}
      </p>
    </Section>
  );
}

/* ── 2. loaders ────────────────────────────────────────────────────────── */

const CLIENTS = [
  ["Variant", "#7c3aed", "135.25h"],
  ["NoTraffic", "#3b82f6", "142h"],
  ["Baseline", "#3b4a8f", "8.75h"],
  ["Maccabi", "#1e2a6b", "25.5h"],
  ["Visitt", "#1f7a4d", "27h"],
];

function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`mx-skel block rounded-md ${className}`} />;
}

function Loaders() {
  const [v, setV] = useState<V>(2);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = () => {
    setLoading(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLoading(false), 1600);
  };
  useEffect(() => {
    timer.current = setTimeout(() => setLoading(false), 1600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return (
    <Section
      n={2}
      title="While data loads"
      line="What fills a card before its rows arrive. Today 19 places say “Loading…” in grey. A skeleton shows the shape of what is coming, so the page doesn't jump when it lands."
      controls={
        <>
          <Options value={v} onChange={(x) => { setV(x); run(); }} names={["Text", "Skeleton", "Skeleton + line"]} />
          <Replay onClick={run} label="Load again" />
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="relative overflow-hidden p-0">
          {loading && v === 3 && <span className="mx-loadline absolute inset-x-0 top-0 h-0.5" />}
          <div className="px-5 pb-2 pt-5 font-heading text-base">Clients</div>
          {loading && v === 1 && <p className="px-5 pb-6 pt-2 text-sm text-muted">Loading…</p>}
          {loading && v !== 1 && (
            <div className="flex flex-col gap-4 px-5 pb-5 pt-2">
              {CLIENTS.map((_, i) => (
                <div key={i} className="flex items-center gap-3" style={{ opacity: 1 - i * 0.14 }}>
                  <Skeleton className="size-8 rounded-lg" />
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="ml-auto h-3.5 w-14" />
                </div>
              ))}
            </div>
          )}
          {!loading && (
            <div className="flex flex-col px-3 pb-3 pt-1">
              {CLIENTS.map(([n, c, h], i) => (
                <div key={n} className={`flex items-center gap-3 rounded-xl px-2 py-2 ${v !== 1 ? "mx-in-2" : ""}`} style={{ animationDelay: `${i * 30}ms` }}>
                  <span className="flex size-8 items-center justify-center rounded-lg text-sm text-white" style={{ background: c }}>{n[0]}</span>
                  <span className="text-sm font-medium">{n}</span>
                  <span className="ml-auto text-sm tabular-nums">{h}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="flex flex-col items-center justify-center gap-4 text-center">
          <div className="font-heading text-base">Opening the app</div>
          <span className="brand-ampmore mx-amp h-10 w-36 bg-brand" />
          <span className="relative block h-1 w-40 overflow-hidden rounded-full bg-track">
            <span className="mx-boot absolute inset-y-0 left-0 rounded-full bg-brand" />
          </span>
          <p className="text-[13px] text-muted">The first load keeps its &amp;more screen; the mark breathes while the studio loads.</p>
        </Card>
      </div>
    </Section>
  );
}

/* ── 3. hover ──────────────────────────────────────────────────────────── */

function Hover() {
  const [v, setV] = useState<V>(2);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <Section
      n={3}
      title="Hover"
      line="Point at things to feel the difference. Hover only describes what a click will do — nothing moves out from under the cursor."
      controls={<Options value={v} onChange={setV} names={["Now", "Lift", "Spotlight"]} />}
    >
      <div className={`mx-h${v} grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_200px]`}>
        <div onMouseMove={v === 3 ? onMove : undefined} className="mx-card group relative cursor-pointer overflow-hidden rounded-[20px] bg-surface p-6 shadow-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="font-serif-accent text-[28px] leading-9">Daniel Ross</p>
              <p className="text-[13px] text-muted">€55.00/h up to 50h a month</p>
            </div>
            <StudioArrow size={44} up className="mx-arrow text-faint" />
          </div>
          <p className="font-serif-accent mt-4 text-[40px] leading-none text-brand">€2,667.50</p>
        </div>
        <div className="flex flex-col rounded-[20px] bg-surface p-2 shadow-card">
          {["Branding · Strategy", "Home Page · Design", "Logo design"].map((t) => (
            <div key={t} className="mx-row relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm">
              <SquareCheckBig size={16} className="text-muted" /> {t}
              <StudioArrow size={15} className="mx-row-arrow ml-auto text-brand" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <button className="mx-btn inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-white">
            <Plus size={16} /> Add lead
          </button>
          <div className="rounded-xl bg-brand p-1.5">
            {[["Home", House], ["Clients", Users], ["Leads", Handshake]].map(([l, I], i) => {
              const Icon = I as LucideIcon;
              return (
                <div key={l as string} className={`mx-nav flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm ${i === 0 ? "bg-white text-brand" : "text-white/80"}`}>
                  <Icon size={17} strokeWidth={1.75} /> {l as string}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mt-4 text-[13px] text-muted">
        {v === 1 && "Today: cards deepen their shadow, rows tint."}
        {v === 2 && "Cards lift 2px with a deeper shadow and the arrow travels up-right; rows tint and show a sliding arrow; buttons brighten; nav items nudge right."}
        {v === 3 && "Lift, plus a soft light that follows the pointer across the card; rows fill with a tint that sweeps in from the left."}
      </p>
    </Section>
  );
}

/* ── 4. feedback ───────────────────────────────────────────────────────── */

function Feedback() {
  const [v, setV] = useState<V>(2);
  const [save, setSave] = useState<"idle" | "busy" | "done">("idle");
  const [toast, setToast] = useState<number | null>(null);
  const [burst, setBurst] = useState(0);
  const doSave = () => {
    setSave("busy");
    setTimeout(() => setSave("done"), 600);
    setTimeout(() => setSave("idle"), v === 1 ? 1500 : 1900);
  };
  const doLog = () => {
    if (v === 1) return doSave();
    setToast(Date.now());
    setTimeout(() => setToast(null), 3200);
  };
  return (
    <Section
      n={4}
      title="Feedback after an action"
      line="What the app says back when you save, log hours or win a deal. Press the buttons."
      controls={<Options value={v} onChange={setV} names={["Quiet", "Confident", "Playful"]} />}
    >
      <div className="relative flex min-h-56 flex-wrap items-start gap-6">
        <Card className="flex w-72 flex-col gap-3">
          <div className="font-heading text-base">Save a change</div>
          <button
            onClick={doSave}
            disabled={save !== "idle"}
            className={`mx-press inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-colors ${
              save === "done" ? "bg-success" : "bg-brand"
            }`}
          >
            {save === "idle" && "Save"}
            {save === "busy" && <Loader2 size={16} className="animate-spin" />}
            {save === "done" && (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="butt" strokeLinejoin="miter">
                  <path d="M4 12.5 L9.5 18 L20 6.5" className={v !== 1 ? "mx-tick" : ""} />
                </svg>
                Saved
              </>
            )}
          </button>
        </Card>
        <Card className="flex w-72 flex-col gap-3">
          <div className="font-heading text-base">Log 2h on Variant</div>
          <button onClick={doLog} className="mx-press inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-white">
            <Clock size={16} /> Log hours
          </button>
          <p className="text-[13px] text-muted">{v === 1 ? "Quiet: the button confirms in place." : "A note slides up with an Undo, then leaves on its own."}</p>
        </Card>
        <Card className="relative flex w-72 flex-col gap-3 overflow-visible">
          <div className="font-heading text-base">Mark a lead as won</div>
          <button
            onClick={() => setBurst(Date.now())}
            className="mx-press relative inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#0f9d58] px-4 text-sm font-medium text-white"
          >
            Won
            {v === 3 && burst > 0 && (
              <span key={burst} className="pointer-events-none absolute inset-0">
                {Array.from({ length: 10 }, (_, i) => {
                  const a = (i / 10) * Math.PI * 2;
                  return (
                    <span
                      key={i}
                      className="mx-burst absolute left-1/2 top-1/2 size-2 rounded-[2px]"
                      style={{
                        background: i % 3 === 0 ? "#74f3ef" : i % 3 === 1 ? "#0b43ed" : "#0f9d58",
                        ["--dx" as string]: `${Math.cos(a) * 70}px`,
                        ["--dy" as string]: `${Math.sin(a) * 46}px`,
                      }}
                    />
                  );
                })}
              </span>
            )}
          </button>
          <p className="text-[13px] text-muted">
            {v === 3 ? "Playful: a small burst in the studio's colours — only for the moments worth it (a won deal, a hire)." : "Only the playful option celebrates."}
          </p>
        </Card>
        {toast && v !== 1 && (
          <div key={toast} className="mx-toast absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-4 overflow-hidden rounded-xl bg-[#06112f] py-3 pl-4 pr-3 text-sm text-white shadow-2xl">
            <span className="flex size-6 items-center justify-center rounded-full bg-success">
              <Check size={14} strokeWidth={3} />
            </span>
            Logged 2h on Variant · Home Page
            <button className="rounded-md px-2 py-1 font-medium text-[#74f3ef] hover:bg-white/10">Undo</button>
            <span className="mx-toast-timer absolute inset-x-0 bottom-0 h-0.5 bg-[#74f3ef]" />
          </div>
        )}
      </div>
    </Section>
  );
}

/* ── 5. gestures ───────────────────────────────────────────────────────── */

function Gestures() {
  const [v, setV] = useState<V>(2);
  const [cols, setCols] = useState<string[][]>([
    ["Getlira", "Orbit Health"],
    ["Unibeam"],
  ]);
  const [drag, setDrag] = useState<{ name: string; from: number; dx: number; dy: number; over: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const colRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];

  const overCol = (x: number) => {
    const r = colRefs[1].current?.getBoundingClientRect();
    return r && x >= r.left ? 1 : 0;
  };
  return (
    <Section
      n={5}
      title="Gestures"
      line="Drag a card to the other column. The same feel would apply to the leads and candidates boards, the client board and the weekly plan."
      controls={<Options value={v} onChange={setV} names={["Lift", "Lift + tilt", "Lift + make room"]} />}
    >
      <div className="grid max-w-3xl grid-cols-2 gap-4 select-none">
        {cols.map((list, ci) => (
          <div key={ci}>
            <div className="mb-2 px-1 text-sm font-medium">{ci === 0 ? "Discovery" : "Negotiation"}</div>
            <div
              ref={colRefs[ci]}
              className={`flex min-h-48 flex-col gap-2.5 rounded-2xl p-2 transition-colors ${
                drag && drag.over === ci && drag.from !== ci ? "bg-brand-soft" : "bg-track/50"
              }`}
            >
              {list.map((name) => {
                const dragging = drag?.name === name;
                return (
                  <div key={name} className="relative">
                    {dragging && v === 3 && <div className="mx-gap h-[76px] rounded-xl bg-surface/50" />}
                    <div
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        start.current = { x: e.clientX, y: e.clientY };
                        setDrag({ name, from: ci, dx: 0, dy: 0, over: ci });
                      }}
                      onPointerMove={(e) => {
                        if (!dragging || !start.current) return;
                        setDrag({ name, from: ci, dx: e.clientX - start.current.x, dy: e.clientY - start.current.y, over: overCol(e.clientX) });
                      }}
                      onPointerUp={(e) => {
                        if (!dragging) return;
                        const to = overCol(e.clientX);
                        setDrag(null);
                        if (to !== ci) {
                          setCols((c) => c.map((l, i) => (i === ci ? l.filter((x) => x !== name) : i === to ? [...l, name] : l)));
                        }
                      }}
                      className={`cursor-grab rounded-xl bg-surface p-4 active:cursor-grabbing ${dragging ? "relative z-10" : "mx-settle"} ${
                        dragging && v === 3 ? "absolute inset-x-0 top-0" : ""
                      }`}
                      style={{
                        transform: dragging
                          ? `translate(${drag!.dx}px, ${drag!.dy}px) ${v >= 2 ? "rotate(2deg)" : ""} scale(1.02)`
                          : undefined,
                        boxShadow: dragging ? "0 18px 40px -12px rgba(6,17,47,.35)" : "var(--shadow-card)",
                        transition: dragging ? "box-shadow 120ms" : "transform 220ms cubic-bezier(.2,.8,.2,1.1), box-shadow 200ms",
                      }}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-[15px] font-medium">{name}</span>
                        <span className="text-sm tabular-nums">₪{name === "Unibeam" ? "242,900" : "60,000"}</span>
                      </div>
                      <div className="mt-1 text-[13px] text-muted">{name === "Getlira" ? "No next step yet" : "Next step due 24/10"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-muted">
        {v === 1 && "The card lifts and casts a deeper shadow; the column you're over tints."}
        {v === 2 && "As 1, and the card tilts 2° in the hand, like picking up a paper card. On release it settles back with a slight spring."}
        {v === 3 && "As 2, and the card's old place stays open as a soft gap, so you can see where it came from."}
      </p>
    </Section>
  );
}

/* ── 6. empty states ───────────────────────────────────────────────────── */

function Empty() {
  const [v, setV] = useState<V>(2);
  const cases: { icon: LucideIcon; title: string; serif: string; line: string; action?: string }[] = [
    { icon: SquareCheckBig, title: "Nothing assigned to you right now.", serif: "All clear.", line: "Nothing is assigned to you right now.", action: "Open the weekly plan" },
    { icon: Inbox, title: "Nothing waiting.", serif: "Nothing waiting.", line: "New intake requests and client edits will show up here." },
    { icon: Search, title: "Nobody matches that.", serif: "No one by that name.", line: "Try a part of the name, an email or a source.", action: "Clear the search" },
  ];
  return (
    <Section
      n={6}
      title="Empty states"
      line="What a card says when there is nothing in it. Today it is one grey line."
      controls={<Options value={v} onChange={setV} names={["Line", "Icon + action", "Studio"]} />}
    >
      <div className="grid gap-4 md:grid-cols-3">
        {cases.map((c) => (
          <Card key={c.title} className="flex min-h-56 flex-col">
            <div className="font-heading text-base">{c.icon === Inbox ? "Intake" : c.icon === Search ? "Candidates" : "My tasks"}</div>
            {v === 1 && <p className="mt-3 text-sm text-muted">{c.title}</p>}
            {v === 2 && (
              <div className="mx-in-2 flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
                  <c.icon size={22} strokeWidth={1.75} />
                </span>
                <p className="text-sm">{c.line}</p>
                {c.action && <button className="mx-press rounded-lg bg-background px-3 py-1.5 text-sm font-medium">{c.action}</button>}
              </div>
            )}
            {v === 3 && (
              <div className="mx-in-2 flex flex-1 flex-col items-start justify-end gap-2">
                <span className="brand-amp h-10 w-8 bg-brand/15" />
                <p className="font-serif-accent text-[28px] leading-tight text-brand">{c.serif}</p>
                <p className="text-sm text-muted">{c.line}</p>
                {c.action && (
                  <button className="group mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand">
                    {c.action} <StudioArrow size={16} className="transition-transform group-hover:translate-x-1" />
                  </button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </Section>
  );
}

/* ── 7. icons ──────────────────────────────────────────────────────────── */

function Icons() {
  const [v, setV] = useState<V>(2);
  const nav: [string, LucideIcon][] = [
    ["Home", House],
    ["Weekly Plan", Calendar],
    ["My Tasks", SquareCheckBig],
    ["Vacation", TreePalm],
    ["Time Feed", History],
    ["Clients", Users],
    ["Reports", ChartPie],
    ["Settings", Settings],
  ];
  const tools: LucideIcon[] = [Search, Plus, Pencil, Copy, Trash2, MoreHorizontal, Clock, Inbox];
  return (
    <Section
      n={7}
      title="Icons in the studio's hand"
      line="The website's icons are drawn with flat-cut ends, sharp corners and a firmer line. These are the app's own icons with that treatment applied — one rule, so it reaches every icon in the app."
      controls={<Options value={v} onChange={setV} names={["Stock", "Studio cut", "Studio cut + fill"]} />}
    >
      <div className={`mx-ic${v} grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]`}>
        <div className="rounded-2xl bg-brand p-3">
          {nav.map(([l, I], i) => (
            <div key={l} className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${i === 2 ? "mx-active bg-white text-brand" : "text-white/85"}`}>
              <I size={20} strokeWidth={1.75} /> {l}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-6">
          <Card className="flex flex-wrap items-center gap-5 text-foreground">
            {tools.map((I, i) => (
              <I key={i} size={22} strokeWidth={1.75} />
            ))}
            <StudioArrow size={22} />
            <StudioArrow size={22} up />
          </Card>
          <Card>
            <div className="flex items-center gap-6 text-muted">
              {[SquareCheckBig, Calendar, Clock, Users].map((I, i) => (
                <span key={i} className="flex items-center gap-2 text-sm">
                  <I size={16} strokeWidth={1.75} /> {["Task", "Due 24/10", "12.5h", "3 people"][i]}
                </span>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-6 text-foreground">
              {[House, Users, Handshake, ChartPie].map((I, i) => (
                <I key={i} size={40} strokeWidth={1.75} />
              ))}
            </div>
          </Card>
        </div>
      </div>
      <p className="mt-4 text-[13px] text-muted">
        {v === 1 && "Today: rounded ends and corners at the 1.75 line."}
        {v === 2 && "Flat ends, sharp corners, a 2.0 line — the website's arrow in every icon. Small sizes stay crisp; big ones look cut, not drawn with a marker."}
        {v === 3 && "As 2, and the icon of the page you're on fills with a light wash of its colour, so the active one reads at a glance."}
      </p>
    </Section>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

export function MotionLab() {
  return (
    <div className="app-canvas min-h-screen bg-background">
      <style>{CSS}</style>
      <div className="mx-auto flex max-w-[1500px] flex-col gap-14 px-6 pb-24 pt-10">
        <header>
          <h1 className="page-title">Motion, feedback &amp; icons</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Seven areas, three options each, all live — click, hover, drag. Nothing here makes you wait to act: content
            is usable from its first frame, and all of it turns off for anyone who asks their device for less motion.
          </p>
        </header>
        <LoadIn />
        <Loaders />
        <Hover />
        <Feedback />
        <Gestures />
        <Empty />
        <Icons />
      </div>
    </div>
  );
}

const CSS = `
/* 1 — arrivals */
@keyframes mx-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes mx-settle-in { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
.mx-in-2 { animation: mx-rise 220ms cubic-bezier(.2,.7,.2,1) both; }
.mx-in-3 { animation: mx-settle-in 180ms cubic-bezier(.2,.7,.2,1) both; }
@keyframes mx-draw { from { stroke-dashoffset: 800; } to { stroke-dashoffset: 0; } }
.mx-draw-line { stroke-dasharray: 800; animation: mx-draw 700ms 120ms cubic-bezier(.4,0,.2,1) both; }

/* 2 — loaders */
@keyframes mx-shimmer { from { background-position: 150% 0; } to { background-position: -50% 0; } }
.mx-skel { background: linear-gradient(90deg, #eef0f5 0%, #eef0f5 35%, #f7f9fc 50%, #eef0f5 65%, #eef0f5 100%); background-size: 200% 100%; animation: mx-shimmer 1.3s linear infinite; }
@keyframes mx-loadline { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
.mx-loadline { background: linear-gradient(90deg, transparent, #0b43ed, transparent); width: 40%; animation: mx-loadline 1s cubic-bezier(.4,0,.2,1) infinite; }
@keyframes mx-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
.mx-amp { animation: mx-breathe 1.6s ease-in-out infinite; }
@keyframes mx-bootbar { from { width: 8%; } to { width: 92%; } }
.mx-boot { animation: mx-bootbar 2.4s cubic-bezier(.2,.6,.2,1) infinite; }

/* 3 — hover */
.mx-h1 .mx-card { transition: box-shadow 160ms; }
.mx-h1 .mx-card:hover { box-shadow: var(--shadow-card-hover); }
.mx-h1 .mx-row:hover { background: #f7f9fc; }
.mx-h1 .mx-row-arrow, .mx-h3 .mx-row-arrow { opacity: 0; }
.mx-h2 .mx-card, .mx-h3 .mx-card { transition: transform 180ms cubic-bezier(.2,.7,.2,1), box-shadow 180ms; }
.mx-h2 .mx-card:hover, .mx-h3 .mx-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-card-hover); }
.mx-arrow { transition: transform 200ms cubic-bezier(.2,.7,.2,1), color 160ms; }
.mx-h2 .mx-card:hover .mx-arrow, .mx-h3 .mx-card:hover .mx-arrow { transform: translate(4px,-4px); color: #0b43ed; }
.mx-h2 .mx-row { transition: background-color 140ms; }
.mx-h2 .mx-row:hover { background: #f7f9fc; }
.mx-h2 .mx-row-arrow { opacity: 0; transform: translateX(-6px); transition: opacity 160ms, transform 180ms cubic-bezier(.2,.7,.2,1); }
.mx-h2 .mx-row:hover .mx-row-arrow { opacity: 1; transform: none; }
.mx-h2 .mx-btn, .mx-h3 .mx-btn { transition: filter 140ms, transform 120ms; }
.mx-h2 .mx-btn:hover, .mx-h3 .mx-btn:hover { filter: brightness(1.12); }
.mx-h2 .mx-nav, .mx-h3 .mx-nav { transition: transform 160ms cubic-bezier(.2,.7,.2,1), background-color 140ms; }
.mx-h2 .mx-nav:not(.bg-white):hover, .mx-h3 .mx-nav:not(.bg-white):hover { transform: translateX(3px); background: rgba(255,255,255,.12); }
.mx-h3 .mx-card::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 200ms;
  background: radial-gradient(240px circle at var(--mx, 50%) var(--my, 50%), rgba(11,67,237,.07), transparent 70%); }
.mx-h3 .mx-card:hover::after { opacity: 1; }
.mx-h3 .mx-row::before { content: ""; position: absolute; inset: 0; background: #f7f9fc; transform: scaleX(0); transform-origin: left; transition: transform 220ms cubic-bezier(.2,.7,.2,1); z-index: 0; }
.mx-h3 .mx-row:hover::before { transform: scaleX(1); }
.mx-h3 .mx-row > * { position: relative; z-index: 1; }

/* 4 — feedback */
.mx-press { transition: transform 90ms; }
.mx-press:active { transform: scale(.97); }
@keyframes mx-tick-draw { from { stroke-dashoffset: 26; } to { stroke-dashoffset: 0; } }
.mx-tick { stroke-dasharray: 26; animation: mx-tick-draw 260ms cubic-bezier(.4,0,.2,1) both; }
@keyframes mx-toast-in { from { opacity: 0; transform: translate(-50%, 14px); } to { opacity: 1; transform: translate(-50%, 0); } }
.mx-toast { animation: mx-toast-in 200ms cubic-bezier(.2,.7,.2,1) both; }
@keyframes mx-timer { from { transform: scaleX(1); } to { transform: scaleX(0); } }
.mx-toast-timer { transform-origin: left; animation: mx-timer 3.2s linear both; }
@keyframes mx-burst { 0% { opacity: 1; transform: translate(-50%,-50%) scale(1); } 100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(.5) rotate(90deg); } }
.mx-burst { animation: mx-burst 650ms cubic-bezier(.2,.7,.2,1) both; }

/* 5 — gestures */
@keyframes mx-gap-in { from { height: 0; opacity: 0; } to { height: 76px; opacity: 1; } }
.mx-gap { animation: mx-gap-in 160ms ease-out both; }

/* 7 — icons: the studio cut, applied to every lucide icon at once */
.mx-ic2 svg.lucide, .mx-ic3 svg.lucide { stroke-linecap: butt; stroke-linejoin: miter; stroke-width: 2; }
.mx-ic3 .mx-active svg.lucide { fill: currentColor; fill-opacity: .14; }
`;
