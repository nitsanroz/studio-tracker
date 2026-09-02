"use client";

// Move some of one logged entry's hours onto the client's non-billable Keys task,
// wherever that entry is on screen.
//
// ⚠️⚠️ ONE IMPLEMENTATION FOR EVERY SURFACE, AND THAT IS THE POINT. This started
// life inside the client-report hover card (v1.45.0) and is now also on the task
// pane's time list, the day popup and the entry editor — four places that each
// show a task's logged time. Four copies of "which task do the hours go to, who
// may move them, and what counts as a valid figure" is three chances to disagree
// about a client's bill.
//
// It is a HOOK plus two small components rather than one element, because the
// three hosts lay the control out differently: the hover card puts the field on
// its own line under a tight flex row, the entry editor puts it inline, the modal
// gives it a labelled row. An absolutely-positioned popover was the other option
// and is exactly wrong here — every one of these lists sits inside an
// `overflow-y-auto` scroller, which clips both axes (the trap this codebase has
// hit five times).

import { useState } from "react";
import { KeyRound, X } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { formatHoursDecimal, formatHoursShort } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

export type KeysWriteDownState = {
  /** false when there is nothing to offer — see the rules in the hook */
  available: boolean;
  keysTaskTitle: string;
  open: boolean;
  toggle: () => void;
  close: () => void;
  hours: string;
  setHours: (v: string) => void;
  /** the typed figure in whole minutes, or null when it cannot be moved */
  minutes: number | null;
  /** why the typed figure is refused, for the field to say out loud */
  problem: string | null;
  max: number;
  busy: boolean;
  commit: () => void;
  size: "sm" | "md";
};

/**
 * The rules, in one place.
 *
 * ⚠️ ADMIN ONLY. A write-down reduces what a client is charged; a designer
 * deciding their own hours were slow is a different thing from the studio
 * deciding not to bill for them. Members see their entries exactly as before.
 * ⚠️ Not offered on a LEGACY row: recovered pre-Everhour history was
 * reconstructed rather than logged, and `canEditEntry` already refuses it.
 * ⚠️ Not offered when the client has no Keys task chosen (`Client.keysTaskId`,
 * migration 0037) — there is nowhere for the hours to go, and a control that
 * explains itself only after a click is worse than one that is not there.
 * ⚠️ Not offered when the entry is ALREADY on the keys task: writing keys hours
 * down to themselves is a no-op.
 */
export function useKeysWriteDown(
  /** null is allowed so a caller with an early return can still call the hook */
  entry: TimeEntry | null,
  /** told how many minutes moved, for a caller holding its own copy of the row */
  onMoved?: (movedMinutes: number) => void,
  size: "sm" | "md" = "sm",
): KeysWriteDownState {
  const { tasks, clients, writeDownToKeys } = useData();
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);

  const task = entry ? (tasks.find((t) => t.id === entry.taskId) ?? null) : null;
  const client = task ? (clients.find((c) => c.id === task.clientId) ?? null) : null;
  const keysTaskId = client?.keysTaskId ?? null;
  const keysTask = keysTaskId ? (tasks.find((t) => t.id === keysTaskId) ?? null) : null;
  const available =
    !!entry &&
    isAdmin &&
    !entry.legacy &&
    entry.minutes > 0 &&
    !!keysTaskId &&
    keysTaskId !== entry.taskId;

  /**
   * ⚠️⚠️ THE TYPED FIGURE IS HOURS AND THE STORE TAKES MINUTES — and the rounding
   * is where a write-down would otherwise lie. `1.6` hours is 96 minutes exactly;
   * a value that does not land on a whole minute is REFUSED rather than rounded,
   * because rounding down under-bills the studio a minute at a time and rounding up
   * over-bills the client, and neither is a decision this field should make quietly.
   */
  const raw = Number(hours.trim());
  const asMinutes = raw * 60;
  let minutes: number | null = null;
  let problem: string | null = null;
  if (!hours.trim()) problem = null;
  else if (!Number.isFinite(raw) || raw <= 0) problem = "hours must be a positive number";
  else if (!Number.isInteger(asMinutes)) problem = "not a whole number of minutes";
  else if (entry && asMinutes > entry.minutes)
    problem = `this entry only holds ${formatHoursDecimal(entry.minutes)}h`;
  else minutes = asMinutes;

  const commit = () => {
    if (!entry || !keysTaskId || minutes == null || busy) return;
    const moving = minutes;
    setBusy(true);
    void writeDownToKeys(entry.id, moving, keysTaskId).then((ok) => {
      setBusy(false);
      if (!ok) return;
      setOpen(false);
      setHours("");
      onMoved?.(moving);
    });
  };

  return {
    available,
    keysTaskTitle: keysTask?.title ?? "Keys",
    open: open && available,
    // opens pre-filled with the whole entry, which is the common case (the row was
    // not billable at all) and is also the ceiling, so it can only be edited down
    toggle: () => {
      setOpen((v) => !v);
      setHours(entry ? formatHoursDecimal(entry.minutes) : "");
    },
    close: () => setOpen(false),
    hours,
    setHours,
    minutes,
    problem,
    max: entry?.minutes ?? 0,
    busy,
    commit,
    size,
  };
}

