"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Layers, Search } from "lucide-react";
import { useData } from "@/lib/store";
import { buildTaskClientMap, latestActivityByClient, minutesByClientInRange } from "@/lib/aggregate";
import { formatDayMonth, formatHoursDecimal, toISODate } from "@/lib/format";
import { taskMinutesDone } from "@/lib/task-hours";
import { ClientAvatar } from "./client-avatar";
import type { Task } from "@/lib/types";

/**
 * The clients list and one client's TASK LIST, built for a phone.
 *
 * ⚠️ These are separate components, not the desktop ones made responsive. The
 * desktop client page is ~2,900 lines of drag-and-drop, marquee selection,
 * context menus, inline editing and three view tabs, all of which assume a
 * pointer and about 900px. Squeezing that into 375px would have meant touching
 * every one of those behaviours; writing the read path fresh touched none.
 *
 * ⚠️ TASK LIST ONLY, deliberately. The Timeline pins a 238px column before the
 * calendar even starts and the Board is a set of side-by-side columns — neither
 * has a 375px form that is worth having, and offering a broken one is worse
 * than saying so. `desktop-only.tsx` still covers those; this covers the view
 * that genuinely works.
 *
 * What a phone deliberately does NOT get: creating or reordering sections and
 * groups, dragging tasks between them, renaming inline, editing budgets. Those
 * are planning jobs done at a desk. Tapping a task opens the normal task pane,
 * which IS built for a phone (v1.12.0) — so logging time, changing status and
 * reading the brief all work.
 */

/* ────────────────────────────── clients list ───────────────────────────── */

