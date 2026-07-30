"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useData } from "@/lib/store";
import { addDays, formatHoursShort, startOfWeek, toISODate, DAY_NAMES } from "@/lib/format";
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
    const base = Array.from({ length: 5 }, (_, i) => toISODate(addDays(weekStart, i)));
    const extra = [5, 6]
      .map((i) => toISODate(addDays(weekStart, i)))
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
    <div className="card flex flex-col p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <h2 className="font-heading text-sm">This week</h2>
          <p className="text-xs text-muted">Who has logged their hours</p>
        </div>
        <Link
          href="/feed"
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          Time Feed <ArrowRight size={13} />
        </Link>
      </div>

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-fit border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr>
              <th className="w-20 text-left text-[11px] font-medium uppercase tracking-wide text-faint">
                <span className="sr-only">Designer</span>
              </th>
              {days.map((iso) => {
                const d = new Date(iso + "T00:00:00");
                const isToday = iso === todayIso;
                return (
                  <th
                    key={iso}
                    className={`px-1 text-center text-[11px] font-medium uppercase tracking-wide ${
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
                  <td className="w-20 max-w-20 truncate pr-1 text-xs font-medium" title={m.name}>
                    {m.name.split(" ")[0]}
                  </td>
                  {days.map((iso) => {
                    const entries = forUser?.get(iso);
                    const minutes = entries?.reduce((s, e) => s + e.minutes, 0) ?? 0;
                    const logged = minutes > 0;
                    // Only a day that is OVER can be a gap. Flagging today would
                    // nag every morning about hours nobody has had time to log.
                    const missed = !logged && iso < todayIso;
                    return (
                      <td key={iso} className="px-0.5">
                        <button
                          onClick={() => setPopup({ userId: m.id, date: iso })}
                          title={cellTooltip(entries)}
                          className={`h-7 w-full min-w-11 rounded-md border text-xs tabular-nums transition-colors ${
                            logged
                              ? "border-border bg-surface font-medium text-foreground hover:border-brand"
                              : missed
                                ? "border-danger/25 bg-danger/5 text-danger/50 hover:border-danger/50"
                                : "border-dashed border-border text-faint hover:border-brand"
                          }`}
                        >
                          {logged ? formatHoursShort(minutes) : missed ? "—" : ""}
                        </button>
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
      </div>

      <p className="mt-2 text-[11px] text-muted">
        Click any cell to see or add that day&apos;s hours.
      </p>

      {popup && (
        <UserDayDetails
          userId={popup.userId}
          date={popup.date}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}
