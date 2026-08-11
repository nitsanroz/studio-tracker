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
import { ChevronLeft, Search } from "lucide-react";
import { useData } from "@/lib/store";
import { useTaskMatches, type TaskMatch } from "./task-autocomplete";
import { LogTimeForm } from "./log-time-form";
import { MobileSheet } from "./mobile-sheet";
import { ClientChip } from "./ui";

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
  const { timeEntries, tasks, clients, sections, currentUserId } = useData();
  const [picked, setPicked] = useState<TaskMatch | null>(null);
  const [query, setQuery] = useState("");

  const matches = useTaskMatches({ query, limit: 20 });

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

  const showing = query.trim() ? matches : recents;

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
          onAdded={onClose}
        />
      </MobileSheet>
    );
  }

  return (
    <MobileSheet title="Log time" onClose={onClose}>
      <div className="relative mb-2">
        <Search
          size={16}
          strokeWidth={1.75}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
          aria-hidden
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Which task?"
          aria-label="Search tasks"
          className="w-full rounded-md border border-border bg-surface py-2.5 pl-8 pr-2 text-sm outline-none focus:border-brand"
        />
      </div>
      {!query.trim() && recents.length > 0 && (
        <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted">Recent</div>
      )}
      <div className="flex flex-col">
        {showing.map((m) => (
          <TaskRow key={m.task.id} m={m} onPick={() => setPicked(m)} />
        ))}
        {showing.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-muted">
            {query.trim() ? "No open tasks match that." : "Nothing logged yet — search for a task."}
          </p>
        )}
      </div>
    </MobileSheet>
  );
}
