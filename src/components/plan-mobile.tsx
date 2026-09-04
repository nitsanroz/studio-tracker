"use client";

// The weekly plan on a phone: ONE DAY AT A TIME, people down the page.
//
// ⚠️⚠️ A SEPARATE COMPONENT, NOT THE GRID MADE RESPONSIVE, and the precedent is
// `client-mobile.tsx`. `weekly-plan.tsx` is a ~1,350-line fixed table — one
// 175px column per person, about 1,850px across — whose whole interaction model
// is dragging chips between cells, with a marquee, context menus, a resizable
// rail and two axes of sticky headers. Rendering that behind `md:hidden` would
// still mount all of it, and no amount of CSS turns a days × people grid into
// something a thumb can use.
//
// ⚠️ THE AXIS CHOICE IS THE WHOLE DESIGN. A grid has to lose one axis on a
// phone, and the day is the one worth keeping whole: the question a phone gets
// asked is "what is the team on today", and a person's own week is already on
// the home page (`MemberWeekHours` / `MyWeek`). So: a day strip across the top,
// and every column — people, Studio, then the dateless waiting list — as a
// section beneath it.
//
// ⚠️ Editing is by PICKER, never by drag: add through the shared `EntryModal`,
// and move through a sheet that names a person and a day. Everything writes
// through the same store methods the grid uses, so an hour planned on a phone is
// the same row as one planned on a laptop.

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MoreVertical, Plus } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import { DAY_NAMES, formatDayLabel, isWeekend, shiftDays, startOfWeek, toISODate } from "@/lib/format";
import { Avatar, ClientChip } from "./ui";
import { MobileSheet } from "./mobile-sheet";
import { ABSENCE_FILL, ABSENCE_LABELS, EntryModal, type CellTarget } from "./plan-entry-modal";
import type { PlanColumn, PlanEntry } from "@/lib/types";

/** The waiting list has no date, so it is addressed by this instead of an ISO day. */
const WAITING = "wl";

/**
 * "SUN", not "SUNDAY", in the day strip only.
 *
 * ⚠️ The desktop's `formatDayLabel` gives the full name and is right to — it has
 * a 96px column to print it in. Here seven of them plus the waiting list are
 * competing for a 375px strip, and the shorter label is what makes the next two
 * days visible without a swipe.
 */
const shortDay = (d: Date) => DAY_NAMES[d.getDay()].slice(0, 3);

/**
 * The day to open on.
 *
 * ⚠️⚠️ NOT SIMPLY "TODAY", and the studio week is why: it runs Sun–Thu, so on a
 * Friday or Saturday today is a day nobody plans work on — the page opened with
 * every person reading "Nothing planned", which looks broken rather than
 * accurate. On a weekend it opens on the NEXT Sunday, which is the day you are
 * actually looking ahead to, and the week shown moves with it.
 */
function openingDay(now: Date): { weekStart: Date; day: string } {
  const week = startOfWeek(now);
  if (!isWeekend(now)) return { weekStart: week, day: toISODate(now) };
  const nextSunday = shiftDays(week, 7);
  return { weekStart: nextSunday, day: toISODate(nextSunday) };
}

