"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCircle2, Maximize2, Plus } from "lucide-react";
import { useData } from "@/lib/store";
import { formatDate, formatHoursShort } from "@/lib/format";
import { Avatar, BudgetBar, CollapseChevron, TagBadge } from "./ui";
import {
  EditableDateCell,
  EditableNumberCell,
  EditableSelectCell,
  EditableTextCell,
} from "./editable-cell";
import { ClientReportButtons } from "./client-report-buttons";
import { HBar, LineChart } from "./charts";
import type { Profile, Section, Task } from "@/lib/types";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Right-hand client stats: totals, hours per month, hours per user. */
function ClientStats({ clientId }: { clientId: string }) {
  const { tasks, profiles, entrySums, currentUserId } = useData();
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";

  const stats = useMemo(() => {
    const clientTaskIds = new Set(tasks.filter((t) => t.clientId === clientId).map((t) => t.id));
    const open = tasks.filter((t) => t.clientId === clientId && t.status !== "done").length;
    const billableTaskIds = new Set(
      tasks.filter((t) => t.clientId === clientId && t.billable).map((t) => t.id),
    );

    let total = 0;
    let billable = 0;
    const byMonth = new Map<string, number>();
    const byUser = new Map<string, number>();
    for (const e of entrySums) {
      if (!clientTaskIds.has(e.taskId)) continue;
      total += e.minutes;
      if (billableTaskIds.has(e.taskId)) billable += e.minutes;
      const month = e.date.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + e.minutes);
      byUser.set(e.userId, (byUser.get(e.userId) ?? 0) + e.minutes);
    }

    const months = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-8)
      .map(([key, minutes]) => {
        const [y, m] = key.split("-").map(Number);
        return { label: `${MONTH_SHORT[m - 1]}${m === 1 ? ` ${String(y).slice(2)}` : ""}`, minutes };
      });

    const users = [...byUser.entries()]
      .map(([id, minutes]) => ({ profile: profiles.find((p) => p.id === id), minutes }))
      .filter((u) => u.profile)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 8);

    return { total, billable, open, months, users };
  }, [tasks, profiles, entrySums, clientId]);

  const maxUser = stats.users[0]?.minutes ?? 0;

  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-4 self-start xl:flex">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[11px] font-medium text-muted">Total logged</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">
            {formatHoursShort(stats.total)}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="text-[11px] font-medium text-muted">Open tasks</div>
          <div className="mt-0.5 text-xl font-semibold tabular-nums">{stats.open}</div>
        </div>
        {isAdmin && (
          <div className="col-span-2 rounded-xl border border-border bg-surface p-3">
            <div className="text-[11px] font-medium text-muted">Billable share</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">
              {stats.total > 0 ? `${Math.round((stats.billable / stats.total) * 100)}%` : "–"}
            </div>
          </div>
        )}
      </div>

      {stats.months.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-2 text-[11px] font-medium text-muted">Hours per month</div>
          <LineChart points={stats.months} />
        </div>
      )}

      {stats.users.length > 0 && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3">
          <div className="text-[11px] font-medium text-muted">Hours per user</div>
          {stats.users.map(({ profile, minutes }) => (
            <HBar
              key={profile!.id}
              label={
                <>
                  <Avatar profile={profile!} size={16} />
                  <span className="truncate">{profile!.name}</span>
                </>
              }
              right={formatHoursShort(minutes)}
              minutes={minutes}
              maxMinutes={maxUser}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

const COLS = "flex items-center gap-3 pl-3 pr-4";

type SortKey = "title" | "assignee" | "due" | "tag" | "budget" | "billable";
type Sort = { key: SortKey; dir: 1 | -1 } | null;

/** Nulls/empties always sort last regardless of direction. */
function cmpNullable<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return cmp(a, b) * dir;
}

function makeComparator(
  sort: NonNullable<Sort>,
  profiles: Profile[],
  taskMinutes: (id: string) => number,
): (a: Task, b: Task) => number {
  const name = (t: Task) => profiles.find((p) => p.id === t.assigneeId)?.name ?? null;
  const budget = (t: Task) =>
    t.estimateHours ? taskMinutes(t.id) / 60 / t.estimateHours : null;
  const str = (x: string, y: string) => x.localeCompare(y);
  const num = (x: number, y: number) => x - y;
  switch (sort.key) {
    case "title":
      return (a, b) => str(a.title, b.title) * sort.dir;
    case "assignee":
      return (a, b) => cmpNullable(name(a), name(b), str, sort.dir);
    case "due":
      return (a, b) => cmpNullable(a.dueDate, b.dueDate, str, sort.dir);
    case "tag":
      return (a, b) => cmpNullable(a.tag, b.tag, str, sort.dir);
    case "budget":
      return (a, b) => cmpNullable(budget(a), budget(b), num, sort.dir);
    case "billable":
      return (a, b) => (Number(b.billable) - Number(a.billable)) * sort.dir;
  }
}

const SORT_HINTS: Record<SortKey, string> = {
  title: "Task title — click a cell to rename. Click to sort",
  assignee: "Who the task is assigned to — click a cell to change. Click to sort",
  due: "Due date — click a cell to change. Click to sort",
  tag: "Task tag — click a cell to change. Click to sort",
  budget: "Hours logged vs the estimate — click a cell to edit the budget. Click to sort",
  billable: "Billable task? Non-billable hours don't appear on client reports. Click to sort",
};

function SortHeader({
  label,
  k,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  k: SortKey;
  sort: Sort;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort?.key === k;
  const Icon = active ? (sort!.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <button
      onClick={() => onSort(k)}
      className={`group/sort flex items-center gap-1 text-left uppercase tracking-wide ${
        active ? "text-brand" : "text-faint hover:text-muted"
      } ${className}`}
      title={SORT_HINTS[k] ?? `Sort by ${label.toLowerCase()}`}
    >
      {label}
      <Icon
        size={12}
        className={active ? "" : "opacity-0 transition-opacity group-hover/sort:opacity-100"}
      />
    </button>
  );
}

function TaskRow({ task }: { task: Task }) {
  const { profiles, tags, openTask, updateTask, taskMinutes, openTaskId, currentUserId } = useData();
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";
  const assignee = profiles.find((p) => p.id === task.assigneeId) ?? null;
  const done = task.status === "done";
  const active = openTaskId === task.id;

  return (
    <div
      className={`${COLS} group h-10 cursor-pointer border-b border-border text-sm transition-colors ${
        active ? "bg-brand-soft/50" : "hover:bg-background"
      } ${task.pending ? "opacity-50" : ""}`}
      onClick={() => openTask(task.id)}
    >
      {isAdmin ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            updateTask(task.id, { status: done ? "todo" : "done" });
          }}
          className={`shrink-0 transition-colors ${done ? "text-success" : "text-border-strong hover:text-success"}`}
          title={done ? "Reopen" : "Mark complete"}
        >
          <CheckCircle2 size={17} strokeWidth={1.75} fill={done ? "currentColor" : "none"} className={done ? "[&>path]:stroke-white" : ""} />
        </button>
      ) : (
        <span className={`shrink-0 ${done ? "text-success" : "text-border-strong"}`} title={done ? "Completed" : "In progress"}>
          <CheckCircle2 size={17} strokeWidth={1.75} fill={done ? "currentColor" : "none"} className={done ? "[&>path]:stroke-white" : ""} />
        </span>
      )}
      <span className={`flex min-w-0 flex-1 items-center font-medium ${done ? "text-faint line-through" : ""}`}>
        {isAdmin ? (
          <EditableTextCell
            value={task.title}
            onCommit={(v) => v && updateTask(task.id, { title: v })}
          />
        ) : (
          <span className="bidi-auto truncate px-1.5 py-0.5">{task.title}</span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            openTask(task.id);
          }}
          title="Open details"
          className="invisible ml-1 shrink-0 rounded p-0.5 text-faint hover:bg-background hover:text-brand group-hover:visible"
        >
          <Maximize2 size={13} />
        </button>
        {task.pending && (
          <span className="ml-2 shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            pending approval
          </span>
        )}
      </span>
      <span className="hidden w-40 shrink-0 text-xs text-muted sm:block">
        <EditableSelectCell
          value={task.assigneeId ?? ""}
          options={profiles.filter((p) => p.active || p.id === task.assigneeId).map((p) => ({ value: p.id, label: p.name }))}
          onCommit={(v) => updateTask(task.id, { assigneeId: v || null })}
          emptyLabel="Unassigned"
          display={
            assignee ? (
              <span className="flex items-center gap-1.5">
                <Avatar profile={assignee} size={22} />
                <span className="truncate">{assignee.name}</span>
              </span>
            ) : (
              <span className="text-faint">—</span>
            )
          }
        />
      </span>
      <span className="w-16 shrink-0 text-xs text-muted">
        {isAdmin ? (
          <EditableDateCell
            value={task.dueDate}
            onCommit={(v) => updateTask(task.id, { dueDate: v })}
            format={formatDate}
            placeholder=""
          />
        ) : (
          <span className="px-1.5 py-0.5">{task.dueDate ? formatDate(task.dueDate) : ""}</span>
        )}
      </span>
      <span className="hidden w-36 shrink-0 lg:block">
        <EditableSelectCell
          value={task.tag ?? ""}
          options={tags.map((t) => ({ value: t.name, label: t.name }))}
          onCommit={(v) => updateTask(task.id, { tag: v || null })}
          emptyLabel="No tag"
          display={task.tag ? <TagBadge tag={task.tag} /> : null}
        />
      </span>
      <span className="hidden w-28 shrink-0 md:block">
        {isAdmin ? (
          <EditableNumberCell
            value={task.estimateHours}
            onCommit={(v) => updateTask(task.id, { estimateHours: v })}
            display={<BudgetBar doneMinutes={taskMinutes(task.id)} estimateHours={task.estimateHours} />}
          />
        ) : (
          <BudgetBar doneMinutes={taskMinutes(task.id)} estimateHours={task.estimateHours} />
        )}
      </span>
      {isAdmin && (
        <span
          className={`w-4 shrink-0 text-center text-xs ${task.billable ? "text-success" : "text-faint"}`}
          title={task.billable ? "Billable" : "Non-billable"}
        >
          {task.billable ? "$" : "–"}
        </span>
      )}
    </div>
  );
}

function AddTaskRow({ clientId, sectionId }: { clientId: string; sectionId: string | null }) {
  const { addTask } = useData();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`${COLS} h-9 w-full border-b border-border text-left text-sm text-faint hover:bg-background hover:text-muted`}
      >
        <span className="w-[17px]" />
        Add task…
      </button>
    );
  }
  return (
    <form
      className={`${COLS} h-10 border-b border-border`}
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) addTask(clientId, sectionId, title.trim());
        setTitle("");
      }}
    >
      <span className="w-[17px]" />
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim()) addTask(clientId, sectionId, title.trim());
          setTitle("");
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTitle("");
            setEditing(false);
          }
        }}
        placeholder="Task name — Enter to add"
        className="bidi-auto min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
    </form>
  );
}

