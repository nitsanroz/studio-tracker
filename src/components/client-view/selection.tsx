"use client";

// Selecting several tasks at once: the per-scope tick box, and the bar that
// acts on what is selected.
//
// ⚠️ Bulk delete REFUSES outright when any selected task carries logged time,
// rather than warning — hours cascade away with the task and cannot be restored.

import { TaskBulkControls } from "../task-bulk-controls";
import { useSelection } from "./shared";
import { formatHoursShort } from "@/lib/format";
import { useData } from "@/lib/store";
import { X } from "lucide-react";
import { useMemo, useState } from "react";


/** Tri-state select-all: checked when every id is selected, dash when only some are. */
export function SelectAllBox({ ids, title }: { ids: string[]; title: string }) {
  const sel = useSelection();
  if (!sel || ids.length === 0) return <span className="w-3.5" />;
  const on = ids.filter((id) => sel.selected.has(id)).length;
  const all = on === ids.length;
  return (
    <input
      // `indeterminate` has no HTML attribute — it can only be set on the node.
      ref={(el) => {
        if (el) el.indeterminate = on > 0 && !all;
      }}
      type="checkbox"
      checked={all}
      title={title}
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
      onChange={() => sel.setMany(ids, !all)}
      className="h-3.5 w-3.5 cursor-pointer accent-[var(--brand)]"
    />
  );
}


/**
 * Sticky action bar for the current multi-selection. Admin-only; the caller
 * renders it only when something is selected.
 */
export function SelectionBar({
  ids,
  clientId,
  onClear,
}: {
  ids: string[];
  clientId: string;
  onClear: () => void;
}) {
  const { clients, sections, tasks, taskMinutes, updateTasksBulk, deleteTasksBulk } = useData();
  const [moveTo, setMoveTo] = useState("");

  const targetSections = useMemo(
    () => sections.filter((s) => s.clientId === (moveTo || clientId)).sort((a, b) => a.position - b.position),
    [sections, moveTo, clientId],
  );
  const selectedTasks = tasks.filter((t) => ids.includes(t.id));
  const minutes = selectedTasks.reduce((sum, t) => sum + taskMinutes(t.id), 0);

  const done = () => {
    setMoveTo("");
    onClear();
  };

  return (
    <div className="sticky bottom-4 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand bg-surface px-3 py-2 text-sm shadow-card">
      <span className="font-medium">
        {ids.length} selected
        {minutes > 0 && <span className="ml-1.5 text-muted">· {formatHoursShort(minutes)}</span>}
      </span>

      <span className="mx-1 h-4 w-px bg-border" />

      <label className="flex items-center gap-1.5 text-muted">
        Move to
        <select
          value={moveTo}
          onChange={(e) => setMoveTo(e.target.value)}
          className="rounded-md border border-border bg-surface px-1.5 py-1 text-sm text-foreground outline-none focus:border-brand"
        >
          <option value="">this client</option>
          {clients
            .filter((c) => c.id !== clientId)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? " (archived)" : ""}
              </option>
            ))}
        </select>
      </label>

      <select
        defaultValue=""
        onChange={(e) => {
          const sectionId = e.target.value === "__none" ? null : e.target.value;
          // A section belongs to exactly one client, so a cross-client move MUST
          // carry a section for the target — keeping the old id would strand these
          // tasks inside another client's section.
          updateTasksBulk(ids, moveTo ? { clientId: moveTo, sectionId } : { sectionId });
          done();
        }}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-sm outline-none focus:border-brand"
      >
        <option value="" disabled>
          section…
        </option>
        <option value="__none">No section</option>
        {targetSections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <span className="mx-1 h-4 w-px bg-border" />

      <TaskBulkControls ids={ids} onDone={done} />

      <span className="mx-1 h-4 w-px bg-border" />

      <button
        onClick={() => {
          updateTasksBulk(ids, { status: "done" });
          done();
        }}
        className="rounded-md border border-border px-2 py-1 font-medium text-muted hover:border-success hover:text-success"
      >
        Mark done
      </button>
      <button
        onClick={() => {
          updateTasksBulk(ids, { billable: true });
          done();
        }}
        className="rounded-md border border-border px-2 py-1 font-medium text-muted hover:border-success hover:text-success"
      >
        Billable
      </button>
      <button
        onClick={() => {
          updateTasksBulk(ids, { billable: false });
          done();
        }}
        className="rounded-md border border-border px-2 py-1 font-medium text-muted hover:border-brand hover:text-brand"
      >
        Non-billable
      </button>
      <button
        onClick={() => {
          // Hours cascade away with the task and cannot be restored, so a selection
          // holding any logged time is refused outright rather than warned about.
          if (minutes > 0) {
            alert(
              `${formatHoursShort(minutes)} of logged time sits on these tasks.\n\n` +
                `Deleting would destroy those hours permanently. Move the time off them first, ` +
                `or delete those tasks one at a time.`,
            );
            return;
          }
          if (confirm(`Delete ${ids.length} task${ids.length === 1 ? "" : "s"}?\n\nThis cannot be undone.`)) {
            deleteTasksBulk(ids);
            done();
          }
        }}
        className="rounded-md border border-border px-2 py-1 font-medium text-muted hover:border-danger hover:text-danger"
      >
        Delete
      </button>

      <button
        onClick={done}
        title="Clear selection"
        className="ml-auto rounded-md p-1 text-faint hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}
