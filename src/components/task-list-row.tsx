"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { useData } from "@/lib/store";
import { formatHoursShort, parseDuration, toISODate } from "@/lib/format";
import { Avatar, ClientChip, TagBadge } from "./ui";
import { useColWidths, ResizeHandle } from "./resizable";
import type { Task } from "@/lib/types";

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

/** "12/7" — day/month, no year. */
function formatDueShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}/${m}`;
}

// column order per Nitsan: Tags, Figma, Budget, Hrs done, %done, Hrs by me, %Billable
const COLS: { key: string; label: string; w: number }[] = [
  { key: "client", label: "Client", w: 110 },
  { key: "section", label: "Section", w: 150 },
  // task column flexes — no fixed width
  { key: "tags", label: "Tags", w: 90 },
  { key: "figma", label: "Figma", w: 76 },
  { key: "budget", label: "Budget", w: 64 },
  { key: "done", label: "Hrs done", w: 72 },
  { key: "pctDone", label: "% done", w: 64 },
  { key: "mine", label: "Hrs by me", w: 78 },
  { key: "pctBill", label: "%Billable", w: 70 },
  { key: "loggedBy", label: "Logged by", w: 96 },
  { key: "due", label: "Due", w: 52 },
  { key: "add", label: "", w: 96 },
];
const DEFAULT_WIDTHS = Object.fromEntries(COLS.map((c) => [c.key, c.w]));

function LoggedByGroup({ userIds, profiles }: { userIds: string[]; profiles: ReturnType<typeof useData>["profiles"] }) {
  const shown = userIds.slice(0, 4);
  const extra = userIds.length - shown.length;
  return (
    <span className="flex items-center">
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

/**
 * Task table with the full column set + drag-resizable columns.
 * Used by the My Tasks page AND the Home "My tasks" card.
 */
export function TaskTable({ tasks, tableKey = "tasks" }: { tasks: Task[]; tableKey?: string }) {
  const { clients, sections, profiles, entrySums, currentUserId, openTask } = useData();
  const { widths, startResize } = useColWidths(tableKey, DEFAULT_WIDTHS);
  const [adding, setAdding] = useState<string | null>(null);

  // hours per task (total / mine) + who logged
  const stats = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    const total = new Map<string, number>();
    const mine = new Map<string, number>();
    const users = new Map<string, string[]>();
    for (const e of entrySums) {
      if (!ids.has(e.taskId)) continue;
      total.set(e.taskId, (total.get(e.taskId) ?? 0) + e.minutes);
      if (e.userId === currentUserId) mine.set(e.taskId, (mine.get(e.taskId) ?? 0) + e.minutes);
      const arr = users.get(e.taskId) ?? [];
      if (!arr.includes(e.userId)) arr.push(e.userId);
      users.set(e.taskId, arr);
    }
    return { total, mine, users };
  }, [entrySums, tasks, currentUserId]);

  const cell = (key: string) => ({ width: widths[key], flexShrink: 0 } as const);
  const todayIso = toISODate(new Date());

  return (
    <div className="overflow-x-auto">
      <div className="min-w-fit">
        {/* header */}
        <div className="group/thead flex items-center gap-3 border-b border-border bg-background px-4 py-2 text-xs font-medium uppercase tracking-wide text-faint">
          {COLS.slice(0, 2).map((c) => (
            <span key={c.key} className="relative" style={cell(c.key)}>
              {c.label}
              <ResizeHandle onMouseDown={startResize(c.key)} />
            </span>
          ))}
          <span className="min-w-24 flex-1">Task</span>
          {COLS.slice(2).map((c) => (
            <span key={c.key} className="relative" style={cell(c.key)}>
              {c.label}
              {c.key !== "add" && <ResizeHandle onMouseDown={startResize(c.key)} />}
            </span>
          ))}
        </div>

        {tasks.map((task) => {
          const client = clients.find((c) => c.id === task.clientId);
          const section = sections.find((s) => s.id === task.sectionId);
          const total = stats.total.get(task.id) ?? 0;
          const my = stats.mine.get(task.id) ?? 0;
          const budget = task.estimateHours;
          const pctDone = budget && budget > 0 ? Math.round((total / 60 / budget) * 100) : null;
          const overdue = task.dueDate != null && task.status !== "done" && task.dueDate < todayIso;
          return (
            <div
              key={task.id}
              className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0 hover:bg-background"
              onClick={() => openTask(task.id)}
            >
              <span style={cell("client")}>
                {client && <ClientChip client={client} size="sm" link={false} />}
              </span>
              <span className="bidi-auto truncate text-muted" style={cell("section")}>
                {section?.name}
              </span>
              <span className="bidi-auto min-w-24 flex-1 truncate font-medium">{task.title}</span>
              <span className="truncate" style={cell("tags")}>
                {task.tag && <TagBadge tag={task.tag} />}
              </span>
              <span style={cell("figma")} onClick={(e) => e.stopPropagation()}>
                {task.figmaUrl && (
                  <a
                    href={task.figmaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                  >
                    Figma <ExternalLink size={10} />
                  </a>
                )}
              </span>
              <span className="text-xs tabular-nums text-muted" style={cell("budget")}>
                {budget != null ? `${budget}h` : "–"}
              </span>
              <span className="text-xs font-medium tabular-nums" style={cell("done")}>
                {total > 0 ? formatHoursShort(total) : "–"}
              </span>
              <span
                className={`text-xs tabular-nums ${pctDone != null && pctDone > 100 ? "font-medium text-danger" : "text-muted"}`}
                style={cell("pctDone")}
              >
                {pctDone != null ? `${pctDone}%` : "–"}
              </span>
              <span className="text-xs tabular-nums text-muted" style={cell("mine")}>
                {my > 0 ? formatHoursShort(my) : "–"}
              </span>
              <span className="text-xs tabular-nums text-muted" style={cell("pctBill")}>
                {total > 0 ? (task.billable ? "100%" : "0%") : "–"}
              </span>
              <span style={cell("loggedBy")}>
                <LoggedByGroup userIds={stats.users.get(task.id) ?? []} profiles={profiles} />
              </span>
              <span
                className={`text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}
                style={cell("due")}
              >
                {task.dueDate ? formatDueShort(task.dueDate) : ""}
              </span>
              <span className="relative" style={cell("add")} onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setAdding((v) => (v === task.id ? null : task.id))}
                  className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand"
                >
                  <Plus size={12} /> Add time
                </button>
                {adding === task.id && (
                  <AddTimePopover taskId={task.id} onClose={() => setAdding(null)} />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
