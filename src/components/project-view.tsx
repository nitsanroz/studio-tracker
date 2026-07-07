"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useData } from "@/lib/store";
import { formatDate } from "@/lib/format";
import { Avatar, BudgetBar, ClientChip, TagBadge } from "./ui";
import type { Section, Task } from "@/lib/types";

const COLS = "flex items-center gap-3 pl-3 pr-4";

function TaskRow({ task }: { task: Task }) {
  const { profiles, openTask, updateTask, taskMinutes, openTaskId } = useData();
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
      <span className={`bidi-auto min-w-0 flex-1 truncate font-medium ${done ? "text-faint line-through" : ""}`}>
        {task.title}
        {task.pending && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            pending approval
          </span>
        )}
      </span>
      <span className="hidden w-40 shrink-0 items-center gap-1.5 text-xs text-muted sm:flex">
        {assignee ? (
          <>
            <Avatar profile={assignee} size={22} />
            <span className="truncate">{assignee.name}</span>
          </>
        ) : (
          <span className="text-faint">—</span>
        )}
      </span>
      <span className="w-16 shrink-0 text-xs text-muted">
        {task.dueDate ? formatDate(task.dueDate) : ""}
      </span>
      <span className="hidden w-36 shrink-0 lg:block">{task.tag ? <TagBadge tag={task.tag} /> : null}</span>
      <span className="hidden w-28 shrink-0 md:block">
        <BudgetBar doneMinutes={taskMinutes(task.id)} estimateHours={task.estimateHours} />
      </span>
      <span
        className={`w-4 shrink-0 text-center text-xs ${task.billable ? "text-success" : "text-faint"}`}
        title={task.billable ? "Billable" : "Non-billable"}
      >
        {task.billable ? "$" : "–"}
      </span>
    </div>
  );
}

function AddTaskRow({ projectId, sectionId }: { projectId: string; sectionId: string | null }) {
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
        if (title.trim()) addTask(projectId, sectionId, title.trim());
        setTitle("");
      }}
    >
      <span className="w-[17px]" />
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title.trim()) addTask(projectId, sectionId, title.trim());
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
  projectId,
}: {
  section: Section | null;
  tasks: Task[];
  projectId: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 border-b border-border bg-background/60 px-2 py-1.5 text-left text-sm font-semibold hover:bg-background"
      >
        {open ? (
          <ChevronDown size={14} className="text-muted" />
        ) : (
          <ChevronRight size={14} className="text-muted" />
        )}
        {section?.name ?? "No section"}
        <span className="text-xs font-normal text-faint">{tasks.length}</span>
      </button>
      {open && (
        <>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
          <AddTaskRow projectId={projectId} sectionId={section?.id ?? null} />
        </>
      )}
    </div>
  );
}

export function ProjectView({ projectId }: { projectId: string }) {
  const { projects, clients, sections, tasks, addSection } = useData();
  const [showDone, setShowDone] = useState(false);
  const [view, setView] = useState<"list" | "board">("list");
  const [addingSection, setAddingSection] = useState(false);
  const [sectionName, setSectionName] = useState("");

  const project = projects.find((p) => p.id === projectId);
  const client = clients.find((c) => c.id === project?.clientId);

  const projectSections = useMemo(
    () =>
      sections
        .filter((s) => s.projectId === projectId)
        .sort((a, b) => a.position - b.position),
    [sections, projectId],
  );

  const projectTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.projectId === projectId && (showDone || t.status !== "done"))
        .sort((a, b) => a.position - b.position),
    [tasks, projectId, showDone],
  );

  if (!project || !client) return <div className="text-muted">Project not found.</div>;

  const noSection = projectTasks.filter((t) => t.sectionId === null);
  const statuses: { key: Task["status"]; label: string }[] = [
    { key: "todo", label: "To do" },
    { key: "in_progress", label: "In progress" },
    { key: "done", label: "Done" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <ClientChip client={client} />
            {!project.billable && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                non-billable project
              </span>
            )}
          </div>
          <h1 className="text-2xl">{project.name}</h1>
        </div>
        <div className="flex items-center gap-2">
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

      {view === "list" ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <div className="min-w-[720px]">
            <div className={`${COLS} h-8 border-b border-border bg-background text-xs font-medium uppercase tracking-wide text-faint`}>
              <span className="w-[17px] shrink-0" />
              <span className="min-w-0 flex-1">Name</span>
              <span className="hidden w-40 shrink-0 sm:block">Assignee</span>
              <span className="w-16 shrink-0">Due</span>
              <span className="hidden w-36 shrink-0 lg:block">Tag</span>
              <span className="hidden w-28 shrink-0 md:block">Budget</span>
              <span className="w-4 shrink-0" title="Billable">$</span>
            </div>
            {noSection.length > 0 && (
              <SectionGroup section={null} tasks={noSection} projectId={projectId} />
            )}
            {projectSections.map((section) => (
              <SectionGroup
                key={section.id}
                section={section}
                tasks={projectTasks.filter((t) => t.sectionId === section.id)}
                projectId={projectId}
              />
            ))}
            {addingSection ? (
              <form
                className="flex items-center gap-2 px-3 py-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sectionName.trim()) addSection(projectId, sectionName.trim());
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
              (t) => t.projectId === projectId && t.status === key,
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
