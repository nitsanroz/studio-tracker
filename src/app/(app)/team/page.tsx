"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus, X } from "lucide-react";
import { useData } from "@/lib/store";
import { presetRange } from "@/lib/date-ranges";
import { toISODate } from "@/lib/format";
import { formatHoursShort } from "@/lib/format";
import { Avatar } from "@/components/ui";
import { SplitBar } from "@/components/charts";

// ── time scope ──────────────────────────────────────────────────────────────

const SCOPES = ["This week", "This month", "This quarter", "This year", "All time"] as const;
type Scope = (typeof SCOPES)[number];

/** Inclusive ISO range for a scope; null = all time (no filtering). */
function scopeRange(scope: Scope): { from: string; to: string } | null {
  switch (scope) {
    case "This week":
    case "This month":
    case "This year":
      return presetRange(scope);
    case "This quarter": {
      const now = new Date();
      const q = Math.floor(now.getMonth() / 3);
      return {
        from: toISODate(new Date(now.getFullYear(), q * 3, 1)),
        to: toISODate(new Date(now.getFullYear(), q * 3 + 3, 0)),
      };
    }
    case "All time":
      return null;
  }
}

/** "2y 4m" since a start date. */
function tenureShort(startIso: string): string {
  const start = new Date(startIso);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months -= 1;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}y ${m}m` : `${m}m`;
}

// ── add user modal ──────────────────────────────────────────────────────────

function AddUserModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ email: "", name: "", role: "designer" });
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setStatus(body.error ?? "Failed");
      return;
    }
    setStatus(
      `${form.name} added ✓ — they set their password via "Forgot password" on the login page (reload to see them).`,
    );
    setForm({ email: "", name: "", role: "designer" });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <form
        onSubmit={submit}
        className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-heading text-sm">Add user</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-1.5 text-muted hover:bg-background"
          >
            <X size={16} />
          </button>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Name
          <input
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="rounded-md border border-border-strong px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Email
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="rounded-md border border-border-strong px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Role
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            className="rounded-md border border-border-strong px-2 py-1.5 text-sm text-foreground"
          >
            <option value="designer">designer</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button
          disabled={busy}
          className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? "Adding…" : "+ Add user"}
        </button>
        {status && <p className="text-xs text-muted">{status}</p>}
      </form>
    </>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default function TeamPage() {
  const { profiles, tasks, entrySums, currentUserId } = useData();
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [scope, setScope] = useState<Scope>("This month");
  const [addOpen, setAddOpen] = useState(false);

  const range = useMemo(() => scopeRange(scope), [scope]);

  const statsByUser = useMemo(() => {
    const billableTaskIds = new Set(tasks.filter((t) => t.billable).map((t) => t.id));
    const map = new Map<string, { total: number; billable: number }>();
    for (const e of entrySums) {
      if (range && (e.date < range.from || e.date > range.to)) continue;
      const row = map.get(e.userId) ?? { total: 0, billable: 0 };
      row.total += e.minutes;
      if (billableTaskIds.has(e.taskId)) row.billable += e.minutes;
      map.set(e.userId, row);
    }
    return map;
  }, [entrySums, tasks, range]);

  const activeMembers = useMemo(() => profiles.filter((p) => p.active), [profiles]);

  const teamStats = useMemo(() => {
    // aggregate over active members only, so the row matches the panel below
    let total = 0;
    let billable = 0;
    for (const p of activeMembers) {
      const s = statsByUser.get(p.id);
      if (!s) continue;
      total += s.total;
      billable += s.billable;
    }
    return {
      total,
      billablePct: total > 0 ? Math.round((billable / total) * 100) : null,
      activeCount: activeMembers.length,
      avgPerMember: activeMembers.length > 0 ? total / activeMembers.length : 0,
    };
  }, [statsByUser, activeMembers]);

  const byUser = useMemo(
    () =>
      activeMembers
        .map((p) => ({ profile: p, ...(statsByUser.get(p.id) ?? { total: 0, billable: 0 }) }))
        .filter((r) => r.total > 0)
        .sort((a, b) => b.total - a.total),
    [activeMembers, statsByUser],
  );
  const maxUserTotal = byUser[0]?.total ?? 0;

  if (!isAdmin) {
    return <p className="text-sm text-muted">This page is for admins only.</p>;
  }

  const team = profiles
    .filter((p) => showDeactivated || p.active)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <div className="flex max-w-[1500px] flex-col gap-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl">Team</h1>
          <p className="text-sm text-muted">Open a member for details, graphs, and HR fields.</p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={showDeactivated}
            onChange={(e) => setShowDeactivated(e.target.checked)}
          />
          Show deactivated
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {SCOPES.map((s) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                scope === s
                  ? "border-brand bg-brand-soft text-brand-dark"
                  : "border-border bg-surface text-muted hover:border-border-strong"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          <Plus size={15} /> Add user
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`Hours · ${scope.toLowerCase()}`} value={formatHoursShort(teamStats.total)} />
        <Stat
          label="Billable share"
          value={teamStats.billablePct == null ? "–" : `${teamStats.billablePct}%`}
        />
        <Stat label="Active members" value={String(teamStats.activeCount)} />
        <Stat label="Avg hours / member" value={formatHoursShort(teamStats.avgPerMember)} />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border bg-background px-3 py-2 text-xs font-medium uppercase tracking-wide text-faint">
          <span className="min-w-0 flex-1" title="Open a member for details, graphs and HR fields">
            Member
          </span>
          <span className="w-24 shrink-0" title="Time since the member's start date">
            In studio
          </span>
          <span className="w-20 shrink-0 text-right" title={`Hours logged ${scope.toLowerCase()}`}>
            {scope}
          </span>
          <span className="w-40 shrink-0" title="Billable (blue) vs non-billable (grey) hours in the scope">
            Billable / non-bill.
          </span>
          <span className="w-20 shrink-0 text-right" title="Share of the member's hours on billable tasks">
            Billable
          </span>
          <span className="w-6 shrink-0" />
        </div>
        {team.map((p) => {
          const s = statsByUser.get(p.id);
          const pct = s && s.total > 0 ? Math.round((s.billable / s.total) * 100) : null;
          return (
            <Link
              key={p.id}
              href={`/team/${p.id}`}
              className={`flex items-center gap-3 border-b border-border px-3 py-2.5 transition-colors last:border-b-0 hover:bg-background ${p.active ? "" : "opacity-60"}`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <Avatar profile={p} size={32} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className="block text-xs capitalize text-faint">
                    {p.role}
                    {!p.active && " · deactivated"}
                  </span>
                </span>
              </span>
              <span className="w-24 shrink-0 text-xs tabular-nums text-muted">
                {p.startDate ? tenureShort(p.startDate) : "–"}
              </span>
              <span className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">
                {s?.total ? formatHoursShort(s.total) : "–"}
              </span>
              <span className="w-40 shrink-0">
                {s && s.total > 0 ? (
                  <SplitBar billable={s.billable} nonBillable={s.total - s.billable} maxMinutes={maxUserTotal} />
                ) : (
                  <span className="text-xs text-faint">–</span>
                )}
              </span>
              <span className="w-20 shrink-0 text-right text-sm tabular-nums text-muted">
                {pct == null ? "–" : `${pct}%`}
              </span>
              <ChevronRight size={15} className="shrink-0 text-faint" />
            </Link>
          );
        })}
      </div>

      {addOpen && <AddUserModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}
