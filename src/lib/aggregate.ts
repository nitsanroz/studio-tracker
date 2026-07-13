import type { EntrySum, Task } from "./types";

/** taskId → clientId lookup. */
export function buildTaskClientMap(tasks: Task[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tasks) {
    if (t.clientId) map.set(t.id, t.clientId);
  }
  return map;
}

export interface SumFilter {
  from?: string; // inclusive ISO date
  to?: string; // inclusive ISO date
  userId?: string;
  clientId?: string;
}

/** Total minutes matching the filter. */
export function sumInRange(
  entrySums: EntrySum[],
  filter: SumFilter,
  taskClient?: Map<string, string>,
): number {
  let total = 0;
  for (const e of entrySums) {
    if (filter.from && e.date < filter.from) continue;
    if (filter.to && e.date > filter.to) continue;
    if (filter.userId && e.userId !== filter.userId) continue;
    if (filter.clientId && taskClient?.get(e.taskId) !== filter.clientId) continue;
    total += e.minutes;
  }
  return total;
}

/** clientId → total minutes within [from, to]. */
export function minutesByClientInRange(
  entrySums: EntrySum[],
  from: string,
  to: string,
  taskClient: Map<string, string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entrySums) {
    if (e.date < from || e.date > to) continue;
    const clientId = taskClient.get(e.taskId);
    if (!clientId) continue;
    out.set(clientId, (out.get(clientId) ?? 0) + e.minutes);
  }
  return out;
}

/** userId → total minutes within [from, to]. */
export function minutesByUserInRange(
  entrySums: EntrySum[],
  from: string,
  to: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entrySums) {
    if (e.date < from || e.date > to) continue;
    out.set(e.userId, (out.get(e.userId) ?? 0) + e.minutes);
  }
  return out;
}

/** clientId → latest entry date (ISO), for recent-activity ordering. */
export function latestActivityByClient(
  entrySums: EntrySum[],
  taskClient: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of entrySums) {
    const clientId = taskClient.get(e.taskId);
    if (!clientId) continue;
    const prev = out.get(clientId);
    if (!prev || e.date > prev) out.set(clientId, e.date);
  }
  return out;
}
