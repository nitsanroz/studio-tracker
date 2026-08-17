"use client";

// What YOU logged on this week's days, on a phone — with each entry editable.
//
// This exists because the Time Feed is desktop-only below 768px (its timesheet is
// a week-wide grid), which left a member with no way to see or fix an hour logged
// yesterday: the bottom bar's "+" only ADDS, and the task pane only reaches the
// entries of one task. `MyWeek` above this shows the days AHEAD on a phone, so
// between the two panes the week is covered in both directions.
//
// It is deliberately NOT `UserDayDetails` in a sheet. That popup is a 2xl modal
// built around an admin's controls — a member picker, a date picker and a
// six-control edit row per line — and at 375px its row alone needs ~390px.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useData } from "@/lib/store";
import { addDays, DAY_NAMES, formatHours, formatHoursDecimal, startOfWeek, toISODate } from "@/lib/format";
import { TimeEntryModal } from "./time-entry-modal";
import { DayTotalBar, LoggedEntryRow, useDayEntries } from "./logged-day";
import { dailyTargetMinutes } from "@/lib/members";
import type { TimeEntry } from "@/lib/types";

export function MemberWeekHours() {
  const { entrySums, timeEntries, profiles, currentUserId } = useData();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const { rows, reload } = useDayEntries(currentUserId, open);

  const me = profiles.find((p) => p.id === currentUserId) ?? null;
  const weekStart = startOfWeek(new Date());
  const weekStartIso = toISODate(weekStart);
  const todayIso = toISODate(new Date());

  /** Sun–Thu, up to and including today — the days that can already hold hours. */
  const days = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)).filter(
        (d) => toISODate(d) <= todayIso,
      ),
    // `weekStartIso` stands in for `weekStart`, whose Date identity changes every
    // render while the day it names does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekStartIso, todayIso],
  );

  /**
   * Per-day totals, from BOTH stores keyed by entry id.
   *
   * ⚠️ `entrySums` alone is not good enough here and the mismatch is visible:
   * since v1.18.2 it is fetched on the COLD tier, so an hour logged on another
   * device up to ten minutes ago is missing from it — this pane read a day as "–"
   * while the day's own list, which is a live query, showed an hour in it. The
   * `timeEntries` window is refreshed every 60 seconds and always covers a few
   * recent days, so folding it in closes that gap; the id map means an entry
   * carried by both is still counted once.
   */
  const minutesByDay = useMemo(() => {
    const mine = new Map<string, { date: string; minutes: number }>();
    for (const e of entrySums) {
      if (e.userId !== currentUserId || e.date < weekStartIso || e.date > todayIso) continue;
      mine.set(e.id, { date: e.date, minutes: e.minutes });
    }
    for (const e of timeEntries) {
      if (e.userId !== currentUserId || e.date < weekStartIso || e.date > todayIso) continue;
      if (e.legacy) continue; // recovered history is not time this person logged
      mine.set(e.id, { date: e.date, minutes: e.minutes });
    }
    const byDay = new Map<string, number>();
    for (const { date, minutes } of mine.values()) {
      byDay.set(date, (byDay.get(date) ?? 0) + minutes);
    }
    return byDay;
  }, [entrySums, timeEntries, currentUserId, weekStartIso, todayIso]);

  const weekTotal = [...minutesByDay.values()].reduce((s, n) => s + n, 0);

  if (days.length === 0 || weekTotal === 0) {
    // Nothing logged yet this week — a table of five dashes is not worth a pane.
    // ⚠️ It comes back on its own the moment an hour is logged, because the store
    // patches both sets optimistically.
    return null;
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card md:hidden">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-heading text-sm">Hours I logged this week</h2>
        <span className="text-sm font-semibold tabular-nums">{formatHours(weekTotal)}</span>
      </div>
      <div className="flex flex-col divide-y divide-border">
        {days.map((day) => {
          const iso = toISODate(day);
          const minutes = minutesByDay.get(iso) ?? 0;
          const isOpen = open === iso;
          const isToday = iso === todayIso;
          return (
            <div key={iso}>
              <button
                onClick={() => setOpen(isOpen ? null : iso)}
                aria-expanded={isOpen}
                // 44px — this is the one control on the pane and it is a thumb
                // target, not a table row on a desk.
                className="flex min-h-11 w-full items-center gap-2 text-left"
              >
                {isOpen ? (
                  <ChevronDown size={15} className="shrink-0 text-faint" aria-hidden />
                ) : (
                  <ChevronRight size={15} className="shrink-0 text-faint" aria-hidden />
                )}
                <span className="text-sm font-medium">
                  {DAY_NAMES[day.getDay()].slice(0, 3)} {day.getDate()}
                </span>
                {isToday && <span className="text-[11px] text-brand">today</span>}
                <span className="flex-1" />
                {/* ⚠️ A blank day reads red only when the day is OVER, the same
                    rule the admin week timesheet follows — flagging today would
                    nag every morning about hours nobody has had time to log. */}
                <span
                  className={`text-sm tabular-nums ${
                    minutes > 0 ? "font-semibold" : isToday ? "text-faint" : "text-danger/60"
                  }`}
                >
                  {minutes > 0 ? formatHoursDecimal(minutes) + "h" : "–"}
                </span>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-1 pb-3 pl-6">
                  {rows === null && <p className="py-2 text-xs text-faint">Loading…</p>}
                  {rows?.length === 0 && (
                    <p className="py-2 text-xs text-faint">Nothing logged on this day.</p>
                  )}
                  {rows?.map((e) => (
                    <LoggedEntryRow key={e.id} entry={e} onPick={setEditing} />
                  ))}
                  {/* the day's own total against the target, so a day that is
                      short says so where you are looking at it */}
                  {rows && rows.length > 0 && (
                    <div className="pt-1">
                      <DayTotalBar
                        minutes={rows.reduce((s, e) => s + e.minutes, 0)}
                        targetMinutes={dailyTargetMinutes(me)}
                        label={isToday ? "Logged today" : "Logged that day"}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {editing && (
        <TimeEntryModal
          taskId={editing.taskId}
          entry={editing}
          layer="base"
          // ⚠️ Re-fetch the open day rather than patching the row in place. The
          // store's own copy moves on save and delete, but these rows came from a
          // one-off query, so a deleted entry would sit here until the accordion
          // was closed and opened again.
          onSaved={reload}
          onDeleted={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
