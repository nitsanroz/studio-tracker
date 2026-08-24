"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
  const { profiles, entrySums, tasks, clients } = useData();
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
      <table className="h-full w-full min-w-fit text-sm">
        <thead>
          <tr>
            {/* the corner cell is otherwise dead space, and the pane has no
                title of its own to hang this off */}
            <th className="w-28 pb-1 text-left">
              <Link
                href="/feed"
                className="flex items-center gap-0.5 text-[11px] font-medium text-brand hover:underline"
              >
                Time Feed <ArrowRight size={11} />
              </Link>
            </th>
            {days.map((iso) => {
              const d = new Date(iso + "T00:00:00");
              const isToday = iso === todayIso;
              return (
                <th
                  key={iso}
                  className={`px-1 pb-1 text-right text-[11px] font-medium uppercase tracking-wide ${
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
              <tr key={m.id} className="border-t border-border">
                <td className="w-28 max-w-28 pr-1" title={m.name}>
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
                  // Only a day that is OVER can be a gap. Flagging today would
                  // nag every morning about hours nobody has had time to log.
                  // Carried in the text colour rather than a box, so the grid
                  // reads like the Time Feed timesheet.
                  const missed = !logged && iso < todayIso;
                  return (
                    <td
                      key={iso}
                      onClick={() => setPopup({ userId: m.id, date: iso })}
                      title={cellTooltip(entries)}
                      className={`cursor-pointer p-2 text-right tabular-nums hover:bg-brand-soft/60 ${
                        logged ? "font-medium" : missed ? "text-danger/60" : "text-faint"
                      }`}
                    >
                      {logged ? formatHoursShort(minutes) : "–"}
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
