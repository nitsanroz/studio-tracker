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
  Menu,
  Plus,
  Receipt,
  Settings,
  SquareCheckBig,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { DataProvider, useData, useIsAdmin } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { APP_VERSION } from "@/lib/version";
import type { Profile } from "@/lib/types";
import { Avatar } from "./ui";
import { NotificationsBell } from "./notifications-bell";
import { TaskPanel } from "./task-panel";
import { GlobalSearch } from "./global-search";
import { AboutModal } from "./about-modal";
import { MobileLogTimeSheet } from "./mobile-log-time";
import { DesktopOnlyCard, desktopOnlyEntry } from "./desktop-only";
import { WhatsNewModal } from "./whats-new-modal";

// admin-only sections render LAST, below a thin divider.
//
// `mobile: false` keeps a route out of the phone drawer. It is not a permission
// and it is not a redirect — the route still exists and still resolves; it just
// isn't offered where it can't be used. Every one of these has a matching entry
// in `desktop-only.tsx`, which is what a pasted link lands on. KEEP THE TWO
// LISTS IN AGREEMENT: hidden here with no entry there means a phone renders the
// real, broken page.
const NAV = [
  { href: "/", label: "Home", Icon: House, mobile: true },
  { href: "/plan", label: "Weekly Plan", Icon: CalendarDays, mobile: false },
  { href: "/my-tasks", label: "My Tasks", Icon: SquareCheckBig, mobile: true },
  { href: "/feed", label: "Time Feed", Icon: History, mobile: false },
  { href: "/settings", label: "Settings", Icon: Settings, mobile: true },
  { href: "/clients", label: "Clients", Icon: Users, adminOnly: true, mobile: false },
  { href: "/reports", label: "Reports", Icon: ChartPie, adminOnly: true, mobile: false },
  {
    href: "/client-reports",
    label: "Client Reports",
    Icon: Receipt,
    adminOnly: true,
    mobile: false,
  },
  { href: "/team", label: "Team", Icon: UsersRound, adminOnly: true, mobile: true },
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

/* ── Mobile chrome ──────────────────────────────────────────────────────────
   Two patterns, doing different jobs. A bottom bar alone can't hold nine nav
   items; a drawer alone buries "log time" — the single most frequent phone
   action in this app — two taps deep. So the bar carries the handful of things
   done daily and the drawer carries the rest.

   Both are `md:hidden` and the sidebar is `hidden md:flex`, so the two never
   coexist and nothing above 768px is touched. */

const BAR_ITEM =
  "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium";

function BarLink({
  href,
  label,
  Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={BAR_ITEM}
      // ⚠️ NOT `--sb-active-fg`. That token is the ink for text sitting ON
      // `--sb-active-bg` (the white pill the sidebar draws behind a selected
      // row) — and under `electric` it is #0b43ed, the exact blue of `--sb-bg`.
      // Used flat on the bar it painted the active item blue-on-blue and the
      // whole slot vanished. On a bar with no pill the pair that always works is
      // full-strength ink vs muted: `--sb-fg` is by definition legible on
      // `--sb-bg` in all four themes, which is the property needed here.
      style={{ color: active ? "var(--sb-fg)" : "var(--sb-muted)" }}
    >
      <span className="relative">
        <Icon size={21} strokeWidth={1.75} />
        {badge != null && badge > 0 && (
          <span className="absolute -right-2 -top-1 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white">
            {badge}
          </span>
        )}
      </span>
      {label}
    </Link>
  );
}

function MobileBar({
  pathname,
  isAdmin,
  pendingIntake,
  onMenu,
  onLogTime,
}: {
  pathname: string;
  isAdmin: boolean;
  pendingIntake: number;
  onMenu: () => void;
  onLogTime: () => void;
}) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t pb-[env(safe-area-inset-bottom)] md:hidden"
      style={{ backgroundColor: "var(--sb-bg)", borderColor: "var(--sb-border)" }}
    >
      <BarLink href="/" label="Home" Icon={House} active={pathname === "/"} />
      <BarLink
        href="/my-tasks"
        label="Tasks"
        Icon={SquareCheckBig}
        active={pathname.startsWith("/my-tasks")}
      />
      {/* An ACTION, not a route — the middle slot is the reason this bar exists
          rather than a drawer. It opens the log-time sheet wherever you are. */}
      <button onClick={onLogTime} aria-label="Log time" className={BAR_ITEM}>
        <span
          className="flex size-9 items-center justify-center rounded-full"
          style={{ backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }}
        >
          <Plus size={20} strokeWidth={2.25} />
        </span>
      </button>
      {isAdmin && (
        <BarLink
          href="/intake-queue"
          label="Inbox"
          Icon={Inbox}
          active={pathname.startsWith("/intake-queue")}
          badge={pendingIntake}
        />
      )}
      <button
        onClick={onMenu}
        aria-label="Open menu"
        className={BAR_ITEM}
        style={{ color: "var(--sb-muted)" }}
      >
        <Menu size={21} strokeWidth={1.75} />
        Menu
      </button>
    </nav>
  );
}

