"use client";

// The phone's cold-start log-time flow: pick a task, then fill the form.
//
// Two steps rather than one sheet, and only HERE. Opened from a task (its row,
// its panel) the task is already known and a single sheet is fewer taps — that
// path uses `LogTimeForm` directly. Opened from the bottom bar's "+" there is no
// task, and cramming a search field, its results, a duration, a description and
// a date into one sheet gives the search about two visible rows, which is the
// one part of this that needs room.
//
// ⚠️ This does NOT use `TaskAutocomplete`. That component's result list is
// `absolute`, and the sheet's body is an `overflow-y-auto` scroller — a scroll
// container clips BOTH axes, so the list would be cut off at the sheet's edge.
// (Fifth instance of that trap in this codebase.) The rule is shared as
// `useTaskMatches` instead, and the results render as a plain inline list.

import { useMemo, useState } from "react";
import { ChevronLeft, Search, X } from "lucide-react";
import { useData } from "@/lib/store";
import { toISODate } from "@/lib/format";
import { dailyTargetMinutes } from "@/lib/members";
import {
  namesClient,
  useClientsByRecency,
  useTaskMatches,
  type TaskMatch,
} from "./task-autocomplete";
import { LogTimeForm } from "./log-time-form";
import { MobileSheet } from "./mobile-sheet";
import { TimeEntryModal } from "./time-entry-modal";
import { DayTotalBar, LoggedEntryRow, useDayEntries } from "./logged-day";
import { ClientChip } from "./ui";
import type { TimeEntry } from "@/lib/types";

/** How many previously-logged tasks to offer before anything is typed. */
const RECENTS = 6;

function TaskRow({ m, onPick }: { m: TaskMatch; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="flex min-h-12 w-full items-center gap-2 rounded-lg px-2 text-left hover:bg-background"
    >
      <span className="bidi-auto min-w-0 flex-1 truncate text-sm">{m.task.title}</span>
      {m.client && <ClientChip client={m.client} size="sm" link={false} />}
    </button>
  );
}

