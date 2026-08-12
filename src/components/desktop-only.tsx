"use client";

// Six routes are deliberately not built for a phone, and this is what they show
// there instead of a broken grid.
//
// ⚠️ It renders INSIDE the shell, in place of the page body only — the header,
// the bottom bar and the drawer are all still there. A redirect was the obvious
// alternative and is wrong: several of these routes are linked from elsewhere
// (a client page from a task's client chip, `/feed` from the home pane), and
// redirecting destroys the URL somebody was sent. Landing on a page that
// explains itself and offers the nearest useful screen keeps the link honest.
//
// These routes are ALSO absent from the mobile drawer (see NAV's `mobile` flag),
// so this card is only ever reached by a direct link, a pasted URL or a stale
// tab — not by browsing. There is deliberately no "open anyway" escape: at
// 375px the weekly plan is a 1,846px fixed grid and the client Gantt pins a
// 238px column, so "anyway" would mean a horizontal scroll through a layout
// nothing in it can accommodate. If that turns out to be too strict, adding an
// escape is a `useState` and a button — nothing here assumes it can't be reached.

import Link from "next/link";
import { Monitor } from "lucide-react";

type Entry = { label: string; why: string; toHref: string; toLabel: string };

/**
 * Longest prefix wins, so `/clients/[id]` can differ from `/clients`. Keep this
 * list and NAV's `mobile: false` flags in agreement — a route hidden from the
 * drawer with no entry here renders its real (broken) page on a phone.
 */
const DESKTOP_ONLY: Array<[string, Entry]> = [
  // ⚠️ `/clients` and `/clients/[id]` were both here until v1.14.0 and are
  // deliberately GONE, not commented out: `client-mobile.tsx` gives each of them
  // a real phone build. The client page's phone build is the TASK LIST ONLY —
  // its Timeline and Board tabs simply aren't offered there, which is a choice
  // made inside that component rather than a route-level block, because the rest
  // of the page is genuinely useful on a phone.
  [
    "/plan",
    {
      label: "Weekly plan",
      why: "It is a fixed grid — one 175px column per designer, about 1,850px across — and work is scheduled by dragging, which isn't a phone gesture.",
      toHref: "/my-tasks",
      toLabel: "My tasks",
    },
  ],
  [
    "/feed",
    {
      label: "Time feed",
      why: "The timesheet is a week-wide grid. To check hours you just logged, open the task.",
      toHref: "/my-tasks",
      toLabel: "My tasks",
    },
  ],
  [
    "/reports",
    {
      label: "Reports",
      why: "Charts and a wide table built for reading side by side.",
      toHref: "/",
      toLabel: "Home",
    },
  ],
  [
    "/client-reports",
    {
      label: "Client reports",
      why: "Publishing a report freezes numbers a client will read — not something to do one-handed.",
      toHref: "/",
      toLabel: "Home",
    },
  ],
  [
    "/team/",
    {
      label: "Member details",
      why: "HR details and per-month charts.",
      toHref: "/team",
      toLabel: "The team",
    },
  ],
];

/** The entry for a path, or null if this route works on a phone. */
export function desktopOnlyEntry(pathname: string): Entry | null {
  const hit = DESKTOP_ONLY.find(([prefix]) => pathname.startsWith(prefix));
  return hit ? hit[1] : null;
}

export function DesktopOnlyCard({ entry }: { entry: Entry }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-6 py-10 text-center shadow-card">
      <span className="flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Monitor size={22} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold">{entry.label} needs a bigger screen</h1>
        <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted">{entry.why}</p>
      </div>
      <Link
        href={entry.toHref}
        className="min-h-11 rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark flex items-center"
      >
        Go to {entry.toLabel}
      </Link>
    </div>
  );
}
