"use client";

import Link from "next/link";
import { use } from "react";
import { useData } from "@/lib/store";
import { formatHoursShort } from "@/lib/format";
import { ClientChip } from "@/components/ui";

export default function ClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = use(params);
  const { clients, projects, tasks, taskMinutes } = useData();
  const client = clients.find((c) => c.id === clientId);

  if (!client) return <div className="text-muted">Client not found.</div>;

  const clientProjects = projects.filter((p) => p.clientId === client.id && !p.archived);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <ClientChip client={client} />
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{client.name}</h1>
        {client.billingPeriodNote && (
          <p className="text-sm text-muted">Billing: {client.billingPeriodNote}</p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clientProjects.map((project) => {
          const projectTasks = tasks.filter((t) => t.projectId === project.id);
          const openTasks = projectTasks.filter((t) => t.status !== "done").length;
          const minutes = projectTasks.reduce((sum, t) => sum + taskMinutes(t.id), 0);
          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{project.name}</span>
                {!project.billable && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    non-billable
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-muted">
                <span>
                  <span className="font-semibold text-foreground">{openTasks}</span> open tasks
                </span>
                <span>
                  <span className="font-semibold text-foreground">{formatHoursShort(minutes)}</span> logged
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
