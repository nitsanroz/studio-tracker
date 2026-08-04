"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Pencil } from "lucide-react";
import { useData } from "@/lib/store";
import { ClientChip } from "./ui";
import type { Client, Task } from "@/lib/types";

export interface TaskMatch {
  task: Task;
  client: Client | undefined;
  /** name of the task's section, if it has one */
  section?: string;
}

/**
 * One smart input over all open tasks (title + client + section).
 * Enter on a highlighted row picks the task; with `allowFreeText`, Enter
 * with nothing highlighted submits the raw text instead.
 *
 * The result list is an OVERLAY, not part of the layout: it hangs off the input
 * absolutely, so typing can't grow the popup that hosts it (which used to
 * stretch the day-details modal and squash the duration/description row beside
 * it), and it sizes to its own content rather than to the input's width — task
 * titles are the whole point of the list and they were being trimmed to "Vo…".
 */
export function TaskAutocomplete({
  clientId,
  allowFreeText = false,
  includeDone = false,
  initialQuery = "",
  freeTextLabel = "Add free text",
  placeholder = "Type a task…",
  autoFocus = false,
  onPickTask,
  onFreeText,
  onQueryEdited,
}: {
  clientId?: string | null;
  allowFreeText?: boolean;
  /**
   * Offer completed tasks too, listed after the open ones and struck through.
   * The weekly plan wants them: work comes back, and a task marked done too early
   * is exactly the thing someone needs to put in next week — the plan reopens it
   * on the way in (see `plannedTaskToReopen`). Everywhere else a done task in the
   * list would just be a way to log hours against finished work by accident.
   */
  includeDone?: boolean;
  /** pre-fills the box — for editing an existing free-text entry */
  initialQuery?: string;
  /** verb on the free-text row; "Add" is wrong when you're editing a note */
  freeTextLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onPickTask: (match: TaskMatch) => void;
  onFreeText?: (text: string) => void;
  /**
   * Typing after a pick means the caller's remembered task is no longer what the
   * field says. Callers that KEEP this input on screen after picking (the log-time
   * form) use this to forget it, so hours can't be filed against a task the user
   * has since typed away from.
   */
  onQueryEdited?: () => void;
}) {
  const { tasks, sections, clients } = useData();
  const [query, setQuery] = useState(initialQuery);
  const [highlight, setHighlight] = useState(allowFreeText ? -1 : 0);
  const [focused, setFocused] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const results = useMemo<TaskMatch[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q && !clientId) return [];
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const open: TaskMatch[] = [];
    const done: TaskMatch[] = [];
    for (const t of tasks) {
      if (t.pending) continue;
      const isDone = t.status === "done";
      if (isDone && !includeDone) continue;
      const client = clientById.get(t.clientId);
      if (!client || client.archived) continue;
      if (clientId && t.clientId !== clientId) continue;
      const section = t.sectionId ? sectionById.get(t.sectionId)?.name : undefined;
      if (q) {
        const hay = `${t.title} ${section ?? ""} ${client.name}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      (isDone ? done : open).push({ task: t, client, section });
      // the 12-row cap counts open matches only while there are still open ones
      // to find — filling it with finished work would bury the live tasks
      if (open.length >= 12) break;
    }
    return [...open, ...done].slice(0, 12);
  }, [tasks, sections, clients, clientId, query, includeDone]);

  // reset highlight when inputs change
  useEffect(() => {
    setHighlight(allowFreeText ? -1 : 0);
  }, [query, clientId, allowFreeText]);

  const min = allowFreeText ? -1 : 0;

  /**
   * Picking fills the input with the task's title and collapses the list. Callers
   * that unmount straight after (the plan popover) don't notice; the log-time form
   * keeps rendering, and there the field is the only record of what you chose —
   * leaving it on the raw query with an open list over the description was the
   * worst of both.
   */
  function pick(m: TaskMatch) {
    setQuery(m.task.title);
    setFocused(false);
    onPickTask(m);
  }

  function submit() {
    if (highlight >= 0 && results[highlight]) {
      pick(results[highlight]);
    } else if (allowFreeText && query.trim() && onFreeText) {
      onFreeText(query.trim());
    } else if (results[0]) {
      pick(results[0]);
    }
  }

  // Only while the input has focus, so a floating list can't hover over the rest
  // of the card after you've moved on to the duration or the description.
  const open = focused && (results.length > 0 || !!query.trim());

  return (
    <div
      ref={root}
      className="relative"
      // focus/blur bubble in React; relatedTarget inside our own subtree means
      // focus never really left (e.g. tabbing onto a result row)
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <input
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onQueryEdited?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(results.length - 1, h + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(min, h - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="bidi-auto w-full rounded-md border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand"
      />
      {open && (
        <div
          // `w-max` sizes the panel to the longest row, `min-w-full` keeps it at
          // least as wide as the input, and the cap stops one long title from
          // running off-screen (rows then truncate, as before).
          className="absolute left-0 top-full z-50 mt-1.5 flex max-h-56 w-max min-w-full max-w-[min(34rem,calc(100vw_-_2rem))] flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl"
          // keeps focus in the input, so blur can't unmount a row between
          // mousedown and mouseup and swallow the click
          onMouseDown={(e) => e.preventDefault()}
        >
          {allowFreeText && query.trim() && (
            <button
              onClick={() => onFreeText?.(query.trim())}
              onMouseEnter={() => setHighlight(-1)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                highlight === -1 ? "bg-brand-soft" : "hover:bg-background"
              }`}
            >
              <Pencil size={13} className="shrink-0 text-muted" />
              <span className="bidi-auto min-w-0 truncate text-muted">
                {freeTextLabel}: “{query.trim()}”
              </span>
              <span className="flex-1" />
              {highlight === -1 && <CornerDownLeft size={13} className="shrink-0 text-faint" />}
            </button>
          )}
          {results.map((m, i) => (
            <button
              key={m.task.id}
              onClick={() => pick(m)}
              onMouseEnter={() => setHighlight(i)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                highlight === i ? "bg-brand-soft" : "hover:bg-background"
              }`}
              title={m.task.status === "done" ? "Completed — planning it reopens it" : undefined}
            >
              {/* struck through, so choosing finished work is a decision rather
                  than a mis-click on a row that looks like any other */}
              <span
                className={`bidi-auto min-w-0 truncate ${
                  m.task.status === "done" ? "text-muted line-through" : ""
                }`}
              >
                {m.task.title}
              </span>
              {m.task.status === "done" && (
                <span className="shrink-0 rounded-full bg-background px-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">
                  done
                </span>
              )}
              {/* an EMPTY grower, so the chips sit right without the title
                  claiming a zero flex-basis — which is what made the panel
                  measure to the input instead of to its content */}
              <span className="flex-1" />
              <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-faint">
                {m.client && <ClientChip client={m.client} size="sm" link={false} />}
                {m.section && <span>/ {m.section}</span>}
              </span>
              {highlight === i && <CornerDownLeft size={13} className="shrink-0 text-faint" />}
            </button>
          ))}
          {results.length === 0 && query.trim() && !allowFreeText && (
            <div className="px-2 py-3 text-center text-sm text-faint">No open tasks found.</div>
          )}
        </div>
      )}
    </div>
  );
}
