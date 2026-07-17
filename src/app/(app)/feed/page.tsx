"use client";

import { Suspense, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, X } from "lucide-react";
import { useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { fetchAll, mapTimeEntry } from "@/lib/db";
import {
  addDays,
  formatFeedDate,
  formatHours,
  formatHoursShort,
  parseDuration,
  startOfWeek,
  toISODate,
  DAY_NAMES,
} from "@/lib/format";
import { presetRange, RANGE_PRESETS, type RangePreset } from "@/lib/date-ranges";
import { Avatar, ClientChip, ContextMenu, type ContextMenuItem } from "@/components/ui";
import { EditableTextCell } from "@/components/editable-cell";
import { useColWidths, ResizeHandle } from "@/components/resizable";
import type { TimeEntry } from "@/lib/types";

type Period = "Recent" | RangePreset;

// ── cell details popup (task + day → entries, editable) ────────────────────

function EntryEditRow({ entry }: { entry: TimeEntry }) {
  const { profiles, updateTimeEntry, deleteTimeEntry } = useData();
  const [duration, setDuration] = useState(formatHoursShort(entry.minutes));
  const [description, setDescription] = useState(entry.description);
  const [date, setDate] = useState(entry.date);
  const user = profiles.find((p) => p.id === entry.userId) ?? null;

  const minutes = parseDuration(duration);
  const dirty =
    (minutes != null && minutes !== entry.minutes) ||
    description !== entry.description ||
    (!!date && date !== entry.date);

  function save() {
    if (minutes == null || minutes <= 0 || !date) return;
    updateTimeEntry(entry.id, { minutes, description, date });
  }

  return (
    <div className="group flex items-center gap-2 border-b border-border py-2 last:border-b-0">
      <Avatar profile={user} size={24} />
      <input
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
        className={`w-16 rounded-md border bg-surface px-1.5 py-1 text-sm tabular-nums outline-none focus:border-brand ${
          duration && minutes == null ? "border-danger" : "border-border"
        }`}
      />
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs outline-none focus:border-brand"
      />
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && dirty && save()}
        placeholder="Description"
        className="bidi-auto min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand"
      />
      {dirty && (
        <button
          onClick={save}
          disabled={minutes == null || minutes <= 0 || !date}
          className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-40"
        >
          Save
        </button>
      )}
      <button
        onClick={() => deleteTimeEntry(entry.id)}
        title="Delete this time log"
        className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-danger group-hover:opacity-100"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/** A designer's entries on one day (timesheet cell) — editable per line. */
function UserDayDetails({
  userId,
  date,
  onClose,
}: {
  userId: string;
  date: string;
  onClose: () => void;
}) {
  const { tasks, clients, profiles, timeEntries } = useData();
  const supabase = useMemo(() => createClient(), []);
  const [loaded, setLoaded] = useState<TimeEntry[]>([]);
  const [ready, setReady] = useState(false);
  const profile = profiles.find((p) => p.id === userId) ?? null;

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", userId)
      .eq("date", date)
      .not("minutes", "is", null)
      .order("created_at")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("user day load failed", error.message);
        setLoaded((data ?? []).map(mapTimeEntry));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, userId, date]);

  const entries = useMemo(() => {
    const byId = new Map(loaded.map((e) => [e.id, e]));
    for (const e of timeEntries) {
      if (e.userId === userId && e.date === date && e.minutes > 0) byId.set(e.id, e);
    }
    return [...byId.values()];
  }, [loaded, timeEntries, userId, date]);
  const total = entries.reduce((s, e) => s + e.minutes, 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed left-1/2 top-1/3 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar profile={profile} size={26} />
            <div className="min-w-0">
              <h3 className="truncate font-heading text-sm">{profile?.name ?? "Member"}</h3>
              <div className="text-xs text-muted">
                {formatFeedDate(date)} · <span className="font-semibold tabular-nums">{formatHours(total)}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md px-1.5 text-muted hover:bg-background">
            <X size={16} />
          </button>
        </div>
        <div className="mt-2 flex max-h-80 flex-col overflow-y-auto">
          {!ready && <p className="py-3 text-center text-sm text-faint">Loading…</p>}
          {ready && entries.length === 0 && (
            <p className="py-3 text-center text-sm text-faint">No hours on this day.</p>
          )}
          {entries.map((e) => {
            const task = tasks.find((t) => t.id === e.taskId);
            const client = clients.find((c) => c.id === task?.clientId);
            return (
              <div key={e.id} className="border-b border-border/60 py-1 last:border-b-0">
                <div className="flex items-center gap-1.5 pt-1 text-[11px] text-muted">
                  {client && (
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: client.color }} />
                  )}
                  <span className="bidi-auto truncate">{task?.title ?? "(deleted task)"}</span>
                </div>
                <EntryEditRow entry={e} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function CellDetails({
  taskId,
  date,
  onClose,
}: {
  taskId: string;
  date: string;
  onClose: () => void;
}) {
  const { tasks, clients, timeEntries, addTimeEntry, currentUserId } = useData();
  const supabase = useMemo(() => createClient(), []);
  const [loadedIds, setLoadedIds] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState<TimeEntry[]>([]);
  const [addDuration, setAddDuration] = useState("");
  const [addDescription, setAddDescription] = useState("");

  const task = tasks.find((t) => t.id === taskId);
  const client = clients.find((c) => c.id === task?.clientId);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from("time_entries")
      .select("*")
      .eq("task_id", taskId)
      .eq("date", date)
      .not("minutes", "is", null)
      .order("created_at")
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const rows = (data ?? []).map(mapTimeEntry);
        setLoaded(rows);
        setLoadedIds(rows.map((r) => r.id));
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, taskId, date]);

  // Prefer the store's copy (it reflects live edits/additions), fall back to the fetch.
  const entries = useMemo(() => {
    const byId = new Map(loaded.map((e) => [e.id, e]));
    for (const e of timeEntries) {
      if (e.taskId === taskId && e.date === date && e.minutes > 0) byId.set(e.id, e);
    }
    return [...byId.values()];
  }, [loaded, timeEntries, taskId, date]);

  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const addMinutes = parseDuration(addDuration);
  const canAdd = addMinutes != null && addMinutes > 0 && addDescription.trim() && currentUserId;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed left-1/2 top-1/3 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-4 shadow-2xl">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="bidi-auto truncate font-heading text-sm">{task?.title ?? "Task"}</h3>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
              {client && <ClientChip client={client} size="sm" />}
              <span>{formatFeedDate(date)}</span>
              <span className="font-semibold tabular-nums">{formatHours(total)}</span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md px-1.5 text-muted hover:bg-background">
            <X size={16} />
          </button>
        </div>

        <div className="mt-2 flex max-h-64 flex-col overflow-y-auto">
          {loadedIds === null && <p className="py-3 text-center text-sm text-faint">Loading…</p>}
          {loadedIds !== null && entries.length === 0 && (
            <p className="py-3 text-center text-sm text-faint">No hours on this day.</p>
          )}
          {entries.map((e) => (
            <EntryEditRow key={e.id} entry={e} />
          ))}
        </div>

        <div className="mt-3 flex gap-2 border-t border-border pt-3">
          <input
            value={addDuration}
            onChange={(e) => setAddDuration(e.target.value)}
            placeholder="1.5h"
            className={`w-16 rounded-md border bg-surface px-1.5 py-1.5 text-sm outline-none focus:border-brand ${
              addDuration && addMinutes == null ? "border-danger" : "border-border"
            }`}
          />
          <input
            value={addDescription}
            onChange={(e) => setAddDescription(e.target.value)}
            placeholder="What was done? (required)"
            className="bidi-auto min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
          />
          <button
            disabled={!canAdd}
            onClick={() => {
              if (!canAdd || addMinutes == null) return;
              addTimeEntry(taskId, addMinutes, addDescription.trim(), date);
              setAddDuration("");
              setAddDescription("");
            }}
            className="flex shrink-0 items-center gap-1 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-40"
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>
    </>
  );
}

// ── page ───────────────────────────────────────────────────────────────────

/** ?range=today|thisweek|thismonth → initial period + date range. */
function initialFromRangeParam(param: string | null): { period: Period; range: { from: string; to: string } } {
  switch (param) {
    case "today": {
      const today = toISODate(new Date());
      return { period: "Custom", range: { from: today, to: today } };
    }
    case "thisweek":
      return { period: "This week", range: presetRange("This week") };
    case "thismonth":
      return { period: "This month", range: presetRange("This month") };
    default:
      return { period: "Recent", range: presetRange("This week") };
  }
}

function FeedPageContent() {
  const { timeEntries, entrySums, tasks, sections, clients, profiles, openTask, deleteTimeEntry, updateTimeEntry, currentUserId } =
    useData();
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();

  const [view, setView] = useState<"feed" | "timesheet">("feed");
  const [clientFilter, setClientFilter] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [period, setPeriod] = useState<Period>(
    () => initialFromRangeParam(searchParams.get("range")).period,
  );
  const [range, setRange] = useState(
    () => initialFromRangeParam(searchParams.get("range")).range,
  );
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [fetched, setFetched] = useState<TimeEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [cellPopup, setCellPopup] = useState<{ taskId: string; date: string } | null>(null);
  const { widths: colWidths, startResize: startColResize } = useColWidths("feed", {
    user: 48,
    date: 80,
    hours: 64,
    client: 112,
    section: 112,
    task: 176,
  });
  const [userPopup, setUserPopup] = useState<{ userId: string; date: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  // ?mine=1 → preselect "My hours" once the current user is known
  const mineParam = searchParams.get("mine") === "1";
  const [mineApplied, setMineApplied] = useState(false);
  useEffect(() => {
    if (mineParam && !mineApplied && currentUserId) {
      setMemberFilter(currentUserId);
      setMineApplied(true);
    }
  }, [mineParam, mineApplied, currentUserId]);

  const myHours = memberFilter === currentUserId && memberFilter !== "";

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const taskClient = useMemo(() => new Map(tasks.map((t) => [t.id, t.clientId])), [tasks]);

  // feed view + explicit period → fetch full rows on demand
  const feedRange = view === "feed" && period !== "Recent" ? range : null;
  useEffect(() => {
    if (!feedRange) {
      setFetched(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchAll<Record<string, unknown>>(supabase, "time_entries", "*", (q) =>
      q.gte("date", feedRange.from).lte("date", feedRange.to).not("minutes", "is", null),
    )
      .then((rows) => {
        if (!cancelled) setFetched(rows.map(mapTimeEntry));
      })
      .catch((e) => console.error("feed period fetch failed", e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [supabase, feedRange?.from, feedRange?.to]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickPeriod(p: Period) {
    setPeriod(p);
    if (p !== "Recent" && p !== "Custom") setRange(presetRange(p));
  }

  const feedRows = useMemo(() => {
    const source = fetched ?? timeEntries;
    return source
      .filter((e) => {
        if (memberFilter && e.userId !== memberFilter) return false;
        if (clientFilter && taskClient.get(e.taskId) !== clientFilter) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [fetched, timeEntries, memberFilter, clientFilter, taskClient]);

  // per-column aggregates over the visible (filtered) feed rows
  const feedStats = useMemo(() => {
    const users = new Set<string>();
    const days = new Set<string>();
    const clientIds = new Set<string>();
    const sectionIds = new Set<string>();
    const taskIds = new Set<string>();
    let minutes = 0;
    let withNotes = 0;
    for (const e of feedRows) {
      users.add(e.userId);
      days.add(e.date);
      taskIds.add(e.taskId);
      minutes += e.minutes;
      if (e.description.trim()) withNotes++;
      const task = taskById.get(e.taskId);
      if (task) clientIds.add(task.clientId);
      if (task?.sectionId) sectionIds.add(task.sectionId);
    }
    return {
      users: users.size,
      days: days.size,
      minutes,
      clients: clientIds.size,
      sections: sectionIds.size,
      tasks: taskIds.size,
      withNotes,
    };
  }, [feedRows, taskById]);

  // ── timesheet data (from entrySums — always complete) ────────────────────
  const weekFrom = toISODate(weekStart);
  const weekTo = toISODate(addDays(weekStart, 6));

  const sheet = useMemo(() => {
    if (view !== "timesheet") return null;
    const inWeek = entrySums.filter((e) => {
      if (e.date < weekFrom || e.date > weekTo) return false;
      if (memberFilter && e.userId !== memberFilter) return false;
      if (clientFilter && taskClient.get(e.taskId) !== clientFilter) return false;
      return true;
    });
    const hasFriSat = inWeek.some((e) => {
      const d = new Date(e.date).getDay();
      return d === 5 || d === 6;
    });
    const dayCount = hasFriSat ? 7 : 5;
    const days = Array.from({ length: dayCount }, (_, i) => toISODate(addDays(weekStart, i)));

    // rows = designers (one line per member with hours this week)
    const rowMap = new Map<string, { byDay: Map<string, number>; total: number }>();
    for (const e of inWeek) {
      const row = rowMap.get(e.userId) ?? { byDay: new Map(), total: 0 };
      row.byDay.set(e.date, (row.byDay.get(e.date) ?? 0) + e.minutes);
      row.total += e.minutes;
      rowMap.set(e.userId, row);
    }
    const rows = [...rowMap.entries()]
      .map(([userId, v]) => ({ userId, profile: profiles.find((p) => p.id === userId) ?? null, ...v }))
      .sort((a, b) => b.total - a.total);
    const dayTotals = days.map((d) =>
      inWeek.reduce((s, e) => (e.date === d ? s + e.minutes : s), 0),
    );
    const weekTotal = inWeek.reduce((s, e) => s + e.minutes, 0);
    return { days, rows, dayTotals, weekTotal };
  }, [view, entrySums, weekFrom, weekTo, weekStart, memberFilter, clientFilter, taskClient, profiles]);

  const weekLabel = `${weekStart.getDate()}/${weekStart.getMonth() + 1} – ${addDays(weekStart, 4).getDate()}/${addDays(weekStart, 4).getMonth() + 1}`;

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl">Time Feed</h1>
          <p className="text-sm text-muted">
            {view === "feed"
              ? "Recent hours across the studio — newest first. Open a task to move hours between tasks."
              : "Weekly timesheet — hours per designer per day. Click a cell for that day's entries."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            {(["feed", "timesheet"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${
                  view === v ? "bg-brand-soft text-brand-dark" : "text-muted"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            onClick={() => setMemberFilter(myHours ? "" : currentUserId)}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              myHours
                ? "border-brand bg-brand-soft text-brand-dark"
                : "border-border bg-surface text-muted hover:text-foreground"
            }`}
          >
            My hours
          </button>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">All clients</option>
            {clients
              .filter((c) => !c.archived)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
          >
            <option value="">All users</option>
            {profiles
              .filter((p) => p.active)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {view === "feed" && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["Recent", ...RANGE_PRESETS] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => pickPeriod(p)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                  period === p
                    ? "border-brand bg-brand-soft text-brand-dark"
                    : "border-border bg-surface text-muted hover:border-border-strong"
                }`}
              >
                {p}
              </button>
            ))}
            {period === "Custom" && (
              <>
                <input
                  type="date"
                  value={range.from}
                  onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                />
                <span className="text-muted">→</span>
                <input
                  type="date"
                  value={range.to}
                  onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                />
              </>
            )}
            {loading && <span className="text-xs text-faint">loading…</span>}
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="group/thead flex items-start gap-3 border-b border-border bg-background px-4 py-2">
              {(
                [
                  ["user", "User", `${feedStats.users} user${feedStats.users === 1 ? "" : "s"}`],
                  ["date", "Date", `${feedStats.days} day${feedStats.days === 1 ? "" : "s"}`],
                  ["hours", "Hours", formatHoursShort(feedStats.minutes)],
                  ["client", "Client", `${feedStats.clients} client${feedStats.clients === 1 ? "" : "s"}`],
                  ["section", "Section", `${feedStats.sections} section${feedStats.sections === 1 ? "" : "s"}`],
                  ["task", "Task", `${feedStats.tasks} task${feedStats.tasks === 1 ? "" : "s"}`],
                ] as const
              ).map(([key, title, subtitle]) => (
                <span key={key} className="relative shrink-0" style={{ width: colWidths[key] }}>
                  <span className="block text-xs font-medium uppercase tracking-wide text-faint">
                    {title}
                  </span>
                  <span className="block text-[10px] text-faint">{subtitle}</span>
                  <ResizeHandle onMouseDown={startColResize(key)} />
                </span>
              ))}
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium uppercase tracking-wide text-faint">
                  Description
                </span>
                <span className="block text-[10px] text-faint">{feedStats.withNotes} with notes</span>
              </span>
            </div>
            {feedRows.map((entry) => {
              const user = profiles.find((p) => p.id === entry.userId) ?? null;
              const task = taskById.get(entry.taskId);
              const client = clients.find((c) => c.id === task?.clientId);
              const section = task?.sectionId ? sectionById.get(task.sectionId) : undefined;
              return (
                <div
                  key={entry.id}
                  className="group/row flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0 hover:bg-background"
                  onClick={() => task && openTask(task.id)}
                >
                  <span className="shrink-0" style={{ width: colWidths.user }}>
                    <Avatar profile={user} size={26} />
                  </span>
                  <span className="shrink-0 text-xs text-muted" style={{ width: colWidths.date }}>
                    {formatFeedDate(entry.date)}
                  </span>
                  <span
                    className="shrink-0 font-semibold tabular-nums"
                    style={{ width: colWidths.hours }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <EditableTextCell
                      value={formatHours(entry.minutes)}
                      bidi={false}
                      onCommit={(v) => {
                        const minutes = parseDuration(v);
                        if (minutes != null && minutes > 0 && minutes !== entry.minutes)
                          updateTimeEntry(entry.id, { minutes });
                      }}
                    />
                  </span>
                  <span className="shrink-0 truncate" style={{ width: colWidths.client }}>
                    {client && <ClientChip client={client} size="sm" link={false} />}
                  </span>
                  <span className="bidi-auto shrink-0 truncate text-muted" style={{ width: colWidths.section }}>
                    {section?.name}
                  </span>
                  <span className="bidi-auto shrink-0 truncate font-medium" style={{ width: colWidths.task }}>
                    {task?.title}
                  </span>
                  <span className="min-w-0 flex-1 text-muted" onClick={(e) => e.stopPropagation()}>
                    <EditableTextCell
                      value={entry.description}
                      placeholder="no description"
                      onCommit={(v) => v && updateTimeEntry(entry.id, { description: v })}
                    />
                  </span>
                  {entry.movedFromTaskId && (
                    <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
                      moved
                    </span>
                  )}
                  <span className="flex w-12 shrink-0 items-center justify-end gap-0.5 opacity-0 group-hover/row:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCellPopup({ taskId: entry.taskId, date: entry.date });
                      }}
                      title="Edit this time log (hours, date, description)"
                      className="rounded p-1 text-muted hover:text-brand"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTimeEntry(entry.id);
                      }}
                      title="Delete this time log"
                      className="rounded p-1 text-muted hover:text-danger"
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
              );
            })}
            {feedRows.length === 0 && !loading && (
              <div className="p-8 text-center text-sm text-faint">No hours in this period.</div>
            )}
          </div>
        </>
      )}

      {view === "timesheet" && sheet && (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekStart((w) => addDays(w, -7))}
              className="rounded-md border border-border bg-surface p-1.5 text-muted hover:text-foreground"
              title="Previous week"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-28 text-center text-sm font-medium tabular-nums">{weekLabel}</span>
            <button
              onClick={() => setWeekStart((w) => addDays(w, 7))}
              className="rounded-md border border-border bg-surface p-1.5 text-muted hover:text-foreground"
              title="Next week"
            >
              <ChevronRight size={15} />
            </button>
            <button
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted hover:text-foreground"
            >
              This week
            </button>
            <span className="ml-auto text-sm text-muted">
              Week total:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {formatHoursShort(sheet.weekTotal)}
              </span>
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-background text-xs font-medium uppercase tracking-wide text-faint">
                  <th className="p-2 text-left">Designer</th>
                  {sheet.days.map((d) => {
                    const day = new Date(d);
                    const isToday = d === toISODate(new Date());
                    return (
                      <th key={d} className={`w-20 p-2 text-right ${isToday ? "text-brand" : ""}`}>
                        {DAY_NAMES[day.getDay()].slice(0, 3)} {day.getDate()}
                      </th>
                    );
                  })}
                  <th className="w-20 p-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map(({ userId, profile, byDay, total }) => (
                  <tr key={userId} className="border-b border-border last:border-b-0 hover:bg-background/60">
                    <td className="max-w-64 p-2">
                      <span className="flex w-full min-w-0 items-center gap-2 text-left">
                        <Avatar profile={profile} size={22} />
                        <span className="truncate font-medium">{profile?.name ?? "(unknown)"}</span>
                      </span>
                    </td>
                    {sheet.days.map((d) => {
                      const minutes = byDay.get(d) ?? 0;
                      return (
                        <td
                          key={d}
                          onClick={() => minutes > 0 && setUserPopup({ userId, date: d })}
                          className={`p-2 text-right tabular-nums ${
                            minutes > 0
                              ? "cursor-pointer font-medium hover:bg-brand-soft/60"
                              : "text-faint"
                          }`}
                          title={minutes > 0 ? "Click for that day's entries" : undefined}
                        >
                          {minutes > 0 ? formatHoursShort(minutes) : "–"}
                        </td>
                      );
                    })}
                    <td className="p-2 text-right font-semibold tabular-nums">
                      {formatHoursShort(total)}
                    </td>
                  </tr>
                ))}
                {sheet.rows.length === 0 && (
                  <tr>
                    <td colSpan={sheet.days.length + 2} className="p-8 text-center text-faint">
                      No hours this week.
                    </td>
                  </tr>
                )}
              </tbody>
              {sheet.rows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border bg-background text-xs font-semibold">
                    <td className="p-2 text-faint">Day total</td>
                    {sheet.dayTotals.map((m, i) => (
                      <td key={i} className="p-2 text-right tabular-nums">
                        {m > 0 ? formatHoursShort(m) : "–"}
                      </td>
                    ))}
                    <td className="p-2 text-right tabular-nums">
                      {formatHoursShort(sheet.weekTotal)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {cellPopup && (
        <CellDetails
          taskId={cellPopup.taskId}
          date={cellPopup.date}
          onClose={() => setCellPopup(null)}
        />
      )}
      {userPopup && (
        <UserDayDetails
          userId={userPopup.userId}
          date={userPopup.date}
          onClose={() => setUserPopup(null)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** useSearchParams requires a Suspense boundary above it (Next.js prerendering). */
export default function FeedPage() {
  return (
    <Suspense>
      <FeedPageContent />
    </Suspense>
  );
}