function MobileDrawer({
  pathname,
  isAdmin,
  me,
  pendingIntake,
  onClose,
  onAbout,
}: {
  pathname: string;
  isAdmin: boolean;
  me: Profile | null;
  pendingIntake: number;
  onClose: () => void;
  onAbout: () => void;
}) {
  const items = NAV.filter((n) => n.mobile && (!n.adminOnly || isAdmin));
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col md:hidden"
        style={{ backgroundColor: "var(--sb-bg)", color: "var(--sb-fg)" }}
      >
        <div className="flex items-center px-4 pb-3 pt-5">
          <span className="text-[26px] leading-none" style={{ fontWeight: 700 }}>
            &amp;more
          </span>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="ml-auto rounded-md p-1.5 opacity-70"
            style={{ color: "var(--sb-fg)" }}
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
          {items.map(({ href, label, Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm"
                style={
                  active
                    ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }
                    : { color: "var(--sb-muted)" }
                }
              >
                <Icon size={20} strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              href="/intake-queue"
              onClick={onClose}
              className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm"
              style={
                pathname.startsWith("/intake-queue")
                  ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }
                  : { color: "var(--sb-muted)" }
              }
            >
              <Inbox size={20} strokeWidth={1.75} />
              Intake
              {pendingIntake > 0 && (
                <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white">
                  {pendingIntake}
                </span>
              )}
            </Link>
          )}
        </nav>

        {/* The account block the desktop sidebar keeps at its foot. It is here
            rather than in the header because a 375px header has room for the
            wordmark, the sync dot and the bell, and nothing else. */}
        <div
          className="flex items-center gap-2.5 border-t px-4 py-3"
          style={{ borderColor: "var(--sb-border)" }}
        >
          <Avatar profile={me} size={30} />
          <div className="min-w-0 flex-1">
            <div className="font-serif-accent truncate text-[15px]">{me?.name}</div>
            <div className="text-xs capitalize" style={{ color: "var(--sb-muted)" }}>
              {me?.role}
            </div>
          </div>
          <button
            onClick={async () => {
              await createClient().auth.signOut();
              window.location.href = "/login";
            }}
            aria-label="Sign out"
            className="shrink-0 rounded-md p-2 opacity-70"
            style={{ color: "var(--sb-muted)" }}
          >
            <LogOut size={18} strokeWidth={1.75} />
          </button>
        </div>
        <button
          onClick={() => {
            onClose();
            onAbout();
          }}
          className="px-4 pb-3 text-left text-[11px]"
          style={{ color: "var(--sb-muted)" }}
        >
          About · {APP_VERSION}
        </button>
      </div>
    </>
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const isNarrow = useIsNarrow();
  useEffect(() => {
    setFolded(localStorage.getItem("sidebar.folded") === "1");
  }, []);
  useEffect(() => {
    localStorage.setItem("sidebar.folded", folded ? "1" : "0");
  }, [folded]);

  // A drawer that survives navigation would cover the page it just opened.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // ⚠️ JS, not `md:hidden`, and the comment in `use-is-narrow.ts` says why: these
  // pages are 700–2,300 lines and the client one mounts a Gantt. Rendering that
  // to hide it with CSS would cost the render anyway AND let its 1,846px grid
  // widen the document before the class took effect.
  const blocked = isNarrow ? desktopOnlyEntry(pathname) : null;

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
      {/* `hidden md:flex` — below 768px this rail would eat 52% of the screen
          with no way to dismiss it (it folds only by a manual chevron, and that
          state is remembered, so a phone could load straight into it). The
          bottom bar and drawer take over there. */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r transition-[width] duration-150 md:flex ${
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

      {/* ⚠️ The margin is `md:`-prefixed on BOTH branches. Unprefixed it would
          still indent the content by the width of a sidebar that isn't there. */}
      <div
        className={`flex min-w-0 flex-1 flex-col transition-[margin] duration-150 ${folded ? "md:ml-16" : "md:ml-52"}`}
      >
        {/* z-scale, and why the header is 30:
              sidebar 30 · header 30 · in-page sticky rows ≤20 · overlays 40/50.
            `backdrop-blur` makes this header its own stacking context, so the
            search and bell dropdowns inside it can never rise above its z-index —
            at z-20 the weekly plan's sticky `thead` (also 20, and later in the
            DOM) painted straight over the open search results. Every modal
            overlay is ≥40, so the task drawer still dims the header. */}
        <header
          className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border px-4 backdrop-blur md:px-6"
          style={{ backgroundColor: "var(--header-bg)" }}
        >
          {/* Below md the sidebar is gone, so the header carries the wordmark —
              otherwise nothing on a phone says which app this is or gets you
              home from a page whose own title has scrolled away.
              ⚠️ `text-brand`, not the inherited foreground: on a phone this is
              the ONLY place the mark appears, and the mark is brand blue. It
              read as Studio Black here because nothing set a colour. */}
          <Link href="/" aria-label="Studio&more" className="text-[22px] leading-none text-brand md:hidden">
            <span style={{ fontWeight: 700 }}>&amp;more</span>
          </Link>
          {/* Global search is desktop-only for now: it wants ~400px and a 375px
              header already holds the wordmark, the sync dot and the bell. The
              log-time sheet has its own task search, which is what the phone
              scope actually needs. Worth revisiting if finding a task by name
              turns out to be a thing people do on the move. */}
          <div className="hidden min-w-0 flex-1 md:block">
            <GlobalSearch />
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <SyncDot />
            {isAdmin && (
              <NotificationsBell pendingIntake={pendingIntake} />
            )}
            {/* The account chip moves into the drawer below md — see MobileDrawer. */}
            <Link
              href="/settings"
              title="Account & settings"
              className="hidden shrink-0 items-center gap-2 rounded-lg border border-border bg-surface py-1 pl-1 pr-2.5 transition-colors hover:border-border-strong md:flex"
            >
              <Avatar profile={me} size={26} />
              <span className="text-sm font-medium">{me?.name.split(" ")[0]}</span>
            </Link>
          </div>
        </header>
        {/* The bottom bar is `fixed`, so it covers whatever the page ends with
            unless the page reserves its height. 3.5rem is the bar; the inset is
            the home indicator; the extra 1rem keeps the last row off the edge. */}
        <main className="min-w-0 flex-1 p-4 pb-[calc(3.5rem+env(safe-area-inset-bottom)+1rem)] md:p-6 md:pb-6">
          {blocked ? <DesktopOnlyCard entry={blocked} /> : children}
        </main>
      </div>

      <MobileBar
        pathname={pathname}
        isAdmin={isAdmin}
        pendingIntake={pendingIntake}
        onMenu={() => setDrawerOpen(true)}
        onLogTime={() => setLogTimeOpen(true)}
      />
      {drawerOpen && (
        <MobileDrawer
          pathname={pathname}
          isAdmin={isAdmin}
          me={me}
          pendingIntake={pendingIntake}
          onClose={() => setDrawerOpen(false)}
          onAbout={() => setAboutOpen(true)}
        />
      )}
      {logTimeOpen && <MobileLogTimeSheet onClose={() => setLogTimeOpen(false)} />}

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
      {/* ⚠️ Suppressed on /welcome. That page IS somebody's first sign-in — it
          asks them to confirm their details and set a photo — and opening
          "v1.12.0 is out" over the top of it announces a change to someone who
          has never seen the thing it changed. It waits for their next visit. */}
      <WhatsNewModal suppressed={pathname.startsWith("/welcome")} />
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
