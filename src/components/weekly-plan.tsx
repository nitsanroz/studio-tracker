"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  Columns3,
  Plus,
  X,
} from "lucide-react";
import { useData } from "@/lib/store";
import { addDays, formatDayLabel, isWeekend, startOfWeek, toISODate } from "@/lib/format";
import { Avatar } from "./ui";
import type { AbsenceType, PlanColumn, PlanEntry } from "@/lib/types";

const ABSENCE_LABELS: Record<AbsenceType, string> = {
  vacation: "🌴 Vacation",
  sick: "🤒 Sick",
  day_off: "Day off",
  half_day: "½ Half day",
  wfh: "🏠 WFH",
};

interface CellTarget {
  date: string | null;
  columnId: string;
  label: string;
}

// ── chips ────────────────────────────────────────────────────────────────

function EntryChip({ entry, canEdit }: { entry: PlanEntry; canEdit: boolean }) {
  const { tasks, clients, openTask, deletePlanEntry } = useData();
  const task = entry.taskId ? tasks.find((t) => t.id === entry.taskId) : null;
  const client = entry.clientId ? clients.find((c) => c.id === entry.clientId) : null;

  const remove = canEdit ? (
    <button
      onClick={(e) => {
        e.stopPropagation();
        deletePlanEntry(entry.id);
      }}
      className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-foreground text-white group-hover/chip:flex"
      title="Remove from plan"
    >
      <X size={10} />
    </button>
  ) : null;

  const dragProps = canEdit
    ? {
        draggable: true,
        onDragStart: (e: DragEvent) => {
          e.dataTransfer.setData("text/plan-entry", entry.id);
          e.dataTransfer.effectAllowed = "move";
        },
      }
    : {};

  if (entry.type === "absence") {
    return (
      <div className="group/chip relative" {...dragProps}>
        <div className="rounded-md bg-gray-200/70 px-2 py-1 text-xs font-medium text-gray-600">
          {ABSENCE_LABELS[entry.absenceType ?? "day_off"]}
        </div>
        {remove}
      </div>
    );
  }

  const label = task ? task.title : entry.text;
  const color = client?.color ?? "#6b7280";
  const done = task?.status === "done";

  return (
    <div className="group/chip relative" {...dragProps}>
      <div
        onClick={() => task && openTask(task.id)}
        className={`bidi-auto truncate rounded-md px-2 py-1 text-left text-xs font-medium text-white ${
          task ? "cursor-pointer" : ""
        } ${task?.pending ? "opacity-40 grayscale" : ""} ${done ? "opacity-50 line-through" : ""}`}
        style={{ backgroundColor: color }}
        title={task?.pending ? `${label} (pending approval)` : label}
      >
        {label}
      </div>
      {remove}
    </div>
  );
}

// ── add-entry modal ──────────────────────────────────────────────────────

