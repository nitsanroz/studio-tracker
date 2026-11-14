"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { atLeast, canOpenFinance, type Tier } from "@/lib/access";
import { HideNumbersToggle, PrivacyBlur } from "@/components/finance/privacy-blur";
import { NewClientsPrompt } from "@/components/finance/new-clients";

/**
 * The finance area's own frame, inside the tracker's shell: its page links, the
 * "Hide numbers" switch, and the helpers the finance app's shell used to mount
 * (discreet mode, the new-clients prompt).
 *
 * The sidebar carries ONE "Finance" entry; the pages are listed here, across
 * the top, so nine more rows don't push the tracker's own nav off the screen.
 * Each link is shown only to a tier that may open it (lib/access.ts) — the
 * server layouts and RLS are what actually keep a page shut.
 */
const PAGES: { href: string; label: string; exact?: boolean }[] = [
  { href: "/finance", label: "Overview", exact: true },
  { href: "/finance/plan", label: "Plan" },
  { href: "/finance/salaries", label: "Salaries" },
  { href: "/finance/freelance", label: "Freelance" },
  { href: "/finance/people", label: "People" },
  { href: "/finance/expenses", label: "Expenses" },
  { href: "/finance/rates", label: "Rates" },
  { href: "/finance/scenarios", label: "Scenarios" },
  // A tab of the tracker's Settings (stage 5); the address still answers, by redirect.
  { href: "/finance/settings", label: "Settings" },
];

export function FinanceShell({ tier, children }: { tier: Tier; children: React.ReactNode }) {
  const pathname = usePathname();
  const pages = PAGES.filter((p) => canOpenFinance(tier, p.href));
  const full = atLeast(tier, "finance");
  return (
    <>
      <PrivacyBlur />
      <div className="mb-4 flex flex-wrap items-center gap-x-1 gap-y-2">
        {/* One page (an admin without full finance) needs no menu. */}
        {pages.length > 1 && (
          <nav className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Finance pages">
            {pages.map((p) => {
              const active = p.exact ? pathname === p.href : pathname.startsWith(p.href);
              return (
                <Link
                  key={p.href}
                  href={p.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    active ? "bg-brand text-white" : "text-muted hover:bg-surface hover:text-foreground"
                  }`}
                >
                  {p.label}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="ml-auto">
          <HideNumbersToggle />
        </div>
      </div>
      {children}
      {/* &advice is mounted once, by AppShell, for the whole app (the finance merge, stage 4). */}
      {full && <NewClientsPrompt />}
    </>
  );
}