function SectionGroup({
  section,
  tasks,
  clientId,
}: {
  section: Section | null;
  tasks: Task[];
  clientId: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`${COLS} w-full border-b border-border bg-background/60 py-1.5 text-left text-sm font-bold hover:bg-background`}
      >
        <span className="flex w-[17px] shrink-0 items-center justify-center">
          <CollapseChevron open={open} />
        </span>
        <span className="bidi-auto">{section?.name ?? "No section"}</span>
        <span className="text-xs font-normal text-faint">{tasks.length}</span>
      </button>
      {open && (
        <>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
          <AddTaskRow clientId={clientId} sectionId={section?.id ?? null} />
        </>
      )}
    </div>
  );
}

export function ClientView({ clientId }: { clientId: string }) {
  const { clients, sections, tasks, profiles, taskMinutes, addSection, currentUserId } = useData();
  const isAdmin = profiles.find((p) => p.id === currentUserId)?.role === "admin";
  const [showDone, setShowDone] = useState(false);
  const [view, setView] = useState<"list" | "board">("list");
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const [sort, setSort] = useState<Sort>(null);

  const client = clients.find((c) => c.id === clientId);

  // click = asc, again = desc, third = clear
  const cycleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key !== key ? { key, dir: 1 } : prev.dir === 1 ? { key, dir: -1 } : null,
    );

  const clientSections = useMemo(
    () =>
      sections
        .filter((s) => s.clientId === clientId)
        .sort((a, b) => a.position - b.position),
    [sections, clientId],
  );

  const clientTasks = useMemo(() => {
    const list = tasks
      .filter((t) => t.clientId === clientId && (showDone || t.status !== "done"))
      .sort((a, b) => a.position - b.position);
    if (sort) list.sort(makeComparator(sort, profiles, taskMinutes));
    return list;
  }, [tasks, clientId, showDone, sort, profiles, taskMinutes]);

  if (!client) return <div className="text-muted">Client not found.</div>;

  const noSection = clientTasks.filter((t) => t.sectionId === null);
  const statuses: { key: Task["status"]; label: string }[] = [
    { key: "todo", label: "To do" },
    { key: "in_progress", label: "In progress" },
    { key: "done", label: "Done" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          <ClientReportButtons clientId={client.id} />
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input
              type="checkbox"
              checked={showDone}
              onChange={(e) => setShowDone(e.target.checked)}
            />
            Show completed
          </label>
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {(["list", "board"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${view === v ? "bg-brand-soft text-brand-dark" : "text-muted"}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="min-w-0 max-w-[850px] flex-1">
      {view === "list" ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <div className="min-w-[720px]">
            <div className={`${COLS} h-8 border-b border-border bg-background text-xs font-medium`}>
              <span className="w-[17px] shrink-0" />
              <span className="min-w-0 flex-1">
                <SortHeader label="Name" k="title" sort={sort} onSort={cycleSort} />
              </span>
              <span className="hidden w-40 shrink-0 sm:block">
                <SortHeader label="Assignee" k="assignee" sort={sort} onSort={cycleSort} />
              </span>
              <span className="w-16 shrink-0">
                <SortHeader label="Due" k="due" sort={sort} onSort={cycleSort} />
              </span>
              <span className="hidden w-36 shrink-0 lg:block">
                <SortHeader label="Tag" k="tag" sort={sort} onSort={cycleSort} />
              </span>
              <span className="hidden w-28 shrink-0 md:block">
                <SortHeader label="Budget" k="budget" sort={sort} onSort={cycleSort} />
              </span>
              {isAdmin && (
                <span className="w-4 shrink-0">
                  <SortHeader label="$" k="billable" sort={sort} onSort={cycleSort} />
                </span>
              )}
            </div>
            {noSection.length > 0 && (
              <SectionGroup section={null} tasks={noSection} clientId={clientId} />
            )}
            {clientSections.map((section) => (
              <SectionGroup
                key={section.id}
                section={section}
                tasks={clientTasks.filter((t) => t.sectionId === section.id)}
                clientId={clientId}
              />
            ))}
            {addingSection ? (
              <form
                className="flex items-center gap-2 px-3 py-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sectionName.trim()) addSection(clientId, sectionName.trim());
                  setSectionName("");
                  setAddingSection(false);
                }}
              >
                <input
                  autoFocus
                  value={sectionName}
                  onChange={(e) => setSectionName(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setAddingSection(false)}
                  placeholder="Section name — Enter to add"
                  className="bidi-auto rounded-md border border-border px-2 py-1 text-sm outline-none focus:border-brand"
                />
              </form>
            ) : (
              <button
                onClick={() => setAddingSection(true)}
                className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-muted hover:text-brand"
              >
                <Plus size={14} /> Add section
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {statuses.map(({ key, label }) => {
            const columnTasks = tasks.filter(
              (t) => t.clientId === clientId && t.status === key,
            );
            return (
              <div key={key} className="rounded-xl border border-border bg-surface p-3">
                <div className="mb-2 text-sm font-semibold">
                  {label}
                  <span className="ml-2 text-xs font-normal text-faint">{columnTasks.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {columnTasks.map((t) => (
                    <BoardCard key={t.id} task={t} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
        </div>
        <ClientStats clientId={clientId} />
      </div>
    </div>
  );
}

function BoardCard({ task }: { task: Task }) {
  const { profiles, openTask, taskMinutes } = useData();
  const assignee = profiles.find((p) => p.id === task.assigneeId) ?? null;
  return (
    <button
      onClick={() => openTask(task.id)}
      className={`flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-left hover:border-brand ${task.pending ? "opacity-50" : ""}`}
    >
      <span className="bidi-auto text-sm font-medium">{task.title}</span>
      {task.tag && <TagBadge tag={task.tag} />}
      <div className="flex items-center justify-between">
        <BudgetBar doneMinutes={taskMinutes(task.id)} estimateHours={task.estimateHours} />
        <Avatar profile={assignee} size={22} />
      </div>
    </button>
  );
}
