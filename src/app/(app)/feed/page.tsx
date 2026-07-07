"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/store";
import { formatDate, formatHours } from "@/lib/format";
import { Avatar, ClientChip } from "@/components/ui";

export default function FeedPage() {
  const { timeEntries, tasks, projects, clients, profiles, openTask } = useData();
  const [clientFilter, setClientFilter] = useState("");
  const [memberFilter, setMemberFilter] = useState("");

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const sorted = [...timeEntries]
    .filter((e) => {
      if (memberFilter && e.userId !== memberFilter) return false;
      if (clientFilter) {
        const t = taskById.get(e.taskId);
        const p = t ? projectById.get(t.projectId) : undefined;
        if (p?.clientId !== clientFilter) return false;
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl">Time Feed</h1>
          <p className="text-sm text-muted">
            Recent hours across the studio — newest first. Open a task to move hours between tasks.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">All clients</option>
            {clients
              .filter((c) => !c.archived)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">All members</option>
            {profiles
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {sorted.map((entry) => {
          const user = profiles.find((p) => p.id === entry.userId) ?? null;
          const task = tasks.find((t) => t.id === entry.taskId);
          const project = projects.find((p) => p.id === task?.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          return (
            <div
              key={entry.id}
              className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0 hover:bg-background"
              onClick={() => task && openTask(task.id)}
            >
              <Avatar profile={user} size={26} />
              <span className="w-16 shrink-0 text-xs text-muted">{formatDate(entry.date)}</span>
              <span className="w-16 shrink-0 font-semibold tabular-nums">
                {formatHours(entry.minutes)}
              </span>
              {client && (
                <span className="w-28 shrink-0">
                  <ClientChip client={client} size="sm" />
                </span>
              )}
              <span className="bidi-auto w-44 shrink-0 truncate font-medium">{task?.title}</span>
              <span className="bidi-auto min-w-0 flex-1 truncate text-muted">
                {entry.description || <span className="italic text-faint">no description</span>}
              </span>
              {entry.movedFromTaskId && (
                <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                  moved
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
