"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Inbox, Pencil, PencilLine, X } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import {
  addDays,
  formatFeedDate,
  formatHours,
  formatHoursAvg,
  formatHoursShort,
  greetingFor,
  parseDuration,
  startOfWeek,
  toISODate,
  DAY_NAMES,
} from "@/lib/format";
import {
  HOME_RANGES,
  bucketProjection,
  bucketize,
  comparablePrevRange,
  periodBounds,
  rangeLabel,
} from "@/lib/period-math";
import { TaskAutocomplete, type TaskMatch } from "./task-autocomplete";
import { MemberPhoto } from "./member-photo";
import { ConfirmDetailsBanner } from "./confirm-details-banner";
import { Avatar, ClientChip, InfoDot, Tabs } from "./ui";
import { MiniColumnsLabeled, MultiLineChart, PieChart } from "./charts";
import { PeriodStepper } from "./period-stepper";
import { WeekTimesheet } from "./week-timesheet";
import { MobileLogTimeSheet } from "./mobile-log-time";
import { MemberWeekHours } from "./member-week-hours";
import { dailyTargetMinutes } from "@/lib/members";
import { needsReview } from "@/lib/brief-diff";
import { useIsNarrow } from "@/lib/use-is-narrow";
import type { Profile, TimeEntry } from "@/lib/types";

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
      {/* link={false}: clicking the row opens the inline editor, so a navigating
          chip inside it would be a trap rather than a shortcut */}
      {client && (
        <span className="max-w-28 shrink-0 truncate">
          <ClientChip client={client} size="sm" link={false} />
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
  const { addTimeEntry, deleteTimeEntry, loadDayEntries, timeEntries, tasks, clients, currentUserId, profiles } =
    useData();
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
    loadDayEntries(currentUserId, dateIso).then((rows) => {
      if (cancelled) return;
      setLoaded(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadDayEntries, currentUserId, dateIso]);

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
  // the same rule the phone's log-time sheet shows — see `dailyTargetMinutes`
  const targetMinutes = dailyTargetMinutes(me);
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
  const narrow = useIsNarrow();
  const myColumn = planColumns.find((c) => c.profileId === currentUserId);
  const weekStart = startOfWeek(new Date());
  const weekStartIso = toISODate(weekStart);
  const todayIso = toISODate(new Date());

  // On a phone the days already behind you are dead weight in a pane that has to
  // earn its screen — the week ahead is the only part you can still act on.
  // ⚠️ The fallback matters: the studio week is Sun–Thu, so on a Friday or a
  // Saturday EVERY card is in the past and filtering would leave an empty pane.
  // Showing the whole week there is the honest reading of "nothing left".
  const days = useMemo(() => {
    const all = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)); // Sun–Thu
    if (!narrow) return all;
    const ahead = all.filter((d) => toISODate(d) >= todayIso);
    return ahead.length > 0 ? ahead : all;
    // `weekStartIso` stands in for `weekStart`, whose Date identity changes on
    // every render while the day it names does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartIso, narrow, todayIso]);

  if (!myColumn) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-sm">My week</h2>
        <Link href="/plan" className="flex items-center gap-1 text-xs text-brand hover:underline">
          Weekly plan <ArrowRight size={12} />
        </Link>
      </div>
      {/* Five day-cards at 375px give each about 63px — a weekday label and an
          hours figure do not fit, and the figure is the point. Below `md` they
          run as a row at a readable width instead of being squeezed.
          ⚠️ The breakpoint here must match `useIsNarrow` (768), NOT `sm`: the
          card count varies below it, and `grid-cols-5` would lay two remaining
          days out in fifths of the width. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
        {days.map((day) => {
          const iso = toISODate(day);
          const entries = planEntries
            .filter((e) => e.date === iso && e.columnId === myColumn.id)
            .sort((a, b) => a.position - b.position);
          const isToday = iso === todayIso;
          return (
            <div
              key={iso}
              // `w-64 shrink-0 grow` only matters in the row below `md`; in the
              // grid above it the track width wins and these are inert. `grow`
              // is what makes a short week (two days left) fill the width
              // instead of leaving 200px of nothing — with all five the basis
              // already exceeds the screen, so nothing grows and it scrolls.
              //
              // ⚠️ On a phone the card is 256px and the DAY sits beside its work
              // rather than above it: the row below `md` shows only today onwards,
              // so there are two or three cards holding a whole day's chips, and
              // a 128px column wrapped every task title. Above `md` it is five
              // cards in a grid and the stack is the only thing that fits.
              className={`flex min-h-[132px] w-64 shrink-0 grow gap-2 rounded-xl border p-2.5 md:w-auto md:grow-0 md:flex-col md:gap-1 ${
                isToday ? "border-brand bg-brand text-white" : "border-border bg-background"
              }`}
            >
              {/* ⚠️ `md:contents` — at ≥768px this wrapper leaves the layout
                  entirely, so the label and the date become direct children of
                  the card's own `flex-col` again and the desktop card is
                  byte-identical. Rendering it conditionally would be two card
                  layouts to keep in step. */}
              <div className="flex min-w-0 flex-1 flex-col md:contents">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide ${isToday ? "text-white/80" : "text-faint"}`}
                >
                  {DAY_NAMES[day.getDay()].slice(0, 3)}
                </span>
                <span className="text-base font-bold leading-none">{day.getDate()}</span>
              </div>
              {/* ⚠️ The WORK column is the one given the width — `w-4/5` on it and
                  `flex-1` on the day beside it, not the other way round. Sizing
                  the day at 1/5 instead left the work 70% of the card, because
                  the 20px of padding and the 8px gap come off the total before
                  the fraction is taken. It starts at the TOP of that column. */}
              <div className="flex w-4/5 shrink-0 flex-col gap-1 md:mt-1 md:w-auto">
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
  /**
   * Admin toggle: when on, every hour figure on the page counts BILLABLE tasks
   * only. The two billable-SHARE readouts (the Billable tile, the per-designer
   * bars) deliberately keep their denominator on all hours — a share of a
   * billable-only total is 100% by construction and would say nothing.
   */
  billableOnly: boolean;
}

/** Clients named individually in the donut; the rest fold into "Other". */
const PIE_CLIENTS = 15;
/** Series label the "hours over time" headline reads (see totalSeries below). */
const TOTAL_SERIES = "All hours";

/**
 * The rows both "Hours over time" and the by-client donut read, scoped by the
 * page filter. One hook so the two panes can never disagree about which hours
 * they are describing.
 */
function useHoursScope(filter: HomeFilter, isAdmin: boolean) {
  const { entrySums, entrySumsAll, tasks, clients, currentUserId } = useData();

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  // Admins see the whole studio, INCLUDING the recovered pre-Everhour history, so
  // "All time" reaches back to 2016 instead of stopping at the Everhour cutover.
  // Members see only their own hours and must stay on the legacy-free list — a
  // backfilled 2019 entry is not time they logged.
  const source = isAdmin ? entrySumsAll : entrySums;
  const scoped = useMemo(
    () =>
      source.filter((e) => {
        if (!isAdmin && e.userId !== currentUserId) return false;
        if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) return false;
        const task = taskById.get(e.taskId);
        if (filter.clientId && task?.clientId !== filter.clientId) return false;
        if (filter.billableOnly && !task?.billable) return false;
        return true;
      }),
    [source, currentUserId, isAdmin, filter, taskById],
  );

  return { scoped, taskById, clientById };
}

function MyGraphs({ filter, isAdmin }: { filter: HomeFilter; isAdmin: boolean }) {
  const { scoped, taskById } = useHoursScope(filter, isAdmin);

  const { perBucket, projection } = useMemo(() => {
    const { keyFor, labelFor, unit } = bucketize(scoped.map((e) => e.date), !!filter.range);
    const map = new Map<string, { all: number; billable: number }>();
    for (const e of scoped) {
      const key = keyFor(e.date);
      const cur = map.get(key) ?? { all: 0, billable: 0 };
      cur.all += e.minutes;
      if (taskById.get(e.taskId)?.billable) cur.billable += e.minutes;
      map.set(key, cur);
    }
    const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const rows = sorted.map(([key, v]) => ({
      label: labelFor(key),
      minutes: v.all,
      billable: v.billable,
    }));
    const lastKey = sorted.at(-1)?.[0];
    const factor = lastKey ? bucketProjection(unit, lastKey) : null;
    const last = rows.at(-1);
    return {
      perBucket: rows,
      projection:
        factor != null && last
          ? {
              index: rows.length - 1,
              // one entry per series, in the order the chart is given them
              values: [Math.round(last.minutes * factor), Math.round(last.billable * factor)],
            }
          : undefined,
    };
  }, [scoped, filter.range, taskById]);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <h2 className="mb-3 font-heading text-sm" title="Your logged hours over the selected period">
        Hours over time
      </h2>
      {perBucket.length > 0 ? (
        // Admins get the line form (same chart as the client-trend pane beside
        // it, single series) — it thins the x labels, which matters at 20+ daily
        // buckets. Members keep the labelled columns.
        isAdmin ? (
          <MultiLineChart
            labels={perBucket.map((p) => p.label)}
            series={[
              { label: TOTAL_SERIES, color: "#0b43ed", values: perBucket.map((p) => p.minutes) },
              // Showing everything? Then the billable slice rides along as a
              // second line. With "Billable only" on it would just retrace the
              // first one, so it's dropped.
              ...(filter.billableOnly
                ? []
                : [
                    {
                      label: "Billable",
                      color: "#16a34a",
                      values: perBucket.map((p) => p.billable),
                    },
                  ]),
            ]}
            // billable ⊂ all hours, so the headline must read ONE series
            totalSeries={TOTAL_SERIES}
            totalLabel={filter.label.toLowerCase()}
            projection={projection}
          />
        ) : (
          <MiniColumnsLabeled points={perBucket} />
        )
      ) : (
        <p className="text-sm text-faint">No hours in this scope.</p>
      )}
    </div>
  );
}

/** The donut half of "Hours by client". */
function HoursByClientDonut({ filter, isAdmin }: { filter: HomeFilter; isAdmin: boolean }) {
  const { scoped, taskById, clientById } = useHoursScope(filter, isAdmin);

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
    const slices: { label: string; minutes: number; color: string; href?: string }[] = rows
      .slice(0, PIE_CLIENTS)
      .map((r) => ({
        label: r.client!.name,
        minutes: r.minutes,
        color: r.client!.color,
        href: `/clients/${r.client!.id}`,
      }));
    const rest = rows.slice(PIE_CLIENTS).reduce((s, r) => s + r.minutes, 0);
    if (rest > 0) slices.push({ label: "Other", minutes: rest, color: "#9ca3af" });
    return slices;
  }, [scoped, taskById, clientById]);

  if (pieSlices.length === 0) return <p className="text-sm text-faint">No hours in this scope.</p>;
  return <PieChart slices={pieSlices} />;
}

/**
 * "Hours by client", two ways, in one pane. The split (donut) and the trend over
 * time answer the same question — who the studio's hours went to — so they were
 * two panes competing for the same slot rather than two separate facts.
 * Members only ever had the donut, so they get it without a tab strip.
 */
function ClientBreakdown({ filter, isAdmin }: { filter: HomeFilter; isAdmin: boolean }) {
  const [tab, setTab] = useState<"split" | "trend">("split");
  const show = isAdmin ? tab : "split";

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2
          className="font-heading text-sm"
          title={
            show === "split"
              ? "Hours split by client over the selected period"
              : "Studio hours per client over the selected period"
          }
        >
          Hours by client
        </h2>
        {isAdmin && (
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: "split" as const, label: "Split" },
              { value: "trend" as const, label: "Over time" },
            ]}
            variant="segmented"
            size="sm"
            ariaLabel="Hours by client view"
          />
        )}
      </div>
      {show === "split" ? (
        <HoursByClientDonut filter={filter} isAdmin={isAdmin} />
      ) : (
        <StudioClientTrend filter={filter} />
      )}
    </div>
  );
}

/** Admin overview: studio hours per client over time — one colored line per client.
 *  Admin-only and per-client, never per-person, so it includes the recovered
 *  pre-Everhour history (entrySumsAll). */
function StudioClientTrend({ filter }: { filter: HomeFilter }) {
  const { entrySumsAll, tasks, clients } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const { labels, series, projection } = useMemo(() => {
    const scoped = entrySumsAll.filter((e) => {
      if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) return false;
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) return false;
      if (filter.billableOnly && !task?.billable) return false;
      return true;
    });
    const { keyFor, labelFor, unit } = bucketize(scoped.map((e) => e.date), !!filter.range);
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
    // Pick the leaders of EACH BUCKET, then top up by overall total — not simply
    // the top 6 overall. Ranking by the whole range's total let the modern clients
    // win every slot, and they have no early hours at all: on "All time" the six
    // chosen lines covered 0% of every year before 2022, so the chart was flat
    // across 2016–2021 while the studio had really logged 3,068h in that stretch.
    // The actual leaders then were Quadream, Cognigo, Volta, New Era and Anchor.
    const MAX_SERIES = 7;
    const chosen = new Set<string>();
    for (const k of keys) {
      const leaders = [...byClientBucket.entries()]
        .map(([cid, m]) => [cid, m.get(k) ?? 0] as const)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2);
      for (const [cid] of leaders) chosen.add(cid);
    }
    const byTotal = [...totalByClient.entries()].sort((a, b) => b[1] - a[1]).map(([cid]) => cid);
    // Trim to the biggest overall if per-bucket leaders overflow, then top up.
    const top = byTotal.filter((cid) => chosen.has(cid)).slice(0, MAX_SERIES);
    for (const cid of byTotal) {
      if (top.length >= MAX_SERIES) break;
      if (!top.includes(cid)) top.push(cid);
    }

    const series = top.map((cid) => {
      const c = clientById.get(cid);
      const m = byClientBucket.get(cid)!;
      return { label: c?.name ?? "?", color: c?.color ?? "#9ca3af", values: keys.map((k) => m.get(k) ?? 0) };
    });

    // Everything not given its own line, so the lines account for the studio's
    // whole total instead of silently dropping 20–60% of it.
    const shown = new Set(top);
    const otherValues = keys.map((k) => {
      let sum = 0;
      for (const [cid, m] of byClientBucket) if (!shown.has(cid)) sum += m.get(k) ?? 0;
      return sum;
    });
    if (otherValues.some((v) => v > 0)) {
      series.push({ label: "Other clients", color: "#9ca3af", values: otherValues });
    }

    // still-running last bucket → run-rate estimate of the whole period, per line
    const factor = keys.length ? bucketProjection(unit, keys.at(-1)!) : null;
    const projection =
      factor != null
        ? {
            index: keys.length - 1,
            values: series.map((s) => Math.round((s.values.at(-1) ?? 0) * factor)),
          }
        : undefined;

    return { labels: keys.map(labelFor), series, projection };
  }, [entrySumsAll, filter, taskById, clientById]);

  if (series.length === 0) return <p className="text-sm text-faint">No hours in this scope.</p>;
  return (
    <MultiLineChart
      labels={labels}
      series={series}
      totalLabel={`top clients · ${filter.label.toLowerCase()}`}
      projection={projection}
    />
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

type ApiOccasion = {
  group: "birthday" | "anniversary" | "holiday" | "studioday" | "custom";
  title: string;
  /** recurring things carry "MM-DD"; one-off things carry a full "YYYY-MM-DD" */
  monthDay?: string;
  date?: string;
  icon?: string;
  years?: number;
};

/**
 * How far out the MEMBER hero looks. The admin pane has no horizon at all — it
 * shows the next occasions whenever they fall — and DIMS anything past this
 * window, which is exactly "not showing to the team yet".
 */
const MEMBER_OCCASION_DAYS = 7;

/** "today" / "tomorrow" / "in 9 days" / "in ~4 months" — days stop reading past ~2 months. */
function relativeDays(inDays: number): string {
  if (inDays === 0) return "today";
  if (inDays === 1) return "tomorrow";
  if (inDays < 60) return `in ${inDays} days`;
  return `in ~${Math.round(inDays / 30)} months`;
}

/** `inline` drops the card chrome and inverts the colours, for use inside the blue
 *  member hero, and only shows what members can actually see. The admin form is a
 *  4-card carousel, soonest first, with the not-yet-visible ones dimmed. */
function Celebrations({ inline = false }: { inline?: boolean }) {
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
    const out: {
      icon: string;
      text: string;
      when: string;
      rel: string;
      at: number;
      /** false = beyond the member window, so the team can't see it yet */
      liveForMembers: boolean;
    }[] = [];

    for (const o of raw) {
      let next: Date;
      if (o.monthDay) {
        const [m, d] = o.monthDay.split("-").map(Number);
        if (!m || !d) continue;
        // Roll to next year once the date has passed, so December dates surface in January.
        next = new Date(today.getFullYear(), m - 1, d);
        if (next.getTime() < today.getTime()) next = new Date(today.getFullYear() + 1, m - 1, d);
      } else if (o.date) {
        const [y, m, d] = o.date.split("-").map(Number);
        if (!y || !m || !d) continue;
        next = new Date(y, m - 1, d); // one-off: never rolls
      } else continue;

      const delta = next.getTime() - today.getTime();
      // No horizon: the pane shows the next few occasions however far off they are.
      // Recurring dates roll at most a year ahead, so the list stays bounded.
      if (delta < 0) continue;

      // Anniversary count is recomputed against the occurrence year — the API's
      // `years` is relative to the current year, which is wrong for a date that
      // has rolled into next year.
      const years = o.years != null ? o.years + (next.getFullYear() - today.getFullYear()) : null;
      const inDays = Math.round(delta / 86400000);
      out.push({
        icon: o.icon ?? "📅",
        text:
          o.group === "anniversary"
            ? `${o.title} — ${years} year${years === 1 ? "" : "s"} at the studio`
            : o.title,
        when: `${next.getDate()}/${next.getMonth() + 1}`,
        rel: relativeDays(inDays),
        at: next.getTime(),
        liveForMembers: inDays <= MEMBER_OCCASION_DAYS,
      });
    }
    // Sort on the timestamp: the old code compared the formatted "D/M" string, so
    // "10/8" sorted before "9/8".
    const sorted = out.sort((a, b) => a.at - b.at);
    // The member hero only ever shows what is live for members.
    return inline ? sorted.filter((o) => o.liveForMembers) : sorted;
  }, [raw, inline]);

  if (upcoming.length === 0) return null;

  const idx = Math.min(at, upcoming.length - 1);
  const cur = upcoming[idx];
  const many = upcoming.length > 1;

  // The mr below stacks on the hero's own pr-32: the portrait needs ~216px of
  // clearance from the pane's right edge (it's scaled by the pane's HEIGHT, so it
  // renders wider than its 176px container), and a filled pill would otherwise
  // slide under it and hide the date and arrows. max-w keeps it from sprawling
  // when the hero goes full width below the lg breakpoint.
  if (inline) {
    return (
      <div className="mt-4 mr-[100px] max-w-[360px] rounded-xl bg-white/10 px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <span className="shrink-0 text-xl leading-none">{cur.icon}</span>
          <div className="min-w-0 flex-1">
            {/* Wraps to two lines rather than truncating: the portrait leaves this
                column narrow, and "Shaked's bir…" is worse than two short lines. */}
            <div className="bidi-auto line-clamp-2 text-sm font-medium leading-tight">
              {cur.text}
            </div>
            <div className="mt-0.5 text-[11px] text-white/70">
              <span className="tabular-nums">{cur.when}</span> · {cur.rel}
            </div>
          </div>
        </div>
        {/* Controls on their own row — sharing the row above cost the title ~60px
            of a column that only has ~200px to give. */}
        {many && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              onClick={() => setAt((v) => (v - 1 + upcoming.length) % upcoming.length)}
              aria-label="Previous occasion"
              className="rounded-md p-0.5 text-white/80 hover:bg-white/15 hover:text-white"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="flex items-center gap-1.5">
              {upcoming.map((o, i) => (
                <button
                  key={o.at}
                  onClick={() => setAt(i)}
                  aria-label={`Occasion ${i + 1} of ${upcoming.length}`}
                  aria-current={i === idx}
                  className={`size-1.5 rounded-full transition-colors ${
                    i === idx ? "bg-white" : "bg-white/35 hover:bg-white/60"
                  }`}
                />
              ))}
            </div>
            <button
              onClick={() => setAt((v) => (v + 1) % upcoming.length)}
              aria-label="Next occasion"
              className="rounded-md p-0.5 text-white/80 hover:bg-white/15 hover:text-white"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── admin form: a vertical scrolling list beside the week timesheet ──────
  //
  // Capped by COUNT, not by days: v0.99.37 deliberately deleted the 30-day
  // horizon because the next occasions matter whenever they fall, and a day
  // horizon would reintroduce exactly that. The sources are all recurring, so
  // "everything" is ~30–40 rows whose tail is a full year out.
  const LIST_MAX = 12;
  const shown = upcoming.slice(0, LIST_MAX);
  const hidden = upcoming.length - shown.length;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2">
        <h2 className="font-heading text-sm">Coming up</h2>
        <span className="text-[11px] tabular-nums text-faint">{upcoming.length} ahead</span>
      </div>
      {/* min-h-0 is load-bearing: without it a flex child refuses to shrink below
          its content and the scrollbar never appears — the pane would grow and
          stretch the whole row instead. */}
      <div className="-mr-1 min-h-0 flex-1 divide-y divide-border overflow-y-auto pr-1 max-lg:max-h-[420px]">
        {shown.map((o) => (
          <div
            key={o.at + o.text}
            // Dimmed = past the member window, i.e. the team can't see it yet.
            className={`flex items-start gap-2 py-2 ${o.liveForMembers ? "" : "opacity-50"}`}
            title={
              o.liveForMembers
                ? undefined
                : `Not shown to the team yet — the studio sees occasions within ${MEMBER_OCCASION_DAYS} days`
            }
          >
            <span className="shrink-0 text-base leading-tight">{o.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="bidi-auto line-clamp-2 text-xs font-medium leading-tight">
                {o.text}
              </div>
              <div className="mt-0.5 text-[10px] text-muted">
                <span className="tabular-nums">{o.when}</span> · {o.rel}
              </div>
            </div>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <p className="mt-1.5 shrink-0 text-[10px] text-faint">+{hidden} further ahead</p>
      )}
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
  info,
  infoAlign,
}: {
  hi?: boolean;
  label: string;
  figure: string;
  unit?: string;
  delta?: { value: number; unit: string } | null;
  sub?: string;
  /** what the figure counts and what the delta compares — shown behind the "i" */
  info?: React.ReactNode;
  infoAlign?: "left" | "right";
}) {
  const up = delta ? delta.value >= 0 : true;
  return (
    <div
      className={`rounded-2xl border p-4 shadow-card ${hi ? "border-brand bg-brand text-white" : "border-border bg-surface"}`}
    >
      <div
        className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wide ${hi ? "text-white/80" : "text-muted"}`}
      >
        {label}
        {info && (
          <InfoDot title={label} align={infoAlign}>
            {info}
          </InfoDot>
        )}
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
/**
 * "A client changed a brief you've already handled" — on the admin home, not
 * only in the queue.
 *
 * ⚠️ Renders NOTHING when there is nothing to say (no empty state, no zero
 * count). A permanent pane reporting "0 updates" is one nobody reads by the
 * second week, which would defeat the point of putting it above the figures.
 */
function UpdatedBriefsAlert() {
  const { taskRequests } = useData();
  const updated = useMemo(() => taskRequests.filter(needsReview), [taskRequests]);
  if (!updated.length) return null;
  return (
    <Link
      href="/intake-queue"
      className="flex items-start gap-3 rounded-2xl border-2 border-brand/40 bg-brand/5 px-4 py-3 hover:bg-brand/10"
    >
      <PencilLine size={18} className="mt-0.5 shrink-0 text-brand" />
      <span className="min-w-0">
        <span className="block text-base font-semibold">
          {updated.length === 1
            ? "A client changed a brief"
            : `${updated.length} briefs were changed by clients`}
        </span>
        {/* Names them, so it is obvious at a glance whether this is the job
            somebody is working on today. */}
        <span className="bidi-auto block truncate text-sm text-muted">
          {updated.map((r) => r.title).join(" · ")} — see what changed
        </span>
      </span>
    </Link>
  );
}

function StatTiles({ filter, prevRange }: { filter: HomeFilter; prevRange: { from: string; to: string } | null }) {
  // entrySumsAll: "Studio hours" and "Billable" are studio-wide history and should
  // reach back to 2016 on "All time". The per-person figures below deliberately do
  // NOT — see `curLive`.
  const { entrySumsAll, tasks } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const s = useMemo(() => {
    // curAll/prevAll ignore the billable-only toggle on purpose: they are the
    // denominator of the Billable share, which is the one figure that has to stay
    // "billable out of everything" whatever the page is scoped to.
    let cur = 0,
      curAll = 0,
      curB = 0,
      prev = 0,
      prevAll = 0,
      prevB = 0,
      curLive = 0;
    const designers = new Set<string>();
    const worked = new Set<string>();
    for (const e of entrySumsAll) {
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) continue;
      const counts = !filter.billableOnly || !!task?.billable;
      const inCur = !filter.range || (e.date >= filter.range.from && e.date <= filter.range.to);
      if (inCur) {
        curAll += e.minutes;
        if (task?.billable) curB += e.minutes;
        if (counts) cur += e.minutes;
        // A task was worked whoever logged it — no author gate here, or every year
        // before 2022 read "0 tasks worked" beside thousands of hours.
        if (counts && e.minutes > 0) worked.add(e.taskId);
        // The average needs a divisor, so it counts only ATTRIBUTED hours: recovered
        // entries that name a person are in (they are two thirds of the 2019 total's
        // problem solved), the authorless ones are out of both halves of the
        // fraction. This used to exclude every legacy row, which made the tile read
        // "0h · 0 designers" for any year before 2022.
        if (counts && e.minutes > 0 && e.userId) {
          curLive += e.minutes;
          designers.add(e.userId);
        }
      } else if (prevRange && e.date >= prevRange.from && e.date <= prevRange.to) {
        prevAll += e.minutes;
        if (task?.billable) prevB += e.minutes;
        if (counts) prev += e.minutes;
      }
    }
    return { cur, curAll, curB, prev, prevAll, prevB, curLive, designers: designers.size, worked: worked.size };
  }, [entrySumsAll, taskById, filter, prevRange]);

  const hoursDelta = prevRange && s.prev > 0 ? Math.round(((s.cur - s.prev) / s.prev) * 100) : null;
  const curPct = s.curAll > 0 ? Math.round((s.curB / s.curAll) * 100) : 0;
  const prevPct = s.prevAll > 0 ? Math.round((s.prevB / s.prevAll) * 100) : null;
  const pctDelta = prevPct != null ? curPct - prevPct : null;
  // Live hours over live designers. Dividing the history-inclusive total by the
  // count of people working today would report an average nobody worked.
  const perDesigner = s.designers > 0 ? s.curLive / s.designers : 0;

  const [hFig, hUnit] = splitHours(s.cur);
  const [pdFig, pdUnit] = splitHours(perDesigner, true);

  // Spelling the compared window out is the point of the "i": the previous period
  // is CLIPPED to the same elapsed portion, and a reader can only trust the delta
  // once they can see which dates it actually weighed.
  // A period in the past is already complete, so there is nothing to clip and saying
  // so would be a lie about what the dates mean.
  const todayIso = toISODate(new Date());
  const ongoing = !!filter.range && todayIso >= filter.range.from && todayIso <= filter.range.to;
  const vs = prevRange ? (
    <>
      Compared with <b>{prevRange.from} → {prevRange.to}</b>
      {ongoing ? (
        <>
          {" "}— the same stretch of the previous period, clipped to today so a
          part-finished period isn&apos;t weighed against a whole one.
        </>
      ) : (
        <> — the whole of the previous period, since this one is already complete.</>
      )}
    </>
  ) : (
    <>No comparison on &ldquo;All time&rdquo; — there is no earlier period to read it against.</>
  );
  const scope = filter.clientId ? " Limited to the selected client." : "";

  return (
    // 2×2, not a row of four: on the admin home these sit in the left half of a
    // two-column grid beside the week timesheet, so each tile keeps roughly the
    // width it had when the four spanned the page.
    <div className="grid grid-cols-2 gap-4">
      <StatTile
        hi
        label={filter.billableOnly ? "Billable hours" : "Studio hours"}
        figure={hFig}
        unit={hUnit}
        delta={hoursDelta != null ? { value: hoursDelta, unit: "%" } : null}
        sub="this period"
        info={
          <>
            Every hour logged by the whole studio in {filter.label.toLowerCase()},
            {filter.billableOnly ? " on billable tasks only" : " billable and internal alike"},
            including the recovered pre-Everhour history.{scope} {vs}
          </>
        }
      />
      <StatTile
        label="Billable"
        figure={String(curPct)}
        unit="%"
        delta={pctDelta != null ? { value: pctDelta, unit: "pp" } : null}
        sub={filter.billableOnly ? "of all hours" : "of hours"}
        info={
          <>
            Hours on billable tasks ÷ <b>all</b> hours in the period. The denominator
            ignores the &ldquo;Billable only&rdquo; toggle on purpose — scoped to billable
            hours this would otherwise read a meaningless 100%. The delta is in
            percentage points, not percent.{scope} {vs}
          </>
        }
      />
      <StatTile
        label="Tasks worked"
        figure={String(s.worked)}
        sub="this period"
        info={
          <>
            Distinct tasks that received at least one minute in {filter.label.toLowerCase()}
            {filter.billableOnly ? ", counting billable tasks only" : ""}. Not tasks
            created, and not tasks assigned. Recovered pre-Everhour work counts, whoever
            logged it.{scope}
          </>
        }
      />
      <StatTile
        label="Avg / designer"
        figure={pdFig}
        unit={pdUnit}
        sub={`${s.designers} designer${s.designers === 1 ? "" : "s"}`}
        infoAlign="right"
        info={
          <>
            Hours logged in the period ÷ the {s.designers} {s.designers === 1 ? "person" : "people"}{" "}
            who logged any. People who logged nothing are not in the divisor, so this is
            the average of those who worked, not of the roster. Hours whose author was
            never recorded — common in the recovered pre-Everhour years — are left out of
            <b> both</b> sides of the fraction, so this can read lower than the studio
            total suggests.{scope}
          </>
        }
      />
    </div>
  );
}

/** Compact studio roster on the admin home: per-designer hours + billable bar. */
function StudioTeamStrip({ filter }: { filter: HomeFilter }) {
  // entrySumsAll, NOT entrySums: the legacy-free list is empty before 2022 (every
  // entry that far back is recovered pre-Everhour history), so the pane rendered
  // nothing at all for those years while the tiles above it reported thousands of
  // hours. About a third of those old entries DO name a person; the rest name
  // nobody, and `unattributed` below owns up to that instead of quietly shrinking
  // the studio's total.
  const { entrySumsAll, tasks, profiles } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const { rows, unattributed } = useMemo(() => {
    const per = new Map<string, { min: number; bil: number }>();
    // no billable filter in this loop: `pct` below is the billable SHARE and has to
    // keep all hours as its denominator, so both figures are always accumulated
    const orphan = { min: 0, bil: 0 };
    for (const e of entrySumsAll) {
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) continue;
      if (filter.range && (e.date < filter.range.from || e.date > filter.range.to)) continue;
      const r = e.userId ? (per.get(e.userId) ?? { min: 0, bil: 0 }) : orphan;
      r.min += e.minutes;
      if (task?.billable) r.bil += e.minutes;
      if (e.userId) per.set(e.userId, r);
    }
    // Archived people are NOT filtered out: the pane describes a period, and
    // someone who left in March did log hours in March. `min > 0` below is the real
    // gate — an archived designer with nothing in the period still doesn't appear.
    const rows = profiles
      .map((p) => {
        const r = per.get(p.id) ?? { min: 0, bil: 0 };
        // The bar is the billable SHARE, so it stays over all hours even when the
        // page shows billable only — otherwise every designer reads a flat 100%.
        return {
          p,
          min: filter.billableOnly ? r.bil : r.min,
          pct: r.min > 0 ? Math.round((r.bil / r.min) * 100) : 0,
          archived: !p.active,
        };
      })
      .filter((x) => x.min > 0)
      .sort((a, b) => b.min - a.min);
    return { rows, unattributed: filter.billableOnly ? orphan.bil : orphan.min };
  }, [entrySumsAll, taskById, profiles, filter]);

  if (rows.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-heading text-sm">
          The studio · {rows.length} designer{rows.length === 1 ? "" : "s"}
          {unattributed > 0 && (
            // Without this the cards silently account for less than the period's
            // total — most old recovered entries name nobody at all.
            <span
              className="ml-1.5 font-normal text-faint"
              title="Recovered pre-Everhour hours whose author isn't recorded. They count in the studio totals above but can't be put on anyone's card."
            >
              · {formatHoursShort(unattributed)} unattributed
            </span>
          )}
        </h2>
        <Link href="/team" className="flex shrink-0 items-center gap-1 text-xs text-brand hover:underline">
          View team <ArrowRight size={12} />
        </Link>
      </div>
      {/* half-width pane since v0.99.35 (it took the My-tasks slot), so 4 across at
          most — 8 columns here would leave each card too narrow to read */}
      {/* full-page width again (the client-trend pane merged into its neighbour),
          so the roster fits more designers per row instead of wrapping at four */}
      {/* A LIST below `sm`, cards above it. Two columns of portrait cards on a
          phone give each about 150px to spend on an avatar, a name, an hours
          figure and a bar stacked vertically — four rows of chrome per person
          and only two people per screen. Laid on their side the same four facts
          take one row each, so the whole studio fits without scrolling. */}
      <div className="flex flex-col gap-1.5 sm:grid sm:grid-cols-3 sm:gap-2.5 lg:grid-cols-5 xl:grid-cols-7">
        {rows.map(({ p, min, pct, archived }) => (
          <Link
            key={p.id}
            href={`/team/${p.id}`}
            title={
              archived
                ? `${p.name} — ${p.endDate ? `left ${p.endDate}` : "no longer in the studio"}, but logged these hours in the period`
                : p.name
            }
            // dashed border rather than a dimmed card: the hours are as real as
            // anyone else's, it's the person who is no longer on the roster
            // Same four children in the same order — only the axis changes, so
            // the desktop card is byte-identical above `sm`.
            className={`flex items-center gap-3 rounded-xl border bg-background p-2.5 hover:border-brand sm:flex-col sm:gap-1.5 sm:p-3 ${
              archived ? "border-dashed border-border-strong" : "border-border"
            }`}
          >
            <Avatar profile={p} size={40} />
            <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-sm font-semibold sm:max-w-full sm:flex-none sm:text-xs">
              <span className="truncate">{p.name.split(" ")[0]}</span>
              {archived && <span className="shrink-0 font-normal text-faint">·&nbsp;past</span>}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted sm:text-[10px]">
              {formatHoursShort(min)} · {pct}%
            </span>
            {/* A fixed 56px on the row; full width once it sits under the name. */}
            <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-border sm:w-full">
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
  prevRange,
  onLogTime,
}: {
  // ⚠️ The whole `Profile`, not the three fields the hero draws: the caller
  // already found it in `profiles`, and `dailyTargetMinutes` needs its capacity.
  // Narrowing here only meant looking the same object up a second time.
  me: Profile;
  filter: HomeFilter;
  prevRange: { from: string; to: string } | null;
  /** Phone-only: opens the log-time sheet, since `#log` has nothing to jump to. */
  onLogTime: () => void;
}) {
  const { entrySums, timeEntries, tasks } = useData();
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // ⚠️ The hero used to be week-scoped ("You've logged 21h across 6 active
  // tasks — 1 due this week"). It reads TODAY now, deliberately: the week's
  // figures are already on the tiles and in My week directly below, and the one
  // number nothing else on this page shows is how the current day is going.
  const scoped = useMemo(() => {
    let min = 0;
    let bil = 0;
    let prev = 0;
    const byDate = new Map<string, number>();
    for (const e of entrySums) {
      if (e.userId !== me.id) continue;
      const task = taskById.get(e.taskId);
      if (filter.clientId && task?.clientId !== filter.clientId) continue;
      if (prevRange && e.date >= prevRange.from && e.date <= prevRange.to) prev += e.minutes;
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
      // The delta the removed "My hours" pane used to carry, folded into the tile.
      delta: prev > 0 ? Math.round(((min - prev) / prev) * 100) : null,
    };
  }, [entrySums, taskById, me.id, filter, prevRange]);

  /**
   * Today's own hours, and the three things the hero can say about them.
   *
   * ⚠️ It reads `timeEntries` — the 60-second window — NOT `entrySums`, which has
   * been on the cold tier since v1.18.2 and can be ten minutes behind. A line
   * that reads "Nothing logged today" for ten minutes after you logged an hour is
   * worse than no line, and the window always reaches back far enough for today.
   * Your own writes patch both sets optimistically, so your own logging shows at
   * once either way; this is about an hour logged on the phone reaching the
   * laptop.
   */
  const todayLine = useMemo(() => {
    const today = toISODate(new Date());
    let min = 0;
    for (const e of timeEntries) {
      if (e.userId === me.id && e.date === today && !e.legacy) min += e.minutes;
    }
    const target = dailyTargetMinutes(me);
    if (min <= 0) return "Nothing logged today";
    // At or past the target the remaining figure is noise — say it's done.
    if (min >= target) return `Day complete — ${formatHours(min)} logged`;
    return `${formatHours(min)} of ${formatHours(target)} logged today`;
  }, [timeEntries, me]);

  const [hFig, hUnit] = splitHours(scoped.min);
  const [adFig, adUnit] = splitHours(scoped.perDay, true);

  return (
    <div className="grid items-stretch gap-2 lg:grid-cols-2 lg:gap-4">
      {/* mt-9 is the room the portrait's head needs above the panel. The hero can't
          clip (the head breaks out of the top), so the decorative disc gets its own
          clipping layer instead of relying on overflow-hidden here.
          ⚠️ Below `sm` the portrait is not rendered at all, so that 36px was pure
          gap on the screen with the least of it to spare. */}
      <div
        className="relative rounded-2xl bg-brand px-6 py-6 text-white sm:mt-9"
        style={{ minHeight: 208, boxShadow: "var(--shadow-hero)" }}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -top-12 right-24 size-64 rounded-full bg-white/[0.06]" />
        </div>
        {/* ⚠️ `sm:pr-[196px]` is the portrait's column — 176px of figure at
            `right: 5`, plus air. The shipped value was `pr-32` (128px), which let
            a line run ~50px ONTO the photograph: that is where the "1" of "1 due
            this week" went in Nitsan's screenshot. Nothing is clipped (the text
            block is `z-10`, above the figure) — it is simply unreadable over a
            person. The portrait is `hidden sm:block`, so below `sm` the padding
            has to be zero or it reserves a column for nothing. */}
        <div className="relative z-10 sm:pr-[196px]">
          {/* ⚠️ The greeting LIVES HERE now, and the page header's copy of it was
              removed for members in the same change — this panel is the welcome,
              and two "Good afternoon"s six inches apart is one too many.
              The sentence that used to be here reported three figures the same
              screen already carried: the week's hours (the My hours tile beside
              this), the open-task count (the header's own counter and the My
              tasks heading) and the due count (those tasks' own dates). What is
              left is the one figure nothing else on the page shows — today
              against your own day — which is also the one the button underneath
              acts on. */}
          <h2 className="font-serif-accent text-[34px] italic leading-tight">
            {greetingFor(new Date())}, {me.name.split(" ")[0]}
          </h2>
          <div className="mt-1.5 text-sm text-white/85">{todayLine}</div>
          {/* ⚠️ Off on a phone, and the gate is a WRAPPER for the same reason the
              admin pane's is (see below): `Celebrations` returns its own element
              with `empty:hidden`, so `hidden md:block` on that element would win
              at desktop and leave a gap on quiet days. `md:contents` makes this
              wrapper leave the layout above 768px, so the hero's own vertical
              rhythm is byte-identical there. Nitsan's call — a birthday two days
              out is desk reading, and on 375px it was pushing the one button this
              panel exists for further down the screen. */}
          <div className="hidden md:contents">
            <Celebrations inline />
          </div>
          {/* Two buttons rather than a JS branch, so there is no hydration flash.
              ⚠️ The anchor is desktop-only ON PURPOSE: `#log` is the "Log my
              hours" pane, which a phone doesn't render, so the link would scroll
              nowhere. There the same button opens the log-time sheet. */}
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={onLogTime}
              className="rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-brand hover:brightness-95 md:hidden"
            >
              + Log time
            </button>
            <a
              href="#log"
              className="hidden rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-brand hover:brightness-95 md:block"
            >
              + Log time
            </a>
            {/* "What am I meant to be doing today" — the plan, one tap from the
                greeting. ⚠️ DESKTOP ONLY, and not for tidiness: `/plan` is one of
                the six routes that render a "needs a bigger screen" card below
                768px, so on a phone this button would promise the week and
                deliver a refusal. Nothing is lost there — the My week pane sits
                directly under this hero on a phone and shows today onwards. */}
            <Link
              href="/plan"
              className="hidden rounded-xl border border-white/45 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10 md:block"
            >
              Weekly plan
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

      {/* mt-9 only earns its place at `lg`, where this is the column BESIDE the
          hero and has to start level with it. Stacked under the hero it is just
          a 36px hole between two panes. */}
      <div className="mt-2 grid grid-cols-2 gap-4 lg:mt-9">
        <StatTile
          label="My hours"
          figure={hFig}
          unit={hUnit}
          delta={scoped.delta != null ? { value: scoped.delta, unit: "%" } : null}
          sub={filter.label.toLowerCase()}
        />
        <StatTile label="Billable" figure={String(scoped.pct)} unit="%" sub={filter.label.toLowerCase()} />
        <StatTile label="Days in studio" figure={String(scoped.days)} sub={filter.label.toLowerCase()} />
        <StatTile label="Avg / day" figure={adFig} unit={adUnit} sub="days logged" />
      </div>
    </div>
  );
}


export function Dashboard() {
  const { profiles, tasks, clients, currentUserId, taskRequests, openTask } = useData();
  const me = profiles.find((p) => p.id === currentUserId);
  const isAdmin = useIsAdmin();

  // page-wide filters — rangeKey picks the unit, periodOffset walks it (0 = current)
  const [rangeKey, setRangeKey] = useState<(typeof HOME_RANGES)[number]>("This month");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [filterClient, setFilterClient] = useState("");
  const [billableOnly, setBillableOnly] = useState(false);
  // The hero's phone CTA. The shell owns its own copy for the bottom bar's "+";
  // the sheet is self-contained, so a second instance is simpler than threading
  // a callback down through AppShell's children.
  const [logTimeOpen, setLogTimeOpen] = useState(false);
  const filter: HomeFilter = useMemo(() => {
    const b = periodBounds(rangeKey, periodOffset);
    return {
      range: b ? { from: toISODate(b.start), to: toISODate(b.end) } : null,
      label: rangeLabel(rangeKey, periodOffset),
      clientId: filterClient,
      // Members have no toggle — internal vs client work isn't a distinction their
      // own hours are read through, and the control is admin-only.
      billableOnly: isAdmin && billableOnly,
    };
  }, [rangeKey, periodOffset, filterClient, isAdmin, billableOnly]);
  const prevRange = useMemo(
    () => comparablePrevRange(rangeKey, periodOffset),
    [rangeKey, periodOffset],
  );
  const canNavigate = rangeKey !== "All time";

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
                {/* link={false}: the whole row is a button, and an <a> can't nest in one */}
                {c && <ClientChip client={c} size="sm" link={false} />}
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
    // Half the gap on a phone. 16px between every pane is a desk measurement —
    // on a 812px screen it is most of a stat tile's worth of nothing, and this
    // page stacks six panes.
    <div className="flex w-full flex-col gap-2 md:gap-4">
      {/* Header: greeting + display stats + page-wide filters.
          ⚠️ On a phone this used to spend ~440px of an 812px screen — more than
          half the first screen — before a single figure: the greeting, the
          tenure counter, the billable switch, the range pills, the period
          stepper and the client select each took a row of their own, because one
          `flex-wrap` row simply wrapped six items at 375px.
          Now it is two rows: identity (tenure pulled up beside the name rather
          than under it) and ONE horizontally-scrollable strip holding every
          filter. Above `md` the `md:` classes restore the original wrap
          behaviour exactly.
          Second pass (Nitsan, on the phone): the member's "Tasks assigned"
          counter and the client select are both `md:` only now — the bottom bar
          already carries Tasks, and picking a client to scope your own hours is
          desk work. That leaves identity + the period stepper, two rows. */}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-10 md:gap-y-3">
        <div className="flex items-center gap-3">
          <MyAvatar />
          <div className="min-w-0">
            {/* ⚠️ Members get the DATE here, not the greeting — their hero says
                "Good afternoon, Nadav" a few inches below, and the same phrase
                twice on one screen reads as a bug. The date was already carried
                by this line's `title`, so nothing new is being invented; it is
                the one orienting fact the page never states out loud. Admins have
                no hero, so theirs is unchanged. */}
            <p className="text-sm text-muted" title={dateLabel}>
              {isAdmin ? greetingFor(today) : dateLabel}
            </p>
            <h1 className="font-serif-accent truncate text-[26px] leading-8">{firstName}</h1>
          </div>
          {/* `ml-auto` only below md — above it this block is a flex sibling of
              the filters and pushing it right would strand the greeting. */}
          {me?.startDate && (
            <div className="ml-auto text-right md:hidden" title={`In the studio since ${me.startDate}`}>
              <div className="font-serif-accent text-[22px] leading-7">
                {tenureSince(me.startDate)
                  .split(" ")
                  .map((part) => (
                    <span key={part} className="mr-1.5 last:mr-0">
                      {part.slice(0, -1)}
                      <span className="text-[13px]">{part.slice(-1)}</span>
                    </span>
                  ))}
              </div>
              <p className="text-[11px] text-muted">In the studio</p>
            </div>
          )}
        </div>
        {me?.startDate && (
          <div className="hidden md:block" title={`In the studio since ${me.startDate}`}>
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
        {/* admins don't triage their own assignments from here — the counter went
            with the My-tasks pane */}
        {!isAdmin && (
          <div className="hidden md:block">
            <div className="font-serif-accent text-[30px] leading-9">{myTasks.length}</div>
            <p className="text-xs text-muted">Tasks assigned</p>
          </div>
        )}
        {/* Two lines below md: the billable switch and the client picker share
            the first, and `PeriodStepper` — pushed last and given a full basis —
            takes the second, where it scrolls itself.
            ⚠️ `order-last basis-full` rather than reordering the JSX: the DOM
            order (billable · stepper · client) is the DESKTOP order, and moving
            the markup to group two of them would have changed how this row reads
            at ≥768px. An earlier attempt wrapped the whole row in a scroller
            instead, which broke /team — that page hosts the same stepper with no
            scroller of its own. */}
        <div className="flex flex-wrap items-center gap-2 md:ml-auto md:gap-1.5">
          {isAdmin && (
            <label
              title="Count only hours logged on billable tasks — every tile, graph and designer figure on this page follows it. The two billable-share readouts keep all hours as their denominator."
              // no pill: a bordered capsule read as one more range button sitting
              // among the range buttons. The switch itself carries the state.
              className={`mr-2 flex shrink-0 cursor-pointer select-none items-center gap-2 whitespace-nowrap text-sm font-medium ${
                billableOnly ? "text-brand-dark" : "text-muted hover:text-foreground"
              }`}
            >
              <input
                type="checkbox"
                checked={billableOnly}
                onChange={(e) => setBillableOnly(e.target.checked)}
                className="peer sr-only"
              />
              {/* switch: track + knob, driven off the sr-only checkbox so the whole
                  pill stays one click target and keeps keyboard focus */}
              <span
                aria-hidden
                className={`relative h-4 w-7 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 ${
                  billableOnly ? "bg-brand" : "bg-border-strong"
                }`}
              >
                <span
                  className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${
                    billableOnly ? "left-3.5" : "left-0.5"
                  }`}
                />
              </span>
              Billable only
            </label>
          )}
          {/* Extracted to period-stepper.tsx so reports and the team page get the
              same control — including the rule that the arrows and "Now" are
              disabled and dimmed rather than removed, so the row can't reflow
              under the cursor. */}
          <PeriodStepper
            className="order-last basis-full md:order-none md:basis-auto"
            ranges={HOME_RANGES}
            value={rangeKey}
            offset={periodOffset}
            label={filter.label}
            canStep={canNavigate}
            disabledReason="All time has no previous period"
            onChange={setRangeKey}
            onOffset={setPeriodOffset}
          />
          <select
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="hidden shrink-0 rounded-md border border-border bg-surface px-2 py-1.5 text-sm md:block"
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
          {/* One row: KPI tiles at half width, then the week's timesheet and the
              occasions list sharing the other half. 12 columns rather than 4
              because the three panes want different shares — 6/4/2 keeps the tiles
              exactly the width they had, and 2/12 is comfortable for a vertical
              occasion row.
              No items-start: the columns stretch to the same height.
              lg:h-0 + lg:min-h-full on the last one means it FILLS the row's
              height without CONTRIBUTING to it — otherwise a long occasion list
              would stretch the whole row. */}
          {/* ⚠️ ABOVE the figures, because it is the only thing here that can go
              stale in a way that costs work: a client has changed a brief the
              studio may already have drawn from. Nitsan asked to be told on the
              dashboard, and a badge in the header is easy to walk past. It
              disappears the moment the changes are read — see `needsReview`. */}
          <UpdatedBriefsAlert />

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <StatTiles filter={filter} prevRange={prevRange} />
            </div>
            <div className="lg:col-span-4">
              <WeekTimesheet />
            </div>
            {/* ⚠️ The mobile gate goes on a WRAPPER, not on the pane's own div —
                that div carries `empty:hidden`, and adding `hidden md:block`
                beside it would let `md:block` win at desktop and leave an empty
                box on the days nothing is coming up. `md:contents` makes this
                wrapper vanish from layout above 768px, so the pane stays a
                direct grid item and `lg:col-span-2` still applies.
                Off on a phone at Nitsan's request — birthdays and holidays are
                something you read at a desk, not the reason you opened the app
                on the way home. The member hero's `inline` variant is gated the
                same way, so no phone shows an occasion anywhere. */}
            <div className="hidden md:contents">
              <div className="empty:hidden lg:col-span-2 lg:h-0 lg:min-h-full">
                <Celebrations />
              </div>
            </div>
          </div>
          {/* analytics 2×2 — hours over time / by client, then client-trend and the
              studio roster, which took the My-tasks slot (admins use /my-tasks) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Kept on a phone: "hours over time" is a trend, and a trend is the
                one chart shape that still reads at 343px — it already renders
                through a `viewBox` at `width="100%"`, so it scales rather than
                being cropped. */}
            <MyGraphs filter={filter} isAdmin={isAdmin} />
            {/* the split and the trend answer the same question, so they share a
                pane with a tab rather than competing for two slots.
                ⚠️ Hidden below md: its donut is drawn at a literal 300×300 with a
                legend beside it, so at 375px the legend has ~40px and the client
                names become one character each. Reading a share is analysis, and
                analysis is a desk job — the honest fix is to leave it out rather
                than ship an unreadable one. */}
            <div className="hidden md:block">
              <ClientBreakdown filter={filter} isAdmin={isAdmin} />
            </div>
          </div>
          {/* full width now that the pane beside it has gone — the roster fits
              more designers per row instead of wrapping at four */}
          <StudioTeamStrip filter={filter} />
        </>
      ) : (
        <>
          <ConfirmDetailsBanner />
          {me && (
            <MemberWelcome
              me={me}
              filter={filter}
              prevRange={prevRange}
              onLogTime={() => setLogTimeOpen(true)}
            />
          )}
          <MyWeek />
          {/* Phone only, and it is the other half of `MyWeek` there: that pane
              shows the days AHEAD, this one what you actually logged on the days
              already gone. On a laptop the Time Feed and "Log my hours" below
              cover it; on a phone the Feed is desktop-only, so nothing did. */}
          <MemberWeekHours />
          {/* My tasks takes the slot beside "Log my hours" that Celebrations left
              when it moved into the hero.
              ⚠️ The whole row is `md:` only. Both panes are duplicates of the
              bottom bar on a phone — "+" is the log-time flow and "Tasks" is the
              full list — and two duplicated panes were the top of this page's
              second screen. Nitsan's call. */}
          <div className="hidden grid-cols-1 gap-4 md:grid lg:grid-cols-3">
            <div id="log" className="scroll-mt-20 lg:col-span-2">
              <DayLog />
            </div>
            {compactTasksCard}
          </div>
          {/* PeriodStat is gone from the member view — it repeated the "My hours"
              tile above, whose delta chip now carries the vs-last-period figure.
              That frees the row so both graphs sit side by side. */}
          {/* Both charts are `md:` only on the member home — you chose to drop
              them there. They are analysis of your own past hours; the phone
              scope is logging time and seeing what's assigned. */}
          <div className="hidden grid-cols-1 gap-4 md:grid lg:grid-cols-2">
            <MyGraphs filter={filter} isAdmin={false} />
            <ClientBreakdown filter={filter} isAdmin={false} />
          </div>
          {logTimeOpen && <MobileLogTimeSheet onClose={() => setLogTimeOpen(false)} />}
        </>
      )}
    </div>
  );
}
