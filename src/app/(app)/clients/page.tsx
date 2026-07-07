"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useData } from "@/lib/store";
import { formatHoursShort } from "@/lib/format";

export default function ClientsPage() {
  const { clients, projects, tasks, taskMinutes } = useData();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients
      .filter((c) => !c.archived && (q === "" || c.name.toLowerCase().includes(q)))
      .map((client) => {
        const clientProjects = projects.filter((p) => p.clientId === client.id && !p.archived);
        const projectIds = new Set(clientProjects.map((p) => p.id));
        const clientTasks = tasks.filter((t) => projectIds.has(t.projectId));
        const openTasks = clientTasks.filter((t) => t.status !== "done").length;
        const minutes = clientTasks.reduce((sum, t) => sum + taskMinutes(t.id), 0);
        const href =
          clientProjects.length === 1
            ? `/projects/${clientProjects[0].id}`
            : `/clients/${client.id}`;
        return { client, clientProjects, openTasks, minutes, href };
      })
      .sort((a, b) => b.openTasks - a.openTasks || b.minutes - a.minutes);
  }, [clients, projects, tasks, taskMinutes, query]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="text-2xl">Clients</h1>

      <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3">
        <Search size={15} className="shrink-0 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="bidi-auto h-9 w-full bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </div>

      <div className="flex flex-col gap-2">
        {rows.map(({ client, clientProjects, openTasks, minutes, href }) => (
          <Link
            key={client.id}
            href={href}
            className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand"
          >
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-white"
              style={{ backgroundColor: client.color }}
            >
              {client.name[0]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{client.name}</div>
              <div className="truncate text-xs text-muted">
                {clientProjects.length} project{clientProjects.length === 1 ? "" : "s"}
                {client.billingPeriodNote && <> · {client.billingPeriodNote}</>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-5 text-right text-xs text-muted">
              <span>
                <span className="block text-sm font-semibold text-foreground">{openTasks}</span>
                open
              </span>
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  {formatHoursShort(minutes)}
                </span>
                logged
              </span>
            </div>
          </Link>
        ))}
        {rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-faint">
            No clients match &quot;{query}&quot;.
          </div>
        )}
      </div>
    </div>
  );
}
