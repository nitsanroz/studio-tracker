import { addDays, formatFeedDate, startOfWeek, toISODate } from "./format";
import type {
  BillingPeriod,
  Client,
  EntrySum,
  ReportSnapshot,
  Section,
  Task,
} from "./types";

/** Sun–Sat week buckets covering the given entries; only weeks with hours. */
function buildWeeks(entries: EntrySum[]): { label: string; from: string; to: string }[] {
  if (entries.length === 0) return [];
  const dates = entries.map((e) => e.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const weeks: { label: string; from: string; to: string }[] = [];
  const [y, m, d] = first.split("-").map(Number);
  let cur = startOfWeek(new Date(y, m - 1, d));
  const minutesInWeek = (from: string, to: string) =>
    entries.some((e) => e.date >= from && e.date <= to);
  while (toISODate(cur) <= last) {
    const from = toISODate(cur);
    const to = toISODate(addDays(cur, 6));
    if (minutesInWeek(from, to)) {
      const shortFrom = formatFeedDate(from).split(" ").slice(0, 2).join(" ");
      const shortTo = formatFeedDate(to).split(" ").slice(0, 2).join(" ");
      weeks.push({ label: `${shortFrom} – ${shortTo}`, from, to });
    }
    cur = addDays(cur, 7);
  }
  return weeks;
}

/**
 * Freeze a client's approved hours into a snapshot for publishing.
 * Only billable tasks appear (keys/internal tasks are non-billable by
 * convention), and only if they have logged hours or an estimate.
 */
export function buildReportSnapshot(
  client: Client,
  sections: Section[],
  tasks: Task[],
  entrySums: EntrySum[],
  periods: BillingPeriod[],
): ReportSnapshot {
  const clientTasks = tasks.filter((t) => t.clientId === client.id && t.billable && !t.pending);
  const taskIds = new Set(clientTasks.map((t) => t.id));

  const totalByTask = new Map<string, number>();
  const periodByTask = new Map<string, number[]>();
  const weekByTask = new Map<string, number[]>();
  const sorted = [...periods].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));
  const clientEntries = entrySums.filter((e) => taskIds.has(e.taskId));
  const weeks = buildWeeks(clientEntries);

  for (const e of clientEntries) {
    totalByTask.set(e.taskId, (totalByTask.get(e.taskId) ?? 0) + e.minutes);
    let arr = periodByTask.get(e.taskId);
    if (!arr) periodByTask.set(e.taskId, (arr = sorted.map(() => 0)));
    sorted.forEach((p, i) => {
      if (e.date >= p.dateFrom && e.date <= p.dateTo) arr![i] += e.minutes;
    });
    let warr = weekByTask.get(e.taskId);
    if (!warr) weekByTask.set(e.taskId, (warr = weeks.map(() => 0)));
    weeks.forEach((w, i) => {
      if (e.date >= w.from && e.date <= w.to) warr![i] += e.minutes;
    });
  }

  const clientSections = sections
    .filter((s) => s.clientId === client.id)
    .sort((a, b) => a.position - b.position);

  const bySection = new Map<string | null, Task[]>();
  for (const t of clientTasks) {
    const key = t.sectionId ?? null;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(t);
  }

  const sectionBlocks: ReportSnapshot["sections"] = [];
  const pushBlock = (name: string, list: Task[]) => {
    const rows = list
      .filter((t) => (totalByTask.get(t.id) ?? 0) > 0 || t.estimateHours != null)
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        id: t.id,
        title: t.title,
        estimateHours: t.estimateHours,
        totalMinutes: totalByTask.get(t.id) ?? 0,
        periodMinutes: periodByTask.get(t.id) ?? sorted.map(() => 0),
        weekMinutes: weekByTask.get(t.id) ?? weeks.map(() => 0),
      }));
    if (rows.length > 0) sectionBlocks.push({ name, tasks: rows });
  };

  for (const s of clientSections) pushBlock(s.name, bySection.get(s.id) ?? []);
  pushBlock("Other", bySection.get(null) ?? []);

  return {
    clientName: client.name,
    clientColor: client.color,
    generatedAt: new Date().toISOString(),
    periods: sorted.map((p) => ({
      label: p.label,
      from: p.dateFrom,
      to: p.dateTo,
      hourCap: p.hourCap,
      advanceHours: p.advanceHours,
    })),
    weeks,
    sections: sectionBlocks,
  };
}
