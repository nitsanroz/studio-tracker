"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { useData } from "@/lib/store";
import { formatDate, parseDuration, toISODate } from "@/lib/format";
import { Avatar, ClientChip } from "./ui";
import type { Task } from "@/lib/types";

/** Column widths shared with the My Tasks table header. */
export const TASK_ROW_COLS = {
  client: "w-28 shrink-0",
  section: "w-28 shrink-0",
  loggedBy: "w-24 shrink-0",
  due: "w-16 shrink-0",
  addTime: "w-24 shrink-0",
} as const;

function AddTimePopover({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { addTimeEntry } = useData();
  const [duration, setDuration] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => toISODate(new Date()));

  const minutes = parseDuration(duration);
  const canAdd = minutes != null && minutes > 0 && description.trim() !== "";

  function submit() {
    if (!canAdd || minutes == null) return;
    addTimeEntry(taskId, minutes, description.trim(), date);
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full z-50 mt-1 flex w-64 flex-col gap-2 rounded-xl border border-border bg-surface p-3 shadow-xl">
        <div className="flex gap-2">
          <input
            autoFocus
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="1.5h"
            className={`w-16 rounded-md border bg-surface px-1.5 py-1.5 text-sm outline-none focus:border-brand ${
              duration && minutes == null ? "border-danger" : "border-border"
            }`}
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
          />
        </div>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="What was done? (required)"
          className="bidi-auto rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
        />
        <button
          disabled={!canAdd}
          onClick={submit}
          className="flex items-center justify-center gap-1 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-40"
        >
          <Plus size={13} /> Add time
        </button>
      </div>
    </>
  );
}

function LoggedByGroup({ taskId }: { taskId: string }) {
  const { entrySums, profiles } = useData();
  const userIds = [...new Set(entrySums.filter((e) => e.taskId === taskId).map((e) => e.userId))];
  const shown = userIds.slice(0, 4);
  const extra = userIds.length - shown.length;

  return (
    <span className={`flex items-center ${TASK_ROW_COLS.loggedBy}`}>
      {shown.map((id, i) => (
        <span key={id} className={`rounded-full ring-2 ring-surface ${i > 0 ? "-ml-1.5" : ""}`}>
          <Avatar profile={profiles.find((p) => p.id === id) ?? null} size={20} />
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 inline-flex size-5 items-center justify-center rounded-full bg-background text-[10px] font-medium text-muted ring-2 ring-surface">
          +{extra}
        </span>
      )}
    </span>
  );
}

/** "12/7" — day/month, no year. */
function formatDueShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}/${m}`;
}

/** One task in a flat list (My Tasks full columns, dashboard compact). */
export function TaskListRow({ task, compact = false }: { task: Task; compact?: boolean }) {
  const { clients, sections, openTask } = useData();
  const client = clients.find((c) => c.id === task.clientId);
  const [adding, setAdding] = useState(false);

  if (compact) {
    return (
      <div
        className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0 hover:bg-background"
        onClick={() => openTask(task.id)}
      >
        {client && (
          <span className="w-24 shrink-0">
            <ClientChip client={client} size="sm" link={false} />
          </span>
        )}
        <span className="bidi-auto min-w-0 flex-1 truncate font-medium">{task.title}</span>
        <span className="w-14 shrink-0 text-xs text-muted">
          {task.dueDate ? formatDate(task.dueDate) : ""}
        </span>
      </div>
    );
  }

  const section = sections.find((s) => s.id === task.sectionId);
  const overdue =
    task.dueDate != null && task.status !== "done" && task.dueDate < toISODate(new Date());

  return (
    <div
      className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0 hover:bg-background"
      onClick={() => openTask(task.id)}
    >
      <span className={TASK_ROW_COLS.client}>
        {client && <ClientChip client={client} size="sm" link={false} />}
      </span>
      <span className={`bidi-auto truncate text-muted ${TASK_ROW_COLS.section}`}>
        {section?.name}
      </span>
      <span className="bidi-auto min-w-0 flex-1 truncate font-medium">{task.title}</span>
      <LoggedByGroup taskId={task.id} />
      <span className={`text-xs ${overdue ? "font-medium text-danger" : "text-muted"} ${TASK_ROW_COLS.due}`}>
        {task.dueDate ? formatDueShort(task.dueDate) : ""}
      </span>
      <span className={`relative ${TASK_ROW_COLS.addTime}`} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand"
        >
          <Plus size={12} /> Add time
        </button>
        {adding && <AddTimePopover taskId={task.id} onClose={() => setAdding(false)} />}
      </span>
    </div>
  );
}
