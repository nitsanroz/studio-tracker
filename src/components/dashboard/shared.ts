"use client";

// The filter every pane on this page reads, and the small helpers they share.
//
// ⚠️ `useHoursScope` is the reason an admin's charts and a member's charts can
// never disagree about WHICH hours they describe: admins see the studio,
// members see their own, and that decision is made once, here, rather than in
// each pane that needs it.

import { formatHoursAvg, formatHoursShort } from "@/lib/format";
import { useData } from "@/lib/store";
import { useMemo } from "react";


export interface HomeFilter {
  range: { from: string; to: string } | null; // null = all time
  label: string;
  clientId: string;
  /**
   * Admin toggle: when on, every hour figure on the page counts BILLABLE tasks
   * only. The two billable-SHARE readouts (the Billable tile, the per-designer
   * bars) deliberately keep their denominator on all hours — a share of a
   * billable-only total is 100% by construction and would say nothing.
   */
  billableOnly: boolean;
}


/** Clients named individually in the donut; the rest fold into "Other". */
export const PIE_CLIENTS = 15;

/** Series label the "hours over time" headline reads (see totalSeries below). */
export const TOTAL_SERIES = "All hours";


/**
 * The rows both "Hours over time" and the by-client donut read, scoped by the
 * page filter. One hook so the two panes can never disagree about which hours
 * they are describing.
 */
export function useHoursScope(filter: HomeFilter, isAdmin: boolean) {
  const { entrySums, entrySumsAll, tasks, clients, currentUserId } = useData();

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  // Admins see the whole studio, INCLUDING the recovered pre-Everhour history, so
  // "All time" reaches back to 2016 instead of stopping at the Everhour cutover.
  // Members see only their own hours and must stay on the legacy-free list — a
  // backfilled 2019 entry is not time they logged.
  const source = isAdmin ? entrySumsAll : entrySums;
  const scoped = useMemo(
    () =>
      source.filter((e) => {
        if (!isAdmin && e.userId !== currentUserId) return false;
        if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) return false;
        const task = taskById.get(e.taskId);
        if (filter.clientId && task?.clientId !== filter.clientId) return false;
        if (filter.billableOnly && !task?.billable) return false;
        return true;
      }),
    [source, currentUserId, isAdmin, filter, taskById],
  );

  return { scoped, taskById, clientById };
}


/** figure + unit split so the unit renders smaller, e.g. "353.8" + "h" */
export function splitHours(min: number, avg = false): readonly [string, string] {
  const s = avg ? formatHoursAvg(min) : formatHoursShort(min);
  const m = s.match(/^([\d.,]+)(.*)$/);
  return m ? [m[1], m[2]] : [s, ""];
}


/** calendar diff since start date → "Xy Ym Zd" */
export function tenureSince(startIso: string): string {
  const start = new Date(startIso);
  const now = new Date();
  let y = now.getFullYear() - start.getFullYear();
  let m = now.getMonth() - start.getMonth();
  let d = now.getDate() - start.getDate();
  if (d < 0) {
    m -= 1;
    d += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  return `${y}y ${m}m ${d}d`;
}
