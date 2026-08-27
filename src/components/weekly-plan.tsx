"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  Columns3,
  Minus,
  Palmtree,
  Plus,
  Thermometer,
  X,
} from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { shiftDays, formatDayLabel, isWeekend, startOfWeek, toISODate } from "@/lib/format";
import { Avatar, ContextMenu, type ContextMenuItem } from "./ui";
import { TaskAutocomplete, useClientsByRecency, type TaskMatch } from "./task-autocomplete";
import { ResizeHandle, useColWidths } from "./resizable";
import type { AbsenceType, DevStatus, PlanEntry } from "@/lib/types";

const ABSENCE_LABELS: Record<AbsenceType, string> = {
  vacation: "🌴 Vacation",
  sick: "🤒 Sick",
  day_off: "Day off",
};

/** Full-cell fill styles per absence type. */
const ABSENCE_FILL: Record<AbsenceType, string> = {
  sick: "bg-black text-white",
  vacation: "bg-blue-700 text-white",
  day_off: "bg-gray-200 text-gray-500",
};

/** Icon + short label shown inside the full-cell absence fill. */
const ABSENCE_CELL: Record<AbsenceType, { icon: typeof Thermometer; label: string | null }> = {
  sick: { icon: Thermometer, label: "Sick" },
  vacation: { icon: Palmtree, label: "Vacation" },
  day_off: { icon: Minus, label: null },
};

/** Display label + functional chip colors per dev-item status. */
const DEV_STATUS: Record<DevStatus, { label: string; chip: string }> = {
  pricing: { label: "Pricing", chip: "bg-gray-100 text-gray-800" },
  in_approval: { label: "In approval", chip: "bg-amber-100 text-amber-800" },
  wip: { label: "WIP", chip: "bg-blue-100 text-blue-800" },
  qa: { label: "QA", chip: "bg-purple-100 text-purple-800" },
  client_qa: { label: "Client QA", chip: "bg-pink-100 text-pink-800" },
  done: { label: "Done", chip: "bg-green-100 text-green-800" },
};

const DEV_STATUS_ORDER: DevStatus[] = ["pricing", "in_approval", "wip", "qa", "client_qa", "done"];

/** The absence buttons in the add/edit modal, in the order the studio reads them. */
const ABSENCE_CHOICES: { key: AbsenceType; label: string; chip: string }[] = [
  { key: "sick", label: "🤒 Sick", chip: "bg-black text-white" },
  { key: "vacation", label: "🌴 Vacation", chip: "bg-blue-700 text-white" },
  { key: "day_off", label: "– Day off", chip: "bg-gray-200 text-gray-600" },
];

interface CellTarget {
  date: string | null;
  columnId: string;
  label: string;
}

interface ChipPayload {
  type: PlanEntry["type"];
  taskId: string | null;
  text: string;
  clientId: string | null;
  absenceType: AbsenceType | null;
}

/** Module-level clipboard: survives re-renders, intentionally not persisted. */
let planClipboard: ChipPayload | null = null;

/**
 * Every person column is exactly this wide, whatever is in it. Only the header
 * row's widths matter (see the table's `table-fixed`), so this lives as a class
 * there — 175px is Nitsan's floor, and a wider window shares the spare space out
 * between the columns equally rather than giving it to the busiest one.
 */
const PERSON_COL = "w-[175px]";

// ── chips ────────────────────────────────────────────────────────────────

