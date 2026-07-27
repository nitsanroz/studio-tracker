"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Inbox, Pencil, X } from "lucide-react";
import { useData } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import { mapTimeEntry } from "@/lib/db";
import {
  addDays,
  formatFeedDate,
  formatHours,
  formatHoursAvg,
  formatHoursShort,
  parseDuration,
  startOfWeek,
  toISODate,
  DAY_NAMES,
} from "@/lib/format";
import { TaskAutocomplete, type TaskMatch } from "./task-autocomplete";
import { MemberPhoto } from "./member-photo";
import { ConfirmDetailsBanner } from "./confirm-details-banner";
import { Avatar, ClientChip } from "./ui";
import { HBar, MiniColumnsLabeled, MultiLineChart, PercentRing, PieChart } from "./charts";
import type { TimeEntry } from "@/lib/types";

/** Full calendar bounds of a period, `offset` steps from the current one
 *  (0 = current, −1 = previous, …). null for "All time". */
function periodBounds(
  rangeKey: (typeof HOME_RANGES)[number],
  offset: number,
): { start: Date; end: Date } | null {
  const now = new Date();
  switch (rangeKey) {
    case "This week": {
      const start = addDays(startOfWeek(now), offset * 7);
      return { start, end: addDays(start, 6) };
    }
    case "This month":
      return {
        start: new Date(now.getFullYear(), now.getMonth() + offset, 1),
        end: new Date(now.getFullYear(), now.getMonth() + offset + 1, 0),
      };
    case "This year":
      return {
        start: new Date(now.getFullYear() + offset, 0, 1),
        end: new Date(now.getFullYear() + offset, 11, 31),
      };
    default:
      return null; // All time
  }
}

/** whole calendar days from a → b (both floored to local midnight) */
function daysBetween(a: Date, b: Date): number {
  const ms =
    new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() -
    new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  return Math.round(ms / 86_400_000);
}

/** Human label for the selected period, e.g. "This month", "Last week", "March", "2025". */
function rangeLabel(rangeKey: (typeof HOME_RANGES)[number], offset: number): string {
  if (rangeKey === "All time") return "All time";
  if (offset === 0) return rangeKey;
  if (offset === -1) return rangeKey === "This week" ? "Last week" : rangeKey === "This month" ? "Last month" : "Last year";
  const b = periodBounds(rangeKey, offset)!;
  if (rangeKey === "This week") {
    return `${b.start.getDate()}/${b.start.getMonth() + 1}–${b.end.getDate()}/${b.end.getMonth() + 1}`;
  }
  if (rangeKey === "This month") {
    const now = new Date();
    const m = MONTH_SHORT[b.start.getMonth()];
    return b.start.getFullYear() === now.getFullYear() ? m : `${m} ${b.start.getFullYear()}`;
  }
  return String(b.start.getFullYear());
}

/**
 * The comparable previous range for the "vs last period" delta. When the
 * selected period is still ongoing (partial), the previous range is truncated
 * to the SAME elapsed portion — e.g. this month up to the 15th compares against
 * last month up to the 15th, not the whole of last month.
 */
function comparablePrevRange(
  rangeKey: (typeof HOME_RANGES)[number],
  offset: number,
): { from: string; to: string } | null {
  const sel = periodBounds(rangeKey, offset);
  const prev = periodBounds(rangeKey, offset - 1);
  if (!sel || !prev) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let prevEnd = prev.end;
  const ongoing = today >= sel.start && today < sel.end; // period contains today, not yet over
  if (ongoing) {
    const candidate = addDays(prev.start, daysBetween(sel.start, today));
    if (candidate < prevEnd) prevEnd = candidate;
  }
  return { from: toISODate(prev.start), to: toISODate(prevEnd) };
}

