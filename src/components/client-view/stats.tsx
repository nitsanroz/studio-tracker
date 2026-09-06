"use client";

// The client Overview tab's figures: totals, hours per month, hours per user.

import { HBar, LineChart } from "../charts";
import { Avatar } from "../ui";
import { formatHoursShort } from "@/lib/format";
import { useData, useIsAdmin } from "@/lib/store";
import { useMemo } from "react";


export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


/**
 * Client stats: totals, hours per month, hours per user.
 *
 * `inTab` drops the fixed 300px column and the `xl:` gate — it lives on the
 * Overview tab now, where it is finally reachable on a laptop.
 */
export function ClientStats({ clientId, inTab = false }: { clientId: string; inTab?: boolean }) {
  const { tasks, profiles, entrySumsAll } = useData();
  const isAdmin = useIsAdmin();

  const stats = useMemo(() => {
    const clientTaskIds = new Set(tasks.filter((t) => t.clientId === clientId).map((t) => t.id));
    const open = tasks.filter((t) => t.clientId === clientId && t.status !== "done").length;
    const billableTaskIds = new Set(
      tasks.filter((t) => t.clientId === clientId && t.billable).map((t) => t.id),
    );

    // Recovered hours we could not pin to a person or a date. They are NOT in
    // entrySumsAll (they never became entries), so they are added to the total
    // separately and deliberately kept out of byMonth/byUser.
    //
    // ⚠️ THE BILLABLE PART IS COUNTED TOO, AND IT WAS NOT. The share below is
    // `billable / total`, and `total` carries these hours while `billable` was
    // built only from entries — which these are not — so every client with
    // pre-Everhour history read as LESS billable than it is, in proportion to how
    // much of that history it carries. A client whose work is entirely billable,
    // with 100h tracked and 100h recovered, showed 50%. Not hypothetical: the
    // recovery put 3,953.75h of remainder onto ~150 tasks. The tooltip beside the
    // total already reasons about this split for the charts; the share was missed.
    let unattributed = 0;
    let unattributedBillable = 0;
    for (const t of tasks) {
      if (t.clientId !== clientId) continue;
      const mins = (t.legacyHours ?? 0) * 60;
      unattributed += mins;
      if (t.billable) unattributedBillable += mins;
    }

    let total = 0;
    let billable = 0;
    /**
     * ⚠️ RECOVERED ENTRIES THAT *DO* HAVE A DATE WERE INVISIBLE HERE. The caption
     * below has always reported `unattributed` — the task-level `legacy_hours`
     * remainder, i.e. the part with no day at all — so a client whose recovered
     * history came through as DATED legacy entries read as if every hour in its
     * total had been logged by a person in this app. That is most of the
     * recovery: 3,994.90h landed as dated entries against 3,953.75h of
     * remainder, and the later passes added ~33,000h more, nearly all dated.
     *
     * Both are reconstructions and the caption now says so. They stay separate
     * numbers because they degrade differently: a dated legacy entry has a real
     * (sometimes estimated) day and often an author, the remainder has neither
     * and is excluded from the charts below.
     */
    let legacyDated = 0;
    const byMonth = new Map<string, number>();
    const byUser = new Map<string, number>();
    for (const e of entrySumsAll) {
      if (!clientTaskIds.has(e.taskId)) continue;
      total += e.minutes;
      if (e.legacy) legacyDated += e.minutes;
      if (billableTaskIds.has(e.taskId)) billable += e.minutes;
      const month = e.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + e.minutes);
      // A recovered pre-Everhour entry can name an author who has no profile
      // (they left before the current roster). Those hours still belong in the
      // client total and in byMonth — they have a real date — but there is no
      // person to attribute them to in the "hours per user" breakdown.
      if (e.userId) byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + e.minutes);
    }

    const months = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
      .map(([key, minutes]) => {
        const [y, m] = key.split("-").map(Number);
        return { label: `${MONTH_SHORT[m - 1]}${m === 1 ? ` ${String(y).slice(2)}` : ""}`, minutes };
      });

    const users = [...byUser.entries()]
      .map(([id, minutes]) => ({ profile: profiles.find((p) => p.id === id), minutes }))
      .filter((u) => u.profile)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 8);

    return {
      total: total + unattributed,
      unattributed,
      legacyDated,
      /** Everything in `total` that was reconstructed rather than logged here. */
      recovered: legacyDated + unattributed,
      // Same basis as `total`: both sides of the share now include the recovered
      // hours, so the percentage answers "how much of this client's work is
      // billable" rather than "how much of the ITEMISED part is".
      billable: billable + unattributedBillable,
      open,
      months,
      users,
    };
  }, [tasks, profiles, entrySumsAll, clientId]);

  const maxUser = stats.users[0]?.minutes ?? 0;

  return (
    <aside
      className={
        inTab
          ? "flex flex-col gap-4"
          : "hidden w-[300px] shrink-0 flex-col gap-4 self-start xl:flex"
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[11px] font-medium text-muted">Total logged</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">
            {formatHoursShort(stats.total)}
          </div>
          {stats.recovered > 0 && (
            <div
              className="mt-0.5 text-[11px] text-faint"
              title={
                "Reconstructed from the pre-Everhour Asana history rather than logged in this app.\n\n" +
                (stats.legacyDated > 0
                  ? `${formatHoursShort(stats.legacyDated)} has a day (sometimes estimated from the task's activity window) and appears in the charts below.\n`
                  : "") +
                (stats.unattributed > 0
                  ? `${formatHoursShort(stats.unattributed)} has no day or author at all — counted in the total above, left out of the charts below.\n`
                  : "") +
                "\nBefore quoting this figure to a client, treat the recovered part as approximate."
              }
            >
              incl. {formatHoursShort(stats.recovered)} recovered
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[11px] font-medium text-muted">Open tasks</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">{stats.open}</div>
        </div>
        {isAdmin && (
          <div className="col-span-2 rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] font-medium text-muted">Billable share</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">
              {stats.total > 0 ? `${Math.round((stats.billable / stats.total) * 100)}%` : "–"}
            </div>
          </div>
        )}
      </div>

      {stats.months.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-2 text-[11px] font-medium text-muted">Hours per month</div>
          <LineChart points={stats.months} />
        </div>
      )}

      {stats.users.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3">
          <div className="text-[11px] font-medium text-muted">Hours per user</div>
          {stats.users.map(({ profile, minutes }) => (
            <HBar
              key={profile!.id}
              label={
                <>
                  <Avatar profile={profile!} size={16} />
                  <span className="truncate">{profile!.name}</span>
                </>
              }
              right={formatHoursShort(minutes)}
              minutes={minutes}
              maxMinutes={maxUser}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
