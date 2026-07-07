"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useData } from "@/lib/store";
import { Avatar, ClientChip } from "./ui";

interface Result {
  kind: "task" | "project" | "client";
  id: string;
  label: string;
  sub: string;
  clientId?: string;
  done?: boolean;
}

export function GlobalSearch() {
  const router = useRouter();
  const { tasks, projects, clients, profiles, openTask } = useData();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // click-outside closes
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: Result[] = [];

    for (const c of clients) {
      if (c.name.toLowerCase().includes(q) && !c.archived) {
        out.push({ kind: "client", id: c.id, label: c.name, sub: "Client", clientId: c.id });
      }
      if (out.length >= 4) break;
    }
    for (const p of projects) {
      if (p.name.toLowerCase().includes(q) && !p.archived) {
        const c = clients.find((cc) => cc.id === p.clientId);
        out.push({ kind: "project", id: p.id, label: p.name, sub: `Project · ${c?.name ?? ""}`, clientId: p.clientId });
        if (out.length >= 8) break;
      }
    }
    const matching = tasks
      .filter((t) => t.title.toLowerCase().includes(q))
      .sort((a, b) => Number(a.status === "done") - Number(b.status === "done"))
      .slice(0, 12);
    for (const t of matching) {
      const p = projects.find((pp) => pp.id === t.projectId);
      const c = clients.find((cc) => cc.id === p?.clientId);
      const assignee = profiles.find((pr) => pr.id === t.assigneeId);
      out.push({
        kind: "task",
        id: t.id,
        label: t.title,
        sub: `${c?.name ?? ""} › ${p?.name ?? ""}${assignee ? ` · ${assignee.name}` : ""}`,
        clientId: p?.clientId,
        done: t.status === "done",
      });
    }
    return out.slice(0, 14);
  }, [query, tasks, projects, clients, profiles]);

  function choose(r: Result) {
    setOpen(false);
    setQuery("");
    if (r.kind === "task") openTask(r.id);
    else if (r.kind === "project") router.push(`/projects/${r.id}`);
    else router.push(`/clients/${r.id}`);
  }

  return (
    <div ref={boxRef} className="relative mr-auto w-full max-w-md">
      <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3">
        <Search size={15} className="shrink-0 text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter" && results[highlight]) {
              choose(results[highlight]);
            } else if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder="Search tasks, projects, clients…"
          className="bidi-auto h-8 w-full bg-transparent text-sm outline-none placeholder:text-faint"
        />
        <kbd className="hidden shrink-0 rounded border border-border bg-surface px-1.5 text-[10px] text-faint sm:block">
          ⌘K
        </kbd>
      </div>

      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-10 z-50 max-h-96 overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-2xl">
          {results.map((r, i) => {
            const client = r.clientId ? clients.find((c) => c.id === r.clientId) : null;
            return (
              <button
                key={`${r.kind}-${r.id}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(r)}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${i === highlight ? "bg-brand-soft" : ""}`}
              >
                {client ? (
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: client.color }} />
                ) : (
                  <span className="size-2.5 shrink-0" />
                )}
                <span className={`bidi-auto min-w-0 flex-1 truncate font-medium ${r.done ? "text-faint line-through" : ""}`}>
                  {r.label}
                </span>
                <span className="shrink-0 text-xs text-faint">{r.sub}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
