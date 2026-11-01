"use client";

import { useData } from "@/lib/store";
import { TaskTable } from "@/components/task-list-row";
import { toISODate } from "@/lib/format";
import { taskBucket } from "@/lib/task-buckets";

export default function MyTasksPage() {
  const { tasks, currentUserId } = useData();

  const mine = tasks.filter((t) => t.assigneeId === currentUserId && t.status !== "done");
  // The one line under the title (2026-11, design-lab option A): how many, and
  // how many need you first — the same buckets the table is grouped by.
  const today = toISODate(new Date());
  const overdue = mine.filter((t) => taskBucket(t.dueDate, today) === "overdue").length;
  const week = mine.filter((t) => taskBucket(t.dueDate, today) === "week").length;

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <div>
        <h1 className="page-title">
          My <span className="font-serif-accent">tasks</span>
        </h1>
        {mine.length > 0 && (
          <p className="mt-1 text-sm text-muted">
            {mine.length} open
            {overdue > 0 && <span className="text-danger"> · {overdue} overdue</span>}
            {week > 0 && <> · {week} due this week</>}
          </p>
        )}
      </div>
      {/* The card chrome is `md:` only. Below that `TaskTable` renders its own
          cards, and a white card full of white cards reads as a mistake — it also
          spent 28px of a 375px screen on two nested paddings. On a phone the
          cards sit straight on the page. */}
      <div className="overflow-hidden md:rounded-2xl md:border md:border-border md:bg-surface md:shadow-card">
        <TaskTable tasks={mine} tableKey="my-tasks" grouped />
      </div>
    </div>
  );
}