function EntryChip({
  entry,
  canEdit,
  onMenu,
  onHover,
  onEdit,
}: {
  entry: PlanEntry;
  canEdit: boolean;
  onMenu?: (e: ReactMouseEvent, entry: PlanEntry) => void;
  onHover?: (entry: PlanEntry | null) => void;
  /**
   * Clicking anything that ISN'T a task — an absence, a free-text note — opens the
   * editor, since there is nowhere else to change them. A task chip keeps opening
   * the task pane instead: that's where a task is edited.
   */
  onEdit?: (entry: PlanEntry) => void;
}) {
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

  // task chips handle their own click (they open the pane), so this is only wired
  // for the rest
  const editable = canEdit && !!onEdit && !entry.taskId;
  const wrapperProps = {
    ...dragProps,
    onContextMenu: onMenu ? (e: ReactMouseEvent) => onMenu(e, entry) : undefined,
    onMouseEnter: onHover ? () => onHover(entry) : undefined,
    onMouseLeave: onHover ? () => onHover(null) : undefined,
    ...(editable
      ? {
          onClick: (e: ReactMouseEvent) => {
            e.stopPropagation();
            onEdit?.(entry);
          },
        }
      : {}),
  };
  /** appended to the chip's own tooltip rather than set on the wrapper, whose
   *  title an inner element with its own would hide */
  const editHint = editable ? " — click to edit" : "";

  // Absence: full-cell fill (rendered stretched by PlanCell), not a chip.
  if (entry.type === "absence") {
    const type = entry.absenceType ?? "day_off";
    const { icon: AbsenceIcon, label: absenceLabel } = ABSENCE_CELL[type];
    return (
      <div
        className={`group/chip relative flex min-h-8 flex-1 ${editable ? "cursor-pointer" : ""}`}
        {...wrapperProps}
      >
        {/* no rounding: an absence fills its cell edge to edge, so it reads as
            "this day is gone" rather than as one more card sitting in the day */}
        <div
          className={`flex flex-1 items-center justify-center gap-1 text-xs font-medium ${ABSENCE_FILL[type]}`}
          title={`${ABSENCE_LABELS[type]}${editHint}`}
        >
          <AbsenceIcon size={12} />
          {absenceLabel}
        </div>
        {remove}
      </div>
    );
  }

  const label = task ? task.title : entry.text;
  const color = client?.color ?? "#6b7280";
  const done = task?.status === "done";

  // Real task: solid client color + inset outline to mark it as linked.
  if (task) {
    return (
      <div className="group/chip relative" {...wrapperProps}>
        <div
          onClick={() => openTask(task.id)}
          className={`cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-white ring-2 ring-inset ring-white/40 hover:brightness-110 ${task.pending ? "opacity-40 grayscale" : ""} ${done ? "opacity-50" : ""}`}
          style={{ backgroundColor: color }}
          title={task.pending ? `${label} (pending approval)` : label}
        >
          {client && (
            <div className="truncate text-right text-[9px] font-semibold uppercase tracking-wide text-white/75">
              {client.name}
            </div>
          )}
          {/* wraps rather than truncates: the columns are a fixed equal width now,
              so a long title has to use more lines instead of more width */}
          <div className={`bidi-auto break-words text-left ${done ? "line-through" : ""}`}>
            {label}
          </div>
        </div>
        {remove}
      </div>
    );
  }

  // Free text with a client: lighter shade of the client color, no outline.
  if (client) {
    return (
      <div
        className={`group/chip relative ${editable ? "cursor-pointer" : ""}`}
        {...wrapperProps}
      >
        <div
          className="rounded-md px-2 py-1 text-xs font-medium text-white"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 75%, white)` }}
          title={`${client.name} — ${label}${editHint}`}
        >
          <div className="truncate text-right text-[9px] font-semibold uppercase tracking-wide text-white/85">
            {client.name}
          </div>
          <div className="bidi-auto break-words text-left">{label}</div>
        </div>
        {remove}
      </div>
    );
  }

  // Plain free text: darker grey so it doesn't disappear against the cell.
  return (
    <div className={`group/chip relative ${editable ? "cursor-pointer" : ""}`} {...wrapperProps}>
      <div
        className="bidi-auto break-words rounded-md bg-gray-300 px-2 py-1 text-left text-xs font-medium text-gray-700"
        title={`${label}${editHint}`}
      >
        {label}
      </div>
      {remove}
    </div>
  );
}

// ── add / edit entry modal ───────────────────────────────────────────────

/**
 * One modal for putting something in a cell and for changing what is already
 * there. Editing IS choosing again — pick a task, retype the note, or pick an
 * absence — so a separate editor would have been the same three controls with a
 * different verb.
 *
 * `entry` switches it to edit mode. Task chips never open it: clicking one opens
 * the task pane, which is where a task is edited.
 */
function EntryModal({
  target,
  entry,
  onClose,
}: {
  target: CellTarget;
  entry?: PlanEntry;
  onClose: () => void;
}) {
  const { clients, addPlanEntry, updatePlanEntry, deletePlanEntry } = useData();
  const [clientId, setClientId] = useState<string>(entry?.clientId ?? "");

  // Ordered by how much each client appeared in tracked/planned work lately —
  // the same rule the task picker's own client menu uses, shared so the two
  // can't disagree about which clients are current.
  const recentClients = useClientsByRecency();

  const selectedClient = clients.find((c) => c.id === clientId);

  /**
   * Add or change, from one place. Every field is named on both paths, so an
   * absence turning into a task can't keep the absence kind, and a note turning
   * into a task can't keep its text.
   */
  function commit(patch: {
    type: PlanEntry["type"];
    taskId: string | null;
    text: string;
    clientId: string | null;
    absenceType: AbsenceType | null;
  }) {
    if (entry) updatePlanEntry(entry.id, patch);
    else addPlanEntry({ date: target.date, columnId: target.columnId, ...patch });
    onClose();
  }

  function pickTask(m: TaskMatch) {
    commit({
      type: "task",
      taskId: m.task.id,
      text: "",
      clientId: m.client?.id ?? m.task.clientId,
      absenceType: null,
    });
  }

  function addFreeText(text: string) {
    commit({ type: "free_text", taskId: null, text, clientId: clientId || null, absenceType: null });
  }

  function addAbsence(key: AbsenceType) {
    // re-picking the kind it already is would be a write and an undo step for
    // nothing
    if (entry?.type === "absence" && entry.absenceType === key) {
      onClose();
      return;
    }
    commit({ type: "absence", taskId: null, text: "", clientId: null, absenceType: key });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed left-1/2 top-1/3 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-sm">
            {entry ? "Edit" : "Add to"} {target.label}
          </h3>
          <button onClick={onClose} className="rounded-md px-1.5 text-muted hover:bg-background">
            <X size={16} />
          </button>
        </div>

        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {recentClients.map((c) => (
            <button
              key={c.id}
              onClick={() => setClientId(clientId === c.id ? "" : c.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                clientId === c.id
                  ? "border-brand bg-brand-soft text-brand-dark"
                  : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground"
              }`}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} />
              {c.name}
            </button>
          ))}
        </div>

        <TaskAutocomplete
          clientId={clientId || null}
          allowFreeText
          autoFocus
          // the plan is the one place a FINISHED task is a legitimate choice:
          // work comes back. Picking one reopens it (see `plannedTaskToReopen`).
          includeDone
          // editing a note starts from what it says, so it can be amended rather
          // than retyped
          initialQuery={entry?.type === "free_text" ? entry.text : ""}
          freeTextLabel={entry?.type === "free_text" ? "Save as text" : "Add free text"}
          placeholder={
            selectedClient
              ? `Search ${selectedClient.name} tasks, or type free text…`
              : "Search all tasks, or type free text…"
          }
          onPickTask={pickTask}
          onFreeText={addFreeText}
        />

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <span className="mr-1 text-xs text-faint">Absence:</span>
          {ABSENCE_CHOICES.map((a) => {
            const active = entry?.type === "absence" && entry.absenceType === a.key;
            return (
              <button
                key={a.key}
                onClick={() => addAbsence(a.key)}
                title={active ? "Already set" : undefined}
                className={`rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-80 ${a.chip} ${
                  active ? "ring-2 ring-brand ring-offset-1" : ""
                }`}
              >
                {a.label}
              </button>
            );
          })}
          {entry && (
            <button
              onClick={() => {
                deletePlanEntry(entry.id);
                onClose();
              }}
              className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-danger hover:text-danger"
            >
              Remove from plan
            </button>
          )}
        </div>
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