export function MobileClientsList() {
  const { clients, tasks, entrySumsAll } = useData();
  const [query, setQuery] = useState("");

  /**
   * ⚠️ Split from the filter below on purpose. These three passes are over
   * EVERY task and EVERY time entry in the studio; with `query` in the
   * dependency list they re-ran on every keystroke in the search box. Keyed
   * only on the data, they run when the data changes and typing is free.
   */
  const stats = useMemo(() => {
    const taskClient = buildTaskClientMap(tasks);
    // One pass for the open counts, rather than a `tasks.filter()` per client —
    // that is O(clients × tasks), which at 167 clients and 4,618 tasks is most
    // of a million comparisons for a number we can total in one sweep.
    const open = new Map<string, number>();
    for (const t of tasks) {
      if (t.status === "done") continue;
      open.set(t.clientId, (open.get(t.clientId) ?? 0) + 1);
    }
    return {
      open,
      // The shared helpers, so this page and the desktop table can't disagree
      // about a client's hours. All-time bounds, as the desktop page uses.
      minutes: minutesByClientInRange(entrySumsAll, "0000-01-01", "9999-12-31", taskClient),
      last: latestActivityByClient(entrySumsAll, taskClient),
    };
  }, [tasks, entrySumsAll]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients
      .filter((c) => !c.archived && (q === "" || c.name.toLowerCase().includes(q)))
      .map((client) => ({
        client,
        open: stats.open.get(client.id) ?? 0,
        minutes: stats.minutes.get(client.id) ?? 0,
        last: stats.last.get(client.id) ?? "",
      }))
      // Same default the desktop table uses — most recently worked on first,
      // which is the order that puts what you're doing this week at the top.
      .sort((a, b) => b.last.localeCompare(a.last) || b.open - a.open);
  }, [clients, stats, query]);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl">Clients</h1>

      <div className="flex items-center gap-2 rounded-full border border-border bg-surface px-3">
        <Search size={15} className="shrink-0 text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search clients…"
          className="bidi-auto h-11 w-full bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </div>

      <div className="flex flex-col gap-2">
        {rows.map(({ client, open, minutes }) => (
          <Link
            key={client.id}
            href={`/clients/${client.id}`}
            className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-card"
          >
            <ClientAvatar client={client} size={32} />
            <span className="min-w-0 flex-1">
              <span className="bidi-auto block truncate text-sm font-semibold">{client.name}</span>
              {/* One quiet line instead of the desktop table's four numeric
                  columns — those need 240px of a 375px screen and leave the
                  name about ninety.
                  ⚠️ WHOLE hours, not `formatHoursShort`: that helper keeps two
                  decimals because a logged entry of 0.75h must read back as
                  0.75, but a lifetime total rendered "12440.75h" is four
                  characters of noise on a line that exists to be skimmed. */}
              <span className="block text-[11px] text-muted">
                {open ? `${open} open` : "nothing open"}
                {minutes > 0 && ` · ${Math.round(minutes / 60).toLocaleString()}h logged`}
              </span>
            </span>
          </Link>
        ))}
        {rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-faint">
            {query ? `No clients match “${query}”.` : "No clients yet."}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── one client ────────────────────────────── */

/**
 * One task, as one line: title left, hours and due date right.
 *
 * ⚠️ Its own component rather than a `compact` flag on `TaskTable`. Two reasons,
 * and the second is the load-bearing one. `TaskTable` is built around the full
 * column set and its own log-time popover, none of which a one-line row wants —
 * and it computes its hours in a `useMemo` that walks EVERY time entry in the
 * studio. That is fine for the one table on My Tasks; this page renders a list
 * per group and per section, so on a client like Anchor it meant ~18 instances
 * each scanning ~24,000 entries on every render, and again on every background
 * refresh. `taskMinutes` is the same total, computed once in the store.
 *
 * No "+ Time" here: this list answers "what is the state of this client's
 * work", and the row still opens the task pane, which has its own log control.
 * My Tasks keeps the fuller card — that page exists to log time.
 */
function TaskRow({
  task,
  minutes,
  todayIso,
  onOpen,
}: {
  task: Task;
  minutes: number;
  todayIso: string;
  onOpen: (id: string) => void;
}) {
  const total = taskMinutesDone(task, () => minutes);
  const overdue = task.dueDate != null && task.status !== "done" && task.dueDate < todayIso;
  return (
    <div
      onClick={() => onOpen(task.id)}
      // `items-baseline`, so when a long title wraps to two lines the figures
      // stay level with its FIRST line rather than drifting to the middle.
      className="flex min-h-11 items-baseline gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-card"
    >
      <span className="bidi-auto min-w-0 flex-1 text-sm leading-snug">{task.title}</span>
      <span className="shrink-0 tabular-nums text-[11px] text-muted">
        {formatHoursDecimal(total)}
        {task.estimateHours ? ` / ${task.estimateHours}h` : "h"}
      </span>
      {task.dueDate && (
        <span
          className={`shrink-0 tabular-nums text-[11px] ${overdue ? "text-danger" : "text-muted"}`}
        >
          {formatDayMonth(task.dueDate)}
        </span>
      )}
    </div>
  );
}

/** A section, its groups, and the tasks that sit loose in it. */
interface Block {
  key: string;
  name: string;
  count: number;
  groups: { id: string; name: string; tasks: Task[] }[];
  loose: Task[];
}

export function MobileClientView({ clientId }: { clientId: string }) {
  const { clients, sections, taskGroups, tasks, openTask, taskMinutes } = useData();
  const [showDone, setShowDone] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const client = clients.find((c) => c.id === clientId);

  const blocks = useMemo<Block[]>(() => {
    const mine = tasks
      .filter((t) => t.clientId === clientId && (showDone || t.status !== "done"))
      .sort((a, b) => a.position - b.position);

    // Bucketed in ONE pass rather than a `filter` per section inside a `map` —
    // same result, without re-walking the client's tasks once per section.
    const bySection = new Map<string, Task[]>();
    for (const t of mine) {
      const k = t.sectionId ?? "";
      const arr = bySection.get(k);
      if (arr) arr.push(t);
      else bySection.set(k, [t]);
    }

    const mySections = sections
      .filter((s) => s.clientId === clientId)
      .sort((a, b) => a.position - b.position);

    // ⚠️ The "no section" bucket is a real bucket and is listed LAST, exactly as
    // the desktop page does it. Dropping it would hide tasks entirely rather
    // than merely filing them oddly.
    const buckets: { key: string; name: string }[] = [
      ...mySections.map((s) => ({ key: s.id, name: s.name })),
      { key: "", name: "No section" },
    ];

    return buckets
      .map(({ key, name }) => {
        const inSection = bySection.get(key) ?? [];
        // One pass again: group id → its tasks. ⚠️ Keyed off the SECTION's own
        // groups, which is what enforces the invariant every other reader also
        // applies — a task counts as grouped only when its group belongs to the
        // task's own section. A hand-edited row degrades to "loose", never to
        // invisible.
        const groupNames = new Map(
          taskGroups
            .filter((g) => g.clientId === clientId && (g.sectionId ?? "") === key)
            .sort((a, b) => a.position - b.position)
            .map((g) => [g.id, g.name]),
        );
        const byGroup = new Map<string, Task[]>();
        const loose: Task[] = [];
        for (const t of inSection) {
          if (t.groupId && groupNames.has(t.groupId)) {
            const arr = byGroup.get(t.groupId);
            if (arr) arr.push(t);
            else byGroup.set(t.groupId, [t]);
          } else {
            loose.push(t);
          }
        }
        return {
          key,
          name,
          count: inSection.length,
          // Iterating `groupNames` keeps the groups in their `position` order.
          groups: [...groupNames]
            .filter(([id]) => byGroup.has(id))
            .map(([id, gName]) => ({ id, name: gName, tasks: byGroup.get(id)! })),
          loose,
        };
      })
      .filter((b) => b.count > 0);
  }, [tasks, sections, taskGroups, clientId, showDone]);

  const openCount = useMemo(
    () => tasks.filter((t) => t.clientId === clientId && t.status !== "done").length,
    [tasks, clientId],
  );

  const todayIso = toISODate(new Date());

  if (!client) return <p className="text-sm text-muted">This client no longer exists.</p>;

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const rows = (list: Task[]) =>
    list.map((t) => (
      <TaskRow
        key={t.id}
        task={t}
        minutes={taskMinutes(t.id)}
        todayIso={todayIso}
        onOpen={openTask}
      />
    ));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <ClientAvatar client={client} size={34} />
        <div className="min-w-0 flex-1">
          <h1 className="bidi-auto truncate text-xl leading-tight">{client.name}</h1>
          <p className="text-[11px] text-muted">
            {openCount} open {openCount === 1 ? "task" : "tasks"}
          </p>
        </div>
      </div>

      {/* The only control a phone gets. Everything else on this page is a
          planning job — see the note at the top of this file. */}
      <label className="flex min-h-11 items-center gap-2 self-start text-xs text-muted">
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
        Show done
      </label>

      {blocks.map((block) => {
        const isOpen = !collapsed.has(block.key);
        return (
          <section key={block.key} className="flex flex-col gap-2">
            <button
              onClick={() => toggle(block.key)}
              className="flex min-h-11 items-center gap-1.5 text-left"
            >
              {isOpen ? (
                <ChevronDown size={16} className="shrink-0 text-muted" />
              ) : (
                <ChevronRight size={16} className="shrink-0 text-muted" />
              )}
              {/* Size and colour carry the hierarchy, never weight — the studio's
                  font collapses medium/semibold/bold onto one weight (570). */}
              <span className="bidi-auto min-w-0 flex-1 truncate text-base">{block.name}</span>
              <span className="shrink-0 text-xs text-faint">{block.count}</span>
            </button>

            {/* ⚠️ Only the HEADINGS indent; the rows run the full width of the
                page. Indenting the rows too cost ~24px of every title on a
                375px screen to say something the heading above already said,
                and nested one more level inside a group it was 24 more. */}
            {isOpen && (
              <div className="flex flex-col gap-3">
                {block.groups.map((g) => {
                  // ⚠️ `g:` namespaced, exactly as the desktop page keys them —
                  // one `collapsed` set holds both kinds, and a group id must
                  // never collide with a section id.
                  const gKey = `g:${g.id}`;
                  const groupOpen = !collapsed.has(gKey);
                  return (
                    <div key={g.id} className="flex flex-col gap-2">
                      <button
                        onClick={() => toggle(gKey)}
                        className="flex min-h-11 items-center gap-1.5 pl-5 text-left"
                      >
                        {groupOpen ? (
                          <ChevronDown size={14} className="shrink-0 text-muted" />
                        ) : (
                          <ChevronRight size={14} className="shrink-0 text-muted" />
                        )}
                        <Layers size={14} className="shrink-0 text-muted" />
                        <span className="bidi-auto min-w-0 flex-1 truncate text-sm">{g.name}</span>
                        <span className="shrink-0 text-xs text-faint">{g.tasks.length}</span>
                      </button>
                      {groupOpen && <div className="flex flex-col gap-2">{rows(g.tasks)}</div>}
                    </div>
                  );
                })}
                {block.loose.length > 0 && (
                  <div className="flex flex-col gap-2">{rows(block.loose)}</div>
                )}
              </div>
            )}
          </section>
        );
      })}

      {blocks.length === 0 && (
        <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-faint">
          {showDone
            ? "No tasks for this client yet."
            : "Nothing open — tick “Show done” to see finished work."}
        </p>
      )}

      <p className="pt-2 text-[11px] text-faint">
        The Timeline and Board views need a wider screen.
      </p>
    </div>
  );
}
