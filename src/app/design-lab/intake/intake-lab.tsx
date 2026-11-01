"use client";

// The client's New Task Brief, redrawn in the October refresh's language, at
// life size with the app's own tokens. The questions and the nine kinds are
// the REAL ones (read from `lib/intake-fields.ts`); the person is invented.
//
//   A "Card"   — the app's page: a 40/48 title with a serif word, the steps
//                named, the questions in one white card on Light White wells
//   B "Split"  — a brand-blue panel holds the mark, the headline and the steps
//                as a list; the questions sit in a white card beside it
//   C "Calm"   — one column, no card: a big step title with its number in the
//                serif, a thin named progress line, the buttons in a bar
//
// Each one has three screens: "What you need" (the kind picker, the richest
// step), "About you" (the first thing a client sees) and the thank-you.
// Nothing here is sent anywhere.

import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChartColumn,
  FileText,
  MessageSquare,
  Monitor,
  Presentation,
  Puzzle,
  Shirt,
  Sparkles,
  Tent,
  type LucideIcon,
} from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";
import { AmpLoader } from "@/components/amp-loader";
import { WORK_KINDS } from "@/lib/intake-fields";

type Dir = "A" | "B" | "C";
type Screen = "kinds" | "about" | "done";

const STEPS = ["About you", "What you need", "Technical details", "The brief", "Content & references", "Review & send"];

const KIND_ICON: Record<string, LucideIcon> = {
  social: MessageSquare,
  website: Monitor,
  event: Tent,
  presentation: Presentation,
  document: FileText,
  graphics: ChartColumn,
  swag: Shirt,
  logo: Sparkles,
  other: Puzzle,
};

/** Two kinds picked, so the selected state is visible. */
const PICKED = new Set(["social", "event"]);

/* ── shared pieces ─────────────────────────────────────────────────────── */

/** A field on a Light White well, no outline — the refresh's quiet surface. */
function Well({ value, placeholder, tall, type }: { value?: string; placeholder?: string; tall?: boolean; type?: "date" }) {
  return (
    <div
      className={`flex w-full items-start rounded-xl bg-[#f7f9fc] px-4 text-base ${tall ? "min-h-24 py-3" : "h-12 items-center"} ${
        value ? "text-foreground" : "text-faint"
      }`}
    >
      {value ?? placeholder ?? (type === "date" ? "dd / mm / yyyy" : "")}
    </div>
  );
}

function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-[15px] font-medium">
      {children}
      {required && <span className="text-danger"> *</span>}
    </span>
  );
}