/** Hours in the selected period (admins: studio-wide, users: their own) + delta vs last period. */
function PeriodStat({
  isAdmin,
  filter,
  prevRange,
}: {
  isAdmin: boolean;
  filter: HomeFilter;
  prevRange: { from: string; to: string } | null;
}) {
  const { entrySums, tasks, currentUserId } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const stats = useMemo(() => {
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
  }, [entrySums, taskById, isAdmin, currentUserId, filter, prevRange]);

  const billablePct = stats.cur > 0 ? Math.round((stats.curBillable / stats.cur) * 100) : null;
  // split "353.8h" into figure + unit so the unit renders smaller (Figma round-trip)
  const hoursStr = formatHoursShort(stats.cur);
  const [, hoursFigure, hoursUnit] = hoursStr.match(/^([\d.,]+)(.*)$/) ?? [null, hoursStr, ""];

  const delta = stats.delta != null && (
    <p
      className={`mt-1 text-xs font-semibold tabular-nums ${stats.delta >= 0 ? "text-success" : "text-danger"}`}
      title={`Last period: ${formatHoursShort(stats.prev)}`}
    >
      {stats.delta >= 0 ? "+" : ""}
      {Math.round(stats.delta * 100)}% vs last period
    </p>
  );

  // ── members: unchanged compact stat ──────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between gap-4">
          <div className="shrink-0" title="Your logged hours in the selected period">
            <div className="font-serif-accent text-2xl leading-tight">My hours</div>
            <p className="text-xs text-muted">{filter.label.toLowerCase()}</p>
          </div>
          <div className="text-right">
            <div className="font-serif-accent text-4xl leading-none">
              {hoursFigure}
              <span className="text-2xl">{hoursUnit}</span>
            </div>
            {delta}
          </div>
        </div>
      </div>
    );
  }

  // ── admins: heading-style title, big hours, billable ring, this/last bars ─
  const maxBar = Math.max(stats.cur, stats.prev, 1);
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="mb-3 font-heading text-sm" title="All hours logged across the studio in the selected period">
        Studio · {filter.label}
      </h2>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="font-serif-accent text-4xl leading-none">
            {hoursFigure}
            <span className="text-2xl">{hoursUnit}</span>
          </div>
          {delta}
          <p className="mt-1 text-xs text-muted">Hours logged</p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1" title="Share of hours on billable tasks">
          <PercentRing pct={billablePct ?? 0} size={116} label="Billable share" />
          <span className="text-xs text-muted">Billable</span>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2.5 border-t border-border pt-4">
        {/* hours already shown big above → the bar stays purely visual */}
        <HBar label="This period" minutes={stats.cur} maxMinutes={maxBar} barClass="bg-brand" />
        {prevRange && (
          <HBar
            label={<span className="text-muted">Last period</span>}
            right={formatHoursShort(stats.prev)}
            minutes={stats.prev}
            maxMinutes={maxBar}
            barClass="bg-brand/30"
          />
        )}
      </div>
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
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
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
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-sm">My week</h2>
        <Link href="/plan" className="flex items-center gap-1 text-xs text-brand hover:underline">
          Weekly plan <ArrowRight size={12} />
        </Link>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {days.map((day) => {
          const iso = toISODate(day);
          const entries = planEntries
            .filter((e) => e.date === iso && e.columnId === myColumn.id)
            .sort((a, b) => a.position - b.position);
          const isToday = iso === todayIso;
          return (
            <div
              key={iso}
              className={`flex min-h-[132px] flex-col gap-1 rounded-xl border p-2.5 ${
                isToday ? "border-brand bg-brand text-white" : "border-border bg-background"
              }`}
            >
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide ${isToday ? "text-white/80" : "text-faint"}`}
              >
                {DAY_NAMES[day.getDay()].slice(0, 3)}
              </span>
              <span className="text-base font-bold leading-none">{day.getDate()}</span>
              <div className="mt-1 flex flex-col gap-1">
                {entries.length === 0 && (
                  <span className={`text-[11px] ${isToday ? "text-white/50" : "text-faint"}`}>—</span>
                )}
                {entries.map((e) => {
                  if (e.type === "absence") {
                    const label =
                      e.absenceType === "sick" ? "Sick" : e.absenceType === "vacation" ? "Vacation" : "Day off";
                    return (
                      <span
                        key={e.id}
                        className={`truncate rounded px-1.5 py-0.5 text-[10px] ${
                          isToday ? "bg-white/20 text-white" : "bg-gray-200 text-gray-600"
                        }`}
                      >
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
                      title={label}
                      className={`bidi-auto block max-w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium ${
                        task
                          ? "cursor-pointer text-white"
                          : isToday
                            ? "border border-dashed border-white/50 text-white/90"
                            : "border border-dashed border-border-strong text-muted"
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

/** Period-adaptive time buckets: day (≤31d range), else month (≤24), else year. */
function bucketize(dates: string[], hasRange: boolean) {
  const byDay = hasRange && new Set(dates).size <= 31;
  const byMonth = !byDay && new Set(dates.map((d) => d.slice(0, 7))).size <= 24;
  const keyFor = (date: string) => (byDay ? date : byMonth ? date.slice(0, 7) : date.slice(0, 4));
  const labelFor = (key: string) =>
    byDay
      ? key.slice(8).replace(/^0/, "") + "/" + key.slice(5, 7).replace(/^0/, "")
      : byMonth
        ? MONTH_SHORT[Number(key.slice(5, 7)) - 1]
        : key;
  return { keyFor, labelFor };
}

function MyGraphs({ filter, isAdmin }: { filter: HomeFilter; isAdmin: boolean }) {
  const { entrySums, tasks, clients, currentUserId } = useData();

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  // admins see the whole studio; members see only their own hours
  const scoped = useMemo(
    () =>
      entrySums.filter((e) => {
        if (!isAdmin && e.userId !== currentUserId) return false;
        if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) return false;
        if (filter.clientId && taskById.get(e.taskId)?.clientId !== filter.clientId) return false;
        return true;
      }),
    [entrySums, currentUserId, isAdmin, filter, taskById],
  );

  const perBucket = useMemo(() => {
    const { keyFor, labelFor } = bucketize(scoped.map((e) => e.date), !!filter.range);
    const map = new Map<string, number>();
    for (const e of scoped) map.set(keyFor(e.date), (map.get(keyFor(e.date)) ?? 0) + e.minutes);
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, minutes]) => ({ label: labelFor(key), minutes }));
  }, [scoped, filter.range]);

  const pieSlices = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of scoped) {
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
  }, [scoped, taskById, clientById]);

  return (
    <>
      {/* by time */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <h2 className="mb-3 font-heading text-sm" title="Your logged hours over the selected period">
          Hours over time
        </h2>
        {perBucket.length > 0 ? (
          <MiniColumnsLabeled points={perBucket} />
        ) : (
          <p className="text-sm text-faint">No hours in this scope.</p>
        )}
      </div>

      {/* by client */}
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <h2 className="mb-3 font-heading text-sm" title="Your hours split by client">
          Hours by client
        </h2>
        {pieSlices.length > 0 ? (
          <PieChart slices={pieSlices} />
        ) : (
          <p className="text-sm text-faint">No hours in this scope.</p>
        )}
      </div>
    </>
  );
}

