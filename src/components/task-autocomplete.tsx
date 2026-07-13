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
 */
export function TaskAutocomplete({
  clientId,
  allowFreeText = false,
  placeholder = "Type a task…",
  autoFocus = false,
  onPickTask,
  onFreeText,
}: {
  clientId?: string | null;
  allowFreeText?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  onPickTask: (match: TaskMatch) => void;
  onFreeText?: (text: string) => void;
}) {
  const { tasks, sections, clients } = useData();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(allowFreeText ? -1 : 0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo<TaskMatch[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q && !clientId) return [];
    const sectionById = new Map(sections.map((s) => [s.id, s]));
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const out: TaskMatch[] = [];
    for (const t of tasks) {
      if (t.status === "done" || t.pending) continue;
      const client = clientById.get(t.clientId);
      if (!client || client.archived) continue;
      if (clientId && t.clientId !== clientId) continue;
      const section = t.sectionId ? sectionById.get(t.sectionId)?.name : undefined;
      if (q) {
        const hay = `${t.title} ${section ?? ""} ${client.name}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push({ task: t, client, section });
      if (out.length >= 12) break;
    }
    return out;
  }, [tasks, sections, clients, clientId, query]);

  // reset highlight when inputs change
  useEffect(() => {
    setHighlight(allowFreeText ? -1 : 0);
  }, [query, clientId, allowFreeText]);

  const min = allowFreeText ? -1 : 0;

  function submit() {
    if (highlight >= 0 && results[highlight]) {
      onPickTask(results[highlight]);
    } else if (allowFreeText && query.trim() && onFreeText) {
      onFreeText(query.trim());
    } else if (results[0]) {
      onPickTask(results[0]);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <input
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
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
      {(results.length > 0 || (allowFreeText && query.trim())) && (
        <div ref={listRef} className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {allowFreeText && query.trim() && (
            <button
              onClick={() => onFreeText?.(query.trim())}
              onMouseEnter={() => setHighlight(-1)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                highlight === -1 ? "bg-brand-soft" : "hover:bg-background"
              }`}
            >
              <Pencil size={13} className="shrink-0 text-muted" />
              <span className="bidi-auto min-w-0 flex-1 truncate text-muted">
                Add free text: “{query.trim()}”
              </span>
              {highlight === -1 && <CornerDownLeft size={13} className="shrink-0 text-faint" />}
            </button>
          )}
          {results.map((m, i) => (
            <button
              key={m.task.id}
              onClick={() => onPickTask(m)}
              onMouseEnter={() => setHighlight(i)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                highlight === i ? "bg-brand-soft" : "hover:bg-background"
              }`}
            >
              <span className="bidi-auto min-w-0 flex-1 truncate">{m.task.title}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-faint">
                {m.client && <ClientChip client={m.client} size="sm" link={false} />}
                {m.section && <span className="max-w-28 truncate">/ {m.section}</span>}
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
