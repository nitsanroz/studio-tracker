"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Maximize2, Pencil, Plus, X } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { formatHoursDecimal, formatHoursShort, toISODate } from "@/lib/format";
import { Avatar, ClientChip, TagBadge } from "./ui";
import { LogTimeForm } from "./log-time-form";
import { taskHoursDone } from "@/lib/task-hours";
import {
  EditableDateCell,
  EditableNumberCell,
  EditableSelectCell,
  EditableTextCell,
} from "./editable-cell";
import { useColWidths, ResizeHandle } from "./resizable";
import type { Task } from "@/lib/types";

/** The panel's own box, for the flip decision. 432px (w-72 + 50%) is wide enough
 *  that the duration/member/date row fits on ONE line, which is what gives the
 *  description the full width. Erring HIGH on the height only flips a little
 *  early; erring low clips. */
const ADD_W = 432;
const ADD_H = 160;

/**
 * Log-time popover on a task row. The form itself is the shared one, so this only
 * owns the popover chrome — and an admin gets the member picker here too, which
 * this copy never had.
 *
 * ⚠️ `fixed` and PORTALLED, measured from the button — never `absolute`. This
 * table sits in an `overflow-x-auto` wrapper, and a scroll container clips BOTH
 * axes, so an absolutely-positioned panel is cut off at the wrapper's edge and
 * takes the row's height with it. Same fix as the timeline Dates popout (v1.5.0)
 * and the assignee list (v1.6.0). Flips above the button when the window runs
 * out below.
 */
function AddTimePopover({
  at,
  taskId,
  onClose,
}: {
  at: { left: number; top: number };
  taskId: string;
  onClose: () => void;
}) {
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 flex w-[27rem] flex-col gap-2 rounded-2xl border border-border bg-surface p-3 shadow-xl"
        style={{ left: at.left, top: at.top }}
      >
        <LogTimeForm
          taskId={taskId}
          layout="stacked"
          submitLabel="Add time"
          autoFocus
          onAdded={onClose}
        />
      </div>
    </>,
    document.body,
  );
}

/** Where the panel should sit for a given trigger, kept on screen on both axes. */
function addPopoverPos(btn: HTMLElement) {
  const r = btn.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  return {
    left: Math.max(8, Math.min(r.right - ADD_W, window.innerWidth - ADD_W - 8)),
    top: below < ADD_H + 12 ? Math.max(8, r.top - ADD_H - 4) : r.bottom + 4,
  };
}

/** Figma link cell: link stays clickable; pencil (or empty cell) edits the URL in place. */
function FigmaCell({ url, onCommit }: { url: string | null; onCommit: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={url ?? ""}
        placeholder="Paste link"
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={(e) => {
          if (!cancelled.current) {
            const v = e.target.value.trim();
            if (v !== (url ?? "")) onCommit(v);
          }
          cancelled.current = false;
          setEditing(false);
        }}
        className="w-full min-w-0 rounded-md border border-brand bg-surface px-1.5 py-0.5 text-xs shadow-[0_0_0_2px_var(--color-brand-soft)] outline-none"
      />
    );
  }
  if (!url) {
    return (
      <span
        onClick={() => setEditing(true)}
        title="Click to add a Figma link"
        className="block w-full cursor-text rounded-md px-1.5 py-0.5 text-xs text-faint transition-shadow hover:bg-surface hover:shadow-[inset_0_0_0_1px_var(--color-border-strong)]"
      >
        –
      </span>
    );
  }
  return (
    <span className="group/figma flex items-center gap-1 px-1.5 py-0.5">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
      >
        Figma <ExternalLink size={10} />
      </a>
      <button
        onClick={() => setEditing(true)}
        title="Edit link"
        className="invisible text-faint hover:text-brand group-hover/figma:visible"
      >
        <Pencil size={11} />
      </button>
      <button
        onClick={() => onCommit("")}
        title="Remove link"
        className="invisible text-faint hover:text-danger group-hover/figma:visible"
      >
        <X size={12} />
      </button>
    </span>
  );
}