export function PlanMobile() {
  const { planColumns, planEntries, profiles, dayStates, openTask, deletePlanEntry } = useData();
  const canEdit = useIsAdmin();
  const todayIso = toISODate(new Date());

  /** Sunday of the week on screen, and the day within it — see `openingDay`. */
  const [weekStart, setWeekStart] = useState(() => openingDay(new Date()).weekStart);
  /** The day on screen, or `WAITING` for the dateless list. */
  const [day, setDay] = useState<string>(() => openingDay(new Date()).day);
  const [entryModal, setEntryModal] = useState<{ target: CellTarget; entry?: PlanEntry } | null>(
    null,
  );
  const [actions, setActions] = useState<PlanEntry | null>(null);
  const [moving, setMoving] = useState<PlanEntry | null>(null);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => shiftDays(weekStart, i)),
    [weekStart],
  );

  const columns = useMemo(
    () => [...planColumns].sort((a, b) => a.position - b.position).filter((c) => !c.hidden),
    [planColumns],
  );
  const dayCols = columns.filter((c) => c.type !== "waiting_list");
  const waitingCol = columns.find((c) => c.type === "waiting_list");

  /**
   * Entries keyed exactly as the grid keys them (`date|wl :: columnId`), so both
   * builds read one shape and a chip cannot appear in one and not the other.
   */
  const byCell = useMemo(() => {
    const map = new Map<string, PlanEntry[]>();
    for (const e of planEntries) {
      const key = `${e.date ?? WAITING}::${e.columnId}`;
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [planEntries]);

  const onWaiting = day === WAITING;
  const shownCols = onWaiting ? (waitingCol ? [waitingCol] : []) : dayCols;
  const dayState = dayStates.find((ds) => ds.dateFrom <= day && day <= ds.dateTo);

  /** How a cell names itself in the modal's heading and the move sheet. */
  const labelFor = (col: PlanColumn, iso: string) =>
    iso === WAITING ? col.name : `${col.name} · ${formatDayLabel(new Date(iso)).date}`;

  const jumpToToday = () => {
    const o = openingDay(new Date());
    setWeekStart(o.weekStart);
    setDay(o.day);
  };

  const stepWeek = (by: number) => {
    const next = shiftDays(weekStart, by * 7);
    setWeekStart(next);
    // ⚠️ Follow the same WEEKDAY into the new week rather than keeping the ISO
    // date, which would be a day outside the week now on screen — and land on
    // today when stepping back onto this week, so the strip and the body agree.
    const offset = onWaiting ? 0 : Math.max(0, days.findIndex((d) => toISODate(d) === day));
    const o = openingDay(new Date());
    // stepping back onto the week you started on returns you to that day, so the
    // strip and the body agree rather than leaving you on an arbitrary weekday
    setDay(toISODate(o.weekStart) === toISODate(next) ? o.day : toISODate(shiftDays(next, offset)));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-serif-accent text-2xl">Weekly plan</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => stepWeek(-1)}
            aria-label="Previous week"
            className="flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-muted"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={jumpToToday}
            className="flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-muted"
          >
            {isWeekend(new Date()) ? "Next week" : "Today"}
          </button>
          <button
            onClick={() => stepWeek(1)}
            aria-label="Next week"
            className="flex size-11 items-center justify-center rounded-lg border border-border bg-surface text-muted"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* The day strip. ⚠️ It SCROLLS and bleeds to the screen edges rather than
          squeezing seven days into 375px: five weekdays plus a weekend plus the
          waiting list cannot all be 44px wide, and shrinking them to fit is how
          "SUN 30" becomes unreadable. Same `-mx-4 px-4` bleed the log-time
          client chips use, so a swipe has somewhere to go. */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {days.map((d) => {
          const iso = toISODate(d);
          const { date } = formatDayLabel(d);
          const on = iso === day;
          const holiday = dayStates.some((ds) => ds.dateFrom <= iso && iso <= ds.dateTo);
          const count = dayCols.reduce(
            (n, c) => n + (byCell.get(`${iso}::${c.id}`)?.length ?? 0),
            0,
          );
          return (
            <button
              key={iso}
              onClick={() => setDay(iso)}
              aria-pressed={on}
              className={`flex min-h-11 shrink-0 flex-col items-center justify-center rounded-xl border px-2.5 py-1 ${
                on
                  ? "border-brand bg-brand text-white"
                  : holiday
                    ? "border-border bg-blue-100 text-foreground"
                    : isWeekend(d)
                      ? "border-border bg-weekend text-faint"
                      : "border-border bg-surface text-muted"
              }`}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                {iso === todayIso ? "Today" : shortDay(d)}
              </span>
              <span className={`text-xs tabular-nums ${on ? "" : "text-faint"}`}>{date}</span>
              {/* how much is on that day, so you can see where the week is heavy
                  without opening each one */}
              <span className={`text-[10px] tabular-nums ${on ? "text-white/70" : "text-faint"}`}>
                {count || "–"}
              </span>
            </button>
          );
        })}
        {waitingCol && (
          <button
            onClick={() => setDay(WAITING)}
            aria-pressed={onWaiting}
            className={`flex min-h-11 shrink-0 items-center rounded-xl border px-3 text-xs font-medium ${
              onWaiting ? "border-brand bg-brand text-white" : "border-dashed border-border-strong bg-surface text-muted"
            }`}
          >
            {waitingCol.name}
            <span className="ml-1.5 tabular-nums opacity-70">
              {byCell.get(`${WAITING}::${waitingCol.id}`)?.length ?? 0}
            </span>
          </button>
        )}
      </div>

      {dayState && !onWaiting && (
        <div className="rounded-xl border border-border bg-blue-100 px-3 py-2 text-xs font-medium">
          {dayState.label}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {shownCols.map((col) => {
          const entries = byCell.get(`${day}::${col.id}`) ?? [];
          const profile = col.profileId
            ? (profiles.find((p) => p.id === col.profileId) ?? null)
            : null;
          const target: CellTarget = { date: onWaiting ? null : day, columnId: col.id, label: labelFor(col, day) };
          return (
            <section key={col.id} className="rounded-2xl border border-border bg-surface shadow-card">
              <header className="flex items-center gap-2 px-3 py-2">
                {col.type === "member" && <Avatar profile={profile} size={22} emptyTitle={col.name} />}
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{col.name}</h2>
                {canEdit && (
                  <button
                    onClick={() => setEntryModal({ target })}
                    aria-label={`Add to ${col.name}`}
                    className="flex size-11 items-center justify-center rounded-lg text-faint hover:bg-brand-soft hover:text-brand"
                  >
                    <Plus size={18} />
                  </button>
                )}
              </header>
              {entries.length === 0 ? (
                <p className="px-3 pb-3 text-xs text-faint">Nothing planned.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border border-t border-border">
                  {entries.map((e) => (
                    <PlanRow
                      key={e.id}
                      entry={e}
                      canEdit={canEdit}
                      onOpen={() => {
                        // a task chip opens the task, which is where a task is
                        // edited — the grid's rule, kept
                        if (e.taskId) openTask(e.taskId);
                        else if (canEdit) setEntryModal({ target, entry: e });
                      }}
                      onActions={() => setActions(e)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        {shownCols.length === 0 && (
          <p className="rounded-2xl border border-border bg-surface p-4 text-sm text-faint">
            No plan columns yet — they are set up on a desktop.
          </p>
        )}
      </div>

      {entryModal && (
        <EntryModal
          target={entryModal.target}
          entry={entryModal.entry}
          onClose={() => setEntryModal(null)}
        />
      )}

      {actions && (
        <MobileSheet title="This plan entry" onClose={() => setActions(null)}>
          <div className="flex flex-col gap-2">
            {!actions.taskId && (
              <SheetAction
                label="Edit"
                onClick={() => {
                  const col = columns.find((c) => c.id === actions.columnId);
                  if (col)
                    setEntryModal({
                      target: {
                        date: actions.date,
                        columnId: actions.columnId,
                        label: labelFor(col, actions.date ?? WAITING),
                      },
                      entry: actions,
                    });
                  setActions(null);
                }}
              />
            )}
            <SheetAction label="Move to…" onClick={() => { setMoving(actions); setActions(null); }} />
            <SheetAction
              label="Remove from plan"
              danger
              onClick={() => {
                deletePlanEntry(actions.id);
                setActions(null);
              }}
            />
          </div>
        </MobileSheet>
      )}

      {moving && (
        <MoveSheet
          entry={moving}
          days={days}
          columns={columns}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}

/** One planned thing: what it is, and a separate target for what to do with it. */
function PlanRow({
  entry,
  canEdit,
  onOpen,
  onActions,
}: {
  entry: PlanEntry;
  canEdit: boolean;
  onOpen: () => void;
  onActions: () => void;
}) {
  const { tasks, clients } = useData();
  const task = entry.taskId ? tasks.find((t) => t.id === entry.taskId) : null;
  const client = clients.find((c) => c.id === (entry.clientId ?? task?.clientId));

  if (entry.type === "absence") {
    const kind = entry.absenceType ?? "day_off";
    return (
      <li>
        <button
          onClick={onOpen}
          className={`flex min-h-11 w-full items-center px-3 text-sm font-medium ${ABSENCE_FILL[kind]}`}
        >
          {ABSENCE_LABELS[kind]}
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center">
      <button onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left">
        {client && <ClientChip client={client} size="sm" link={false} />}
        <span className="bidi-auto min-w-0 flex-1 truncate text-sm">
          {task ? task.title : entry.text}
        </span>
      </button>
      {canEdit && (
        <button
          onClick={onActions}
          aria-label="What to do with this"
          className="flex size-11 shrink-0 items-center justify-center text-faint"
        >
          <MoreVertical size={16} />
        </button>
      )}
    </li>
  );
}

function SheetAction({
  label,
  danger,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`min-h-11 rounded-xl border border-border px-3 text-left text-sm font-medium ${
        danger ? "text-danger" : "text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Where a chip goes: a person and a day, chosen rather than dragged.
 *
 * ⚠️ It commits through `movePlanEntryToCell`, the same method the grid's drops
 * use — so moving a task into somebody else's column REASSIGNS the task to them,
 * exactly as it does on a desktop, and as one undo step. The copy says so,
 * because on a phone there is no drag to make it feel like a deliberate act.
 */
function MoveSheet({
  entry,
  days,
  columns,
  onClose,
}: {
  entry: PlanEntry;
  days: Date[];
  columns: PlanColumn[];
  onClose: () => void;
}) {
  const { movePlanEntryToCell, tasks, profiles } = useData();
  const [columnId, setColumnId] = useState(entry.columnId);
  const [date, setDate] = useState<string>(entry.date ?? WAITING);
  const waitingCol = columns.find((c) => c.type === "waiting_list");
  const col = columns.find((c) => c.id === columnId);
  const task = entry.taskId ? tasks.find((t) => t.id === entry.taskId) : null;
  const to = col?.type === "member" ? col.profileId : null;
  const reassigns = !!task && !!to && entry.columnId !== columnId && task.assigneeId !== to;
  const toName = profiles.find((p) => p.id === to)?.name ?? col?.name;
  // the waiting list is dateless, so picking it fixes the date too
  const targetDate = col?.type === "waiting_list" ? null : date === WAITING ? null : date;

  return (
    <MobileSheet title="Move to" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">Who</div>
          <div className="flex flex-wrap gap-1.5">
            {columns.map((c) => (
              <button
                key={c.id}
                onClick={() => setColumnId(c.id)}
                className={`min-h-11 rounded-xl border px-3 text-xs font-medium ${
                  c.id === columnId
                    ? "border-brand bg-brand-soft text-brand-dark"
                    : "border-border bg-surface text-muted"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        {col?.type !== "waiting_list" && (
          <div>
            <div className="mb-1 text-[11px] font-medium text-muted">When</div>
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
              {days.map((d) => {
                const iso = toISODate(d);
                const { date: dd } = formatDayLabel(d);
                return (
                  <button
                    key={iso}
                    onClick={() => setDate(iso)}
                    className={`flex min-h-11 shrink-0 flex-col items-center rounded-xl border px-2.5 py-1 ${
                      iso === date
                        ? "border-brand bg-brand-soft text-brand-dark"
                        : "border-border bg-surface text-muted"
                    }`}
                  >
                    <span className="text-[10px] font-semibold uppercase">{shortDay(d)}</span>
                    <span className="text-xs tabular-nums">{dd}</span>
                  </button>
                );
              })}
              {waitingCol && (
                <button
                  onClick={() => setDate(WAITING)}
                  className={`min-h-11 shrink-0 rounded-xl border px-3 text-xs font-medium ${
                    date === WAITING
                      ? "border-brand bg-brand-soft text-brand-dark"
                      : "border-dashed border-border-strong bg-surface text-muted"
                  }`}
                >
                  No date
                </button>
              )}
            </div>
          </div>
        )}
        {reassigns && (
          <p className="rounded-xl bg-brand-soft px-3 py-2 text-[11px] text-brand-dark">
            This also assigns the task to {toName}.
          </p>
        )}
        <button
          onClick={() => {
            movePlanEntryToCell(entry.id, { date: targetDate, columnId });
            onClose();
          }}
          className="min-h-11 rounded-xl bg-brand px-3 text-sm font-semibold text-white"
        >
          Move
        </button>
      </div>
    </MobileSheet>
  );
}