// ── day-state modal ──────────────────────────────────────────────────────

const DAY_STATE_SUGGESTIONS = ["Holiday"];

function DayStateModal({ dateIso, onClose }: { dateIso: string; onClose: () => void }) {
  const { dayStates, addDayState, deleteDayState } = useData();
  const [label, setLabel] = useState("");
  const [until, setUntil] = useState(dateIso);

  const existing = dayStates.find((ds) => ds.dateFrom <= dateIso && dateIso <= ds.dateTo);

  function save() {
    if (!label.trim()) return;
    addDayState(dateIso, until >= dateIso ? until : dateIso, label.trim());
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed left-1/2 top-1/3 z-50 w-full max-w-xs -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-heading text-sm">Day state — {dateIso}</h3>
          <button onClick={onClose} className="rounded-md px-1.5 text-muted hover:bg-background">
            <X size={16} />
          </button>
        </div>
        {existing ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-white">
                {existing.label}
              </span>
              <span className="text-xs text-faint">
                {existing.dateFrom}
                {existing.dateTo !== existing.dateFrom ? ` → ${existing.dateTo}` : ""}
              </span>
            </div>
            <button
              onClick={() => {
                deleteDayState(existing.id);
                onClose();
              }}
              className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium text-danger hover:border-danger"
            >
              Delete
            </button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="flex gap-1.5">
              {DAY_STATE_SUGGESTIONS.map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setLabel(s)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    label === s
                      ? "border-brand bg-brand-soft text-brand-dark"
                      : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <input
              autoFocus
              placeholder="Label (Holiday, Funday…)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="bidi-auto w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand"
            />
            <label className="flex items-center gap-2 text-xs text-muted">
              until
              <input
                type="date"
                value={until}
                min={dateIso}
                onChange={(e) => setUntil(e.target.value)}
                className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
              />
            </label>
            <button
              disabled={!label.trim()}
              className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
            >
              Save
            </button>
          </form>
        )}
      </div>
    </>
  );
}

