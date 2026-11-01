"use client";

// Sign-in, three ways, at life size with the app's tokens. The reset page uses
// whichever frame is picked.
//
//   A "Card"   — the brief form's language: a white 20px card on the canvas,
//                the logo, a title with a serif word, wells, the arrow button
//   B "Split"  — the boot screen's blue on the left with the animated
//                ampersand; the form on white beside it
//   C "Blue"   — the whole page brand blue (the boot screen carries straight
//                on), the ampersand above a white card

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";
import { AmpLoader } from "@/components/amp-loader";

type Dir = "A" | "B" | "C";

const well = "flex h-12 w-full items-center rounded-xl bg-[var(--light-white)] px-4 text-base";

function Form({ title = true }: { title?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {title && (
        <div>
          <h1 className="page-title">
            Welcome <span className="font-serif-accent">back</span>
          </h1>
          <p className="mt-1 text-base text-muted">Sign in with your studio account.</p>
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-[15px] font-medium">
        Email
        <span className={well}>nitsan@studionmore.com</span>
      </label>
      <label className="flex flex-col gap-1.5 text-[15px] font-medium">
        Password
        <span className={`${well} justify-between`}>
          <span className="tracking-[0.2em]">••••••••••</span>
          <Eye size={18} strokeWidth={1.75} className="text-faint" />
        </span>
      </label>
      <span className="mt-2 flex h-12 items-center justify-center gap-2 rounded-xl bg-brand text-base font-medium text-white">
        Sign in <StudioArrow size={18} />
      </span>
      <span className="text-sm text-brand">Forgot password? / First time here?</span>
    </div>
  );
}

function Version({ light }: { light?: boolean }) {
  return <p className={`text-center text-xs ${light ? "text-white/60" : "text-faint"}`}>v1.85.0</p>;
}

function DirA() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-5">
      <section className="w-full max-w-[420px] rounded-[20px] bg-surface p-8 shadow-card">
        <span className="brand-ampmore mb-8 block h-7 bg-brand" role="img" aria-label="Studio&more" />
        <Form />
      </section>
      <Version />
    </div>
  );
}

function DirB() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="flex flex-col justify-between bg-brand p-10 text-white">
        <span className="brand-ampmore block h-7 self-start bg-white" role="img" aria-label="Studio&more" />
        <div className="flex justify-center">
          <AmpLoader size={260} />
        </div>
        <p className="text-[40px] font-medium leading-[48px] tracking-[-0.025em]">
          The studio&apos;s <span className="font-serif-accent">tracker</span>
        </p>
      </aside>
      <main className="flex flex-col items-center justify-center gap-6 bg-surface px-5">
        <div className="w-full max-w-[380px]">
          <Form />
        </div>
        <Version />
      </main>
    </div>
  );
}

function DirC() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-brand px-5">
      <AmpLoader size={96} />
      <section className="w-full max-w-[420px] rounded-[20px] bg-surface p-8 shadow-[0_24px_60px_rgba(6,17,47,0.25)]">
        <Form />
      </section>
      <Version light />
    </div>
  );
}

const DIRS: { id: Dir; label: string; tip: string }[] = [
  { id: "A", label: "A · Card", tip: "White card on the canvas, like the brief form" },
  { id: "B", label: "B · Split", tip: "Blue half with the animated ampersand, form on white" },
  { id: "C", label: "C · Blue", tip: "All blue, the ampersand above a white card" },
];

export function LoginLab() {
  const [dir, setDir] = useState<Dir>("A");
  const [read, setRead] = useState(false);
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("d") as Dir | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL
    if (d && DIRS.some((x) => x.id === d)) setDir(d);
    setRead(true);
  }, []);
  useEffect(() => {
    if (read) window.history.replaceState(null, "", `?d=${dir}`);
  }, [read, dir]);

  return (
    <div>
      {dir === "A" && <DirA />}
      {dir === "B" && <DirB />}
      {dir === "C" && <DirC />}
      <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 gap-1 rounded-2xl bg-[#111] p-1.5 text-xs text-white shadow-2xl">
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
    </div>
  );
}