function AddEntryModal({ target, onClose }: { target: CellTarget; onClose: () => void }) {
  const { clients, projects, tasks, addPlanEntry } = useData();
  const [mode, setMode] = useState<"task" | "free_text" | "absence">("task");
  const [clientId, setClientId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [text, setText] = useState("");

  const activeClients = useMemo(
    () => clients.filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );

  const clientTasks = useMemo(() => {
    if (!clientId) return [];
    const projectIds = new Set(
      projects.filter((p) => p.clientId === clientId && !p.archived).map((p) => p.id),
    );
    const q = search.trim().toLowerCase();
    return tasks
      .filter(
        (t) =>
          projectIds.has(t.projectId) &&
          t.status !== "done" &&
          (q === "" || t.title.toLowerCase().includes(q)),
      )
      .slice(0, 30);
  }, [clientId, projects, tasks, search]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed left-1/2 top-1/3 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-sm">Add to {target.label}</h3>
          <button onClick={onClose} className="rounded-md px-1.5 text-muted hover:bg-background">
            <X size={16} />
          </button>
        </div>

        <div className="mb-3 flex rounded-lg border border-border bg-background p-0.5">
          {(
            [
              ["task", "Task"],
              ["free_text", "Free text"],
              ["absence", "Absence"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`flex-1 rounded-md px-2 py-1.5 text-sm font-medium ${
                mode === key ? "bg-surface shadow-sm" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode !== "absence" && (
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="mb-2 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">
              {mode === "task" ? "Choose client first…" : "Client (for color) — optional"}
            </option>
            {activeClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        {mode === "task" && clientId && (
          <>
            <input
              autoFocus
              placeholder="Search tasks…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bidi-auto mb-2 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
            <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {clientTasks.map((t) => {
                const project = projects.find((p) => p.id === t.projectId);
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      addPlanEntry({
                        date: target.date,
                        columnId: target.columnId,
                        type: "task",
                        taskId: t.id,
                        clientId,
                      });
                      onClose();
                    }}
                    className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-background"
                  >
                    <span className="bidi-auto">{t.title}</span>
                    <span className="ml-2 text-xs text-faint">{project?.name}</span>
                  </button>
                );
              })}
              {clientTasks.length === 0 && (
                <div className="px-2 py-3 text-center text-sm text-faint">No open tasks found.</div>
              )}
            </div>
          </>
        )}

        {mode === "free_text" && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!text.trim()) return;
              addPlanEntry({
                date: target.date,
                columnId: target.columnId,
                type: "free_text",
                text: text.trim(),
                clientId: clientId || null,
              });
              onClose();
            }}
          >
            <input
              autoFocus
              required
              placeholder="e.g. Voyantis launch 🚀"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="bidi-auto flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
            <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
              Add
            </button>
          </form>
        )}

        {mode === "absence" && (
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(ABSENCE_LABELS) as AbsenceType[]).map((key) => (
              <button
                key={key}
                onClick={() => {
                  addPlanEntry({
                    date: target.date,
                    columnId: target.columnId,
                    type: "absence",
                    absenceType: key,
                  });
                  onClose();
                }}
                className="rounded-lg border border-border px-2 py-2 text-sm hover:border-brand hover:bg-brand-soft"
              >
                {ABSENCE_LABELS[key]}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ── column manager ───────────────────────────────────────────────────────

function ColumnManager({ onClose }: { onClose: () => void }) {
  const { planColumns, addPlanColumn, updatePlanColumn, movePlanColumn, deletePlanColumn } =
    useData();
  const [newName, setNewName] = useState("");

  const ordered = planColumns
    .filter((c) => c.type !== "waiting_list")
    .sort((a, b) => a.position - b.position);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-sm">Plan columns</h3>
          <button onClick={onClose} className="rounded-md px-1.5 text-muted hover:bg-background">
            <X size={16} />
          </button>
        </div>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {ordered.map((col, i) => (
            <div key={col.id} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm">
              <span className={`min-w-0 flex-1 truncate font-medium ${col.hidden ? "text-faint line-through" : ""}`}>
                {col.name}
                {col.type === "studio" && <span className="ml-1.5 text-xs text-faint">(studio)</span>}
                {!col.profileId && col.type === "member" && (
                  <span className="ml-1.5 text-xs text-faint">(custom)</span>
                )}
              </span>
              <button
                disabled={i === 0}
                onClick={() => movePlanColumn(col.id, -1)}
                className="rounded px-1 text-muted hover:bg-background disabled:opacity-30"
                title="Move left"
              >
                ↑
              </button>
              <button
                disabled={i === ordered.length - 1}
                onClick={() => movePlanColumn(col.id, 1)}
                className="rounded px-1 text-muted hover:bg-background disabled:opacity-30"
                title="Move right"
              >
                ↓
              </button>
              <button
                onClick={() => updatePlanColumn(col.id, { hidden: !col.hidden })}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:border-brand hover:text-brand"
              >
                {col.hidden ? "Show" : "Hide"}
              </button>
              {!col.profileId && col.type === "member" && (
                <button
                  onClick={() => {
                    if (confirm(`Delete column "${col.name}" and its plan entries?`))
                      deletePlanColumn(col.id);
                  }}
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:border-danger hover:text-danger"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
        <form
          className="mt-3 flex gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            addPlanColumn(newName.trim());
            setNewName("");
          }}
        >
          <input
            placeholder="New column (freelancer, provider…)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          />
          <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark">
            Add
          </button>
        </form>
        <p className="mt-2 text-xs text-faint">
          Order is top→bottom = left→right. Team members get a column automatically when added in
          Settings; columns of people who leave can be hidden.
        </p>
      </div>
    </>
  );
}

// ── plan cell ────────────────────────────────────────────────────────────

function PlanCell({
  date,
  columnId,
  label,
  entries,
  canEdit,
  onAdd,
}: {
  date: string | null;
  columnId: string;
  label: string;
  entries: PlanEntry[];
  canEdit: boolean;
  onAdd: (target: CellTarget) => void;
}) {
  const { movePlanEntry } = useData();
  const [over, setOver] = useState(false);

  const dropProps = canEdit
    ? {
        onDragOver: (e: DragEvent) => {
          if (e.dataTransfer.types.includes("text/plan-entry")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setOver(true);
          }
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          const id = e.dataTransfer.getData("text/plan-entry");
          if (id) movePlanEntry(id, { date, columnId });
        },
      }
    : {};

  return (
    <div
      className={`group/cell relative flex min-h-8 flex-col gap-1 rounded-sm p-0.5 ${over ? "bg-brand-soft outline-2 outline-dashed outline-brand" : ""}`}
      {...dropProps}
    >
      {entries.map((e) => (
        <EntryChip key={e.id} entry={e} canEdit={canEdit} />
      ))}
      {canEdit && (
        <button
          onClick={() => onAdd({ date, columnId, label })}
          className="hidden h-5 items-center justify-center rounded-md border border-dashed border-border-strong text-faint hover:border-brand hover:text-brand group-hover/cell:flex"
          title={`Add to ${label}`}
        >
          <Plus size={12} />
        </button>
      )}
    </div>
  );
}

// ── the timeline ─────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function WeeklyPlan() {
  const { planColumns, planEntries, profiles, currentUserId } = useData();
  const [rangeStart, setRangeStart] = useState(() => addDays(startOfWeek(new Date()), -14));
  const [rangeEnd, setRangeEnd] = useState(() => addDays(startOfWeek(new Date()), 27));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addTarget, setAddTarget] = useState<CellTarget | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const todayIso = toISODate(new Date());

  const me = profiles.find((p) => p.id === currentUserId);
  const canEdit = me?.role === "admin";

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) out.push(d);
    return out;
  }, [rangeStart, rangeEnd]);

  const columns = [...planColumns].sort((a, b) => a.position - b.position);
  const gridCols = columns.filter((c) => c.type !== "waiting_list" && !c.hidden);
  const waitingCol = columns.find((c) => c.type === "waiting_list");

  const entriesByCell = useMemo(() => {
    const map = new Map<string, PlanEntry[]>();
    for (const e of planEntries) {
      const key = `${e.date ?? "wl"}::${e.columnId}`;
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [planEntries]);

  function scrollToDay(iso: string) {
    const el = document.getElementById(`plan-day-${iso}`);
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    const headerH = scroller.querySelector("thead")?.clientHeight ?? 0;
    scroller.scrollTop = (el as HTMLTableRowElement).offsetTop - headerH - 8;
  }

  function jumpTo(target: Date) {
    const iso = toISODate(target);
    let changed = false;
    if (target < rangeStart) {
      setRangeStart(addDays(startOfWeek(target), -7));
      changed = true;
    }
    if (target > rangeEnd) {
      setRangeEnd(addDays(startOfWeek(target), 27));
      changed = true;
    }
    // Unfold the month we jump into
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(iso.slice(0, 7));
      return next;
    });
    setTimeout(() => scrollToDay(iso), changed ? 250 : 50);
  }

  // Scroll to today on first paint
  useEffect(() => {
    const t = setTimeout(() => scrollToDay(todayIso), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function shift(days: number) {
    const anchor = middleVisibleDate() ?? new Date();
    jumpTo(addDays(anchor, days));
  }

  function middleVisibleDate(): Date | null {
    const scroller = scrollerRef.current;
    if (!scroller) return null;
    const mid = scroller.getBoundingClientRect().top + scroller.clientHeight / 2;
    let best: { dist: number; date: Date } | null = null;
    for (const day of days) {
      const el = document.getElementById(`plan-day-${toISODate(day)}`);
      if (!el) continue;
      const dist = Math.abs(el.getBoundingClientRect().top - mid);
      if (!best || dist < best.dist) best = { dist, date: day };
    }
    return best?.date ?? null;
  }

  // rows grouped with month markers
  const rows: ({ kind: "month"; key: string; label: string } | { kind: "day"; date: Date })[] =
    useMemo(() => {
      const out: ({ kind: "month"; key: string; label: string } | { kind: "day"; date: Date })[] = [];
      let lastMonth = "";
      for (const day of days) {
        const key = toISODate(day).slice(0, 7);
        if (key !== lastMonth) {
          out.push({ kind: "month", key, label: `${MONTH_NAMES[day.getMonth()]} ${day.getFullYear()}` });
          lastMonth = key;
        }
        if (!collapsed.has(key)) out.push({ kind: "day", date: day });
      }
      return out;
    }, [days, collapsed]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl">Weekly Plan</h1>
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => jumpTo(new Date())}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
          >
            Today
          </button>
          <div className="ml-1 flex items-center rounded-md border border-border bg-surface">
            <button onClick={() => shift(-7)} className="px-2 py-1.5 text-muted hover:text-foreground" title="Back a week">
              <ChevronLeft size={15} />
            </button>
            <span className="px-1 text-xs text-faint">week</span>
            <button onClick={() => shift(7)} className="px-2 py-1.5 text-muted hover:text-foreground" title="Forward a week">
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="flex items-center rounded-md border border-border bg-surface">
            <button onClick={() => shift(-30)} className="px-2 py-1.5 text-muted hover:text-foreground" title="Back a month">
              <ChevronsLeft size={15} />
            </button>
            <span className="px-1 text-xs text-faint">month</span>
            <button onClick={() => shift(30)} className="px-2 py-1.5 text-muted hover:text-foreground" title="Forward a month">
              <ChevronsRight size={15} />
            </button>
          </div>
          {canEdit && (
            <button
              onClick={() => setShowColumns(true)}
              className="ml-1 flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-muted hover:text-foreground"
            >
              <Columns3 size={15} /> Columns
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-4">
        <div
          ref={scrollerRef}
          className="min-w-0 flex-1 overflow-auto rounded-xl border border-border bg-surface"
          style={{ maxHeight: "calc(100vh - 170px)" }}
        >
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 w-24 border-b border-r border-border bg-surface p-2 text-left text-xs font-medium text-faint">
                  <button
                    onClick={() => setRangeStart((s) => addDays(s, -28))}
                    className="rounded px-1 text-brand hover:underline"
                    title="Load 4 earlier weeks"
                  >
                    ↑ earlier
                  </button>
                </th>
                {gridCols.map((col) => {
                  const profile = col.profileId
                    ? (profiles.find((p) => p.id === col.profileId) ?? null)
                    : null;
                  const isMe = col.profileId === currentUserId;
                  return (
                    <th
                      key={col.id}
                      className={`min-w-32 border-b border-r border-border bg-surface p-2 text-left last:border-r-0 ${col.type === "studio" ? "bg-brand-soft/60" : ""} ${isMe ? "bg-aqua/20" : ""}`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        {profile ? <Avatar profile={profile} size={20} /> : null}
                        {col.name}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.kind === "month") {
                  const isCollapsed = collapsed.has(row.key);
                  return (
                    <tr key={`m-${row.key}`}>
                      <td
                        colSpan={gridCols.length + 1}
                        className="border-b border-border bg-background/90 px-2 py-1"
                      >
                        <button
                          onClick={() =>
                            setCollapsed((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.key)) next.delete(row.key);
                              else next.add(row.key);
                              return next;
                            })
                          }
                          className="flex items-center gap-1 font-heading text-xs text-muted hover:text-foreground"
                        >
                          {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          {row.label}
                        </button>
                      </td>
                    </tr>
                  );
                }
                const iso = toISODate(row.date);
                const weekend = isWeekend(row.date);
                const isToday = iso === todayIso;
                const isPast = iso < todayIso;
                const { name, date } = formatDayLabel(row.date);
                return (
                  <tr
                    key={iso}
                    id={`plan-day-${iso}`}
                    className={`${weekend ? "bg-weekend" : ""} ${isToday ? "bg-aqua/10" : ""} ${isPast ? "opacity-55" : ""}`}
                  >
                    <td
                      className={`sticky left-0 z-10 border-b border-r border-border p-2 align-top text-xs ${weekend ? "bg-weekend text-faint" : "bg-surface"} ${isToday ? "border-l-4 border-l-brand bg-aqua/20 font-bold" : ""}`}
                    >
                      <div className="font-semibold">{isToday ? "Today" : name}</div>
                      <div className={isToday ? "text-foreground" : "text-faint"}>{date}</div>
                    </td>
                    {gridCols.map((col) => (
                      <td
                        key={col.id}
                        className={`border-b border-r border-border p-1 align-top last:border-r-0 ${col.type === "studio" && !weekend ? "bg-brand-soft/30" : ""}`}
                      >
                        <PlanCell
                          date={iso}
                          columnId={col.id}
                          label={`${col.name} — ${name} ${date}`}
                          entries={entriesByCell.get(`${iso}::${col.id}`) ?? []}
                          canEdit={canEdit}
                          onAdd={setAddTarget}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <td colSpan={gridCols.length + 1} className="p-2">
                  <button
                    onClick={() => setRangeEnd((e) => addDays(e, 28))}
                    className="w-full rounded-md border border-dashed border-border-strong py-1.5 text-xs text-muted hover:border-brand hover:text-brand"
                  >
                    ↓ load 4 more weeks
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {waitingCol && !waitingCol.hidden && (
          <div className="w-48 shrink-0 self-start rounded-xl border border-border bg-surface p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
              {waitingCol.name}
            </div>
            <PlanCell
              date={null}
              columnId={waitingCol.id}
              label="Waiting list"
              entries={entriesByCell.get(`wl::${waitingCol.id}`) ?? []}
              canEdit={canEdit}
              onAdd={setAddTarget}
            />
          </div>
        )}
      </div>

      {canEdit && (
        <p className="text-xs text-faint">
          Hover a cell to add a task, note or absence · drag chips between days · click month names
          to fold them.
        </p>
      )}

      {addTarget && <AddEntryModal target={addTarget} onClose={() => setAddTarget(null)} />}
      {showColumns && <ColumnManager onClose={() => setShowColumns(false)} />}
    </div>
  );
}