// ── in-development card (admins only) ────────────────────────────────────

function DevCard() {
  const { devItems, addDevItem, updateDevItem, deleteDevItem } = useData();
  const [newText, setNewText] = useState("");
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [statusMenu, setStatusMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const ordered = [...devItems].sort((a, b) => a.position - b.position);

  function commitEdit() {
    if (editing && editing.value.trim()) updateDevItem(editing.id, { text: editing.value.trim() });
    setEditing(null);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
        In development
      </div>
      <div className="flex flex-col gap-1">
        {ordered.map((item) => (
          <div key={item.id} className="group/dev relative flex items-center gap-1.5">
            {editing?.id === item.id ? (
              <input
                autoFocus
                value={editing.value}
                onChange={(e) => setEditing({ id: item.id, value: e.target.value })}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  else if (e.key === "Escape") setEditing(null);
                }}
                className="bidi-auto min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs outline-none focus:border-brand"
              />
            ) : (
              <button
                onClick={() => setEditing({ id: item.id, value: item.text })}
                className="bidi-auto min-w-0 flex-1 truncate rounded px-0.5 py-0.5 text-left text-xs hover:bg-background"
                title={item.text}
              >
                {item.text}
              </button>
            )}
            <button
              onClick={(e) => setStatusMenu({ x: e.clientX, y: e.clientY, id: item.id })}
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${DEV_STATUS[item.status].chip}`}
              title="Change status"
            >
              {DEV_STATUS[item.status].label}
            </button>
            <button
              onClick={() => deleteDevItem(item.id)}
              className="absolute -right-1 -top-1 hidden size-4 items-center justify-center rounded-full bg-foreground text-white group-hover/dev:flex"
              title="Delete"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>
      <form
        className={`${ordered.length ? "mt-2 border-t border-border pt-2" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!newText.trim()) return;
          addDevItem(newText.trim());
          setNewText("");
        }}
      >
        <input
          placeholder="+ Add"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          className="bidi-auto w-full rounded-md border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-brand"
        />
      </form>
      {statusMenu && (
        <ContextMenu
          x={statusMenu.x}
          y={statusMenu.y}
          items={DEV_STATUS_ORDER.map((s) => ({
            label: DEV_STATUS[s].label,
            onClick: () => updateDevItem(statusMenu.id, { status: s }),
          }))}
          onClose={() => setStatusMenu(null)}
        />
      )}
    </div>
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
  onChipMenu,
  onCellMenu,
  onHoverCell,
  onHoverEntry,
  onEditEntry,
}: {
  date: string | null;
  columnId: string;
  label: string;
  entries: PlanEntry[];
  canEdit: boolean;
  onAdd: (target: CellTarget) => void;
  onChipMenu?: (e: ReactMouseEvent, entry: PlanEntry) => void;
  onCellMenu?: (e: ReactMouseEvent, target: CellTarget) => void;
  onHoverCell?: (target: CellTarget | null) => void;
  onHoverEntry?: (entry: PlanEntry | null) => void;
  /** the cell passes its own target along, since the editor's header names it */
  onEditEntry?: (entry: PlanEntry, target: CellTarget) => void;
}) {
  const { movePlanEntryToCell } = useData();
  const [over, setOver] = useState(false);

  const hasAbsence = entries.some((e) => e.type === "absence");
  const target: CellTarget = { date, columnId, label };

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
          // dropping into someone else's column also reassigns the task to them
          if (id) movePlanEntryToCell(id, { date, columnId });
        },
      }
    : {};

  return (
    // p-1.5 = the 4px the <td> used to carry plus the 2px this cell did. The
    // padding had to move INSIDE the absolute layer's containing block, or an
    // absence's `inset-0` stops at the td's padding and leaves a visible gap; the
    // total is unchanged, so chips and row heights are pixel-identical.
    // The drop outline needs -outline-offset-2 now that it has no td padding to
    // sit in, else it paints over the cell borders into the next column.
    <div
      className={`group/cell relative flex h-full min-h-8 flex-col gap-1 p-1.5 ${over ? "bg-brand-soft outline-2 -outline-offset-2 outline-dashed outline-brand" : ""}`}
      onContextMenu={canEdit && onCellMenu ? (e) => onCellMenu(e, target) : undefined}
      onMouseEnter={onHoverCell ? () => onHoverCell(target) : undefined}
      onMouseLeave={onHoverCell ? () => onHoverCell(null) : undefined}
      {...dropProps}
    >
      {/* absence covers the WHOLE cell (absolute ignores the cell padding) */}
      {entries
        .filter((e) => e.type === "absence")
        .map((e) => (
          <div key={e.id} className="absolute inset-0 z-0 flex">
            <EntryChip
              entry={e}
              canEdit={canEdit}
              onMenu={onChipMenu}
              onHover={onHoverEntry}
              onEdit={onEditEntry ? (en) => onEditEntry(en, target) : undefined}
            />
          </div>
        ))}
      {entries
        .filter((e) => e.type !== "absence")
        .map((e) => (
          <div key={e.id} className="relative z-10">
            <EntryChip
              entry={e}
              canEdit={canEdit}
              onMenu={onChipMenu}
              onHover={onHoverEntry}
              onEdit={onEditEntry ? (en) => onEditEntry(en, target) : undefined}
            />
          </div>
        ))}
      {hasAbsence && <div className="min-h-8 flex-1" aria-hidden />}
      {canEdit && !hasAbsence && (
        <button
          onClick={() => onAdd(target)}
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

/**
 * ⚠️ BOX-SHADOWS, NOT BORDERS, AND THAT IS FORCED: this table is
 * `border-collapse: collapse`, which does not paint borders on sticky cells
 * reliably — the same reason `report-table.tsx` uses an inset shadow on its last
 * frozen column. The negative spread confines each one to its own edge instead
 * of letting it bloom across the neighbouring cells.
 */
const SHADOW_X = "shadow-[6px_0_8px_-6px_rgba(0,0,0,0.14)]";
const SHADOW_Y = "shadow-[0_5px_8px_-6px_rgba(0,0,0,0.14)]";

export function WeeklyPlan() {
  const { planColumns, planEntries, profiles, currentUserId, dayStates, addPlanEntry, deletePlanEntry } =
    useData();
  const [rangeStart, setRangeStart] = useState(() => shiftDays(startOfWeek(new Date()), -14));
  const [rangeEnd, setRangeEnd] = useState(() => shiftDays(startOfWeek(new Date()), 27));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // one piece of state for both jobs: `entry` present = editing what is there,
  // absent = adding to the cell
  const [entryModal, setEntryModal] = useState<{ target: CellTarget; entry?: PlanEntry } | null>(
    null,
  );
  const [dayStateTarget, setDayStateTarget] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  /**
   * Whether anything is hidden behind the pinned header row / pinned date column.
   *
   * ⚠️ The reasoning is copied from `client-timeline.tsx` along with the pattern:
   * both edges stay SILENT until something is actually behind them, so a shadow
   * is information rather than decoration. Nitsan reported the grid scrolling
   * sideways under the date column "with no shadow to show its a pocket".
   *
   * ⚠️ Only a BOUNDARY CROSSING re-renders — scrolling within a state is free.
   * This grid runs to ~10 columns × 378 days, so a setState per scroll event
   * would be a re-render per frame while dragging a chip across it.
   */
  const [gridShadow, setGridShadow] = useState({ x: false, y: false });
  function onGridScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const x = el.scrollLeft > 0;
    const y = el.scrollTop > 0;
    setGridShadow((g) => (g.x === x && g.y === y ? g : { x, y }));
  }
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hoveredCell = useRef<CellTarget | null>(null);
  const hoveredEntry = useRef<PlanEntry | null>(null);
  const todayIso = toISODate(new Date());
  /**
   * Width of the waiting-list / in-development rail, persisted per browser under
   * `colw.plan-rail` — the same mechanism as the resizable table columns.
   * Min 150: below that the waiting-list chips lose their client line. Max 420:
   * past that the grid starts squeezing the columns you actually plan in.
   */
  const { widths: rail, startResize: startRailResize } = useColWidths(
    "plan-rail",
    { w: 192 },
    { min: 150, max: 420, invert: true },
  );

  const canEdit = useIsAdmin();

  // ── copy / paste ───────────────────────────────────────────────────────
  const copyEntry = (entry: PlanEntry) => {
    planClipboard = {
      type: entry.type,
      taskId: entry.taskId,
      text: entry.text,
      clientId: entry.clientId,
      absenceType: entry.absenceType,
    };
  };

  const pasteInto = (cell: CellTarget) => {
    if (!planClipboard) return;
    addPlanEntry({ date: cell.date, columnId: cell.columnId, ...planClipboard });
  };

  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "c" && hoveredEntry.current && !window.getSelection()?.toString()) {
        e.preventDefault();
        copyEntry(hoveredEntry.current);
      } else if (e.key === "v" && hoveredCell.current && planClipboard) {
        e.preventDefault();
        pasteInto(hoveredCell.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, addPlanEntry]);

  const openChipMenu = (e: ReactMouseEvent, entry: PlanEntry) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Copy", hint: "⌘C", onClick: () => copyEntry(entry) },
        { label: "Delete", danger: true, onClick: () => deletePlanEntry(entry.id) },
      ],
    });
  };

  const openCellMenu = (e: ReactMouseEvent, cell: CellTarget) => {
    if (!canEdit) return;
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Paste", hint: "⌘V", disabled: !planClipboard, onClick: () => pasteInto(cell) },
        { label: "Add…", onClick: () => setEntryModal({ target: cell }) },
      ],
    });
  };

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = rangeStart; d <= rangeEnd; d = shiftDays(d, 1)) out.push(d);
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
      setRangeStart(shiftDays(startOfWeek(target), -7));
      changed = true;
    }
    if (target > rangeEnd) {
      setRangeEnd(shiftDays(startOfWeek(target), 27));
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
    jumpTo(shiftDays(anchor, days));
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
          onScroll={onGridScroll}
        >
          {/*
            `table-fixed`, so every person column is exactly as wide as every
            other one. Under auto layout a column was sized by its longest chip,
            which is why one designer's column was visibly wider than the rest —
            and it moved around as the week's work changed. Chips wrap instead.

            `w-full` only ever ADDS width: measured in Chrome, a fixed table whose
            columns total more than the container keeps their widths and lets the
            wrapper scroll (which is what it did before), and when they total less
            the spare is split evenly. So no min-width is needed here.
          */}
          <table className="w-full table-fixed border-collapse">
            <thead className="sticky top-0 z-20">
              <tr>
                <th
                  className={`sticky left-0 z-30 w-24 border-b border-r border-border bg-surface p-2 text-left text-xs font-medium text-faint ${
                    gridShadow.x ? SHADOW_X : ""
                  } ${gridShadow.y ? SHADOW_Y : ""}`}
                >
                  <button
                    onClick={() => setRangeStart((s) => shiftDays(s, -28))}
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
                      // a width, not a min-width: under fixed layout the header
                      // row's widths ARE the column widths
                      className={`${PERSON_COL} border-b border-r border-border bg-surface p-2 text-left last:border-r-0 ${gridShadow.y ? SHADOW_Y : ""} ${col.type === "studio" ? "bg-brand-soft/60" : ""} ${isMe ? "bg-aqua/20" : ""}`}
                    >
                      <div className="flex items-center gap-1.5 text-xs font-semibold">
                        {profile ? <Avatar profile={profile} size={20} /> : null}
                        {/* the column no longer widens to fit a long name */}
                        <span className="min-w-0 truncate" title={col.name}>
                          {col.name}
                        </span>
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
                          className="-mx-2 -my-1 flex items-center gap-1 rounded px-2 py-1.5 font-heading text-xs text-muted hover:bg-black/5 hover:text-foreground"
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
                const dayState = dayStates.find((ds) => ds.dateFrom <= iso && iso <= ds.dateTo);
                const { name, date } = formatDayLabel(row.date);
                return (
                  <tr
                    key={iso}
                    id={`plan-day-${iso}`}
                    className={`${dayState ? "bg-blue-100/60" : weekend ? "bg-weekend" : ""} ${isToday ? "bg-aqua/10 outline outline-2 -outline-offset-2 outline-brand" : ""} ${isPast ? "opacity-55" : ""}`}
                  >
                    <td
                      onClick={canEdit ? () => setDayStateTarget(iso) : undefined}
                      className={`group/date sticky left-0 z-[15] border-b border-r border-border p-2 align-top text-xs ${gridShadow.x ? SHADOW_X : ""} ${weekend && !dayState ? "text-faint" : ""} ${isToday ? "border-l-4 border-l-brand pin-today" : dayState ? "bg-blue-100" : weekend ? "bg-weekend" : "bg-surface"} ${canEdit ? "cursor-pointer pin-hover" : ""}`}
                      title={canEdit ? "Set day state (holiday…)" : undefined}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div className={isToday ? "text-sm font-bold text-foreground" : "font-semibold"}>
                          {isToday ? "Today" : name}
                        </div>
                        {canEdit && (
                          <CalendarPlus
                            size={12}
                            className="mt-0.5 shrink-0 text-brand opacity-0 transition-opacity group-hover/date:opacity-100"
                          />
                        )}
                      </div>
                      <div className={isToday ? "font-bold text-foreground" : "text-faint"}>{date}</div>
                      {dayState && (
                        <div className="mt-1 inline-block max-w-full truncate rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          {dayState.label}
                        </div>
                      )}
                    </td>
                    {gridCols.map((col) => (
                      <td
                        key={col.id}
                        // p-0 (the padding lives in PlanCell) + h-px: a table cell
                        // only gives a percentage-height child something to resolve
                        // against when it has a height of its own, and the row
                        // overrides h-px anyway — so PlanCell's h-full finally
                        // stretches to the ROW height and an absence fills a tall
                        // row instead of one chip's worth of it.
                        className={`h-px border-b border-r border-border p-0 align-top last:border-r-0 ${col.type === "studio" && !weekend ? "bg-brand-soft/30" : ""} ${col.profileId === currentUserId && !weekend ? "bg-aqua/10" : ""}`}
                      >
                        <PlanCell
                          date={iso}
                          columnId={col.id}
                          label={`${col.name} — ${name} ${date}`}
                          entries={entriesByCell.get(`${iso}::${col.id}`) ?? []}
                          canEdit={canEdit}
                          onAdd={(t) => setEntryModal({ target: t })}
                          onChipMenu={openChipMenu}
                          onCellMenu={openCellMenu}
                          onHoverCell={(t) => (hoveredCell.current = t)}
                          onHoverEntry={(en) => (hoveredEntry.current = en)}
                          onEditEntry={(en, t) => setEntryModal({ target: t, entry: en })}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <td colSpan={gridCols.length + 1} className="p-2">
                  <button
                    onClick={() => setRangeEnd((e) => shiftDays(e, 28))}
                    className="w-full rounded-md border border-dashed border-border-strong py-1.5 text-xs text-muted hover:border-brand hover:text-brand"
                  >
                    ↓ load 4 more weeks
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div
            className="group/resize relative flex shrink-0 flex-col gap-4 self-start"
            style={{ width: rail.w }}
          >
            {/* Handle centred in the flex gap, dragging left to grow the rail.
                `always` because a pane edge — unlike a table column edge — gives
                no hint that it can be dragged. */}
            <ResizeHandle side="left" visibility="always" onMouseDown={startRailResize("w")} />
            {waitingCol && !waitingCol.hidden && (
              <div className="rounded-xl border border-border bg-surface p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">
                  {waitingCol.name}
                </div>
                <PlanCell
                  date={null}
                  columnId={waitingCol.id}
                  label="Waiting list"
                  entries={entriesByCell.get(`wl::${waitingCol.id}`) ?? []}
                  canEdit={canEdit}
                  onAdd={(t) => setEntryModal({ target: t })}
                  onChipMenu={openChipMenu}
                  onCellMenu={openCellMenu}
                  onHoverCell={(t) => (hoveredCell.current = t)}
                  onHoverEntry={(en) => (hoveredEntry.current = en)}
                  onEditEntry={(en, t) => setEntryModal({ target: t, entry: en })}
                />
              </div>
            )}
            <DevCard />
          </div>
        )}
      </div>

      {canEdit && (
        <p className="text-xs text-faint">
          Hover a cell to add a task, free text or absence · drag chips between days, or into
          someone else&apos;s column to reassign the task to them · right-click to copy/paste (or
          ⌘C/⌘V over a chip/cell) · click a date cell to mark a holiday · click month names to fold
          them · drag the edge of the right-hand panel to resize it.
        </p>
      )}

      {entryModal && (
        <EntryModal
          target={entryModal.target}
          entry={entryModal.entry}
          onClose={() => setEntryModal(null)}
        />
      )}
      {dayStateTarget && (
        <DayStateModal dateIso={dayStateTarget} onClose={() => setDayStateTarget(null)} />
      )}
      {showColumns && <ColumnManager onClose={() => setShowColumns(false)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
