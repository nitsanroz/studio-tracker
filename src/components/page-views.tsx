"use client";

// One page, two views (Nitsan, 2026-11-15: "People can be merged into Team, the
// two freelancer pages can merge, maybe as two views; Scenarios is a tab of the
// advisor; Rates belongs with Clients").
//
// Each pair is a tracker page and the finance page about the same thing. They
// stay TWO ADDRESSES on purpose: the finance half sits under /finance, behind
// its own server layout (lib/access.ts) and the finance tables' RLS, and reads
// figures a server layout hands it after the tier check. Folding its code into
// the tracker page would take it out from behind that gate. So the merge is in
// what you see: one row in the menu (app-shell.tsx `VIEW_OF`), and this switch
// at the top of both halves.
//
// ⚠️ A CONVENIENCE, NOT A LOCK — it only decides which views are offered. A
// viewer who may not open a view isn't shown it, and with one view left the
// switch isn't drawn at all.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { atLeast, type Tier } from "@/lib/access";
import { useTier } from "@/components/tier-context";

export interface PageView {
  href: string;
  label: string;
  /** the lowest tier that is offered this view; everyone who reaches the page when absent */
  min?: Tier;
  /** active on this address only, not on what sits under it */
  exact?: boolean;
}

export const ADVICE_VIEWS: PageView[] = [
  { href: "/advice", label: "&advice", min: "owner" },
  { href: "/finance/scenarios", label: "Scenarios", min: "owner" },
];

/**
 * The same pills switching views INSIDE one page — the advisor's tabs, the
 * Freelancers / Payments switch (2026-11-16) — so all three look alike.
 */
export function ViewSwitch<T extends string>({ value, options, onChange, className = "" }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; className?: string }) {
  return (
    <nav aria-label="Views of this page" className={`inline-flex max-w-full flex-wrap rounded-full bg-surface p-0.5 text-[13px] shadow-card ${className}`}>
      {options.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          aria-current={value === id ? "page" : undefined}
          className={`rounded-full px-3.5 py-1 font-medium transition-colors ${value === id ? "bg-brand text-white" : "text-muted hover:text-foreground"}`}
        >
          <span dir="ltr">{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function PageViews({ views, className = "" }: { views: PageView[]; className?: string }) {
  const here = usePathname();
  const tier = useTier();
  const shown = views.filter((v) => !v.min || atLeast(tier, v.min));
  if (shown.length < 2) return null;
  return (
    <nav aria-label="Views of this page" className={`inline-flex max-w-full flex-wrap rounded-full bg-surface p-0.5 text-[13px] shadow-card ${className}`}>
      {shown.map((v) => {
        const active = v.exact ? here === v.href : here === v.href || here.startsWith(v.href + "/");
        return (
          <Link
            key={v.href}
            href={v.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3.5 py-1 font-medium transition-colors ${active ? "bg-brand text-white" : "text-muted hover:text-foreground"}`}
          >
            {/* The name reads left to right in either language. */}
            <span dir="ltr">{v.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
