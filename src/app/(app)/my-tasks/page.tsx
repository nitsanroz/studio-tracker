"use client";

import { useData } from "@/lib/store";
import { TaskTable } from "@/components/task-list-row";

export default function MyTasksPage() {
  const { tasks, currentUserId } = useData();

  const mine = tasks.filter((t) => t.assigneeId === currentUserId && t.status !== "done");

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
      {mine.length === 0 && (
        <p className="text-sm text-muted">Nothing assigned to you right now.</p>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <TaskTable tasks={mine} tableKey="my-tasks" />
      </div>
    </div>
  );
}
