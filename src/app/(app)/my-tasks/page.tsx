"use client";

import { useData } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { BudgetBar, ClientChip, TagBadge } from "@/components/ui";

export default function MyTasksPage() {
  const { tasks, projects, clients, currentUserId, openTask, taskMinutes, startTimer, runningTimer } =
    useData();

  const mine = tasks.filter((t) => t.assigneeId === currentUserId && t.status !== "done");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
      {mine.length === 0 && (
        <p className="text-sm text-muted">
          Nothing assigned to you right now. (You are viewing as Nitsan — mock login.)
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {mine.map((task) => {
          const project = projects.find((p) => p.id === task.projectId);
          const client = clients.find((c) => c.id === project?.clientId);
          return (
            <div
              key={task.id}
              className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0 hover:bg-background"
              onClick={() => openTask(task.id)}
            >
              {client && <span className="w-28 shrink-0"><ClientChip client={client} size="sm" /></span>}
              <span className="bidi-auto min-w-0 flex-1 truncate font-medium">{task.title}</span>
              <span className="w-40 shrink-0">{task.tag && <TagBadge tag={task.tag} />}</span>
              <span className="w-24 shrink-0">
                <BudgetBar doneMinutes={taskMinutes(task.id)} estimateHours={task.estimateHours} />
              </span>
              <span className="w-14 shrink-0 text-xs text-muted">
                {task.dueDate ? formatDate(task.dueDate) : ""}
              </span>
              <button
                disabled={runningTimer != null}
                onClick={(e) => {
                  e.stopPropagation();
                  startTimer(task.id);
                }}
                className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand disabled:opacity-40"
              >
                ▶ Track
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
