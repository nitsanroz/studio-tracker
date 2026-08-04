"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, Plus, Table2, X } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { periodRange, rangeLabel, TEAM_RANGES, type PeriodKey } from "@/lib/period-math";
import { toISODate } from "@/lib/format";
import { formatHoursAvg, formatHoursShort } from "@/lib/format";
import { useMemberEmails } from "@/lib/use-member-emails";
import { MemberPhoto } from "@/components/member-photo";
import { Tabs } from "@/components/ui";
import { PeriodStepper } from "@/components/period-stepper";
import { PercentRing } from "@/components/charts";
import { MemberTable, type MemberRow } from "./member-table";

type Layout = "cards" | "table";
const LAYOUT_KEY = "team.layout";
const RANGE_KEY = "team.range";

// Period selection lives in period-math.ts now (quarters included), so the team
// page and the admin home step through periods with the same arithmetic and the
// same control.

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
  const router = useRouter();
  const [form, setForm] = useState({
    email: "",
    name: "",
    role: "designer",
    startDate: toISODate(new Date()),
  });
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
    // straight to their member page to add pictures and finish setting them up
    setStatus(`${form.name} added ✓ — opening their page…`);
    router.push(`/team/${body.id}`);
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
          Start date
          <input
            required
            type="date"
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
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
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-serif-accent text-2xl tabular-nums">{value}</div>
    </div>
  );
}

