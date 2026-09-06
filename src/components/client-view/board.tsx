"use client";

// One task as a card on the Board tab.

import { Avatar, BudgetBar } from "../ui";
import { drag } from "./shared";
import { useData } from "@/lib/store";
import type { Task } from "@/lib/types";


export function BoardCard({ task, draggable }: { task: Task; draggable: boolean }) {
  const { profiles, openTask, taskMinutes } = useData();
  const assignee = profiles.find((p) => p.id === task.assigneeId) ?? null;
  return (
    <button
      draggable={draggable}
      onDragStart={() => {
        drag.boardId = task.id;
      }}
      onDragEnd={() => {
        drag.boardId = null;
      }}
      onClick={() => openTask(task.id)}
      className={`flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-left hover:border-brand ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${task.pending ? "opacity-50" : ""}`}
    >
      <span className="bidi-auto text-sm font-medium">{task.title}</span>
      <div className="flex items-center justify-between">
        <BudgetBar doneMinutes={taskMinutes(task.id)} estimateHours={task.estimateHours} />
        <Avatar profile={assignee} size={22} />
      </div>
    </button>
  );
}

