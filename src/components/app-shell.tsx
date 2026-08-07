"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChartPie,
  History,
  House,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  LogOut,
  Receipt,
  Settings,
  SquareCheckBig,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { DataProvider, useData, useIsAdmin } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { APP_VERSION } from "@/lib/version";
import { Avatar } from "./ui";
import { NotificationsBell } from "./notifications-bell";
import { TaskPanel } from "./task-panel";
import { GlobalSearch } from "./global-search";
import { AboutModal } from "./about-modal";

// admin-only sections render LAST, below a thin divider
const NAV = [
  { href: "/", label: "Home", Icon: House },
  { href: "/plan", label: "Weekly Plan", Icon: CalendarDays },
  { href: "/my-tasks", label: "My Tasks", Icon: SquareCheckBig },
  { href: "/feed", label: "Time Feed", Icon: History },
  { href: "/settings", label: "Settings", Icon: Settings },
  { href: "/clients", label: "Clients", Icon: Users, adminOnly: true },
  { href: "/reports", label: "Reports", Icon: ChartPie, adminOnly: true },
  { href: "/client-reports", label: "Client Reports", Icon: Receipt, adminOnly: true },
  { href: "/team", label: "Team", Icon: UsersRound, adminOnly: true },
];

/**
 * One sidebar entry, in both widths.
 *
 * Folded, the label becomes a tooltip that appears with NO delay — a native
 * `title` waits about a second, which is fine for a rarely-used icon and useless
 * for a nav bar you're scanning. It's rendered inside the `fixed` aside, which
 * has no overflow clipping, so it can sit outside the 64px rail.
 */
function NavItem({
  href,
  label,
  Icon,
  active,
  folded,
  badge,
  activeStyle,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  folded: boolean;
  badge?: number;
  /** the intake row paints itself aqua when something is waiting */
  activeStyle?: React.CSSProperties;
}) {
  return (
    <Link
      href={href}
      title={folded ? undefined : label}
      aria-label={label}
      className={`group/nav font-heading relative flex items-center rounded-lg py-2.5 text-sm transition-colors ${
        folded ? "justify-center px-0" : "gap-3 px-3"
      }`}
      style={
        activeStyle ??
        (active
          ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }
          : { color: "var(--sb-muted)" })
      }
      onMouseEnter={(e) => {
        if (!active && !activeStyle) e.currentTarget.style.backgroundColor = "var(--sb-hover-bg)";
      }}
      onMouseLeave={(e) => {
        if (!active && !activeStyle) e.currentTarget.style.backgroundColor = "";
      }}
    >
      <span className="relative shrink-0">
        <Icon size={20} strokeWidth={1.75} />
        {/* Folded, the count can't sit at the end of a row that no longer exists,
            so it rides the icon's corner instead of disappearing. */}
        {folded && badge != null && badge > 0 && (
          <span className="absolute -right-2 -top-1.5 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      {!folded && label}
      {!folded && badge != null && badge > 0 && (
        <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white">
          {badge}
        </span>
      )}
      {folded && (
        // no transition: the point of the tooltip is that it's already there
        <span
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium shadow-lg group-hover/nav:block"
          style={{ backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }}
          role="tooltip"
        >
          {label}
        </span>
      )}
    </Link>
  );
}

function ThemeInit() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("theme");
    const stored = localStorage.getItem("theme");
    const theme = fromUrl ?? stored;
    if (fromUrl) localStorage.setItem("theme", fromUrl);
    if (!theme) return; // keep the server-rendered default
    if (theme === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, []);
  return null;
}

/**
 * The only visible sign that data refreshes itself now: a faint dot while a
 * background fetch is in flight, and the time of the last one on hover. Small on
 * purpose — the feature's whole point is that nobody has to think about it — but
 * without it there'd be no way to tell working from broken.
 */
