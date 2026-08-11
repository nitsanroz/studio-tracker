"use client";

import { useData } from "@/lib/store";
import { TaskTable } from "@/components/task-list-row";

export default function MyTasksPage() {
  const { tasks, currentUserId } = useData();

  const mine = tasks.filter((t) => t.assigneeId === currentUserId && t.status !== "done");

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <h1 className="font-serif-accent text-3xl">My Tasks</h1>
      {mine.length === 0 && (
        <p className="text-sm text-muted">Nothing assigned to you right now.</p>
      )}
      {/* The card chrome is `md:` only. Below that `TaskTable` renders its own
          cards, and a white card full of white cards reads as a mistake — it also
          spent 28px of a 375px screen on two nested paddings. On a phone the
          cards sit straight on the page. */}
      <div className="overflow-hidden md:rounded-2xl md:border md:border-border md:bg-surface md:shadow-card">
        <TaskTable tasks={mine} tableKey="my-tasks" />
      </div>
    </div>
  );
}
