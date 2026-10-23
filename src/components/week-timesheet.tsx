"use client";

import { StudioArrow } from "@/components/studio-arrow";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/lib/store";
import { shiftDays, formatHoursShort, startOfWeek, toISODate, DAY_NAMES } from "@/lib/format";
import { Avatar } from "./ui";
import { UserDayDetails } from "./user-day-details";

/**
 * "Has everyone logged their hours this week?" — the admin home's answer.
 *
 * Deliberately NOT the Time Feed timesheet in miniature. No per-designer total,
 * no per-day total and no expandable rows: the question is whether a cell is
 * filled, and a column of sums invites reading it as a performance table. First
 * names only, because the grid has to fit beside the KPI tiles.
 *
 * A blank cell on a workday that has already happened is the whole point, so it
 * is tinted rather than left empty — an empty cell reads as "nothing to see".
 * Future days in the current week stay plain; they aren't gaps yet.
 *
 * Reads `entrySums`, which excludes the recovered pre-Everhour history — this
 * pane is about people logging time in this app, so a 2019 backfill row must
 * never make a designer look like they logged.
 */
export function WeekTimesheet() {
  const { profiles, entrySums, tasks, clients, planColumns, planEntries } = useData();
  const [popup, setPopup] = useState<{ userId: string; date: string } | null>(null);

  const todayIso = toISODate(new Date());
  const weekStart = useMemo(() => startOfWeek(new Date()), []);

  // Sun–Thu is the studio's week. Fri/Sat are appended only when somebody
  // actually logged then, so weekend hours are never silently invisible.
  const days = useMemo(() => {
    const base = Array.from({ length: 5 }, (_, i) => toISODate(shiftDays(weekStart, i)));
    const extra = [5, 6]
      .map((i) => toISODate(shiftDays(weekStart, i)))
      .filter((iso) => entrySums.some((e) => e.date === iso && e.minutes > 0));
    return [...base, ...extra];
  }, [weekStart, entrySums]);

  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  /** userId → date → the week's entries for that cell */
  const byUserDay = useMemo(() => {
    const map = new Map<string, Map<string, { minutes: number; taskId: string }[]>>();
    for (const e of entrySums) {
      if (e.date < firstDay || e.date > lastDay || e.minutes <= 0) continue;
      let forUser = map.get(e.userId);
      if (!forUser) map.set(e.userId, (forUser = new Map()));
      const cell = forUser.get(e.date);
      if (cell) cell.push({ minutes: e.minutes, taskId: e.taskId });
      else forUser.set(e.date, [{ minutes: e.minutes, taskId: e.taskId }]);
    }
    return map;
  }, [entrySums, firstDay, lastDay]);

  /** profileId → date → the absence planned for it ("Vacation", "Sick", "Day off").
   * A day someone was away is not a gap, so it must not look like one. The tile
   * itself just says "Off" — "Vacation" doesn't fit a tile at this width — and
   * the reason is in its tooltip. */
  const awayByUserDay = useMemo(() => {
    const colOwner = new Map(planColumns.filter((c) => c.profileId).map((c) => [c.id, c.profileId!]));
    const map = new Map<string, Map<string, string>>();
    for (const e of planEntries) {
      if (e.type !== "absence" || !e.date || e.date < firstDay || e.date > lastDay) continue;
      const who = colOwner.get(e.columnId);
      if (!who) continue;
      let forUser = map.get(who);
      if (!forUser) map.set(who, (forUser = new Map()));
      forUser.set(e.date, e.absenceType === "vacation" ? "Vacation" : e.absenceType === "sick" ? "Sick" : "Day off");
    }
    return map;
  }, [planColumns, planEntries, firstDay, lastDay]);

  // Who is expected to log: current designers. Admins are left out — they don't
  // log studio hours, so their row would sit permanently red and read as a
  // problem. Accountless profiles are former staff kept for attribution (0018)
  // and cannot log at all.
  //
  // ...but an admin who DID log this week is shown anyway. `Office` is a shared
  // admin account that logs occasionally, and hours that exist must never be
  // invisible on a pane whose whole job is spotting missing ones.
  const members = useMemo(() => {
    const loggedThisWeek = new Set(byUserDay.keys());
    return profiles
      .filter(
        (p) =>
          p.active &&
          p.hasAccount !== false &&
          (p.role === "designer" || loggedThisWeek.has(p.id)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, byUserDay]);

  /** The hover card for one cell: what was logged, not just how much. */
  function cellTooltip(entries: { minutes: number; taskId: string }[] | undefined) {
    if (!entries?.length) return "No hours logged on this day — click to add them";
    return entries
      .map((e) => {
        const task = tasks.find((t) => t.id === e.taskId);
        const client = clients.find((c) => c.id === task?.clientId);
        const name = task?.title ?? "(deleted task)";
        return `${client ? `${client.name} · ` : ""}${name} — ${formatHoursShort(e.minutes)}`;
      })
      .join("\n");
  }

  return (
    // h-full so the pane matches the KPI tile block beside it; the table then
    // spreads its rows over whatever height that turns out to be.
    <div className="card flex h-full flex-col overflow-x-auto p-4">
      {/* Separated cells (design-lab "This week 2"): each day is its own tile,
          shaded by how much was logged, so the grid reads at a glance. */}
      {/* -mx-1 + 100%+8px: the spacing also rings the table's outer edge, which
          would push it 4px past the pane and raise a scrollbar for nothing. */}
      <table className="-mx-1 h-full w-[calc(100%+0.5rem)] min-w-fit border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            {/* the corner cell is otherwise dead space, and the pane has no
                title of its own to hang this off */}
            <th className="w-24 pb-1 text-left">
              <Link
                href="/feed"
                className="flex items-center gap-0.5 text-[11px] font-medium text-brand hover:underline"
              >
                Time Feed <StudioArrow size={14} />
              </Link>
            </th>
            {days.map((iso) => {
              const d = new Date(iso + "T00:00:00");
              const isToday = iso === todayIso;
              return (
                <th
                  key={iso}
                  className={`px-1 pb-1 text-center text-[11px] font-medium uppercase tracking-wide ${
                    isToday ? "text-brand" : "text-faint"
                  }`}
                  title={iso}
                >
                  {DAY_NAMES[d.getDay()].slice(0, 3)}
                  <span className="ml-1 tabular-nums opacity-70">{d.getDate()}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const forUser = byUserDay.get(m.id);
            return (
              <tr key={m.id}>
                <td className="w-24 max-w-24 pr-1" title={m.name}>
                  <span className="flex items-center gap-1.5">
                    <Avatar profile={m} size={20} />
                    <span className="min-w-0 truncate text-xs font-medium">
                      {m.name.split(" ")[0]}
                    </span>
                  </span>
                </td>
                {days.map((iso) => {
                  const entries = forUser?.get(iso);
                  const minutes = entries?.reduce((s, e) => s + e.minutes, 0) ?? 0;
                  const logged = minutes > 0;
                  const away = awayByUserDay.get(m.id)?.get(iso);
                  // Only a day that is OVER can be a gap. Flagging today would
                  // nag every morning about hours nobody has had time to log —
                  // and a day the plan has them away was never one.
                  const missed = !logged && !away && iso < todayIso;
                  // Shade by hours: a 9h day is full strength, a 1h day barely
                  // tinted. Pre-mixed against the surface, so the tile is opaque.
                  const share = Math.min(minutes / 540, 1);
                  const fill = logged
                    ? `color-mix(in oklab, var(--brand) ${Math.round(12 + share * 78)}%, var(--surface))`
                    : undefined;
                  return (
                    <td
                      key={iso}
                      onClick={() => setPopup({ userId: m.id, date: iso })}
                      title={away && !logged ? `${away} — planned in the weekly plan` : cellTooltip(entries)}
                      className={`h-8 cursor-pointer rounded-md px-1.5 text-center text-xs tabular-nums transition-shadow hover:ring-2 hover:ring-brand/40 ${
                        logged
                          ? `font-medium ${share > 0.5 ? "text-white" : "text-foreground"}`
                          : away
                            ? "bg-[repeating-linear-gradient(135deg,var(--weekend)_0_5px,transparent_5px_9px)] text-muted"
                            : missed
                              ? "bg-danger/10 text-danger"
                              : "bg-background text-faint"
                      }`}
                      style={fill ? { backgroundColor: fill } : undefined}
                    >
                      {logged ? formatHoursShort(minutes) : away ? "Off" : "–"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {members.length === 0 && (
            <tr>
              <td colSpan={days.length + 1} className="py-3 text-center text-sm text-faint">
                No active designers.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {popup && (
        <UserDayDetails userId={popup.userId} date={popup.date} onClose={() => setPopup(null)} />
      )}
    </div>
  );
}
