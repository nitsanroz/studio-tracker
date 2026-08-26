"use client";

// One day's logged hours, on a phone: the rows, and the running total against
// that person's own daily target.
//
// Shared by the two phone surfaces that show it — the home pane listing the week
// and the log-time sheet you just added an hour in. They have to agree: the whole
// point of the total is that it answers "have I finished logging today?", and two
// answers on two screens is worse than one screen.

import { useCallback, useEffect, useState } from "react";
import { useData } from "@/lib/store";
import { formatHours, formatHoursDecimal } from "@/lib/format";
import { ClientChip } from "./ui";
import type { TimeEntry } from "@/lib/types";

/**
 * One person's entries on one day, live from the DB, with a `reload`.
 *
 * ⚠️ It is a real query, not a filter over the store. `timeEntries` holds only
 * the most recent 400 rows STUDIO-WIDE, which on a busy week does not reach back
 * to Sunday, and `entrySums` — which does — is on the cold tier and can be ten
 * minutes behind (v1.18.2). A day you are looking at has to be exact.
 *
 * Pass `date: null` to hold the fetch (a closed accordion should cost nothing).
 */
export function useDayEntries(userId: string, date: string | null) {
  /**
   * Tagged with the day it belongs to, so "ready" is DERIVED: opening a second
   * day can never flash the first day's rows under the new heading, and there is
   * no separate flag to reset inside an effect.
   */
  const [fetched, setFetched] = useState<{ key: string; rows: TimeEntry[] } | null>(null);
  const { loadDayEntries } = useData();

  const reload = useCallback(() => {
    if (!date) return;
    void loadDayEntries(userId, date).then((rows) =>
      setFetched({ key: `${userId}|${date}`, rows: rows.filter((r) => r.minutes > 0) }),
    );
  }, [loadDayEntries, userId, date]);

  useEffect(reload, [reload]);

  const rows = date && fetched?.key === `${userId}|${date}` ? fetched.rows : null;
  return { rows, reload };
}

/** One tappable logged line: client, task, note, hours. */
export function LoggedEntryRow({
  entry,
  onPick,
}: {
  entry: TimeEntry;
  onPick: (entry: TimeEntry) => void;
}) {
  const { tasks, clients, freshEntryId } = useData();
  const task = tasks.find((t) => t.id === entry.taskId);
  const client = clients.find((c) => c.id === task?.clientId);
  return (
    <button
      onClick={() => onPick(entry)}
      // the whole line opens the editor — on a phone a pencil beside it would be
      // a 16px target next to a 300px one
      // ⚠️ 3A: `row-flash` on the row just created — same reasoning as the task
      // pane's time list, and it matters more here, because this list is a whole
      // day of entries and a new one does not go at the end.
      className={`flex min-h-11 w-full items-start gap-2 rounded-lg px-1 py-1 text-left hover:bg-background ${
        entry.id === freshEntryId ? "row-flash" : ""
      }`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          {client && <ClientChip client={client} size="sm" link={false} />}
          <span className="bidi-auto min-w-0 truncate text-sm">
            {task?.title ?? "(deleted task)"}
          </span>
        </span>
        {entry.description && (
          <span className="bidi-auto line-clamp-2 text-xs text-muted">{entry.description}</span>
        )}
      </span>
      <span className="shrink-0 text-sm tabular-nums text-muted">
        {formatHoursDecimal(entry.minutes)}h
      </span>
    </button>
  );
}

/**
 * "3h 30m / 8h" over a filled bar — what a day adds up to against the target.
 *
 * The bar turns green at or past the target rather than red: this is a day's own
 * work, not a budget being overrun.
 */
export function DayTotalBar({
  minutes,
  targetMinutes,
  label = "Logged",
}: {
  minutes: number;
  targetMinutes: number;
  label?: string;
}) {
  const pct = Math.min(100, targetMinutes > 0 ? (minutes / targetMinutes) * 100 : 0);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums">
          <span className="font-semibold text-foreground">{formatHours(minutes)}</span>
          <span className="text-muted"> / {formatHours(targetMinutes)}</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