/** Admin overview: studio hours per client over time — one colored line per client. */
function StudioClientTrend({ filter }: { filter: HomeFilter }) {
  const { entrySums, tasks, clients } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const { labels, series } = useMemo(() => {
    const scoped = entrySums.filter((e) => {
      if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) return false;
      if (filter.clientId && taskById.get(e.taskId)?.clientId !== filter.clientId) return false;
      return true;
    });
    const { keyFor, labelFor } = bucketize(scoped.map((e) => e.date), !!filter.range);
    const keys = [...new Set(scoped.map((e) => keyFor(e.date)))].sort();

    const totalByClient = new Map<string, number>();
    const byClientBucket = new Map<string, Map<string, number>>();
    for (const e of scoped) {
      const cid = taskById.get(e.taskId)?.clientId;
      if (!cid) continue;
      totalByClient.set(cid, (totalByClient.get(cid) ?? 0) + e.minutes);
      let m = byClientBucket.get(cid);
      if (!m) {
        m = new Map();
        byClientBucket.set(cid, m);
      }
      const k = keyFor(e.date);
      m.set(k, (m.get(k) ?? 0) + e.minutes);
    }
    const top = [...totalByClient.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([cid]) => cid);
    const series = top.map((cid) => {
      const c = clientById.get(cid);
      const m = byClientBucket.get(cid)!;
      return { label: c?.name ?? "?", color: c?.color ?? "#9ca3af", values: keys.map((k) => m.get(k) ?? 0) };
    });
    return { labels: keys.map(labelFor), series };
  }, [entrySums, filter, taskById, clientById]);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="mb-3 font-heading text-sm" title="Studio hours per client over the selected period">
        Hours by client over time
      </h2>
      {series.length > 0 ? (
        <MultiLineChart labels={labels} series={series} totalLabel={`top clients · ${filter.label.toLowerCase()}`} />
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

type ApiOccasion = { kind: "birthday" | "anniversary"; name: string; monthDay: string; years?: number };

function Celebrations() {
  const [raw, setRaw] = useState<ApiOccasion[]>([]);
  const [at, setAt] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/celebrations")
      .then((r) => (r.ok ? r.json() : { occasions: [] }))
      .then((d) => {
        if (alive) setRaw(d.occasions ?? []);
      })
      .catch(() => {
        /* non-fatal: the pane simply doesn't render */
      });
    return () => {
      alive = false;
    };
  }, []);

  const upcoming = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const horizon = 30 * 86400000;
    const out: { icon: string; text: string; when: string; at: number }[] = [];

    for (const o of raw) {
      const [m, d] = o.monthDay.split("-").map(Number);
      if (!m || !d) continue;
      // Roll to next year once the date has passed, so December dates surface in January.
      let next = new Date(today.getFullYear(), m - 1, d);
      if (next.getTime() < today.getTime()) next = new Date(today.getFullYear() + 1, m - 1, d);
      const delta = next.getTime() - today.getTime();
      if (delta > horizon) continue;

      // Anniversary count is recomputed against the occurrence year — the API's
      // `years` is relative to the current year, which is wrong for a date that
      // has rolled into next year.
      const years = o.years != null ? o.years + (next.getFullYear() - today.getFullYear()) : null;
      out.push({
        icon: o.kind === "birthday" ? "🎂" : "🎉",
        text:
          o.kind === "birthday"
            ? `${o.name}'s birthday`
            : `${o.name} — ${years} year${years === 1 ? "" : "s"} at the studio`,
        when: `${next.getDate()}/${next.getMonth() + 1}`,
        at: next.getTime(),
      });
    }
    // Sort on the timestamp: the old code compared the formatted "D/M" string, so
    // "10/8" sorted before "9/8".
    return out.sort((a, b) => a.at - b.at);
  }, [raw]);

  if (upcoming.length === 0) return null;

  const idx = Math.min(at, upcoming.length - 1);
  const cur = upcoming[idx];
  const many = upcoming.length > 1;

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-heading text-sm">Coming up — next 30 days</h2>
        {many && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 text-xs tabular-nums text-faint">
              {idx + 1}/{upcoming.length}
            </span>
            <button
              onClick={() => setAt((v) => (v - 1 + upcoming.length) % upcoming.length)}
              aria-label="Previous"
              className="rounded-md border border-border p-0.5 text-muted hover:border-brand hover:text-brand"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setAt((v) => (v + 1) % upcoming.length)}
              aria-label="Next"
              className="rounded-md border border-border p-0.5 text-muted hover:border-brand hover:text-brand"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-1 items-center gap-3">
        <span className="text-2xl">{cur.icon}</span>
        <span className="bidi-auto min-w-0 flex-1 text-sm font-medium">{cur.text}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted">{cur.when}</span>
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

