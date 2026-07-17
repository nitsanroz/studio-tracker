"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Inbox, Pencil, X } from "lucide-react";
import { useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { mapTimeEntry } from "@/lib/db";
import { presetRange } from "@/lib/date-ranges";
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
import { TaskAutocomplete, type TaskMatch } from "./task-autocomplete";
import { TaskTable } from "./task-list-row";
import { Avatar, ClientChip } from "./ui";
import { MiniColumnsLabeled, PieChart } from "./charts";
import type { TimeEntry } from "@/lib/types";

/** previous range of the same kind, for the "vs last period" delta */
function previousRange(rangeKey: (typeof HOME_RANGES)[number]): { from: string; to: string } | null {
  const now = new Date();
  switch (rangeKey) {
    case "This week": {
      const cur = presetRange("This week");
      const [y, m, d] = cur.from.split("-").map(Number);
      const prevStart = addDays(new Date(y, m - 1, d), -7);
      return { from: toISODate(prevStart), to: toISODate(addDays(prevStart, 6)) };
    }
    case "This month":
      return {
        from: toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: toISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "This year":
      return {
        from: toISODate(new Date(now.getFullYear() - 1, 0, 1)),
        to: toISODate(new Date(now.getFullYear() - 1, 11, 31)),
      };
    default:
      return null; // All time has no "previous period"
  }
}

/** Hours in the selected period (admins: studio-wide, users: their own) + delta vs last period. */
function PeriodStat({
  isAdmin,
  filter,
  rangeKey,
}: {
  isAdmin: boolean;
  filter: HomeFilter;
  rangeKey: (typeof HOME_RANGES)[number];
}) {
  const { entrySums, tasks, currentUserId } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const stats = useMemo(() => {
    const prevRange = previousRange(rangeKey);
    let cur = 0;
    let curBillable = 0;
    let prev = 0;
    for (const e of entrySums) {
      if (!isAdmin && e.userId !== currentUserId) continue;
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) continue;
      if (!filter.range || (e.date >= filter.range.from && e.date <= filter.range.to)) {
        cur += e.minutes;
        if (task?.billable) curBillable += e.minutes;
      } else if (prevRange && e.date >= prevRange.from && e.date <= prevRange.to) {
        prev += e.minutes;
      }
    }
    return { cur, curBillable, prev, delta: prevRange && prev > 0 ? (cur - prev) / prev : null };
  }, [entrySums, taskById, isAdmin, currentUserId, filter, rangeKey]);

  const billablePct = stats.cur > 0 ? Math.round((stats.curBillable / stats.cur) * 100) : null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2
        className="font-heading text-sm"
        title={
          isAdmin
            ? "All hours logged across the studio in the selected period"
            : "Your logged hours in the selected period"
        }
      >
        {isAdmin ? "Studio hours" : "My hours"} — {filter.label.toLowerCase()}
      </h2>
      <div className="mt-1.5 flex items-baseline gap-2.5">
        <span className="text-4xl font-bold tabular-nums">{formatHoursShort(stats.cur)}</span>
        {stats.delta != null && (
          <span
            className={`text-xs font-semibold tabular-nums ${stats.delta >= 0 ? "text-success" : "text-danger"}`}
            title={`Last period: ${formatHoursShort(stats.prev)}`}
          >
            {stats.delta >= 0 ? "+" : ""}
            {Math.round(stats.delta * 100)}% vs last period
          </span>
        )}
      </div>
      {isAdmin && (
        <p
          className="mt-1.5 text-xs text-muted"
          title="Share of hours logged on billable tasks in the selected period"
        >
          Billable{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {billablePct == null ? "–" : `${billablePct}%`}
          </span>
        </p>
      )}
    </div>
  );
}

function DayLogRow({ entry, onDelete }: { entry: TimeEntry; onDelete: (id: string) => void }) {
  const { tasks, clients, updateTimeEntry } = useData();
  const [editing, setEditing] = useState(false);
  const [duration, setDuration] = useState("");
  const [description, setDescription] = useState("");

  const task = tasks.find((t) => t.id === entry.taskId);
  const client = clients.find((c) => c.id === task?.clientId);

  const minutes = parseDuration(duration);

  function startEdit() {
    setDuration(formatHoursShort(entry.minutes));
    setDescription(entry.description);
    setEditing(true);
  }

  function save() {
    if (minutes == null || minutes <= 0) return;
    updateTimeEntry(entry.id, { minutes, description });
    setEditing(false);
  }

  if (editing) {
    return (
      <div
        className="flex gap-1.5 border-b border-border py-2 last:border-b-0"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(false);
        }}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
      >
        <input
          autoFocus
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className={`w-14 rounded-md border bg-surface px-1.5 py-1 text-sm tabular-nums outline-none focus:border-brand ${
            duration && minutes == null ? "border-danger" : "border-border"
          }`}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="Description"
          className="bidi-auto min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand"
        />
        <button
          onClick={save}
          disabled={minutes == null || minutes <= 0}
          className="shrink-0 rounded-md bg-brand px-2 py-1 text-xs font-medium text-white hover:bg-brand-dark disabled:opacity-40"
        >
          Save
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={startEdit}
      title={entry.description}
      className="group flex cursor-pointer items-center gap-2 border-b border-border px-1 py-2 last:border-b-0 hover:bg-background"
    >
      <span className="w-11 shrink-0 text-sm font-semibold tabular-nums">
        {formatHoursShort(entry.minutes)}
      </span>
      {client && (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: client.color }} />
          <span className="bidi-auto max-w-24 truncate">{client.name}</span>
        </span>
      )}
      <span className="bidi-auto min-w-0 flex-1 truncate text-sm">
        {task?.title ?? "(deleted task)"}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(entry.id);
        }}
        title="Delete entry"
        className="shrink-0 rounded p-0.5 text-muted opacity-0 hover:text-danger group-hover:opacity-100"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function DayLog() {
  const { addTimeEntry, deleteTimeEntry, timeEntries, tasks, clients, currentUserId, profiles } = useData();
  const supabase = useMemo(() => createClient(), []);
  const todayIso = toISODate(new Date());
  const [dateIso, setDateIso] = useState(todayIso);
  const [loaded, setLoaded] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<TaskMatch | null>(null);
  const [duration, setDuration] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from("time_entries")
      .select("*")
      .eq("user_id", currentUserId)
      .eq("date", dateIso)
      .not("minutes", "is", null)
      .order("created_at")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("day log load failed", error.message);
        setLoaded((data ?? []).map(mapTimeEntry));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, currentUserId, dateIso]);

  // Prefer the store's copy (reflects live edits/additions), fall back to the fetch.
  const entries = useMemo(() => {
    const byId = new Map(loaded.map((e) => [e.id, e]));
    for (const e of timeEntries) {
      if (e.userId === currentUserId && e.date === dateIso && e.minutes > 0) byId.set(e.id, e);
    }
    return [...byId.values()];
  }, [loaded, timeEntries, currentUserId, dateIso]);

  const dayMinutes = entries.reduce((s, e) => s + e.minutes, 0);
  const me = profiles.find((p) => p.id === currentUserId);
  const targetMinutes = me?.capacityHoursWeek ? (me.capacityHoursWeek / 5) * 60 : 8 * 60;
  const pct = Math.min(100, (dayMinutes / targetMinutes) * 100);

  const minutes = parseDuration(duration);
  const canSave = picked && minutes != null && minutes > 0 && description.trim().length > 0;

  // the 5 tasks I logged on most recently — one-click re-log chips
  const recentTasks = useMemo(() => {
    const seen: string[] = [];
    for (const e of timeEntries) {
      if (e.userId !== currentUserId || seen.includes(e.taskId)) continue;
      seen.push(e.taskId);
      if (seen.length >= 5) break;
    }
    return seen
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => !!t && t.status !== "done");
  }, [timeEntries, currentUserId, tasks]);

  function shiftDay(delta: number) {
    const [y, m, d] = dateIso.split("-").map(Number);
    setDateIso(toISODate(addDays(new Date(y, m - 1, d), delta)));
  }

  function save() {
    if (!canSave || !picked || minutes == null) return;
    addTimeEntry(picked.task.id, minutes, description.trim(), dateIso);
    setPicked(null);
    setDuration("");
    setDescription("");
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-heading text-sm">Log my hours</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftDay(-1)}
            className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground"
            title="Previous day"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-20 text-center text-xs font-medium tabular-nums">
            {dateIso === todayIso ? "Today" : formatFeedDate(dateIso)}
          </span>
          <button
            onClick={() => shiftDay(1)}
            disabled={dateIso >= todayIso}
            className="rounded-md p-1 text-muted hover:bg-background hover:text-foreground disabled:opacity-30"
            title="Next day"
          >
            <ChevronRight size={15} />
          </button>
          {dateIso !== todayIso && (
            <button
              onClick={() => setDateIso(todayIso)}
              className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted hover:border-brand hover:text-brand"
            >
              Today
            </button>
          )}
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {loading && <p className="py-3 text-center text-xs text-faint">Loading…</p>}
        {!loading && entries.length === 0 && (
          <p className="py-3 text-center text-xs text-faint">No hours logged on this day.</p>
        )}
        {entries.map((e) => (
          <DayLogRow
            key={e.id}
            entry={e}
            onDelete={(id) => {
              // remove from the local fetch snapshot too, or the row reappears
              setLoaded((prev) => prev.filter((x) => x.id !== id));
              deleteTimeEntry(id);
            }}
          />
        ))}
      </div>

      <div className="mt-3">
        {recentTasks.length > 0 && !picked && (
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-faint">Recent:</span>
            {recentTasks.map((t) => {
              const c = clients.find((x) => x.id === t.clientId);
              return (
                <button
                  key={t.id}
                  onClick={() => setPicked({ task: t, client: c })}
                  className="flex max-w-40 items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] hover:border-brand hover:text-brand"
                  title={t.title}
                >
                  {c && <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />}
                  <span className="bidi-auto truncate">{t.title}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="1.5h / 90m"
            className={`w-20 shrink-0 rounded-md border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand ${
              duration && minutes == null ? "border-danger" : "border-border"
            }`}
          />
          {picked ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              {picked.client && <ClientChip client={picked.client} size="sm" link={false} />}
              <span className="bidi-auto min-w-0 flex-1 truncate font-medium">{picked.task.title}</span>
              <button onClick={() => setPicked(null)} className="shrink-0 text-muted hover:text-foreground">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <TaskAutocomplete placeholder="Add a line — search a task…" onPickTask={setPicked} />
            </div>
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="What did you do? (required)"
            className="bidi-auto min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-brand"
          />
          <button
            disabled={!canSave}
            onClick={save}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between gap-2 text-sm text-muted">
          <span>{dateIso === todayIso ? "Logged today" : `Logged ${formatFeedDate(dateIso)}`}</span>
          <span className="text-base font-semibold tabular-nums text-foreground">
            {formatHours(dayMinutes)} / {formatHours(targetMinutes)}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-border">
          <div
            className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-brand"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function MyWeek() {
  const { planColumns, planEntries, tasks, clients, currentUserId, openTask } = useData();
  const myColumn = planColumns.find((c) => c.profileId === currentUserId);
  const weekStart = startOfWeek(new Date());
  const todayIso = toISODate(new Date());

  const days = useMemo(
    () => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)), // Sun–Thu
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toISODate(weekStart)],
  );

  if (!myColumn) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-sm">My week</h2>
        <Link href="/plan" className="flex items-center gap-1 text-xs text-brand hover:underline">
          Weekly plan <ArrowRight size={12} />
        </Link>
      </div>
      <div className="flex flex-col gap-1.5">
        {days.map((day) => {
          const iso = toISODate(day);
          const entries = planEntries
            .filter((e) => e.date === iso && e.columnId === myColumn.id)
            .sort((a, b) => a.position - b.position);
          const isToday = iso === todayIso;
          return (
            <div
              key={iso}
              className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${isToday ? "bg-aqua/15 outline outline-1 outline-brand/40" : ""}`}
            >
              <span className={`w-9 shrink-0 pt-0.5 text-xs ${isToday ? "font-bold" : "text-faint"}`}>
                {DAY_NAMES[day.getDay()].slice(0, 3)}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {entries.length === 0 && <span className="text-xs text-faint">—</span>}
                {entries.map((e) => {
                  if (e.type === "absence") {
                    const label =
                      e.absenceType === "sick" ? "Sick" : e.absenceType === "vacation" ? "Vacation" : "Day off";
                    return (
                      <span key={e.id} className="rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600">
                        {label}
                      </span>
                    );
                  }
                  const task = e.taskId ? tasks.find((t) => t.id === e.taskId) : null;
                  const client = e.clientId ? clients.find((c) => c.id === e.clientId) : null;
                  const label = task ? task.title : e.text;
                  return (
                    <button
                      key={e.id}
                      onClick={() => task && openTask(task.id)}
                      className={`bidi-auto max-w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium ${
                        task ? "cursor-pointer text-white" : "border border-dashed border-border-strong text-muted"
                      }`}
                      style={task ? { backgroundColor: client?.color ?? "#6b7280" } : undefined}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface HomeFilter {
  range: { from: string; to: string } | null; // null = all time
  label: string;
  clientId: string;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function MyGraphs({ isAdmin, filter }: { isAdmin: boolean; filter: HomeFilter }) {
  const { entrySums, tasks, clients, currentUserId } = useData();
  const [tab, setTab] = useState<"time" | "client">("time");

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const mine = useMemo(
    () =>
      entrySums.filter((e) => {
        if (e.userId !== currentUserId) return false;
        if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) return false;
        if (filter.clientId && taskById.get(e.taskId)?.clientId !== filter.clientId) return false;
        return true;
      }),
    [entrySums, currentUserId, filter, taskById],
  );

  // hours per day within the filter (≤31 distinct days) or per month otherwise
  const perBucket = useMemo(() => {
    // period-adaptive buckets: month → days, year → months, all-time → months/years
    const days = new Set(mine.map((e) => e.date));
    const months = new Set(mine.map((e) => e.date.slice(0, 7)));
    const byDay = !!filter.range && days.size <= 31;
    const byMonth = !byDay && months.size <= 24;
    const map = new Map<string, { total: number; billable: number }>();
    for (const e of mine) {
      const key = byDay ? e.date : byMonth ? e.date.slice(0, 7) : e.date.slice(0, 4);
      const cur = map.get(key) ?? { total: 0, billable: 0 };
      cur.total += e.minutes;
      if (taskById.get(e.taskId)?.billable) cur.billable += e.minutes;
      map.set(key, cur);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, v]) => ({
        label: byDay
          ? key.slice(8).replace(/^0/, "") + "/" + key.slice(5, 7).replace(/^0/, "")
          : byMonth
            ? MONTH_SHORT[Number(key.slice(5, 7)) - 1]
            : key,
        minutes: v.total,
        billable: isAdmin ? v.billable : undefined,
      }));
  }, [mine, filter.range, taskById, isAdmin]);

  const pieSlices = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of mine) {
      const clientId = taskById.get(e.taskId)?.clientId;
      if (!clientId) continue;
      map.set(clientId, (map.get(clientId) ?? 0) + e.minutes);
    }
    const rows = [...map.entries()]
      .map(([clientId, minutes]) => ({ client: clientById.get(clientId), minutes }))
      .filter((r) => r.client)
      .sort((a, b) => b.minutes - a.minutes);
    const slices = rows
      .slice(0, 6)
      .map((r) => ({ label: r.client!.name, minutes: r.minutes, color: r.client!.color }));
    const rest = rows.slice(6).reduce((s, r) => s + r.minutes, 0);
    if (rest > 0) slices.push({ label: "Other", minutes: rest, color: "#9ca3af" });
    return slices;
  }, [mine, taskById, clientById]);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-heading text-sm" title="Your logged hours in the selected period">
          My hours — {filter.label.toLowerCase()}
        </h2>
        <div className="flex rounded-lg border border-border bg-background p-0.5">
          {(
            [
              ["time", "By time"],
              ["client", "By client"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                tab === k ? "bg-surface text-brand-dark shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "time" ? (
        <MiniColumnsLabeled points={perBucket} />
      ) : pieSlices.length > 0 ? (
        <PieChart slices={pieSlices} />
      ) : (
        <p className="text-sm text-faint">No hours in this scope.</p>
      )}
    </div>
  );
}

/** calendar diff since start date → "Xy Ym Zd" */
function tenureSince(startIso: string): string {
  const start = new Date(startIso);
  const now = new Date();
  let y = now.getFullYear() - start.getFullYear();
  let m = now.getMonth() - start.getMonth();
  let d = now.getDate() - start.getDate();
  if (d < 0) {
    m -= 1;
    d += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  return `${y}y ${m}m ${d}d`;
}

// ── celebrations: birthdays (admin-readable) + work anniversaries ──────────

function Celebrations() {
  const { profiles } = useData();
  const supabase = useMemo(() => createClient(), []);
  const [birthdays, setBirthdays] = useState<{ profile_id: string; birth_date: string }[]>([]);

  useEffect(() => {
    supabase
      .from("member_hr")
      .select("profile_id, birth_date")
      .not("birth_date", "is", null)
      .then(({ data }) => setBirthdays((data as { profile_id: string; birth_date: string }[]) ?? []));
  }, [supabase]);

  const upcoming = useMemo(() => {
    const out: { icon: string; text: string; when: string }[] = [];
    const now = new Date();
    const horizon = 30 * 86400000;
    const nextOccurrence = (iso: string) => {
      const [, m, d] = iso.split("-").map(Number);
      let next = new Date(now.getFullYear(), m - 1, d);
      if (next.getTime() < now.getTime() - 86400000) next = new Date(now.getFullYear() + 1, m - 1, d);
      return next;
    };
    for (const b of birthdays) {
      const p = profiles.find((x) => x.id === b.profile_id);
      if (!p?.active) continue;
      const next = nextOccurrence(b.birth_date);
      if (next.getTime() - now.getTime() <= horizon) {
        out.push({
          icon: "🎂",
          text: `${p.name.split(" ")[0]}'s birthday`,
          when: `${next.getDate()}/${next.getMonth() + 1}`,
        });
      }
    }
    for (const p of profiles) {
      if (!p.active || !p.startDate) continue;
      const next = nextOccurrence(p.startDate);
      const years = next.getFullYear() - Number(p.startDate.slice(0, 4));
      if (years > 0 && next.getTime() - now.getTime() <= horizon) {
        out.push({
          icon: "🎉",
          text: `${p.name.split(" ")[0]} — ${years} year${years > 1 ? "s" : ""} at the studio`,
          when: `${next.getDate()}/${next.getMonth() + 1}`,
        });
      }
    }
    return out.sort((a, b) => a.when.localeCompare(b.when));
  }, [birthdays, profiles]);

  if (upcoming.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-2 font-heading text-sm">Celebrations — next 30 days</h2>
      <div className="flex flex-col gap-1.5">
        {upcoming.map((c, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span>{c.icon}</span>
            <span className="bidi-auto min-w-0 flex-1 truncate">{c.text}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted">{c.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** My avatar next to the greeting; hover reveals an edit overlay → upload. */
function MyAvatar() {
  const { profiles, currentUserId, patchProfileLocal } = useData();
  const me = profiles.find((p) => p.id === currentUserId) ?? null;
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/avatar", { method: "POST", body });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      console.error("avatar upload failed", json.error);
      return;
    }
    if (me) patchProfileLocal(me.id, { avatarUrl: json.avatarUrl });
  }

  return (
    <button
      onClick={() => inputRef.current?.click()}
      className={`group/avatar relative shrink-0 rounded-full ${busy ? "opacity-50" : ""}`}
      title="Change my avatar"
    >
      <Avatar profile={me} size={52} />
      <span className="absolute inset-0 hidden items-center justify-center rounded-full bg-black/40 text-white group-hover/avatar:flex">
        <Pencil size={16} />
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
    </button>
  );
}

const HOME_RANGES = ["This week", "This month", "This year", "All time"] as const;

export function Dashboard() {
  const { profiles, tasks, clients, currentUserId, taskRequests } = useData();
  const me = profiles.find((p) => p.id === currentUserId);
  const isAdmin = me?.role === "admin";

  // page-wide filters
  const [rangeKey, setRangeKey] = useState<(typeof HOME_RANGES)[number]>("This month");
  const [filterClient, setFilterClient] = useState("");
  const filter: HomeFilter = useMemo(
    () => ({
      range: rangeKey === "All time" ? null : presetRange(rangeKey),
      label: rangeKey,
      clientId: filterClient,
    }),
    [rangeKey, filterClient],
  );

  const firstName = me?.name.split(" ")[0] ?? "";
  const today = new Date();
  const dateLabel = `${DAY_NAMES[today.getDay()]}, ${today.getDate()}/${today.getMonth() + 1}`;

  const myTasks = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            t.assigneeId === currentUserId &&
            t.status !== "done" &&
            (!filterClient || t.clientId === filterClient),
        )
        .sort((a, b) => {
          if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return a.position - b.position;
        }),
    [tasks, currentUserId, filterClient],
  );

  const pendingIntake = taskRequests.filter((r) => r.status === "pending").length;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
      <div className="flex items-center gap-3">
        <MyAvatar />
        <div>
          <p className="text-sm text-muted">{dateLabel}</p>
          <h1 className="text-2xl">{firstName}</h1>
          {me?.startDate && (
            <p className="text-xs text-muted" title={`In the studio since ${me.startDate}`}>
              In the studio{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {tenureSince(me.startDate)}
              </span>
            </p>
          )}
        </div>
      </div>

      {isAdmin && pendingIntake > 0 && (
        <Link
          href="/intake-queue"
          className="flex items-center gap-2 rounded-xl bg-aqua px-4 py-3 text-sm font-semibold text-[#06112f] hover:brightness-95"
        >
          <Inbox size={16} strokeWidth={2} />
          {pendingIntake} intake request{pendingIntake > 1 ? "s" : ""} waiting for review
          <ArrowRight size={15} className="ml-auto" />
        </Link>
      )}

      {/* page-wide filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        {HOME_RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRangeKey(r)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              rangeKey === r
                ? "border-brand bg-brand-soft text-brand-dark"
                : "border-border bg-surface text-muted hover:border-border-strong"
            }`}
          >
            {r}
          </button>
        ))}
        <select
          value={filterClient}
          onChange={(e) => setFilterClient(e.target.value)}
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
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h2 className="font-heading text-sm">My tasks ({myTasks.length})</h2>
              <Link href="/my-tasks" className="flex items-center gap-1 text-xs text-brand hover:underline">
                All tasks <ArrowRight size={12} />
              </Link>
            </div>
            {myTasks.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-faint">Nothing assigned to you right now.</p>
            )}
            {myTasks.length > 0 && <TaskTable tasks={myTasks.slice(0, 8)} tableKey="home-tasks" />}
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-[400px]">
          <PeriodStat isAdmin={isAdmin} filter={filter} rangeKey={rangeKey} />
          <MyGraphs isAdmin={isAdmin} filter={filter} />
          <DayLog />
          <MyWeek />
          <Celebrations />
        </div>
      </div>
    </div>
  );
}
