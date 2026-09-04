"use client";

// What the studio can put in one cell of the weekly plan — shared by the desktop
// grid and the phone build.
//
// ⚠️⚠️ EXTRACTED SO THE TWO CANNOT DISAGREE ABOUT WHAT A PLAN ENTRY IS. The grid
// and `plan-mobile.tsx` are deliberately separate components (the grid is a
// 1,850px fixed table driven by dragging, which is not a phone gesture), but
// "you may put a task, a note or an absence here, and editing is choosing again"
// is one rule, not two. The absence vocabulary lives here for the same reason:
// three kinds, one set of labels, one set of colours.

import { useState } from "react";
import { Minus, Palmtree, Thermometer, X } from "lucide-react";
import { useData } from "@/lib/store";
import { TaskAutocomplete, useClientsByRecency, type TaskMatch } from "./task-autocomplete";
import type { AbsenceType, PlanEntry } from "@/lib/types";

/** Which cell something is going into — the modal names it in its heading. */
export interface CellTarget {
  date: string | null;
  columnId: string;
  label: string;
}

export const ABSENCE_LABELS: Record<AbsenceType, string> = {
  vacation: "🌴 Vacation",
  sick: "🤒 Sick",
  day_off: "Day off",
};

/** Full-cell fill styles per absence type. */

export const ABSENCE_FILL: Record<AbsenceType, string> = {
  sick: "bg-black text-white",
  vacation: "bg-blue-700 text-white",
  day_off: "bg-gray-200 text-gray-500",
};

/** Icon + short label shown inside the full-cell absence fill. */

export const ABSENCE_CELL: Record<AbsenceType, { icon: typeof Thermometer; label: string | null }> = {
  sick: { icon: Thermometer, label: "Sick" },
  vacation: { icon: Palmtree, label: "Vacation" },
  day_off: { icon: Minus, label: null },
};

/** Display label + functional chip colors per dev-item status. */

/** The absence buttons in the add/edit modal, in the order the studio reads them. */
export const ABSENCE_CHOICES: { key: AbsenceType; label: string; chip: string }[] = [
  { key: "sick", label: "🤒 Sick", chip: "bg-black text-white" },
  { key: "vacation", label: "🌴 Vacation", chip: "bg-blue-700 text-white" },
  { key: "day_off", label: "– Day off", chip: "bg-gray-200 text-gray-600" },
];


/**
 * One modal for putting something in a cell and for changing what is already
 * there. Editing IS choosing again — pick a task, retype the note, or pick an
 * absence — so a separate editor would have been the same three controls with a
 * different verb.
 *
 * `entry` switches it to edit mode. Task chips never open it: clicking one opens
 * the task pane, which is where a task is edited.
 */
export function EntryModal({
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
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 items-center justify-center rounded-md text-muted hover:bg-background md:size-auto md:px-1.5"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {recentClients.map((c) => (
            <button
              key={c.id}
              onClick={() => setClientId(clientId === c.id ? "" : c.id)}
              // ⚠️ 44px on a phone. This modal was desktop-only until the plan
              // got a phone build; its controls were 26–28px, under the tap
              // floor this app has held since v1.15.0. Untouched from `md` up.
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium md:min-h-0 ${
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
                className={`min-h-11 rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-80 md:min-h-0 ${a.chip} ${
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
              className="ml-auto min-h-11 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted hover:border-danger hover:text-danger md:min-h-0"
            >
              Remove from plan
            </button>
          )}
        </div>
      </div>
    </>
  );
}
