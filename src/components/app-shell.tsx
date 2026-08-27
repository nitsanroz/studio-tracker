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
  Info,
  LogOut,
  Menu,
  Plus,
  Receipt,
  Settings,
  Sparkles,
  SquareCheckBig,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { DataProvider, useData, useIsAdmin } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { useEnterTransition } from "@/lib/use-enter-transition";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { APP_VERSION } from "@/lib/version";
import type { Profile } from "@/lib/types";
import { Avatar } from "./ui";
import { NotificationsBell } from "./notifications-bell";
import { EgressBanner } from "./egress-banner";
import { TaskPanel } from "./task-panel";
import { GlobalSearch } from "./global-search";
import { AboutModal } from "./about-modal";
import { MobileLogTimeSheet } from "./mobile-log-time";
import { DesktopOnlyCard, desktopOnlyEntry } from "./desktop-only";
import { WhatsNewModal } from "./whats-new-modal";

// admin-only sections render LAST, below a thin divider.
//
/** ⚠️ Must equal the CSS duration on the drawer below — the `PANE_MS` rule. */
const DRAWER_MS = 200;

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
  // `mobile: true` since v1.14.0 — `client-mobile.tsx` gives both /clients and
  // /clients/[id] a phone build (task list only; no Timeline or Board).
  { href: "/clients", label: "Clients", Icon: Users, adminOnly: true, mobile: true },
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
  intakeBadge,
  onMenu,
  onLogTime,
}: {
  pathname: string;
  isAdmin: boolean;
  /** Everything waiting in the queue: new submissions PLUS unread client edits. */
  intakeBadge: number;
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
      {/* ⚠️ An ADMIN gets Clients in this slot, not My Tasks. The bar has room
          for two routes beside the ✚ and the menu, and they should be the two
          you open most: an admin runs the studio's work through the client
          pages, while their own task list is a smaller part of the day. A
          designer, who has no /clients at all, keeps Tasks here. Whichever one
          loses the slot is still one tap away in the drawer, which lists every
          route. */}
      {isAdmin ? (
        <BarLink
          href="/clients"
          label="Clients"
          Icon={Users}
          active={pathname.startsWith("/clients")}
        />
      ) : (
        <BarLink
          href="/my-tasks"
          label="Tasks"
          Icon={SquareCheckBig}
          active={pathname.startsWith("/my-tasks")}
        />
      )}
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
          badge={intakeBadge}
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

/**
 * A textual row at the foot of the sidebar or the drawer — About, Latest
 * updates, Logout. One component for all five, because they differ only in
 * icon, word and handler.
 *
 * `folded` is the desktop rail collapsed to 64px: no room for words, so it
 * falls back to the icon with the label as a tooltip — the same trade
 * `NavItem` makes. The drawer never folds and just omits the prop.
 */
function FootLink({
  Icon,
  label,
  title,
  folded = false,
  onClick,
}: {
  Icon: LucideIcon;
  label: string;
  /** longer hover text, when the label alone is too terse */
  title?: string;
  folded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className={`flex items-center rounded-lg text-[13px] transition-colors hover:bg-white/10 ${
        folded ? "size-9 min-h-9 justify-center" : "min-h-11 gap-2.5 px-2 text-left"
      }`}
      style={{ color: "var(--sb-muted)" }}
    >
      <Icon size={17} strokeWidth={1.75} className="shrink-0" />
      {!folded && label}
    </button>
  );
}

/** Ends the session and returns to the login screen. */
async function signOut() {
  await createClient().auth.signOut();
  window.location.href = "/login";
}

function MobileDrawer({
  pathname,
  isAdmin,
  me,
  intakeBadge,
  onClose,
  onAbout,
  onNews,
}: {
  pathname: string;
  isAdmin: boolean;
  me: Profile | null;
  /** New submissions PLUS unread client edits — see AppShell. */
  intakeBadge: number;
  onClose: () => void;
  onAbout: () => void;
  onNews: () => void;
}) {
  const items = NAV.filter((n) => n.mobile && (!n.adminOnly || isAdmin));
  // Mounts closed, opens one frame later — see `useEnterTransition`.
  const entered = useEnterTransition(true);
  return (
    <>
      {/* ⚠️ ENTER ONLY, AND THAT IS A JUDGEMENT RATHER THAN A SHORTCUT. Nearly
          every dismissal of this drawer comes WITH a navigation — AppShell closes
          it on a pathname change, so the page underneath is being replaced at the
          same moment. Sliding a menu out over a page that is itself changing
          reads as two things fighting; the sheet gets a real exit because it
          closes onto the SAME page, where an instant vanish is what looks wrong.
          ⚠️ `transform`/`opacity` only — the drawer holds the whole nav list. */}
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        style={{
          opacity: entered ? 1 : 0,
          transition: `opacity ${DRAWER_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        }}
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col md:hidden"
        style={{
          backgroundColor: "var(--sb-bg)",
          color: "var(--sb-fg)",
          transform: entered ? "none" : "translateX(-100%)",
          transition: `transform ${DRAWER_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        }}
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
                // 16px, not 14: the drawer is a full-screen menu with room to
                // spare, and these are its primary targets. They were set at the
                // desktop sidebar's size, which is a 208px rail — a different
                // problem. The secondary rows below (About, Latest updates) stay
                // at 13px, so the hierarchy is clearer than when both were `sm`.
                className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-base"
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
              className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-base"
              style={
                pathname.startsWith("/intake-queue")
                  ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }
                  : { color: "var(--sb-muted)" }
              }
            >
              <Inbox size={20} strokeWidth={1.75} />
              Intake
              {intakeBadge > 0 && (
                <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white">
                  {intakeBadge}
                </span>
              )}
            </Link>
          )}
        </nav>

        {/* The same two textual rows the desktop sidebar has, in the same order
            and with the same icons — a phone and a laptop shouldn't disagree
            about what these are called or where they sit. (Logout is NOT
            repeated here: on a phone it is the icon beside the name BELOW,
            which is also the only place a phone names who is signed in.)

            Both close the drawer first, or the panel they open appears behind
            it. The version keeps its own quiet line and opens About too — it is
            what people click when they want to know which build this is. */}
        <div className="flex flex-col px-2 pb-1">
          <FootLink
            Icon={Info}
            label="About"
            title="About the tracker"
            onClick={() => {
              onClose();
              onAbout();
            }}
          />
          <FootLink
            Icon={Sparkles}
            label="Latest updates"
            onClick={() => {
              onClose();
              onNews();
            }}
          />
        </div>
        <button
          onClick={() => {
            onClose();
            onAbout();
          }}
          // Right-aligned and a step up in size: it is the only thing on its
          // line, so left-aligned at 11px it read as a stray label under the
          // links rather than as the build stamp the panel below it explains.
          className="px-4 pb-3 text-right text-[13px]"
          style={{ color: "var(--sb-muted)" }}
        >
          {APP_VERSION}
        </button>

        {/* ⚠️ LAST, below the links, and the account block STAYS on a phone even
            though the desktop sidebar dropped it. Desktop could drop it because
            the header names you top-right; a 375px header has room for the
            wordmark, the sync dot and the bell and nothing else, so removing it
            here would leave a phone naming the signed-in person nowhere at all
            — and with no way to sign out. Sitting lowest, it reads as the base
            of the drawer rather than as an item in the list above it. */}
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
            onClick={signOut}
            aria-label="Sign out"
            className="shrink-0 rounded-md p-2 opacity-70"
            style={{ color: "var(--sb-muted)" }}
          >
            <LogOut size={18} strokeWidth={1.75} />
          </button>
        </div>
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
    updatedRequests,
    viewingAs,
    writeError,
    serviceBlocked,
    dismissWriteError,
    notice,
    dismissNotice,
    bootError,
  } = useData();
  const me = profiles.find((p) => p.id === currentUserId) ?? null;
  const isAdmin = useIsAdmin();
  const pendingIntake = taskRequests.filter((r) => r.status === "pending").length;
  /**
   * ⚠️ Counted across EVERY status, unlike `pendingIntake`. A client can revise a
   * brief that is already an approved task (0030), and that revision is exactly
   * the one that must not go unnoticed — the studio may have drawn from the old
   * words already. The store stops counting one once an admin has read the
   * changes, so the badge means "unread", not "ever edited".
   */
  const updatedIntake = updatedRequests.length;

  // Read in an effect, never in the useState initialiser: the server renders
  // this too, and reading localStorage there is a hydration mismatch. Same
  // pattern as `theme` and the team page's layout.
  const [folded, setFolded] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Set by the sidebar's "Latest updates"; the modal clears it once it has read
  // it, so the link works a second time.
  const [newsOpen, setNewsOpen] = useState(false);
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
          <h1 className="text-lg font-semibold">
            {serviceBlocked
              ? "The studio has hit its database usage limit"
              : "The studio data couldn't be loaded"}
          </h1>
          {/*
            ⚠️ The default copy blames a dropped connection, which for a 402
            would send someone to check their wifi for an hour. This screen
            returns BEFORE the serviceBlocked banner further down ever renders,
            so the boot path has to say the true thing itself.
          */}
          <p className="text-sm text-muted">
            {serviceBlocked ? (
              <>
                Supabase has paused the project because the organization is over its monthly
                allowance, so every request is being refused. Retrying won&apos;t help until the
                plan&apos;s usage is raised — and the public client report links are down too.
              </>
            ) : (
              <>
                Nothing was shown rather than showing an empty studio — the figures on the page
                would all have read zero. This is usually a dropped connection.
              </>
            )}
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
              badge={pendingIntake + updatedIntake}
              active={pathname.startsWith("/intake-queue")}
              activeStyle={
                pathname.startsWith("/intake-queue")
                  ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }
                  // ⚠️ The aqua highlight fires for an unread client EDIT too, not
                  // only for a new submission — a revision of an approved brief is
                  // not pending, so the old test would have left the nav silent on
                  // exactly the case that most needs a look.
                  : pendingIntake + updatedIntake > 0
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
        {/* ⚠️ No avatar, no name, no role. Nitsan's note: the signed-in person is
            already named in the header's top-right menu, and repeating them at
            the foot of every screen spent 60px of sidebar restating something
            nobody was in doubt about. What's left is the two things you'd
            actually come down here to DO.

            Folded (w-16) has no room for words, so both fall back to their
            icons with the label as a tooltip — the same trade `NavItem` makes. */}
        {/* No rule above it. The nav ends where the list of items ends, and
            these three read as three more items in the same column — a divider
            was drawing a boundary between things that don't need separating. */}
        <div
          className={`flex py-2 ${folded ? "flex-col items-center gap-1 px-2" : "flex-col px-2"}`}
        >
          <FootLink Icon={Info} label="About" title="About the tracker" folded={folded} onClick={() => setAboutOpen(true)} />
          <FootLink Icon={Sparkles} label="Latest updates" folded={folded} onClick={() => setNewsOpen(true)} />
          <FootLink Icon={LogOut} label="Logout" folded={folded} onClick={signOut} />
        </div>
        {!folded && (
          <div className="flex items-center justify-end gap-2 px-4 pb-2 text-[10px]">
            {/* "About" used to be a word here too. It has moved up into the
                footer block with Latest updates and Logout, so what's left is
                the version stamp — which still opens the same panel, because
                the version number is the thing people click when they want to
                know what this build is. */}
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
              <NotificationsBell pendingIntake={pendingIntake} updatedIntake={updatedIntake} />
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
        intakeBadge={pendingIntake + updatedIntake}
        onMenu={() => setDrawerOpen(true)}
        onLogTime={() => setLogTimeOpen(true)}
      />
      {drawerOpen && (
        <MobileDrawer
          pathname={pathname}
          isAdmin={isAdmin}
          me={me}
          intakeBadge={pendingIntake + updatedIntake}
          onClose={() => setDrawerOpen(false)}
          onAbout={() => setAboutOpen(true)}
          onNews={() => setNewsOpen(true)}
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
          className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl bg-foreground px-4 py-3 text-sm text-white shadow-lg notice-in"
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

      {/*
        Supabase has cut the project off over its usage quota — every request is
        a 402. Unlike the toasts below this is NOT dismissible and NOT a reload
        prompt: reloading cannot fix it, and the whole reason it exists is that
        the condition is otherwise INVISIBLE. A background refresh failing is
        deliberately silent (normally it's a dropped connection), so without this
        an open tab shows stale figures indefinitely and the next person to
        notice is a client opening a broken report link.

        Placed bottom-center and lifted clear of the phone's bottom nav rather
        than as a bar at the top of the page: the app header is `sticky top-0`
        and the client page pins its own header at `top-14`, so anything that
        pushes the layout down would knock that alignment out — see the z-index
        and sticky table in client-view.tsx.
      */}
      {/* ⚠️ ABOVE the serviceBlocked banner in the DOM but they never both show:
          serviceBlocked means the quota already ran out, at which point a "you are
          at 95%" warning is history. Both sit bottom-centre, lifted clear of the
          phone's bottom nav, for the reason documented just above. */}
      <EgressBanner />

      {serviceBlocked && (
        <div
          role="alert"
          className="fixed bottom-20 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 flex-col gap-1 rounded-xl bg-danger px-4 py-3 text-sm text-white shadow-lg md:bottom-4"
        >
          <span className="font-semibold">
            The studio can&apos;t reach its database — it has hit its monthly usage limit.
          </span>
          <span className="text-white/85">
            What you see may be out of date, and saving will fail. Public client report links are
            down too. Nothing you did caused this and reloading won&apos;t fix it.
            {isAdmin ? " Usage has to be raised on the Supabase plan." : " Let an admin know."}
          </span>
          {isAdmin && (
            <a
              href="https://supabase.com/dashboard/org/fhybmalkjzbwypracsmx/usage"
              target="_blank"
              rel="noreferrer"
              className="mt-1 self-start rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold hover:bg-white/30"
            >
              Check usage &amp; billing →
            </a>
          )}
        </div>
      )}

      {writeError && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl bg-danger px-4 py-3 text-sm text-white shadow-lg notice-in"
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
      <WhatsNewModal
        suppressed={pathname.startsWith("/welcome")}
        requestedOpen={newsOpen}
        onRequestHandled={() => setNewsOpen(false)}
      />
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