/** "12/7" — day/month, no year. */
function formatDueShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}/${m}`;
}

// column order per Nitsan: Due (right after Task), Tags, Figma, Hrs/budget, %done, by me, Logged by
const COLS: { key: string; label: string; w: number; hint?: string }[] = [
  { key: "client", label: "Client", w: 96, hint: "Client the task belongs to" },
  { key: "section", label: "Section", w: 120, hint: "Board section the task lives in" },
  // task column flexes — no fixed width; Due renders immediately after it
  { key: "due", label: "Due", w: 50, hint: "Due date — click a cell to change it" },
  { key: "tags", label: "Status", w: 84, hint: "Where the task is in the process — click a cell to change it" },
  { key: "figma", label: "Figma", w: 58, hint: "Linked Figma file" },
  // split from one merged "Hrs/budget" cell so this table reads the same as the
  // client page's; the utilisation % moved into the tooltip rather than being dropped
  { key: "hours", label: "Hours", w: 64, hint: "Hours logged so far" },
  { key: "budget", label: "Budget", w: 64, hint: "Budget in hours — click a cell to change it" },
  { key: "mine", label: "by me", w: 58, hint: "Hours you logged on the task" },
  { key: "loggedBy", label: "Logged by", w: 84, hint: "Who logged hours on the task" },
  { key: "add", label: "", w: 90 },
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
  const { clients, sections, profiles, entrySums, entrySumsAll, currentUserId, openTask, updateTask, tags } =
    useData();
  const { widths, startResize } = useColWidths(tableKey, DEFAULT_WIDTHS);
  // The open panel's ANCHOR POSITION travels with the id: it is portalled to
  // the body, so it can't inherit a position from the row it belongs to.
  const [adding, setAdding] = useState<{ id: string; left: number; top: number } | null>(null);
  // members may edit tags + figma link only; name/budget/due are admin-only
  const isAdmin = useIsAdmin();

  // hours per task (total / mine) + who logged
  const stats = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    const total = new Map<string, number>();
    const mine = new Map<string, number>();
    const users = new Map<string, string[]>();
    // A task's TOTAL is its real cost, so it counts the recovered pre-Everhour
    // hours. "By me" and "logged by" are personal, so they come from the
    // legacy-free list — a 2021 backfill shouldn't read as time you logged.
    for (const e of entrySumsAll) {
      if (!ids.has(e.taskId)) continue;
      total.set(e.taskId, (total.get(e.taskId) ?? 0) + e.minutes);
    }
    for (const e of entrySums) {
      if (!ids.has(e.taskId)) continue;
      if (e.userId === currentUserId) mine.set(e.taskId, (mine.get(e.taskId) ?? 0) + e.minutes);
      const arr = users.get(e.taskId) ?? [];
      if (!arr.includes(e.userId)) arr.push(e.userId);
      users.set(e.taskId, arr);
    }
    return { total, mine, users };
  }, [entrySums, entrySumsAll, tasks, currentUserId]);

  const cell = (key: string) => ({ width: widths[key], flexShrink: 0 } as const);
  const todayIso = toISODate(new Date());

  return (
    <div className="overflow-x-auto">
      <div className="min-w-fit">
        {/* header */}
        <div className="group/thead flex items-center gap-3 border-b border-border bg-background px-4 py-2 text-xs font-medium uppercase tracking-wide text-faint">
          {COLS.slice(0, 2).map((c) => (
            <span key={c.key} className="relative" style={cell(c.key)} title={c.hint}>
              {c.label}
              <ResizeHandle onMouseDown={startResize(c.key)} />
            </span>
          ))}
          <span className="min-w-24 flex-1" title="Task title — click a cell to rename">
            Task
          </span>
          {COLS.slice(2).map((c) => (
            <span key={c.key} className="relative" style={cell(c.key)} title={c.hint}>
              {c.label}
              {c.key !== "add" && <ResizeHandle onMouseDown={startResize(c.key)} />}
            </span>
          ))}
        </div>

        {tasks.map((task) => {
          const client = clients.find((c) => c.id === task.clientId);
          const section = sections.find((s) => s.id === task.sectionId);
          // the shared helper, so this table and the client page can't disagree
          // about a task's hours (it adds the pre-Everhour remainder on top)
          const total = taskHoursDone(task, (id) => stats.total.get(id) ?? 0);
          const my = stats.mine.get(task.id) ?? 0;
          const budget = task.estimateHours;
          const pctDone = budget && budget > 0 ? Math.round((total / 60 / budget) * 100) : null;
          const overdue = task.dueDate != null && task.status !== "done" && task.dueDate < todayIso;
          const hoursTitle =
            pctDone != null ? `${formatHoursDecimal(total)}h of ${budget}h — ${pctDone}%` : "Hours logged";
          return (
            <div
              key={task.id}
              className="group flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0 hover:bg-background"
              onClick={() => openTask(task.id)}
            >
              <span style={cell("client")}>
                {client && <ClientChip client={client} size="sm" />}
              </span>
              <span className="bidi-auto truncate text-muted" style={cell("section")}>
                {section?.name}
              </span>
              <span
                className="flex min-w-24 flex-1 items-center font-medium"
                onClick={(e) => isAdmin && e.stopPropagation()}
              >
                {isAdmin ? (
                  <EditableTextCell
                    value={task.title}
                    onCommit={(v) => v && updateTask(task.id, { title: v })}
                  />
                ) : (
                  <span className="bidi-auto truncate px-1.5 py-0.5">{task.title}</span>
                )}
                <button
                  onClick={() => openTask(task.id)}
                  title="Open details"
                  className="invisible ml-1 shrink-0 rounded p-0.5 text-faint hover:bg-surface hover:text-brand group-hover:visible"
                >
                  <Maximize2 size={13} />
                </button>
              </span>
              <span
                className={`text-xs ${overdue ? "font-medium text-danger" : "text-muted"}`}
                style={cell("due")}
                onClick={(e) => isAdmin && e.stopPropagation()}
              >
                {isAdmin ? (
                  <EditableDateCell
                    value={task.dueDate}
                    onCommit={(v) => updateTask(task.id, { dueDate: v })}
                    format={formatDueShort}
                    placeholder=""
                  />
                ) : (
                  <span className="px-1.5 py-0.5 tabular-nums">
                    {task.dueDate ? formatDueShort(task.dueDate) : ""}
                  </span>
                )}
              </span>
              <span style={cell("tags")} onClick={(e) => e.stopPropagation()}>
                <EditableSelectCell
                  value={task.tag ?? ""}
                  options={tags.map((t) => ({ value: t.name, label: t.name }))}
                  onCommit={(v) => updateTask(task.id, { tag: v || null })}
                  display={task.tag ? <TagBadge tag={task.tag} /> : null}
                  emptyLabel="No status"
                />
              </span>
              <span style={cell("figma")} onClick={(e) => e.stopPropagation()}>
                <FigmaCell
                  url={task.figmaUrl}
                  onCommit={(v) => updateTask(task.id, { figmaUrl: v || null })}
                />
              </span>
              <span
                className={`text-xs tabular-nums ${pctDone != null && pctDone > 100 ? "font-medium text-danger" : "text-muted"}`}
                style={cell("hours")}
                title={hoursTitle}
              >
                {total > 0 ? `${formatHoursDecimal(total)}h` : <span className="text-faint">–</span>}
              </span>
              <span
                className="text-xs tabular-nums text-muted"
                style={cell("budget")}
                onClick={(e) => isAdmin && e.stopPropagation()}
                title={hoursTitle}
              >
                {isAdmin ? (
                  <EditableNumberCell
                    value={budget}
                    onCommit={(v) => updateTask(task.id, { estimateHours: v })}
                    display={
                      budget != null ? (
                        <span>{budget}h</span>
                      ) : (
                        <span className="text-faint">–</span>
                      )
                    }
                  />
                ) : budget != null ? (
                  `${budget}h`
                ) : (
                  <span className="text-faint">–</span>
                )}
              </span>
              <span className="text-xs tabular-nums text-muted" style={cell("mine")}>
                {my > 0 ? formatHoursShort(my) : "–"}
              </span>
              <span style={cell("loggedBy")}>
                <LoggedByGroup userIds={stats.users.get(task.id) ?? []} profiles={profiles} />
              </span>
              <span style={cell("add")} onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={(e) => {
                    // ⚠️ Read `currentTarget` HERE, not inside the updater.
                    // React nulls it once the handler returns, and a state
                    // updater runs later — `addPopoverPos(e.currentTarget)`
                    // inside the callback threw on every click.
                    const btn = e.currentTarget;
                    setAdding((v) =>
                      v?.id === task.id ? null : { id: task.id, ...addPopoverPos(btn) },
                    );
                  }}
                  className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-brand hover:text-brand"
                >
                  <Plus size={12} /> Add time
                </button>
              </span>
            </div>
          );
        })}
      </div>

      {/* Rendered ONCE, outside the scroller, since it is portalled and carries
          its own viewport coordinates. */}
      {adding && (
        <AddTimePopover
          at={adding}
          taskId={adding.id}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}