export function MobileLogTimeSheet({ onClose }: { onClose: () => void }) {
  const { timeEntries, tasks, clients, sections, profiles, currentUserId } = useData();
  const [picked, setPicked] = useState<TaskMatch | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<TimeEntry | null>(null);

  /**
   * Narrow to one client, exactly as the desktop pickers do — same chips, same
   * recency order, same rules: they disappear once a client is chosen (the field's
   * own chip says which one), typing narrows them to the matching names, and a row
   * that matches NOTHING falls back to all of them, since most of what gets typed
   * here is a task title.
   */
  const [clientId, setClientId] = useState("");
  const byRecency = useClientsByRecency();
  const pickedClient = byRecency.find((c) => c.id === clientId);
  const chipClients = useMemo(() => {
    if (pickedClient) return [];
    const q = query.trim().toLowerCase();
    if (!q) return byRecency;
    const named = byRecency.filter((c) => c.name.toLowerCase().includes(q));
    return named.length > 0 ? named : byRecency;
  }, [pickedClient, query, byRecency]);

  /**
   * Today's own hours, live, so the sheet can show what the day adds up to as you
   * fill it. ⚠️ It fetches only once a task is picked (`picked` gates the date) —
   * step 1 is a search screen and a query behind it would be work nobody asked
   * for on a phone connection.
   */
  const todayIso = toISODate(new Date());
  const { rows: dayRows, reload: reloadDay } = useDayEntries(currentUserId, picked ? todayIso : null);
  const me = profiles.find((p) => p.id === currentUserId) ?? null;
  const dayMinutes = (dayRows ?? []).reduce((s, e) => s + e.minutes, 0);

  const matches = useTaskMatches({ query, clientId: clientId || null, limit: 20 });

  /**
   * The tasks this person logged against most recently — the same rule the home
   * page's quick-log chips use. On a phone this is most of the value: the work
   * you are logging is nearly always the work you logged yesterday, so the
   * common case should need no typing at all.
   */
  const recents = useMemo<TaskMatch[]>(() => {
    const seen: string[] = [];
    for (const e of timeEntries) {
      if (e.userId !== currentUserId || seen.includes(e.taskId)) continue;
      seen.push(e.taskId);
      if (seen.length >= RECENTS) break;
    }
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    return seen
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => !!t && t.status !== "done")
      .map((t) => ({
        task: t,
        client: clientById.get(t.clientId),
        section: t.sectionId ? sectionById.get(t.sectionId)?.name : undefined,
      }));
  }, [timeEntries, currentUserId, tasks, clients, sections]);

  // Recents are the no-input default; a client filter IS input, so once one is
  // picked the list is that client's tasks rather than the last five you logged.
  const showing = query.trim() || clientId ? matches : recents;

  if (picked) {
    return (
      <MobileSheet title="Log time" onClose={onClose}>
        <button
          onClick={() => setPicked(null)}
          className="mb-2 flex min-h-11 items-center gap-1 text-sm text-muted"
        >
          <ChevronLeft size={17} strokeWidth={2} />
          <span className="bidi-auto truncate">{picked.task.title}</span>
        </button>
        {/* `taskId` is fixed now, so the form drops its own picker and autofocuses
            the duration — step 1 already answered the question step 2 would ask. */}
        <LogTimeForm
          taskId={picked.task.id}
          layout="stacked"
          submitLabel="Add time"
          autoFocus
          // ⚠️ The sheet STAYS OPEN after an add, where it used to close. A day is
          // logged in two or three goes ("1h standup, 3h wireframes"), and closing
          // meant re-opening and re-picking for the second one — with no way to see
          // what the day had reached. `LogTimeForm` clears duration and description
          // itself, so what is left is ready for the next entry.
          onAdded={reloadDay}
        />

        {dayRows && dayRows.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <DayTotalBar
              minutes={dayMinutes}
              targetMinutes={dailyTargetMinutes(me)}
              label="Logged today"
            />
            {/* every entry of the day, not just the ones added in this sheet —
                the question is what the DAY holds, and tapping one fixes it */}
            <div className="mt-2 flex flex-col">
              {dayRows.map((e) => (
                <LoggedEntryRow key={e.id} entry={e} onPick={setEditing} />
              ))}
            </div>
          </div>
        )}

        {editing && (
          <TimeEntryModal
            taskId={editing.taskId}
            entry={editing}
            // ⚠️ `raised`: this opens from INSIDE the sheet, which is itself a
            // fixed overlay — at the base layer the editor would open behind it.
            layer="raised"
            onSaved={reloadDay}
            onDeleted={reloadDay}
            onClose={() => setEditing(null)}
          />
        )}
      </MobileSheet>
    );
  }

  return (
    <MobileSheet title="Log time" onClose={onClose}>
      <div className="relative mb-2 flex items-center gap-2 rounded-md border border-border bg-surface pr-2 focus-within:border-brand">
        <Search size={16} strokeWidth={1.75} className="ml-2.5 shrink-0 text-faint" aria-hidden />
        {/* Same shape as the desktop picker: the chosen client rides IN the field
            as its own chip, and its × is the way back to every client. */}
        {pickedClient && (
          <span className="flex max-w-[45%] shrink-0 items-center gap-1 overflow-hidden">
            <span className="min-w-0 truncate">
              <ClientChip client={pickedClient} size="sm" link={false} />
            </span>
            <button
              type="button"
              onClick={() => setClientId("")}
              title={`Search every client again, not just ${pickedClient.name}`}
              aria-label="Clear the client filter"
              className="shrink-0 text-faint"
            >
              <X size={14} />
            </button>
          </span>
        )}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Which task?"
          aria-label="Search tasks"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"
        />
      </div>

      {/* ⚠️ The chips are INLINE here, not in a dropdown. `TaskAutocomplete`'s
          panel is `absolute` and this sheet's body is an `overflow-y-auto`
          scroller, which clips both axes — the same trap that made this screen a
          hand-rolled list in the first place. A horizontally scrolling row inside
          a vertical scroller is fine; an absolute panel is not. */}
      {chipClients.length > 0 && (
        <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {chipClients.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setClientId(c.id);
                // typed text that was NAMING this client has done its job; a task
                // search like "wire" is a separate question and must survive
                if (namesClient(c, query)) setQuery("");
              }}
              title={`Only ${c.name}'s tasks`}
              className="shrink-0 rounded-full"
            >
              <ClientChip client={c} size="sm" link={false} />
            </button>
          ))}
        </div>
      )}

      {!query.trim() && !clientId && recents.length > 0 && (
        <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted">Recent</div>
      )}
      <div className="flex flex-col">
        {showing.map((m) => (
          <TaskRow key={m.task.id} m={m} onPick={() => setPicked(m)} />
        ))}
        {showing.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted">
            {pickedClient
              ? `Nothing open for ${pickedClient.name}${query.trim() ? ` matching “${query.trim()}”` : ""}.`
              : query.trim()
                ? "No open tasks match that."
                : "Nothing logged yet — pick a client or search for a task."}
          </p>
        )}
      </div>
    </MobileSheet>
  );
}
