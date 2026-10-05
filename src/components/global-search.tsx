"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { useData } from "@/lib/store";
import { namesClient, useClientsByRecency } from "./task-autocomplete";
import { ClientChip } from "./ui";

interface Result {
  kind: "task" | "client";
  id: string;
  label: string;
  sub: string;
  clientId?: string;
  done?: boolean;
}

export function GlobalSearch() {
  const router = useRouter();
  const { tasks, clients, profiles, openTask } = useData();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Narrow to one client — the same chips the log-time picker and the plan use. */
  const [clientId, setClientId] = useState("");
  const byRecency = useClientsByRecency();
  const picked = byRecency.find((c) => c.id === clientId);

  /**
   * The chips answer "which client?", so they go once that is answered — the
   * field's own chip says which one and its × brings them back. Typing narrows
   * them to the names that match, so a client is reachable by name rather than
   * by scrolling; ⚠️ but a row that MATCHES NOTHING falls back to all of them,
   * since most of what gets typed here is a task title and the filter shouldn't
   * disappear exactly when the list is longest.
   */
  const chipClients = useMemo(() => {
    if (picked) return [];
    const q = query.trim().toLowerCase();
    if (!q) return byRecency;
    const named = byRecency.filter((c) => c.name.toLowerCase().includes(q));
    return named.length > 0 ? named : byRecency;
  }, [picked, query, byRecency]);

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
    // Two letters is the floor for a text search, but a chosen client is a
    // search in itself — it answers the same question with no typing at all.
    if (q.length < 2 && !clientId) return [];
    const out: Result[] = [];

    // ⚠️ No client ROWS while a client filter is on. You have already said which
    // client you mean; offering to navigate to it (and to the others whose names
    // happen to match) is the one row that can't be what you're after.
    if (!clientId) {
      for (const c of clients) {
        if (c.name.toLowerCase().includes(q) && !c.archived) {
          out.push({ kind: "client", id: c.id, label: c.name, sub: "Client", clientId: c.id });
        }
        if (out.length >= 4) break;
      }
    }
    const matching = tasks
      .filter(
        (t) => (!clientId || t.clientId === clientId) && (!q || t.title.toLowerCase().includes(q)),
      )
      .sort((a, b) => Number(a.status === "done") - Number(b.status === "done"))
      .slice(0, 12);
    for (const t of matching) {
      const c = clients.find((cc) => cc.id === t.clientId);
      const assignee = profiles.find((pr) => pr.id === t.assigneeId);
      out.push({
        kind: "task",
        id: t.id,
        label: t.title,
        sub: `${c?.name ?? ""}${assignee ? ` · ${assignee.name}` : ""}`,
        clientId: t.clientId,
        done: t.status === "done",
      });
    }
    return out.slice(0, 14);
  }, [query, clientId, tasks, clients, profiles]);

  function choose(r: Result) {
    setOpen(false);
    setQuery("");
    // ⚠️ The filter goes with the query. A client left applied after you have
    // jumped somewhere would silently narrow the NEXT search, and the panel it
    // shows through is closed by then, so nothing would say why.
    setClientId("");
    if (r.kind === "task") openTask(r.id);
    else router.push(`/clients/${r.id}`);
  }

  return (
    <div ref={boxRef} className="relative mr-auto w-full max-w-md">
      <div className="flex items-center gap-2 rounded-lg bg-foreground/5 px-3">
        <Search size={15} className="shrink-0 text-faint" />
        {picked && (
          // ⚠️ `shrink-0`, and the INPUT is what gives way. The input carries
          // `w-full` — a 100% flex basis — so a shrinkable token is squeezed to
          // almost nothing beside it: measured, a 72px "Anchor" chip was being
          // clipped to 45px and read as "Anc". The cap is there for a client
          // name far longer than any the studio has.
          <span className="flex max-w-[40%] shrink-0 items-center gap-1 overflow-hidden">
            <span className="min-w-0 truncate" title={picked.name}>
              <ClientChip client={picked} size="sm" link={false} />
            </span>
            <button
              type="button"
              onClick={() => {
                setClientId("");
                inputRef.current?.focus();
              }}
              title={`Search every client again, not just ${picked.name}`}
              aria-label="Clear the client filter"
              className="shrink-0 text-faint hover:text-foreground"
            >
              <X size={13} />
            </button>
          </span>
        )}
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
          placeholder="Search tasks, clients…"
          className="bidi-auto h-8 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-faint"
        />
        <kbd className="hidden shrink-0 rounded border border-border bg-surface px-1.5 text-[10px] text-faint sm:block">
          ⌘K
        </kbd>
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-10 z-50 flex flex-col rounded-xl border border-border bg-surface py-1 shadow-2xl">
          {/* The chips do not scroll with the results, so the filter stays
              reachable however far down the list you have gone. `preventDefault`
              on mousedown keeps the caret in the box, so you can pick a client
              and carry on typing. */}
          {chipClients.length > 0 && (
            <div
              className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-border px-2 pb-2 pt-1"
              onMouseDown={(e) => e.preventDefault()}
            >
              {chipClients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setClientId(c.id);
                    // ⚠️ Clear the box ONLY when what was typed was naming THIS
                    // client — "no" → No Traffic has done its job the moment the
                    // chip is picked. A task search like "wire" is a separate
                    // question that must survive the filter.
                    if (namesClient(c, query)) setQuery("");
                    setHighlight(0);
                    inputRef.current?.focus();
                  }}
                  title={`Only ${c.name}'s tasks`}
                  className="shrink-0 rounded-full opacity-80 hover:opacity-100"
                >
                  <ClientChip client={c} size="sm" link={false} />
                </button>
              ))}
            </div>
          )}
          {results.length === 0 && (
            <div className="px-3 py-2 text-center text-xs text-muted">
              {/* ⚠️ Three cases, not two: with a query typed, "nothing open for
                  that client" is a claim about the CLIENT when the truth is only
                  that the search found nothing. */}
              {picked && query.trim()
                ? `Nothing in ${picked.name} matches “${query.trim()}”.`
                : picked
                  ? `Nothing open for ${picked.name}.`
                  : "Pick a client above, or type at least two letters."}
            </div>
          )}
          <div className="max-h-96 overflow-y-auto">
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
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: client.color }}
                    />
                  ) : (
                    <span className="size-2.5 shrink-0" />
                  )}
                  <span
                    className={`bidi-auto min-w-0 flex-1 truncate font-medium ${r.done ? "text-faint line-through" : ""}`}
                  >
                    {r.label}
                  </span>
                  <span className="shrink-0 text-xs text-faint">{r.sub}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
