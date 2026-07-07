"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import {
  CalendarDays,
  ChartPie,
  History,
  Inbox,
  LogOut,
  Settings,
  SquareCheckBig,
  Users,
} from "lucide-react";
import { DataProvider, useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./ui";
import { TimerWidget } from "./timer-widget";
import { TaskPanel } from "./task-panel";
import { GlobalSearch } from "./global-search";

const NAV = [
  { href: "/", label: "Weekly Plan", Icon: CalendarDays },
  { href: "/my-tasks", label: "My Tasks", Icon: SquareCheckBig },
  { href: "/clients", label: "Clients", Icon: Users },
  { href: "/feed", label: "Time Feed", Icon: History },
  { href: "/reports", label: "Reports", Icon: ChartPie },
  { href: "/settings", label: "Settings", Icon: Settings },
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
  const { profiles, currentUserId, loading, taskRequests } = useData();
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
        <div className="px-4 pb-4 pt-6">
          <Link href="/" aria-label="Studio&more">
            <span
              className="brand-wordmark w-36"
              style={{ backgroundColor: "var(--sb-fg)" }}
            />
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
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
          {NAV.map(({ href, label, Icon }) => {
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
            <div className="truncate text-sm font-medium">{me?.name}</div>
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
      </aside>

      <div className="ml-52 flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-20 flex h-14 items-center justify-end gap-3 border-b border-border px-6 backdrop-blur"
          style={{ backgroundColor: "var(--header-bg)" }}
        >
          <GlobalSearch />
          {isAdmin && pendingIntake > 0 && !pathname.startsWith("/intake-queue") && (
            <Link
              href="/intake-queue"
              className="flex shrink-0 items-center gap-2 rounded-full bg-aqua px-3 py-1.5 text-sm font-semibold text-[#06112f] hover:brightness-95"
            >
              <Inbox size={15} strokeWidth={2} />
              {pendingIntake} to review →
            </Link>
          )}
          <TimerWidget />
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>

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