/** figure + unit split so the unit renders smaller, e.g. "353.8" + "h" */
function splitHours(min: number, avg = false): readonly [string, string] {
  const s = avg ? formatHoursAvg(min) : formatHoursShort(min);
  const m = s.match(/^([\d.,]+)(.*)$/);
  return m ? [m[1], m[2]] : [s, ""];
}

function StatTile({
  hi = false,
  label,
  figure,
  unit = "",
  delta,
  sub,
}: {
  hi?: boolean;
  label: string;
  figure: string;
  unit?: string;
  delta?: { value: number; unit: string } | null;
  sub?: string;
}) {
  const up = delta ? delta.value >= 0 : true;
  return (
    <div
      className={`rounded-2xl border p-4 shadow-card ${hi ? "border-brand bg-brand text-white" : "border-border bg-surface"}`}
    >
      <div className={`text-[11px] uppercase tracking-wide ${hi ? "text-white/80" : "text-muted"}`}>
        {label}
      </div>
      <div className="mt-1.5 font-serif-accent text-[32px] leading-none">
        {figure}
        {unit && <span className="text-xl">{unit}</span>}
      </div>
      <div className={`mt-2.5 flex items-center gap-1.5 text-[11px] ${hi ? "text-white/85" : "text-muted"}`}>
        {delta ? (
          <>
            <span
              className={`rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${
                hi ? "bg-white/20 text-white" : up ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
              }`}
            >
              {up ? "▲" : "▼"} {Math.abs(delta.value)}
              {delta.unit}
            </span>
            <span>vs last</span>
          </>
        ) : sub ? (
          <span>{sub}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Studio-wide KPI tiles for admins: hours, billable, active tasks, avg/designer. */
function StatTiles({ filter, prevRange }: { filter: HomeFilter; prevRange: { from: string; to: string } | null }) {
  const { entrySums, tasks } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const s = useMemo(() => {
    let cur = 0,
      curB = 0,
      prev = 0,
      prevB = 0;
    const designers = new Set<string>();
    const worked = new Set<string>();
    for (const e of entrySums) {
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) continue;
      const inCur = !filter.range || (e.date >= filter.range.from && e.date <= filter.range.to);
      if (inCur) {
        cur += e.minutes;
        if (task?.billable) curB += e.minutes;
        if (e.minutes > 0) {
          designers.add(e.userId);
          worked.add(e.taskId);
        }
      } else if (prevRange && e.date >= prevRange.from && e.date <= prevRange.to) {
        prev += e.minutes;
        if (task?.billable) prevB += e.minutes;
      }
    }
    return { cur, curB, prev, prevB, designers: designers.size, worked: worked.size };
  }, [entrySums, taskById, filter, prevRange]);

  const hoursDelta = prevRange && s.prev > 0 ? Math.round(((s.cur - s.prev) / s.prev) * 100) : null;
  const curPct = s.cur > 0 ? Math.round((s.curB / s.cur) * 100) : 0;
  const prevPct = s.prev > 0 ? Math.round((s.prevB / s.prev) * 100) : null;
  const pctDelta = prevPct != null ? curPct - prevPct : null;
  const perDesigner = s.designers > 0 ? s.cur / s.designers : 0;

  const [hFig, hUnit] = splitHours(s.cur);
  const [pdFig, pdUnit] = splitHours(perDesigner, true);

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatTile hi label="Studio hours" figure={hFig} unit={hUnit} delta={hoursDelta != null ? { value: hoursDelta, unit: "%" } : null} sub="this period" />
      <StatTile label="Billable" figure={String(curPct)} unit="%" delta={pctDelta != null ? { value: pctDelta, unit: "pp" } : null} sub="of hours" />
      <StatTile label="Tasks worked" figure={String(s.worked)} sub="this period" />
      <StatTile label="Avg / designer" figure={pdFig} unit={pdUnit} sub={`${s.designers} designer${s.designers === 1 ? "" : "s"}`} />
    </div>
  );
}

/** Compact studio roster on the admin home: per-designer hours + billable bar. */
function StudioTeamStrip({ filter }: { filter: HomeFilter }) {
  const { entrySums, tasks, profiles } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const rows = useMemo(() => {
    const per = new Map<string, { min: number; bil: number }>();
    for (const e of entrySums) {
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) continue;
      if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) continue;
      const r = per.get(e.userId) ?? { min: 0, bil: 0 };
      r.min += e.minutes;
      if (task?.billable) r.bil += e.minutes;
      per.set(e.userId, r);
    }
    return profiles
      .filter((p) => p.active)
      .map((p) => {
        const r = per.get(p.id) ?? { min: 0, bil: 0 };
        return { p, min: r.min, pct: r.min > 0 ? Math.round((r.bil / r.min) * 100) : 0 };
      })
      .filter((x) => x.min > 0)
      .sort((a, b) => b.min - a.min);
  }, [entrySums, taskById, profiles, filter]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-sm">
          The studio · {rows.length} designer{rows.length === 1 ? "" : "s"}
        </h2>
        <Link href="/team" className="flex items-center gap-1 text-xs text-brand hover:underline">
          View team <ArrowRight size={12} />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        {rows.map(({ p, min, pct }) => (
          <Link
            key={p.id}
            href={`/team/${p.id}`}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-background p-3 hover:border-brand"
          >
            <Avatar profile={p} size={40} />
            <span className="max-w-full truncate text-xs font-semibold">{p.name.split(" ")[0]}</span>
            <span className="text-[10px] tabular-nums text-muted">
              {formatHoursShort(min)} · {pct}%
            </span>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
              <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Member welcome: blue hero with the member's cut-out photo + this-week summary, then 3 KPI tiles. */
function MemberWelcome({
  me,
  filter,
}: {
  me: { id: string; name: string; photoUrl: string | null };
  filter: HomeFilter;
}) {
  const { entrySums, tasks } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // The hero copy stays week-scoped ("This week" is the point of it); the tiles
  // beside it follow the page's period/client filter.
  const wk = useMemo(() => {
    const start = startOfWeek(new Date());
    const from = toISODate(start);
    const to = toISODate(addDays(start, 6));
    let min = 0;
    for (const e of entrySums) {
      if (e.userId !== me.id || e.date < from || e.date > to) continue;
      min += e.minutes;
    }
    return { min, from, to };
  }, [entrySums, me.id]);

  const scoped = useMemo(() => {
    let min = 0;
    let bil = 0;
    const byDate = new Map<string, number>();
    for (const e of entrySums) {
      if (e.userId !== me.id) continue;
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) continue;
      if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) continue;
      min += e.minutes;
      if (task?.billable) bil += e.minutes;
      byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.minutes);
    }
    // A day counts as a full day at 4h+, otherwise a half — same rule as before.
    let days = 0;
    for (const m of byDate.values()) days += m >= 240 ? 1 : m > 0 ? 0.5 : 0;
    return {
      min,
      days,
      pct: min > 0 ? Math.round((bil / min) * 100) : 0,
      perDay: byDate.size > 0 ? min / byDate.size : 0,
    };
  }, [entrySums, taskById, me.id, filter]);

  const myActive = useMemo(
    () => tasks.filter((t) => t.assigneeId === me.id && t.status !== "done"),
    [tasks, me.id],
  );
  const dueThisWeek = myActive.filter(
    (t) => t.dueDate && t.dueDate >= wk.from && t.dueDate <= wk.to,
  ).length;

  const [hFig, hUnit] = splitHours(scoped.min);
  const [adFig, adUnit] = splitHours(scoped.perDay, true);

  return (
    <div className="grid items-stretch gap-4 lg:grid-cols-2">
      {/* mt-9 is the room the portrait's head needs above the panel. The hero can't
          clip (the head breaks out of the top), so the decorative disc gets its own
          clipping layer instead of relying on overflow-hidden here. */}
      <div
        className="relative mt-9 rounded-2xl bg-brand px-6 py-6 text-white"
        style={{ minHeight: 208, boxShadow: "var(--shadow-hero)" }}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -top-12 right-24 size-64 rounded-full bg-white/[0.06]" />
        </div>
        <div className="relative z-10 pr-32">
          <div className="text-[11px] uppercase tracking-[0.09em] text-white/70">This week</div>
          <h2 className="mt-2 font-heading text-[22px] leading-snug">
            You’ve logged {formatHoursShort(wk.min)} across {myActive.length} active task
            {myActive.length === 1 ? "" : "s"}
            {dueThisWeek > 0 ? ` — ${dueThisWeek} due this week.` : "."}
          </h2>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href="#log"
              className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-brand hover:brightness-95"
            >
              + Log time
            </a>
            <Link
              href="/plan"
              className="rounded-xl border border-white/50 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              My week
            </Link>
          </div>
        </div>
        {/* Anchored top AND bottom with a negative top, so the figure is always the
            panel's height plus 34px and the head clears the top edge. A fixed pixel
            height doesn't work: `items-stretch` grows this panel to match the tile
            column beside it, so its height isn't known here. */}
        <div
          className="pointer-events-none absolute z-20 hidden sm:block"
          style={{ top: -34, bottom: 0, right: 5, width: 176 }}
        >
          <MemberPhoto name={me.name} src={me.photoUrl} variant="hero" fill />
        </div>
      </div>

      <div className="mt-9 grid grid-cols-2 gap-4">
        <StatTile label="My hours" figure={hFig} unit={hUnit} sub={filter.label.toLowerCase()} />
        <StatTile label="Billable" figure={String(scoped.pct)} unit="%" sub={filter.label.toLowerCase()} />
        <StatTile label="Days in studio" figure={String(scoped.days)} sub={filter.label.toLowerCase()} />
        <StatTile label="Avg / day" figure={adFig} unit={adUnit} sub="days logged" />
      </div>
    </div>
  );
}

const HOME_RANGES = ["This week", "This month", "This year", "All time"] as const;

export function Dashboard() {
  const { profiles, tasks, clients, currentUserId, taskRequests, openTask } = useData();
  const me = profiles.find((p) => p.id === currentUserId);
  const isAdmin = me?.role === "admin";

  // page-wide filters — rangeKey picks the unit, periodOffset walks it (0 = current)
  const [rangeKey, setRangeKey] = useState<(typeof HOME_RANGES)[number]>("This month");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [filterClient, setFilterClient] = useState("");
  const filter: HomeFilter = useMemo(() => {
    const b = periodBounds(rangeKey, periodOffset);
    return {
      range: b ? { from: toISODate(b.start), to: toISODate(b.end) } : null,
      label: rangeLabel(rangeKey, periodOffset),
      clientId: filterClient,
    };
  }, [rangeKey, periodOffset, filterClient]);
  const prevRange = useMemo(
    () => comparablePrevRange(rangeKey, periodOffset),
    [rangeKey, periodOffset],
  );
  const canNavigate = rangeKey !== "All time";

  const firstName = me?.name.split(" ")[0] ?? "";
  const today = new Date();
  const dateLabel = `${DAY_NAMES[today.getDay()]}, ${today.getDate()}/${today.getMonth() + 1}`;
  const hour = today.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

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

  // My tasks demoted to a compact list on the home (the full table lives on /my-tasks)
  const compactTasksCard = (
    <div className="rounded-2xl border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="font-heading text-sm">My tasks ({myTasks.length})</h2>
        <Link href="/my-tasks" className="flex items-center gap-1 text-xs text-brand hover:underline">
          All tasks <ArrowRight size={12} />
        </Link>
      </div>
      {myTasks.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-faint">Nothing assigned to you right now.</p>
      ) : (
        <div className="divide-y divide-border">
          {myTasks.slice(0, 4).map((t) => {
            const c = clients.find((x) => x.id === t.clientId);
            return (
              <button
                key={t.id}
                onClick={() => openTask(t.id)}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-background"
              >
                {c && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />}
                <span className="bidi-auto min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                {t.dueDate && (
                  <span className="shrink-0 text-xs tabular-nums text-muted">{formatFeedDate(t.dueDate)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-4">
      {/* header row: greeting + display stats + page-wide filters (per Figma round-trip) */}
      <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
        <div className="flex items-center gap-3">
          <MyAvatar />
          <div>
            <p className="text-sm text-muted" title={dateLabel}>
              {greeting}
            </p>
            <h1 className="font-serif-accent text-[26px] leading-8">{firstName}</h1>
          </div>
        </div>
        {me?.startDate && (
          <div title={`In the studio since ${me.startDate}`}>
            <div className="font-serif-accent text-[30px] leading-9">
              {tenureSince(me.startDate)
                .split(" ")
                .map((part) => (
                  <span key={part} className="mr-1.5 last:mr-0">
                    {part.slice(0, -1)}
                    <span className="text-base">{part.slice(-1)}</span>
                  </span>
                ))}
            </div>
            <p className="text-xs text-muted">In the studio</p>
          </div>
        )}
        <div>
          <div className="font-serif-accent text-[30px] leading-9">{myTasks.length}</div>
          <p className="text-xs text-muted">Tasks assigned</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {HOME_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => {
                setRangeKey(r);
                setPeriodOffset(0);
              }}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                rangeKey === r
                  ? "border-brand bg-brand-soft text-brand-dark"
                  : "border-border bg-surface text-muted hover:border-border-strong"
              }`}
            >
              {r}
            </button>
          ))}
          {/* step the selected period back/forward */}
          {canNavigate && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPeriodOffset((o) => o - 1)}
                title="Previous period"
                className="rounded-md border border-border bg-surface p-1.5 text-muted hover:border-border-strong hover:text-foreground"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="min-w-[72px] text-center text-xs font-medium tabular-nums" title="Selected period">
                {filter.label}
              </span>
              <button
                onClick={() => setPeriodOffset((o) => Math.min(0, o + 1))}
                disabled={periodOffset >= 0}
                title="Next period"
                className="rounded-md border border-border bg-surface p-1.5 text-muted hover:border-border-strong hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight size={15} />
              </button>
              {periodOffset !== 0 && (
                <button
                  onClick={() => setPeriodOffset(0)}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted hover:border-brand hover:text-brand"
                >
                  Now
                </button>
              )}
            </div>
          )}
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

      {isAdmin ? (
        <>
          {/* KPI tiles across the top */}
          <StatTiles filter={filter} prevRange={prevRange} />
          {/* Up here with the intake banner, not at the foot of the page — an
              upcoming date is only useful if you see it before the day arrives. */}
          <div className="empty:hidden">
            <Celebrations />
          </div>
          {/* analytics 2×2 — hours over time / by client, then client-trend + my tasks */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MyGraphs filter={filter} isAdmin={isAdmin} />
            <StudioClientTrend filter={filter} />
            {compactTasksCard}
          </div>
          {/* the studio roster */}
          <StudioTeamStrip filter={filter} />
        </>
      ) : (
        <>
          <ConfirmDetailsBanner />
          {me && <MemberWelcome me={me} filter={filter} />}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <MyWeek />
            {compactTasksCard}
          </div>
          {/* Celebrations sits beside "Log my hours" rather than at the foot of the
              page — nobody scrolled that far, so upcoming dates went unseen. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div id="log" className="scroll-mt-20 lg:col-span-2">
              <DayLog />
            </div>
            <Celebrations />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <MyGraphs filter={filter} isAdmin={false} />
            </div>
            <PeriodStat isAdmin={false} filter={filter} prevRange={prevRange} />
          </div>
        </>
      )}
    </div>
  );
}