function KindTiles({ cols = 2 }: { cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-2.5 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {WORK_KINDS.map((k) => {
        const on = PICKED.has(k.id);
        const Icon = KIND_ICON[k.id] ?? Puzzle;
        return (
          <div
            key={k.id}
            className={`relative flex items-start gap-3 rounded-2xl p-4 transition-shadow ${
              on ? "bg-brand-soft ring-2 ring-brand" : "bg-[#f7f9fc] hover:shadow-card"
            }`}
          >
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${on ? "bg-brand text-white" : "bg-surface text-brand"}`}
            >
              <Icon size={18} strokeWidth={2} />
            </span>
            <span className="min-w-0 pr-5">
              <span className="block text-[15px] font-medium leading-snug">{k.label}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">{k.hint}</span>
            </span>
            {on && (
              <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-brand text-white">
                <Check size={12} strokeWidth={3} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function KindsQuestions({ cols }: { cols?: 2 | 3 }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label required>What kind of work is this?</Label>
        <p className="-mt-1 mb-3 text-sm text-muted">Pick as many as apply.</p>
        <KindTiles cols={cols} />
      </div>
      <div>
        <Label required>Task name</Label>
        <Well value="Partner Summit — LinkedIn set + roll-ups" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Due date</Label>
          <Well type="date" value="24 / 11 / 2026" />
        </div>
        <div>
          <Label>Budget</Label>
          <Well placeholder="e.g. 5-8 hours, or tell us what you're working with" />
        </div>
      </div>
    </div>
  );
}

function AboutQuestions({ remembered = false }: { remembered?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="-mt-1 text-sm text-muted">
        Only fields marked * are required — anything you don&apos;t know yet, leave blank and we&apos;ll ask.
      </p>
      <div>
        <Label required>Name</Label>
        <Well value={remembered ? "Dana Levi" : undefined} />
      </div>
      <div>
        <Label required>Email</Label>
        <Well value={remembered ? "dana@northwind.io" : undefined} />
      </div>
      <div>
        <Label>Company</Label>
        <Well value={remembered ? "Northwind" : undefined} />
      </div>
    </div>
  );
}

function NextButton({ label = "Next", wide }: { label?: string; wide?: boolean }) {
  return (
    <span
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand px-6 text-base font-medium text-white hover:bg-brand-dark ${wide ? "flex-1" : ""}`}
    >
      {label} <StudioArrow size={18} />
    </span>
  );
}

function BackButton() {
  return <span className="inline-flex h-12 items-center rounded-xl px-5 text-base text-muted hover:bg-surface">Back</span>;
}

function Mark({ white }: { white?: boolean }) {
  return <span className={`brand-ampmore h-6 self-start ${white ? "bg-white" : "bg-brand"}`} role="img" aria-label="Studio&more" />;
}

/* ── A: Card ───────────────────────────────────────────────────────────── */

function StepChips({ at }: { at: number }) {
  return (
    <ol className="flex flex-wrap gap-1">
      {STEPS.map((s, i) => (
        <li
          key={s}
          className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] ${
            i === at ? "bg-brand text-white" : i < at ? "bg-surface text-brand shadow-card" : "text-faint"
          }`}
        >
          {i < at ? <Check size={13} strokeWidth={2.5} /> : <span className="tabular-nums">{i + 1}</span>}
          {s}
        </li>
      ))}
    </ol>
  );
}

function DirA({ screen }: { screen: Screen }) {
  if (screen === "done") {
    return (
      <div className="mx-auto max-w-[880px] px-5 py-10">
        <div className="mb-8 flex justify-end">
          <Mark />
        </div>
        <section className="rounded-[20px] bg-surface p-10 text-center shadow-card">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand text-white">
            <Check size={28} strokeWidth={2.5} />
          </span>
          <h1 className="page-title mt-6">
            Thank you, <span className="font-serif-accent">Dana</span>
          </h1>
          <p className="mx-auto mt-2 max-w-md text-base text-muted">
            Your brief is with the studio. We&apos;ll be in touch shortly.
          </p>
          <span className="mt-6 inline-flex items-center gap-1.5 text-base text-brand">
            Send another, or change one you&apos;ve sent <StudioArrow size={16} />
          </span>
        </section>
      </div>
    );
  }
  const at = screen === "about" ? 0 : 1;
  return (
    <div className="mx-auto max-w-[880px] px-5 py-10">
      <div className="mb-8 flex justify-end">
        <Mark />
      </div>
      <h1 className="page-title">
        New task <span className="font-serif-accent">brief</span>
      </h1>
      <p className="mt-2 text-base text-muted">Tell us what you need — the more detail, the better the result.</p>
      <div className="mt-6">
        <StepChips at={at} />
      </div>
      <section className="mt-4 rounded-[20px] bg-surface p-6 shadow-card sm:p-8">
        <h2 className="card-title mb-5">{STEPS[at]}</h2>
        {screen === "about" ? <AboutQuestions /> : <KindsQuestions />}
        <div className="mt-8 flex items-center justify-end gap-2">
          {at > 0 && <BackButton />}
          <NextButton />
        </div>
      </section>
    </div>
  );
}

/* ── B: Split ──────────────────────────────────────────────────────────── */

function DirB({ screen }: { screen: Screen }) {
  const at = screen === "about" ? 0 : screen === "kinds" ? 1 : STEPS.length;
  return (
    <div className="grid min-h-screen lg:grid-cols-[400px_minmax(0,1fr)]">
      <aside className="flex flex-col bg-brand px-8 py-10 text-white lg:sticky lg:top-0 lg:h-screen">
        <Mark white />
        <h1 className="mt-12 text-[40px] font-medium leading-[48px] tracking-[-0.025em]">
          {screen === "done" ? (
            <>
              Thank you, <span className="font-serif-accent">Dana</span>
            </>
          ) : (
            <>
              New task <span className="font-serif-accent">brief</span>
            </>
          )}
        </h1>
        <p className="mt-3 text-base text-white/75">
          {screen === "done"
            ? "Your brief is with the studio. We'll be in touch shortly."
            : "Tell us what you need — the more detail, the better the result."}
        </p>
        <ol className="mt-10 hidden flex-col gap-1 lg:flex">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={`flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] ${
                i === at ? "bg-white text-brand" : i < at ? "text-white" : "text-white/50"
              }`}
            >
              <span
                className={`flex size-6 items-center justify-center rounded-full text-[12px] tabular-nums ${
                  i === at ? "bg-brand text-white" : i < at ? "bg-white/20" : "ring-1 ring-white/40"
                }`}
              >
                {i < at ? <Check size={13} strokeWidth={2.5} /> : i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
        {screen === "done" && (
          <div className="mt-auto flex justify-center pt-10">
            <AmpLoader size={120} />
          </div>
        )}
      </aside>
      <main className="bg-[#f7f9fc] px-5 py-10 sm:px-10 lg:py-16">
        {screen === "done" ? (
          <section className="mx-auto max-w-2xl rounded-[20px] bg-surface p-8 shadow-card">
            <h2 className="card-title">What happens next</h2>
            <ol className="mt-4 flex flex-col gap-3 text-base text-muted">
              <li>1 · Someone at the studio reads it — you&apos;ll get a note when they have.</li>
              <li>2 · If anything is missing, we&apos;ll ask.</li>
              <li>3 · It becomes a task, and we start.</li>
            </ol>
            <span className="mt-6 inline-flex items-center gap-1.5 text-base text-brand">
              Send another, or change one you&apos;ve sent <StudioArrow size={16} />
            </span>
          </section>
        ) : (
          <section className="mx-auto max-w-2xl rounded-[20px] bg-surface p-6 shadow-card sm:p-8">
            <p className="text-[13px] text-muted lg:hidden">
              Step {at + 1} of {STEPS.length}
            </p>
            <h2 className="card-title mb-5">{STEPS[at]}</h2>
            {screen === "about" ? <AboutQuestions /> : <KindsQuestions />}
            <div className="mt-8 flex items-center justify-end gap-2">
              {at > 0 && <BackButton />}
              <NextButton />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

/* ── C: Calm ───────────────────────────────────────────────────────────── */

function DirC({ screen }: { screen: Screen }) {
  if (screen === "done") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-brand px-5 text-center text-white">
        <AmpLoader size={160} />
        <h1 className="mt-6 text-[40px] font-medium leading-[48px] tracking-[-0.025em]">
          Thank you, <span className="font-serif-accent">Dana</span>
        </h1>
        <p className="mt-2 max-w-md text-base text-white/80">Your brief is with the studio. We&apos;ll be in touch shortly.</p>
        <span className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-base font-medium text-brand">
          Send another, or change one <StudioArrow size={18} />
        </span>
      </div>
    );
  }
  const at = screen === "about" ? 0 : 1;
  return (
    <div className="min-h-screen bg-[#f7f9fc]">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 pt-8">
        <span className="text-sm text-muted">New task brief</span>
        <Mark />
      </header>
      <div className="mx-auto max-w-3xl px-5 pb-40 pt-10">
        {/* The progress line, each segment named under it. */}
        <ol className="grid grid-cols-6 gap-1.5">
          {STEPS.map((s, i) => (
            <li key={s} className="min-w-0">
              <span className={`block h-1 rounded-full ${i <= at ? "bg-brand" : "bg-[#dfe3ee]"}`} />
              <span className={`mt-2 hidden truncate text-[12px] sm:block ${i === at ? "text-foreground" : "text-faint"}`}>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mt-12 flex items-baseline gap-4">
          <span className="font-serif-accent text-[56px] leading-none text-brand">{String(at + 1).padStart(2, "0")}</span>
          <h1 className="page-title">{STEPS[at]}</h1>
        </div>
        <div className="mt-8 [&_.bg-\[\#f7f9fc\]]:bg-surface">
          {screen === "about" ? <AboutQuestions /> : <KindsQuestions cols={3} />}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 bg-surface/90 shadow-[0_-4px_14px_rgba(6,17,47,.05)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-5 py-3">
          <span className="text-sm text-muted">
            Step {at + 1} of {STEPS.length}
          </span>
          <span className="flex-1" />
          {at > 0 && <BackButton />}
          <NextButton />
        </div>
      </div>
    </div>
  );
}

/* ── the switch ────────────────────────────────────────────────────────── */

const DIRS: { id: Dir; label: string; tip: string }[] = [
  { id: "A", label: "A · Card", tip: "The app's page: title with a serif word, named steps, one white card" },
  { id: "B", label: "B · Split", tip: "Brand-blue panel with the steps as a list, the questions beside it" },
  { id: "C", label: "C · Calm", tip: "One column, no card: big numbered step, buttons in a bottom bar" },
];
const SCREENS: { id: Screen; label: string }[] = [
  { id: "about", label: "About you" },
  { id: "kinds", label: "What you need" },
  { id: "done", label: "Thank you" },
];

export function IntakeLab() {
  const [dir, setDir] = useState<Dir>("A");
  const [screen, setScreen] = useState<Screen>("kinds");
  // Not written back until the URL has been read, or the first write would
  // replace `?d=B` with the default before it is applied.
  const [read, setRead] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const d = q.get("d") as Dir | null;
    const s = q.get("s") as Screen | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL
    if (d && DIRS.some((x) => x.id === d)) setDir(d);
    if (s && SCREENS.some((x) => x.id === s)) setScreen(s);
    setRead(true);
  }, []);
  useEffect(() => {
    if (read) window.history.replaceState(null, "", `?d=${dir}&s=${screen}`);
  }, [read, dir, screen]);

  return (
    <div className="min-h-screen bg-background">
      {dir === "A" && <DirA screen={screen} />}
      {dir === "B" && <DirB screen={screen} />}
      {dir === "C" && <DirC screen={screen} />}
      <div className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 gap-3 rounded-2xl bg-[#111] p-1.5 text-xs text-white shadow-2xl">
        <div className="flex gap-1">
          {DIRS.map((d) => (
            <button
              key={d.id}
              title={d.tip}
              onClick={() => setDir(d.id)}
              className={`whitespace-nowrap rounded-xl px-3 py-2 ${dir === d.id ? "bg-white text-[#111]" : "text-white/75 hover:text-white"}`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 border-l border-white/20 pl-3">
          {SCREENS.map((s) => (
            <button
              key={s.id}
              onClick={() => setScreen(s.id)}
              className={`whitespace-nowrap rounded-xl px-3 py-2 ${screen === s.id ? "bg-white text-[#111]" : "text-white/75 hover:text-white"}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