function SyncDot() {
  const { refreshing, lastSyncedAt, refresh } = useData();
  const when = lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "not yet";
  return (
    <button
      onClick={refresh}
      title={`Updated ${when} — click to refresh now`}
      aria-label="Refresh data"
      className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-black/5"
    >
      <span
        className={`size-1.5 rounded-full bg-brand transition-opacity ${
          refreshing ? "animate-pulse opacity-70" : "opacity-20"
        }`}
      />
    </button>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {
    profiles,
    currentUserId,
    loading,
    taskRequests,
    viewingAs,
    writeError,
    dismissWriteError,
    notice,
    dismissNotice,
    bootError,
  } = useData();
  const me = profiles.find((p) => p.id === currentUserId) ?? null;
  const isAdmin = useIsAdmin();
  const pendingIntake = taskRequests.filter((r) => r.status === "pending").length;

  // Read in an effect, never in the useState initialiser: the server renders
  // this too, and reading localStorage there is a hydration mismatch. Same
  // pattern as `theme` and the team page's layout.
  const [folded, setFolded] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  useEffect(() => {
    setFolded(localStorage.getItem("sidebar.folded") === "1");
  }, []);
  useEffect(() => {
    localStorage.setItem("sidebar.folded", folded ? "1" : "0");
  }, [folded]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <span className="brand-wordmark w-48 animate-pulse bg-brand" />
          <span className="text-sm text-muted">Loading the studio…</span>
        </div>
      </div>
    );
  }

  // The boot query failed, so there is no data — not "no tasks", no data. An
  // empty dashboard would be a claim about the studio that we can't stand
  // behind, so replace the app rather than letting every pane render zero.
  if (bootError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border bg-surface p-8 shadow-card">
          <span className="brand-wordmark w-44 bg-brand" aria-label="Studio&more" />
          <h1 className="text-lg font-semibold">The studio data couldn&apos;t be loaded</h1>
          <p className="text-sm text-muted">
            Nothing was shown rather than showing an empty studio — the figures on the page would
            all have read zero. This is usually a dropped connection.
          </p>
          <p className="rounded-lg bg-background px-3 py-2 font-mono text-[11px] text-faint">
            {bootError}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-brand py-2.5 font-semibold text-white hover:bg-brand-dark"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex flex-col border-r transition-[width] duration-150 ${
          folded ? "w-16" : "w-52"
        }`}
        style={{
          backgroundColor: "var(--sb-bg)",
          color: "var(--sb-fg)",
          borderColor: "var(--sb-border)",
        }}
      >
        {/* Folded, the wordmark becomes the ampersand alone — the studio's mark
            without the word it can no longer fit. The chevron keeps the SAME
            place in both states: immediately right of the mark, so the control
            doesn't move out from under the cursor that just used it. */}
        {/* Folded, the ampersand is CENTRED on the rail like every nav icon
            below it — a mark sitting 6px left of the column of icons it heads
            reads as a mistake. The chevron then has nowhere to go but the right
            edge, which is where it already is when expanded, so it doesn't
            move between states. */}
        <div
          className={`relative flex items-center pb-4 pt-5 ${folded ? "justify-center px-1" : "gap-2 px-4"}`}
        >
          <Link
            href="/"
            aria-label="Studio&more"
            className={`leading-none ${folded ? "text-[26px]" : "text-[28px]"}`}
            style={{ color: "var(--sb-fg)", fontWeight: 700 }}
          >
            {folded ? "&" : <>&amp;more</>}
          </Link>
          <button
            onClick={() => setFolded((f) => !f)}
            title={folded ? "Expand the menu" : "Collapse the menu"}
            aria-label={folded ? "Expand the menu" : "Collapse the menu"}
            aria-expanded={!folded}
            className={`shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100 ${
              folded ? "absolute right-0" : "ml-auto"
            }`}
            style={{ color: "var(--sb-fg)" }}
          >
            {folded ? <ChevronsRight size={14} strokeWidth={2} /> : <ChevronsLeft size={16} strokeWidth={2} />}
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-2 px-2">
          {NAV.filter((n) => !n.adminOnly).map(({ href, label, Icon }) => (
            <NavItem
              key={href}
              href={href}
              label={label}
              Icon={Icon}
              folded={folded}
              active={href === "/" ? pathname === "/" : pathname.startsWith(href)}
            />
          ))}
          {isAdmin && (
            <div
              className="mx-3 my-2 border-t"
              style={{ borderColor: "var(--sb-border)" }}
              aria-hidden
            />
          )}
          {isAdmin && (
            <NavItem
              href="/intake-queue"
              label="Intake"
              Icon={Inbox}
              folded={folded}
              badge={pendingIntake}
              active={pathname.startsWith("/intake-queue")}
              activeStyle={
                pathname.startsWith("/intake-queue")
                  ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }
                  : pendingIntake > 0
                    ? { backgroundColor: "var(--aqua)", color: "#06112f" }
                    : undefined
              }
            />
          )}
          {isAdmin &&
            NAV.filter((n) => n.adminOnly).map(({ href, label, Icon }) => (
              <NavItem
                key={href}
                href={href}
                label={label}
                Icon={Icon}
                folded={folded}
                active={href === "/" ? pathname === "/" : pathname.startsWith(href)}
              />
            ))}
        </nav>
        <div
          className={`flex items-center border-t py-3 ${folded ? "flex-col gap-2 px-2" : "gap-2.5 px-4"}`}
          style={{ borderColor: "var(--sb-border)" }}
        >
          <Avatar profile={me} size={30} />
          {!folded && (
            <div className="min-w-0 flex-1">
              <div className="font-serif-accent truncate text-[15px]">{me?.name}</div>
              <div className="text-xs capitalize" style={{ color: "var(--sb-muted)" }}>
                {me?.role}
              </div>
            </div>
          )}
          <button
            onClick={async () => {
              await createClient().auth.signOut();
              window.location.href = "/login";
            }}
            title="Sign out"
            aria-label="Sign out"
            className="shrink-0 rounded-md p-1.5 opacity-70 transition-opacity hover:opacity-100"
            style={{ color: "var(--sb-muted)" }}
          >
            <LogOut size={17} strokeWidth={1.75} />
          </button>
        </div>
        {!folded && (
          <div className="flex items-center justify-end gap-2 px-4 pb-2 text-[10px]">
            {/* The version was already here and is the natural place to ask what
                this thing is — so it opens the panel rather than sitting beside
                a second control competing for the same corner. */}
            <button
              onClick={() => setAboutOpen(true)}
              title="About the tracker"
              className="text-white/50 transition-colors hover:text-white/90 hover:underline"
            >
              About
            </button>
            <span className="text-white/30">·</span>
            <button
              onClick={() => setAboutOpen(true)}
              title="About the tracker"
              className="text-white/50 transition-colors hover:text-white/90"
            >
              {APP_VERSION}
            </button>
          </div>
        )}
      </aside>

      <div
        className={`flex min-w-0 flex-1 flex-col transition-[margin] duration-150 ${folded ? "ml-16" : "ml-52"}`}
      >
        {/* z-scale, and why the header is 30:
              sidebar 30 · header 30 · in-page sticky rows ≤20 · overlays 40/50.
            `backdrop-blur` makes this header its own stacking context, so the
            search and bell dropdowns inside it can never rise above its z-index —
            at z-20 the weekly plan's sticky `thead` (also 20, and later in the
            DOM) painted straight over the open search results. Every modal
            overlay is ≥40, so the task drawer still dims the header. */}
        <header
          className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border px-6 backdrop-blur"
          style={{ backgroundColor: "var(--header-bg)" }}
        >
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2.5">
            <SyncDot />
            {isAdmin && (
              <NotificationsBell pendingIntake={pendingIntake} />
            )}
            <Link
              href="/settings"
              title="Account & settings"
              className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-surface py-1 pl-1 pr-2.5 transition-colors hover:border-border-strong"
            >
              <Avatar profile={me} size={26} />
              <span className="text-sm font-medium">{me?.name.split(" ")[0]}</span>
            </Link>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>

      {viewingAs && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-foreground px-4 py-2 text-sm text-white shadow-lg">
          <span>
            Viewing as <b>{viewingAs}</b> — preview only
          </span>
          <button
            onClick={() => {
              localStorage.removeItem("viewAs");
              const url = new URL(window.location.href);
              url.searchParams.delete("viewAs");
              window.location.href = url.toString();
            }}
            className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-medium hover:bg-white/30"
          >
            Exit
          </button>
        </div>
      )}

      {/* Neutral, not the red write-error banner: nothing failed to save and
          reloading wouldn't help. Currently only "that undo expired". */}
      {notice && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl bg-foreground px-4 py-3 text-sm text-white shadow-lg"
        >
          <span className="flex-1">{notice}</span>
          <button
            onClick={dismissNotice}
            aria-label="Dismiss"
            className="shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium opacity-80 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {writeError && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl bg-danger px-4 py-3 text-sm text-white shadow-lg"
        >
          <span className="flex-1">{writeError}</span>
          <button
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold hover:bg-white/30"
          >
            Reload
          </button>
          <button
            onClick={dismissWriteError}
            aria-label="Dismiss"
            className="shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium opacity-80 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      <TaskPanel />
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <ThemeInit />
      <Shell>{children}</Shell>
    </DataProvider>
  );
}
