"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Pencil, X } from "lucide-react";
import { useData } from "@/lib/store";
import { shiftDays, toISODate } from "@/lib/format";
import { ClientChip } from "./ui";
import type { Client, Task } from "@/lib/types";

export interface TaskMatch {
  task: Task;
  client: Client | undefined;
  /** name of the task's section, if it has one */
  section?: string;
}

/** How far back "recent" reaches when ordering the client list. */
const RECENT_DAYS = 30;

/**
 * Was this text how the user reached for THIS client — rather than a task
 * search that happens to be running at the same time?
 *
 * The one question that decides whether picking a client chip should empty the
 * search box. It is the same test that put the chip on screen: the chips narrow
 * to the names the text matches, so a chip you reached by typing is one whose
 * name contains what you typed. Shared, so the two pickers can't answer it
 * differently.
 */
export function namesClient(client: Client, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !!q && client.name.toLowerCase().includes(q);
}

/**
 * Active clients, most-recently-worked-on first.
 *
 * Lifted out of the weekly plan's add-to-cell modal, which had it inline, so the
 * plan's chips and the task picker's own chips order the studio the same way.
 * The scoring is deliberately crude — one point per tracked entry, two per
 * planned one, over the last 30 days — because all it has to do is float the
 * handful of clients someone is actually working on to the front of a row of
 * ~40, where the ones you want are reachable without scrolling.
 */
