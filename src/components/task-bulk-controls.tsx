"use client";

import { useData } from "@/lib/store";

/**
 * Set a field on every selected task at once — status, type, due date.
 *
 * Shared by the client table's selection bar and the Timeline's, because those
 * two select the same tasks and any difference between them would read as a bug
 * rather than a design. `updateTasksBulk` records ONE history entry for the
 * whole selection, so a single ⌘Z reverses a 20-task change.
 *
 * Each control resets itself to its placeholder after firing: leaving "Design"
 * showing in a control that no longer has a selection behind it invites a second
 * click that does nothing, or worse, does it to the next selection.
 */
export function TaskBulkControls({
  ids,
  onDone,
  canSetDate = true,
}: {
  ids: string[];
  /** clear the selection (and close the bar) after a change */
  onDone: () => void;
  /** due dates are admin-only in the DB (0011's trigger) */
  canSetDate?: boolean;
}) {
  const { tags, taskTypes, updateTasksBulk } = useData();

  const control =
    "rounded-md border border-border bg-surface px-1.5 py-1 text-sm text-foreground outline-none focus:border-brand";

  return (
    <>
      <select
        value=""
        onChange={(e) => {
          updateTasksBulk(ids, { tag: e.target.value === "__none" ? null : e.target.value });
          onDone();
        }}
        title="Set the status of every selected task"
        className={control}
      >
        <option value="" disabled>
          status…
        </option>
        <option value="__none">No status</option>
        {tags.map((t) => (
          <option key={t.id} value={t.name}>
            {t.name}
          </option>
        ))}
      </select>

      <select
        value=""
        onChange={(e) => {
          updateTasksBulk(ids, { typeId: e.target.value === "__none" ? null : e.target.value });
          onDone();
        }}
        title="Set the type of work on every selected task"
        className={control}
      >
        <option value="" disabled>
          type…
        </option>
        <option value="__none">No type</option>
        {taskTypes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      {canSetDate && (
        <>
          <label className="flex items-center gap-1.5 text-muted">
            Start
            <input
              type="date"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                updateTasksBulk(ids, { startDate: e.target.value });
                onDone();
              }}
              title="Set the start date on every selected task"
              className={`${control} tabular-nums`}
            />
          </label>
          <label className="flex items-center gap-1.5 text-muted">
            Due
            <input
              type="date"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                updateTasksBulk(ids, { dueDate: e.target.value });
                onDone();
              }}
              title="Set the due date on every selected task"
              className={`${control} tabular-nums`}
            />
          </label>
        </>
      )}
    </>
  );
}
