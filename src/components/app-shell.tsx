"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChartPie,
  History,
  House,
  Inbox,
  LogOut,
  Receipt,
  Settings,
  SquareCheckBig,
  Users,
  UsersRound,
} from "lucide-react";
import { DataProvider, useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { APP_VERSION } from "@/lib/version";
import { Avatar } from "./ui";
import { NotificationsBell } from "./notifications-bell";
import { TaskPanel } from "./task-panel";
import { GlobalSearch } from "./global-search";

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

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {
    profiles,
    currentUserId,
    loading,
    taskRequests,
    openSyncIssues,
    viewingAs,
    writeError,
    dismissWriteError,
  } = useData();
  const me = profiles.find((p) => p.id === currentUserId) ?? null;
  const isAdmin = me?.role === "admin";
  const pendingIntake = taskRequests.filter((r) => r.status === "pending").length;

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

  return (
    <div className="flex min-h-screen">
      <aside
        className="fixed inset-y-0 left-0 z-30 flex w-52 flex-col border-r"
        style={{
          backgroundColor: "var(--sb-bg)",
          color: "var(--sb-fg)",
          borderColor: "var(--sb-border)",
        }}
      >
        <div className="px-4 pb-5 pt-6">
          <Link
            href="/"
            aria-label="Studio&more"
            className="text-[28px] leading-none"
            style={{ color: "var(--sb-fg)", fontWeight: 700 }}
          >
            &amp;more
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-2 px-2">
          {NAV.filter((n) => !n.adminOnly).map(({ href, label, Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="font-heading flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
                style={
                  active
                    ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }
                    : { color: "var(--sb-muted)" }
                }
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.backgroundColor = "var(--sb-hover-bg)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.backgroundColor = "";
                }}
              >
                <Icon size={20} strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
          {isAdmin && (
            <div
              className="mx-3 my-2 border-t"
              style={{ borderColor: "var(--sb-border)" }}
              aria-hidden
            />
          )}
          {isAdmin && (
            <Link
              href="/intake-queue"
              className="font-heading flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
              style={
                pathname.startsWith("/intake-queue")
                  ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }
                  : pendingIntake > 0
                    ? { backgroundColor: "var(--aqua)", color: "#06112f" }
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
          {isAdmin && (
            <Link
              href="/sync-issues"
              className="font-heading flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
              style={
                pathname.startsWith("/sync-issues")
                  ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }
                  : { color: "var(--sb-muted)" }
              }
            >
              <AlertTriangle size={20} strokeWidth={1.75} />
              Sync issues
              {openSyncIssues > 0 && (
                <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white">
                  {openSyncIssues}
                </span>
              )}
            </Link>
          )}
          {NAV.filter((n) => n.adminOnly).map(({ href, label, Icon }) => {
            if (!isAdmin) return null;
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className="font-heading flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors"
                style={
                  active
                    ? { backgroundColor: "var(--sb-active-bg)", color: "var(--sb-active-fg)" }
                    : { color: "var(--sb-muted)" }
                }
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.backgroundColor = "var(--sb-hover-bg)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.backgroundColor = "";
                }}
              >
                <Icon size={20} strokeWidth={1.75} />
                {label}
              </Link>
            );
          })}
        </nav>
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
            title="Sign out"
            className="shrink-0 rounded-md p-1.5 opacity-70 transition-opacity hover:opacity-100"
            style={{ color: "var(--sb-muted)" }}
          >
            <LogOut size={17} strokeWidth={1.75} />
          </button>
        </div>
        <div className="px-4 pb-2 text-right text-[10px] text-white/50">{APP_VERSION}</div>
      </aside>

      <div className="ml-52 flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border px-6 backdrop-blur"
          style={{ backgroundColor: "var(--header-bg)" }}
        >
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2.5">
            {isAdmin && (
              <NotificationsBell
                pendingIntake={pendingIntake}
                openSyncIssues={openSyncIssues}
              />
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