export function useClientsByRecency(): Client[] {
  const { clients, tasks, planEntries, entrySums } = useData();
  const taskClient = useMemo(() => new Map(tasks.map((t) => [t.id, t.clientId])), [tasks]);

  return useMemo(() => {
    const cutoff = toISODate(shiftDays(new Date(), -RECENT_DAYS));
    const score = new Map<string, number>();
    for (const e of entrySums) {
      if (e.date < cutoff) continue;
      const cid = taskClient.get(e.taskId);
      if (cid) score.set(cid, (score.get(cid) ?? 0) + 1);
    }
    for (const pe of planEntries) {
      if (!pe.date || pe.date < cutoff || !pe.clientId) continue;
      score.set(pe.clientId, (score.get(pe.clientId) ?? 0) + 2);
    }
    return clients
      .filter((c) => !c.archived)
      .sort(
        (a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || a.name.localeCompare(b.name),
      );
  }, [clients, entrySums, planEntries, taskClient]);
}

/**
 * "Which open tasks match this text" — the rule, on its own.
 *
 * Extracted so the phone's task picker can share it. That picker CANNOT reuse
 * `TaskAutocomplete` itself: its result list is `absolute`, and on mobile the
 * host is a bottom sheet whose body is an `overflow-y-auto` scroller — ⚠️ a
 * scroll container clips BOTH axes, so the list would be cut off at the sheet's
 * edge. The phone renders the same matches as a plain inline list instead. Two
 * copies of this filter would have been free to drift on the things that
 * actually matter — archived clients, pending rows, and the done-task rule.
 */
export function useTaskMatches({
  query,
  clientId,
  includeDone = false,
  limit = 12,
}: {
  query: string;
  clientId?: string | null;
  includeDone?: boolean;
  limit?: number;
}): TaskMatch[] {
  const { tasks, sections, clients } = useData();
  return useMemo<TaskMatch[]>(() => {
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
      // the cap counts open matches only while there are still open ones to
      // find — filling it with finished work would bury the live tasks
      if (open.length >= limit) break;
    }
    return [...open, ...done].slice(0, limit);
  }, [tasks, sections, clients, clientId, query, includeDone, limit]);
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
  clientId: fixedClientId,
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
  /**
   * Narrows the list to one client, and — because the host has answered that
   * question — SUPPRESSES the built-in client menu. Pass `null` to mean "all
   * clients, and the user may not change that"; leave it off entirely and the
   * input grows its own client menu, which is what nearly every caller wants.
   */
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
  const [query, setQuery] = useState(initialQuery);
  const [highlight, setHighlight] = useState(allowFreeText ? -1 : 0);
  const [focused, setFocused] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  /**
   * Choose the client first, then the task — the flow the weekly plan has always
   * had, now wherever a task is searched for. It is the one filter that reliably
   * cuts a studio-wide list down to a readable one, because task titles repeat
   * across clients ("Homepage", "Onboarding") and the client is the thing the
   * person logging already knows.
   */
  const ownPicker = fixedClientId === undefined;
  const [ownClientId, setOwnClientId] = useState("");
  const clientId = ownPicker ? ownClientId || null : fixedClientId;
  const byRecency = useClientsByRecency();
  const pickedClient = ownPicker ? byRecency.find((c) => c.id === ownClientId) : undefined;

  /**
   * The chips answer "which client?", so they go once that is answered — the
   * field's own chip says which one, and its × brings them back. Typing narrows
   * them to the names that match, so a client can be reached by name instead of
   * by scrolling.
   *
   * ⚠️ Falls back to the whole row when NOTHING matches, rather than emptying:
   * most of what gets typed here is a task title, and vanishing the filter the
   * moment someone starts typing takes it away exactly when the list is longest.
   */
  const chipClients = useMemo(() => {
    if (!ownPicker || pickedClient) return [];
    const q = query.trim().toLowerCase();
    if (!q) return byRecency;
    const named = byRecency.filter((c) => c.name.toLowerCase().includes(q));
    return named.length > 0 ? named : byRecency;
  }, [ownPicker, pickedClient, query, byRecency]);

  const results = useTaskMatches({ query, clientId, includeDone });

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
  //
  // With our own client filter the panel opens on focus alone: the chips ARE
  // content, and they're the answer to "I don't know what this task is called".
  // Once a client is chosen the chips are gone, so the panel needs its own
  // reason to stay open — its results, or the line saying there are none.
  const open =
    focused && (chipClients.length > 0 || !!pickedClient || results.length > 0 || !!query.trim());

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
      {/* ⚠️ ONE bordered box, and the filter lives INSIDE the field rather than
          on a line of its own. This component sits in six hosts, several of them
          a flex ROW whose items stretch — anything two rows tall would have made
          the duration, the description and the Add button beside it grow to
          match. The border, radius and background moved off the input and onto
          this box, so a caller that suppresses the filter renders a
          pixel-identical field. */}
      <div className="flex w-full items-center rounded-md border border-border bg-surface focus-within:border-brand">
        {pickedClient && (
          // ⚠️ `min-w-0` + `truncate`: the chip is sized by the client's NAME, so
          // without it a long one would leave the search box a stub. The × is
          // outside the clipped span, so it stays reachable either way.
          <span className="flex min-w-0 shrink items-center gap-1 py-1 pl-1.5">
            <span className="min-w-0 truncate" title={pickedClient.name}>
              <ClientChip client={pickedClient} size="sm" link={false} />
            </span>
            <button
              type="button"
              onClick={() => {
                setOwnClientId("");
                field.current?.focus();
              }}
              title={`Search every client again, not just ${pickedClient.name}`}
              aria-label="Clear the client filter"
              className="shrink-0 text-faint hover:text-foreground"
            >
              <X size={13} />
            </button>
          </span>
        )}
        <input
          ref={field}
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
          // ⚠️ NOT "Search <client> tasks…" when a client is chosen, the way the
          // plan's placeholder reads. There the choice is a chip above the box;
          // here the menu sits IN the box naming the client, so repeating it
          // spends the field's ~139px saying it twice and truncates to
          // "Search No Traffic ta…", which reads as a fault.
          placeholder={placeholder}
          className="bidi-auto min-w-0 flex-1 bg-transparent px-2.5 py-2 text-sm outline-none"
        />
      </div>
      {open && (
        <div
          // `w-max` sizes the panel to the longest row, `min-w-full` keeps it at
          // least as wide as the input, and the cap stops one long title from
          // running off-screen (rows then truncate, as before).
          className="absolute left-0 top-full z-50 mt-1.5 flex w-max min-w-full max-w-[min(34rem,calc(100vw_-_2rem))] flex-col rounded-xl border border-border bg-surface p-1 shadow-xl pop-in"
          // keeps focus in the input, so blur can't unmount a row between
          // mousedown and mouseup and swallow the click
          onMouseDown={(e) => e.preventDefault()}
        >
          {chipClients.length > 0 && (
            // ⚠️ `w-0 min-w-full`. The panel is `w-max` — it measures itself to
            // its widest child — and a row of 40 chips would therefore pin it to
            // the 34rem cap for every list, however short. Width 0 contributes
            // nothing to that measurement while `min-w-full` still stretches the
            // row to whatever the panel turns out to be, so the chips scroll
            // inside the width the RESULTS chose.
            <div className="w-0 min-w-full shrink-0 border-b border-border pb-1.5">
              <div className="flex gap-1.5 overflow-x-auto px-1 pb-0.5">
                {chipClients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setOwnClientId(c.id);
                        // ⚠️ Clear the box ONLY when what was typed was naming
                        // THIS client — "no" → No Traffic has done its job the
                        // moment the chip is picked, and leaving it there means
                        // searching that client's tasks for the word "no".
                        // "wire" is a task search that happens to be running
                        // alongside the filter, and must survive it.
                        if (namesClient(c, query)) {
                          setQuery("");
                          onQueryEdited?.();
                        }
                        field.current?.focus();
                      }}
                      title={`Only ${c.name}'s tasks`}
                      className="shrink-0 rounded-full opacity-80 hover:opacity-100"
                    >
                      <ClientChip client={c} size="sm" link={false} />
                    </button>
                ))}
              </div>
            </div>
          )}
          {/* The results scroll; the chips above them do not, so the filter
              stays reachable however far down the list you are. */}
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
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
            {results.length === 0 && !query.trim() && ownPicker && (
              <div className="px-2 py-2 text-center text-xs text-muted">
                Pick a client above, or type to search every one.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