/** The trigger: a key, and it looks like a button because it is one. */
export function KeysButton({ state, label = true }: { state: KeysWriteDownState; label?: boolean }) {
  if (!state.available) return null;
  const sm = state.size === "sm";
  return (
    <button
      onClick={(ev) => {
        // these rows are often themselves clickable (the task pane opens an editor)
        ev.stopPropagation();
        state.toggle();
      }}
      title={`Move some of these hours to ${state.keysTaskTitle}, so they are not billed`}
      aria-pressed={state.open}
      // ⚠️ 44px tall on a phone, the floor this app has held since v1.15.0 and
      // restored once already (v1.32.3) — from `md` up it is the tight desktop
      // size it was designed at. The `sm` variant only ever renders on
      // desktop-gated surfaces, but it costs nothing to be right either way.
      className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border font-semibold md:min-h-0 ${
        sm ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
      } ${
        state.open
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface text-muted hover:border-brand hover:text-brand"
      }`}
    >
      <KeyRound size={sm ? 11 : 13} />
      {label && "Keys"}
    </button>
  );
}

/**
 * The open field. Carries its own way out — Escape, the ✕, or pressing the button
 * again — because the first thing anybody does after opening it by accident is
 * look for how to close it.
 */
export function KeysField({ state }: { state: KeysWriteDownState }) {
  if (!state.open) return null;
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg bg-background px-1.5 py-1"
      onClick={(ev) => ev.stopPropagation()}
    >
      <input
        autoFocus
        value={state.hours}
        onChange={(ev) => state.setHours(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Escape") state.close();
          if (ev.key === "Enter") state.commit();
        }}
        className={`w-12 rounded border bg-surface px-1 py-0.5 text-right text-[11px] tabular-nums outline-none ${
          state.problem ? "border-danger" : "border-border focus:border-brand"
        }`}
      />
      <span className="text-[10px] text-muted">
        h of {formatHoursDecimal(state.max)} → {state.keysTaskTitle}
      </span>
      <button
        onClick={state.commit}
        disabled={state.busy || state.minutes == null}
        className="ml-auto rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
      >
        {state.busy ? "Moving…" : "Move"}
      </button>
      <button
        onClick={state.close}
        title="Leave these hours as they are"
        className="rounded p-0.5 text-faint hover:bg-surface hover:text-foreground"
      >
        <X size={12} />
      </button>
      {/* Say why rather than leaving a dead Move button — "1.6" is fine and
          "1.61" is not, which is not guessable from a greyed-out control. */}
      {state.problem && (
        <span className="basis-full text-[10px] text-danger">{state.problem}</span>
      )}
      {!state.problem && state.minutes != null && state.minutes < state.max && (
        <span className="basis-full text-[10px] text-faint">
          {formatHoursShort(state.max - state.minutes)} stays billable on this task
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   The TASK-level write-down: pick a designer, say how many hours.

   ⚠️ WHY THERE ARE TWO CONTROLS. The per-row one answers "45 minutes off this
   entry"; this one answers the sentence the studio actually says — "three of
   Nadav's hours on this task were slow" — without making anybody choose whose
   Tuesday to dock first. It consumes that person's rows oldest first (see
   `writeDownMemberToKeys`), so the provenance trail still lands on real entries.
   ───────────────────────────────────────────────────────────────────────────── */

export type KeysMemberOption = { userId: string; name: string; minutes: number };

export type KeysTaskState = {
  available: boolean;
  keysTaskTitle: string;
  open: boolean;
  toggle: () => void;
  close: () => void;
  options: KeysMemberOption[];
  userId: string;
  setUserId: (id: string) => void;
  hours: string;
  setHours: (v: string) => void;
  minutes: number | null;
  problem: string | null;
  /** what the chosen person has in scope */
  max: number;
  busy: boolean;
  commit: () => void;
};

export function useKeysTaskWriteDown({
  taskId,
  options,
  range,
  onMoved,
}: {
  taskId: string;
  /**
   * Who has hours here and how many, AS THE CALLER IS SHOWING THEM.
   *
   * ⚠️ Passed in rather than queried: the hover card and the task pane have both
   * already loaded and totalled these rows, and a second query could disagree with
   * the figures on screen — which, on a control that reduces a bill, is the one
   * thing that must not happen. Rows with no author are filtered out, since a
   * write-down has to name somebody.
   */
  options: KeysMemberOption[];
  /** limits it to one cell's dates; omitted means the whole task */
  range?: { from: string; to: string };
  onMoved?: () => void;
}): KeysTaskState {
  const { tasks, clients, writeDownMemberToKeys } = useData();
  const isAdmin = useIsAdmin();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);

  const task = tasks.find((t) => t.id === taskId) ?? null;
  const client = task ? (clients.find((c) => c.id === task.clientId) ?? null) : null;
  const keysTaskId = client?.keysTaskId ?? null;
  const keysTask = keysTaskId ? (tasks.find((t) => t.id === keysTaskId) ?? null) : null;
  const usable = options.filter((o) => o.minutes > 0);
  const available = isAdmin && !!keysTaskId && keysTaskId !== taskId && usable.length > 0;

  // whoever is chosen, or the biggest contributor — the likeliest subject
  const chosen = usable.find((o) => o.userId === userId) ?? usable[0];
  const max = chosen?.minutes ?? 0;

  const raw = Number(hours.trim());
  const asMinutes = raw * 60;
  let minutes: number | null = null;
  let problem: string | null = null;
  if (!hours.trim()) problem = null;
  else if (!Number.isFinite(raw) || raw <= 0) problem = "hours must be a positive number";
  else if (!Number.isInteger(asMinutes)) problem = "not a whole number of minutes";
  else if (asMinutes > max)
    problem = `${chosen?.name ?? "that person"} has ${formatHoursDecimal(max)}h here`;
  else minutes = asMinutes;

  const commit = () => {
    if (!keysTaskId || !chosen || minutes == null || busy) return;
    setBusy(true);
    void writeDownMemberToKeys(taskId, chosen.userId, minutes, keysTaskId, range).then((ok) => {
      setBusy(false);
      if (!ok) return;
      setOpen(false);
      setHours("");
      onMoved?.();
    });
  };

  return {
    available,
    keysTaskTitle: keysTask?.title ?? "Keys",
    open: open && available,
    toggle: () => {
      setOpen((v) => !v);
      // ⚠️ NOT pre-filled with their whole total, unlike the per-row field: there
      // the common case is "none of this was billable", here it is "some of it" —
      // and a prefilled maximum on a control that moves several rows at once is
      // one Enter away from writing off a designer's entire week on the task.
      setHours("");
      setUserId(usable[0]?.userId ?? "");
    },
    close: () => setOpen(false),
    options: usable,
    userId: chosen?.userId ?? "",
    setUserId,
    hours,
    setHours,
    minutes,
    problem,
    max,
    busy,
    commit,
  };
}

export function KeysTaskButton({ state }: { state: KeysTaskState }) {
  if (!state.available) return null;
  return (
    <button
      onClick={(ev) => {
        ev.stopPropagation();
        state.toggle();
      }}
      title={`Move a number of one designer's hours to ${state.keysTaskTitle}, so they are not billed`}
      aria-pressed={state.open}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold md:min-h-0 ${
        state.open
          ? "border-brand bg-brand text-white"
          : "border-border bg-surface text-muted hover:border-brand hover:text-brand"
      }`}
    >
      <KeyRound size={13} />
      Keys…
    </button>
  );
}

export function KeysTaskPanel({ state }: { state: KeysTaskState }) {
  if (!state.open) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg bg-background px-2 py-1.5">
      <select
        value={state.userId}
        onChange={(ev) => state.setUserId(ev.target.value)}
        title="Whose hours to write down"
        className="rounded border border-border bg-surface px-1 py-0.5 text-[11px] outline-none focus:border-brand"
      >
        {state.options.map((o) => (
          <option key={o.userId} value={o.userId}>
            {o.name} — {formatHoursDecimal(o.minutes)}h
          </option>
        ))}
      </select>
      <input
        autoFocus
        value={state.hours}
        placeholder="0"
        onChange={(ev) => state.setHours(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Escape") state.close();
          if (ev.key === "Enter") state.commit();
        }}
        className={`w-12 rounded border bg-surface px-1 py-0.5 text-right text-[11px] tabular-nums outline-none ${
          state.problem ? "border-danger" : "border-border focus:border-brand"
        }`}
      />
      <span className="text-[10px] text-muted">
        h of {formatHoursDecimal(state.max)} → {state.keysTaskTitle}
      </span>
      <button
        onClick={state.commit}
        disabled={state.busy || state.minutes == null}
        className="ml-auto rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
      >
        {state.busy ? "Moving…" : "Move"}
      </button>
      <button
        onClick={state.close}
        title="Leave these hours as they are"
        className="rounded p-0.5 text-faint hover:bg-surface hover:text-foreground"
      >
        <X size={12} />
      </button>
      {state.problem && <span className="basis-full text-[10px] text-danger">{state.problem}</span>}
      {!state.problem && state.minutes != null && (
        <span className="basis-full text-[10px] text-faint">
          Taken from {state.options.find((o) => o.userId === state.userId)?.name}&apos;s earliest
          hours here first
        </span>
      )}
    </div>
  );
}
