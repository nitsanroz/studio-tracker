"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useFold } from "@/lib/use-fold";
import type { Advice } from "@/lib/finance/people";

const TONE: Record<Advice["tone"], { label: string; className: string }> = {
  act: { label: "Act", className: "bg-[var(--aqua)]/20 text-[var(--aqua)]" },
  watch: { label: "Watch", className: "bg-amber-300/20 text-amber-200" },
  good: { label: "Good", className: "bg-emerald-300/15 text-emerald-200" },
};

/**
 * &advice on one person, at the top of their page (Nitsan, 2026-11-16: "when
 * I'm at a team member page I would expect advice opinion in terms of HR and
 * finance about that person"). The same recommendations as their Summary tab
 * (`lib/finance/people.ts` — pay against what their work supports, time since
 * the last salary update and review talk, which way their hours go), in the
 * advisor's night look so it reads as &advice speaking. Full finance only —
 * the team page mounts it behind that tier.
 */
export function PersonAdvice({ name, advice, owner, onOpen }: { name: string; advice: Advice[]; owner: boolean; onOpen: () => void }) {
  const first = name.split(" ")[0];
  // Folds on a narrow screen (remembered per browser, `fold.person-advice`);
  // from xl it is a column beside the page and always open.
  const [open, toggle] = useFold("person-advice");
  const acts = advice.filter((a) => a.tone === "act").length;
  return (
    <section className="rounded-2xl bg-[#06112f] p-4 text-white shadow-card md:p-5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-base font-medium xl:pointer-events-none"
      >
        <span className="font-serif-accent text-xl text-[var(--aqua)]">&amp;</span>
        advice on {first}
        {acts > 0 && <span className="ml-1 rounded-full bg-[var(--aqua)]/20 px-1.5 text-[11px] text-[var(--aqua)]">{acts} to act on</span>}
        <ChevronDown size={16} className={`ml-auto text-white/60 transition-transform xl:hidden ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={open ? "" : "hidden xl:block"}>
      <p className="mt-0.5 text-[11px] text-white/50">HR and pay, as their employer</p>
      {advice.length ? (
        <ul className="mt-3 flex flex-col gap-3">
          {advice.map((a) => (
            <li key={a.title} className="grid grid-cols-[3.25rem_1fr] items-start gap-3 text-sm">
              <span className={`rounded-md px-1.5 py-0.5 text-center text-[11px] font-medium ${TONE[a.tone].className}`}>{TONE[a.tone].label}</span>
              <div>
                <div className="font-medium">{a.title}</div>
                <div className="text-[13px] leading-snug text-white/65">{a.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-white/65">
          {owner ? "Nothing to say about the owner." : `Nothing about ${first} needs your attention right now.`}
        </p>
      )}
      <p className="mt-3 text-[11px] text-white/40">Read from their numbers and HR timeline — it can&apos;t see the quality of their work. What to look into, not a verdict.</p>
      <button onClick={onOpen} className="mt-3 flex items-center gap-1 text-[13px] text-[var(--aqua)] hover:underline">
        <Sparkles size={14} /> The full summary
      </button>
      </div>
    </section>
  );
}
