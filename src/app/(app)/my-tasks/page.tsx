"use client";

import { useData } from "@/lib/store";
import { TaskListRow, TASK_ROW_COLS } from "@/components/task-list-row";

export default function MyTasksPage() {
  const { tasks, currentUserId } = useData();

  const mine = tasks.filter((t) => t.assigneeId === currentUserId && t.status !== "done");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
      {mine.length === 0 && (
        <p className="text-sm text-muted">Nothing assigned to you right now.</p>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-3 border-b border-border bg-background px-4 py-2 text-xs font-medium uppercase tracking-wide text-faint">
          <span className={TASK_ROW_COLS.client}>Client</span>
          <span className={TASK_ROW_COLS.section}>Section</span>
          <span className="min-w-0 flex-1">Task</span>
          <span className={TASK_ROW_COLS.loggedBy}>Logged by</span>
          <span className={TASK_ROW_COLS.due}>Due</span>
          <span className={TASK_ROW_COLS.addTime} />
        </div>
        {mine.map((task) => (
          <TaskListRow key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
