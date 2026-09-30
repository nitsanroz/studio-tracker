"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, Plus, Table2, X } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { periodRange, presenceFraction, rangeLabel, TEAM_RANGES, type PeriodKey } from "@/lib/period-math";
import { toISODate } from "@/lib/format";
import { formatHoursAvg, formatHoursShort } from "@/lib/format";
import { useMemberEmails } from "@/lib/use-member-emails";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { DEFAULT_PORTRAIT, MemberPhoto } from "@/components/member-photo";
import { useMemberPortraits } from "@/lib/use-member-portraits";
import { Tabs } from "@/components/ui";
import { PeriodStepper } from "@/components/period-stepper";
import { PercentRing } from "@/components/charts";
import {
  addEntry,
  billablePct as billableShare,
  keysPct,
  keysTaskIds,
  newSplit,
  splitTitle,
  type HoursSplit,
} from "@/lib/hours-split";
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

function Stat({
  label,
  value,
  title,
  sub,
}: {
  label: string;
  value: string;
  title?: string;
  /** A short qualifier under the figure — for when the number needs a caveat to be read correctly. */
  sub?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card" title={title}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-serif-accent text-2xl tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-faint">{sub}</div>}
    </div>
  );
}

export default function TeamPage() {
  const { profiles, tasks, entrySumsAll, clients } = useData();
  const isAdmin = useIsAdmin();
  const isNarrow = useIsNarrow();
  const [addOpen, setAddOpen] = useState(false);
  const memberEmails = useMemberEmails(isAdmin);
  const portraits = useMemberPortraits();

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

  const { map: statsByUser, spans: entrySpans } = useMemo(() => {
    const billableTaskIds = new Set(tasks.filter((t) => t.billable).map((t) => t.id));
    // ⚠️ Keys hours are the slice of the NON-billable part that was written down
    // before a client report — see lib/hours-split.ts for why it earns a colour.
    const keysIds = keysTaskIds(clients);
    const map = new Map<string, HoursSplit>();
    const spans = new Map<string, { first: string; last: string }>();
    // entrySumsAll, not entrySums: a member page is a HISTORICAL record, so it
    // should show the pre-Everhour hours too — that is the whole point of having
    // former staff here. The home page keeps using the legacy-free list, so
    // nobody's days-worked or tenure counter can be moved by a 2019 entry.
    for (const e of entrySumsAll) {
      if (range && (e.date < range.from || e.date > range.to)) continue;
      if (!e.userId) continue; // recovered row whose author has no profile at all
      const span = spans.get(e.userId);
      if (!span) spans.set(e.userId, { first: e.date, last: e.date });
      else {
        if (e.date < span.first) span.first = e.date;
        if (e.date > span.last) span.last = e.date;
      }
      map.set(
        e.userId,
        addEntry(map.get(e.userId) ?? newSplit(), e.minutes, {
          billable: billableTaskIds.has(e.taskId),
          keys: keysIds.has(e.taskId),
        }),
      );
    }
    return { map, spans };
  }, [entrySumsAll, tasks, clients, range]);

  /**
   * Who is on the page: everyone still here, plus every former member who logged
   * in the selected period.
   *
   * ⚠️ THERE IS NO "SHOW ARCHIVED" TICKBOX ANY MORE — Nitsan, 2026-09-30: an
   * archived card is dimmed anyway, so it can simply appear when the period is
   * one they worked in. A period's answer includes the people who did the work
   * in it, and a checkbox that hid them made stepping back to March show a team
   * with a hole where somebody now gone had been. It also retired the wall of
   * 49 ex-staff cards that ticking the box used to produce on "All time".
   *
   * ⚠️ `statsByUser` has a key only for somebody with an ENTRY in range, so this
   * is "logged anything then" rather than "net hours are non-zero" — a former
   * member whose recorded reductions net to exactly zero still did work.
   */
  const shownMembers = useMemo(
    () => profiles.filter((p) => p.active || statsByUser.has(p.id)),
    [profiles, statsByUser],
  );

  const teamStats = useMemo(() => {
    /**
     * ⚠️ ADMINS ARE OUT OF THE BILLABLE SHARE, not just off their own cards.
     * Nitsan's call, and the tile is the reason it matters: an admin logs almost
     * entirely internal time, so leaving them in the denominator drags the
     * studio's headline share down by a fact about the people who don't do
     * client work. Their HOURS still count in the total beside it, which is why
     * `all.total` and the share are accumulated separately.
     *
     * ⚠️ THESE TILES NOW COUNT EVERYONE ON THE PAGE, former members included.
     * They used to total active members only "so the row matches the panel
     * below", which stopped being true the moment a departed designer's card
     * could sit in that panel: the Hours tile would have read lower than the
     * cards beneath it added up to. Hours that were logged in a period are that
     * period's hours whoever has since left.
     */
    const all = newSplit();
    let hours = 0;
    let archivedCount = 0;
    /**
     * ⚠️ THE AVERAGE IS DIVIDED BY MEMBER-TIME, NOT BY HEADS — Nitsan,
     * 2026-09-30: "only part of the month if the start/end date of a designer
     * falls in that month". Somebody who joined on the 20th, or left on the 10th,
     * counts as a fraction of a member. See `presenceFraction` for how the
     * window is built when the declared dates are missing, which for former
     * members they nearly always are.
     */
    let memberTime = 0;
    const today = toISODate(new Date());
    for (const p of shownMembers) {
      const s = statsByUser.get(p.id);
      if (!p.active) archivedCount++;
      const span = entrySpans.get(p.id);
      memberTime += range
        ? presenceFraction({
            from: range.from,
            to: range.to,
            asOf: today,
            startDate: p.startDate,
            endDate: p.endDate,
            firstEntry: span?.first ?? null,
            lastEntry: span?.last ?? null,
            active: p.active,
          })
        : 1; // All time has no period to prorate over
      if (!s) continue;
      hours += s.total;
      if (p.role === "admin") continue;
      all.total += s.total;
      all.billable += s.billable;
      all.keys += s.keys;
      all.other += s.other;
    }
    return {
      total: hours,
      split: all,
      billablePct: billableShare(all),
      memberCount: shownMembers.length,
      archivedCount,
      memberTime,
      // ⚠️ Still per MEMBER, admins included — this one is about how much the
      // studio logged per head, not about billability.
      avgPerMember: memberTime > 0 ? hours / memberTime : 0,
    };
  }, [statsByUser, entrySpans, shownMembers, range]);

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

  const team = [...shownMembers].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  // Built from statsByUser / activeTaskByUser, exactly like the cards below, so
  // the two layouts can never show different numbers for the same person.
  const tableRows: MemberRow[] = team.map((p) => {
    const st = statsByUser.get(p.id);
    return {
      profile: p,
      minutes: st?.total ?? 0,
      // ⚠️ null for an admin, not 0 — see the strip on the admin home for why the
      // share is withheld for them while the hours stay.
      billablePct: p.role === "admin" ? null : st ? billableShare(st) : null,
      keysPct: st ? keysPct(st) : 0,
      splitTitle:
        p.role === "admin"
          ? "Admins aren't measured on billable share"
          : splitTitle(st ?? newSplit(), p.name),
      openTasks: activeTaskByUser.get(p.id) ?? 0,
      email: memberEmails[p.id],
      tenure: p.startDate ? tenureShort(p.startDate) : null,
    };
  });

  return (
    <div className="flex max-w-[1500px] flex-col gap-4">
      <div>
        <h1 className="font-serif-accent text-3xl">The team</h1>
        <p className="text-sm text-muted">Open a member for details, graphs, and HR fields.</p>
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
          title={`Designers only — admins are left out. ${splitTitle(teamStats.split)}`}
        />
        <Stat
          label="Members"
          value={String(teamStats.memberCount)}
          sub={teamStats.archivedCount > 0 ? `${teamStats.archivedCount} since left` : null}
          title="Everyone still here, plus former members who logged hours in this period."
        />
        <Stat
          label="Avg hours / member"
          value={formatHoursAvg(teamStats.avgPerMember)}
          // ⚠️ Said out loud whenever the head count and the member-time differ,
          // because a figure divided by 6.4 while the tile above says 8 looks
          // like an arithmetic error to anyone who does not know why.
          sub={
            Math.abs(teamStats.memberTime - teamStats.memberCount) > 0.05
              ? `pro rata — ${teamStats.memberTime.toFixed(1)} of ${teamStats.memberCount} members' time`
              : null
          }
          title="Total hours divided by member-time: someone who joined or left part way through the period counts as the fraction of it they were here."
        />
      </div>

      {/* Portrait left, everything else stacked left-aligned beside it — wider
          cards than the old centred column, so three across rather than four. */}
      {layout === "table" ? (
        <MemberTable rows={tableRows} periodLabel={periodLabel} />
      ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {team.map((p) => {
          const s = statsByUser.get(p.id);
          const pct = p.role === "admin" ? null : s ? billableShare(s) : null;
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
                portrait={portraits[p.id] ?? DEFAULT_PORTRAIT}
                variant="avatar"
                // ⚠️ 124px sets the CARD's height, so on a phone — one card per
                // row instead of two or three — it turned the roster into ten
                // screens of scrolling. 64px still reads as a portrait and more
                // than halves the card. A number, not a class, so it has to go
                // through `useIsNarrow` rather than an `sm:` prefix.
                size={isNarrow ? 64 : 124}
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
                  {/* ⚠️ Absent entirely for an admin rather than showing a dash:
                      a dash in a labelled "Billable" slot reads as missing data,
                      when the truth is that the figure does not apply. */}
                  {p.role !== "admin" && (
                    <div className="flex items-center gap-1.5">
                      {pct == null ? (
                        <span className="text-base font-semibold tabular-nums text-muted">–</span>
                      ) : (
                        <PercentRing
                          pct={pct}
                          keys={keysPct(s ?? newSplit())}
                          size={38}
                          label={splitTitle(s ?? newSplit(), p.name)}
                        />
                      )}
                      <div className="text-[10px] text-muted">Billable</div>
                    </div>
                  )}
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