export default function TeamPage() {
  const { profiles, tasks, entrySumsAll } = useData();
  const isAdmin = useIsAdmin();
  const [showDeactivated, setShowDeactivated] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const memberEmails = useMemberEmails(isAdmin);

  const [rangeKey, setRangeKey] = useState<PeriodKey>("This month");
  /** Deliberately NOT persisted, unlike the range key: reopening the page on
   *  "Q2 2025" would present stale hours as if they were current. */
  const [periodOffset, setPeriodOffset] = useState(0);
  const [layout, setLayout] = useState<Layout>("cards");

  // localStorage in an effect, never in a useState initialiser: these pages are
  // still server-prerendered, so reading it during render is a hydration mismatch.
  useEffect(() => {
    const v = localStorage.getItem(LAYOUT_KEY);
    if (v === "cards" || v === "table") setLayout(v);
    const r = localStorage.getItem(RANGE_KEY);
    // validate — a renamed range must fall back, not render an empty page
    if (r && (TEAM_RANGES as readonly string[]).includes(r)) setRangeKey(r as PeriodKey);
  }, []);
  function pickLayout(v: Layout) {
    setLayout(v);
    try {
      localStorage.setItem(LAYOUT_KEY, v);
    } catch {}
  }
  function pickRange(v: PeriodKey) {
    setRangeKey(v);
    try {
      localStorage.setItem(RANGE_KEY, v);
    } catch {}
  }

  const range = useMemo(() => periodRange(rangeKey, periodOffset), [rangeKey, periodOffset]);
  const periodLabel = rangeLabel(rangeKey, periodOffset);

  const statsByUser = useMemo(() => {
    const billableTaskIds = new Set(tasks.filter((t) => t.billable).map((t) => t.id));
    const map = new Map<string, { total: number; billable: number }>();
    // entrySumsAll, not entrySums: a member page is a HISTORICAL record, so it
    // should show the pre-Everhour hours too — that is the whole point of having
    // former staff here. The home page keeps using the legacy-free list, so
    // nobody's days-worked or tenure counter can be moved by a 2019 entry.
    for (const e of entrySumsAll) {
      if (range && (e.date < range.from || e.date > range.to)) continue;
      if (!e.userId) continue; // recovered row whose author has no profile at all
      const row = map.get(e.userId) ?? { total: 0, billable: 0 };
      row.total += e.minutes;
      if (billableTaskIds.has(e.taskId)) row.billable += e.minutes;
      map.set(e.userId, row);
    }
    return map;
  }, [entrySumsAll, tasks, range]);

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

  const activeTaskByUser = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      if (t.status === "done" || !t.assigneeId) continue;
      m.set(t.assigneeId, (m.get(t.assigneeId) ?? 0) + 1);
    }
    return m;
  }, [tasks]);

  if (!isAdmin) {
    return <p className="text-sm text-muted">This page is for admins only.</p>;
  }

  const team = profiles
    .filter((p) => showDeactivated || p.active)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  // Built from statsByUser / activeTaskByUser, exactly like the cards below, so
  // the two layouts can never show different numbers for the same person.
  const tableRows: MemberRow[] = team.map((p) => {
    const st = statsByUser.get(p.id);
    return {
      profile: p,
      minutes: st?.total ?? 0,
      billablePct: st && st.total > 0 ? Math.round((st.billable / st.total) * 100) : null,
      openTasks: activeTaskByUser.get(p.id) ?? 0,
      email: memberEmails[p.id],
      tenure: p.startDate ? tenureShort(p.startDate) : null,
    };
  });

  return (
    <div className="flex max-w-[1500px] flex-col gap-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="font-serif-accent text-3xl">The team</h1>
          <p className="text-sm text-muted">Open a member for details, graphs, and HR fields.</p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={showDeactivated}
            onChange={(e) => setShowDeactivated(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodStepper
          ranges={TEAM_RANGES}
          value={rangeKey}
          offset={periodOffset}
          label={periodLabel}
          canStep={rangeKey !== "All time"}
          disabledReason="All time has no previous period"
          onChange={pickRange}
          onOffset={setPeriodOffset}
        />
        <div className="flex items-center gap-2">
          <Tabs
            value={layout}
            onChange={pickLayout}
            items={[
              {
                value: "cards" as const,
                label: (
                  <span className="flex items-center gap-1.5">
                    <LayoutGrid size={14} /> Cards
                  </span>
                ),
              },
              {
                value: "table" as const,
                label: (
                  <span className="flex items-center gap-1.5">
                    <Table2 size={14} /> Table
                  </span>
                ),
              },
            ]}
            variant="segmented"
            size="sm"
            ariaLabel="Layout"
          />
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            <Plus size={15} /> Add user
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`Hours · ${periodLabel.toLowerCase()}`} value={formatHoursShort(teamStats.total)} />
        <Stat
          label="Billable share"
          value={teamStats.billablePct == null ? "–" : `${teamStats.billablePct}%`}
        />
        <Stat label="Active members" value={String(teamStats.activeCount)} />
        <Stat label="Avg hours / member" value={formatHoursAvg(teamStats.avgPerMember)} />
      </div>

      {/* Portrait left, everything else stacked left-aligned beside it — wider
          cards than the old centred column, so three across rather than four. */}
      {layout === "table" ? (
        <MemberTable rows={tableRows} periodLabel={periodLabel} />
      ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {team.map((p) => {
          const s = statsByUser.get(p.id);
          const pct = s && s.total > 0 ? Math.round((s.billable / s.total) * 100) : null;
          const openTasks = activeTaskByUser.get(p.id) ?? 0;
          const email = memberEmails[p.id];
          return (
            <Link
              key={p.id}
              href={`/team/${p.id}`}
              className={`group relative flex items-stretch gap-4 rounded-2xl border border-border bg-surface p-4 text-left shadow-card transition-colors hover:border-brand ${p.active ? "" : "opacity-60"}`}
            >
              <span
                className={`absolute right-3 top-3 size-2.5 rounded-full ${p.active ? "bg-success" : "bg-border-strong"}`}
                title={p.active ? "Active" : "Archived"}
              />
              {/* mt-3 leaves room for the head to clear the circle without the
                  card growing or the portrait colliding with the card edge */}
              <MemberPhoto
                name={p.name}
                src={p.photoUrl}
                variant="avatar"
                size={124}
                bleed={0.16}
                // Former staff kept only for historical attribution get initials,
                // never the shared cut-out — that placeholder is a photo of a real
                // colleague, and showing it as someone else is worse than nothing.
                fallback={p.hasAccount === false ? "initials" : "cutout"}
                className="mt-3 shrink-0 self-start"
              />
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <div className="truncate pr-5 text-xl font-semibold leading-tight">{p.name}</div>
                <div className="truncate text-xs capitalize text-muted">
                  {p.role}
                  {p.startDate ? ` · ${tenureShort(p.startDate)}` : ""}
                  {/* tenure of someone who left reads as if they were still here */}
                  {p.endDate ? ` · until ${p.endDate}` : ""}
                </div>
                {email && (
                  <div className="truncate text-xs text-muted" title={email}>
                    {email}
                  </div>
                )}
                {/* Billable sits in the stats row as a ring rather than a full-width
                    bar under the card — that row was the space the name needed. */}
                <div className="mt-3 flex items-center gap-5">
                  <div>
                    <div className="text-base font-semibold tabular-nums">
                      {s?.total ? formatHoursShort(s.total) : "–"}
                    </div>
                    <div className="text-[10px] text-muted">Hours</div>
                  </div>
                  <div>
                    <div className="text-base font-semibold tabular-nums">{openTasks}</div>
                    <div className="text-[10px] text-muted">Tasks</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {pct == null ? (
                      <span className="text-base font-semibold tabular-nums text-muted">–</span>
                    ) : (
                      <PercentRing pct={pct} size={38} label={`${pct}% billable`} />
                    )}
                    <div className="text-[10px] text-muted">Billable</div>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      )}

      {addOpen && <AddUserModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}
