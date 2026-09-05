"use client";

import { useEffect, useState } from "react";
import { formatHoursShort, formatDayMonth } from "@/lib/format";
import { useData } from "@/lib/store";
import { Avatar } from "@/components/ui";
import {
  useKeysWriteDown,
  KeysButton,
  KeysField,
  useKeysTaskWriteDown,
  KeysTaskButton,
  KeysTaskPanel,
} from "@/components/keys-write-down";
import type { InspectableCell } from "@/components/report-table";
import type { TimeEntry } from "@/lib/types";

/**
 * What is behind one hours cell of the client report: the split between the people
 * who logged it, and their individual log rows.
 *
 * ⚠️⚠️ STUDIO-ONLY BY CONSTRUCTION. This renders colleagues' names and the notes
 * they wrote for themselves. It is mounted by `client-reports` alone and reached
 * through `ReportTable`'s optional `onInspectCell`, which the public client report
 * does not pass — so there is no "is this the client?" flag anywhere in here to get
 * wrong. Never render this component from a public route.
 */

/** How wide the card is allowed to be, and how far it stays from the viewport edge. */
const W = 320;
const GAP = 8;

export function CellInspector({
  cell,
  rect,
  onEnter,
  onLeave,
}: {
  cell: InspectableCell;
  /** the hovered cell's box, in viewport coordinates */
  rect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { profiles, loadCellEntries } = useData();
  const key = `${cell.taskId}|${cell.from}|${cell.to}`;
  const [loaded, setLoaded] = useState<{ key: string; rows: TimeEntry[] } | null>(null);
  /**
   * Bumped after a write-down so the effect below re-reads.
   *
   * ⚠️ The card must NOT patch its own rows: a split changes ONE row here and adds
   * another on a different task, and a hand-patched list would disagree with the
   * cell's own total until the next poll. Re-reading is the only version that can
   * be trusted, and it is one small query.
   */
  const [reloads, setReloads] = useState(0);


  /**
   * ⚠️⚠️ THE RESULT CARRIES THE CELL IT BELONGS TO, and that is what makes the card
   * honest. The pointer moves from cell to cell while this component stays mounted,
   * so rows can arrive after the heading has changed — a plain `TimeEntry[]` would
   * show one cell's log under another cell's total. Comparing keys also means the
   * "loading" state needs no `setEntries(null)` in the effect body, which is a
   * cascading render the linter rightly objects to.
   * ⚠️ `alive` still guards the unmount, so a settled fetch cannot set state on a
   * card the pointer has already left.
   */
  useEffect(() => {
    let alive = true;
    void loadCellEntries(cell.taskId, cell.from, cell.to).then((rows) => {
      if (alive) setLoaded({ key: `${key}#${reloads}`, rows });
    });
    return () => {
      alive = false;
    };
  }, [key, cell.taskId, cell.from, cell.to, loadCellEntries, reloads]);

  const entries = loaded?.key === `${key}#${reloads}` ? loaded.rows : null;

  /**
   * Minutes per person, biggest first.
   *
   * ⚠️ FROM THE FETCHED ROWS, not from the cell's total: the two can legitimately
   * differ for a moment while the load is in flight, and the bar has to add up to
   * the list underneath it or the card contradicts itself.
   */
  const byPerson = new Map<string | null, number>();
  for (const e of entries ?? []) {
    byPerson.set(e.userId, (byPerson.get(e.userId) ?? 0) + e.minutes);
  }
  const split = [...byPerson.entries()]
    .map(([userId, minutes]) => ({
      userId,
      minutes,
      profile: profiles.find((p) => p.id === userId) ?? null,
      name:
        profiles.find((p) => p.id === userId)?.name ??
        (entries ?? []).find((e) => e.userId === userId)?.legacyAuthorName ??
        "Unknown",
    }))
    .sort((a, b) => b.minutes - a.minutes);
  const isLoaded = entries !== null;
  const total = split.reduce((n, s) => n + s.minutes, 0);

  /**
   * The card-level write-down, scoped to THIS CELL's dates — so "two of Nadav's
   * hours that week" cannot quietly reach into a different week's rows.
   * ⚠️ Fed from `split`, the same figures drawn on the bar above it, so the picker
   * can never offer hours the card is not showing.
   */
  const taskKeys = useKeysTaskWriteDown({
    taskId: cell.taskId,
    options: split
      .filter((s) => s.userId)
      .map((s) => ({ userId: s.userId as string, name: s.name, minutes: s.minutes })),
    range: { from: cell.from, to: cell.to },
    onMoved: () => setReloads((n) => n + 1),
  });

  /**
   * ⚠️ FLIPPED RATHER THAN CLIPPED. These cells sit in a horizontally scrolling
   * table that runs to the right edge of a wide screen, so a card that always
   * opened rightward would be half off-screen for the newest columns — which are
   * the ones anybody actually hovers.
   */
  const flipX = rect.left + W + GAP > window.innerWidth;
  const left = flipX ? Math.max(GAP, rect.right - W) : Math.max(GAP, rect.left);
  const openUp = rect.bottom + 260 > window.innerHeight && rect.top > 260;
  const style: React.CSSProperties = openUp
    ? { left, bottom: window.innerHeight - rect.top + GAP, width: W }
    : { left, top: rect.bottom + GAP, width: W };

  return (
    <div
      // ⚠️ Above the table's own pinned columns (`z-20`) and its scroll proxy, but
      // below a real modal — this is a hover card, and a dialog opened over it must
      // still cover it.
      className="fixed z-40 rounded-2xl border border-border bg-surface p-3 shadow-2xl"
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold" title={cell.taskTitle}>
          {cell.taskTitle}
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {formatHoursShort(cell.minutes)}
        </span>
      </div>
      <div className="text-[11px] text-faint">{cell.label}</div>

      {!isLoaded && <div className="mt-3 text-[11px] text-faint">Loading the log…</div>}

      {isLoaded && split.length === 0 && (
        // Reachable: the cell's number comes from the published/preview snapshot
        // while these rows come from the database now, so a deleted or re-dated
        // entry leaves a figure with nothing behind it. Say that rather than
        // showing an empty card.
        <div className="mt-3 text-[11px] text-warning">
          No log rows in this range — the entry may have been moved or re-dated.
        </div>
      )}

      {isLoaded && split.length > 0 && (
        <>
          {/* The split, as one bar. ⚠️ Percentage widths of the FETCHED total, so
              the segments always fill the bar exactly and a rounding gap cannot
              read as unaccounted time. */}
          <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-background">
            {split.map((s, i) => (
              <div
                key={s.userId ?? `legacy-${i}`}
                className={BAR[i % BAR.length]}
                style={{ width: `${(s.minutes / total) * 100}%` }}
                title={`${s.name} — ${formatHoursShort(s.minutes)}`}
              />
            ))}
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {split.map((s, i) => (
              <li key={s.userId ?? `legacy-${i}`} className="flex items-center gap-2 text-xs">
                <span className={`size-2 shrink-0 rounded-full ${BAR[i % BAR.length]}`} />
                <Avatar profile={s.profile} size={18} emptyTitle={s.name} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatHoursShort(s.minutes)}
                </span>
                <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-faint">
                  {Math.round((s.minutes / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>

          {taskKeys.available && (
            <div className="mt-2">
              <KeysTaskButton state={taskKeys} />
              <KeysTaskPanel state={taskKeys} />
            </div>
          )}

          {/* The rows themselves. ⚠️ Scrolls at a fixed height rather than growing:
              a task with forty entries in one week would otherwise make a card
              taller than the screen, which cannot be scrolled to on hover. */}
          <div className="mt-2.5 max-h-40 overflow-y-auto border-t border-border pt-2">
            <ul className="flex flex-col gap-1.5">
              {(entries ?? []).map((e) => (
                <InspectorLogRow key={e.id} entry={e} onMoved={() => setReloads((n) => n + 1)} />
              ))}
            </ul>
          </div>

          {/* ⚠️ ONE FOOTNOTE FOR THE CARD, not a tooltip per row. The asterisk is
              only useful if its meaning is on screen: this card is read right
              before a bill goes out, and hovering a row to discover that a date
              was inferred is not a thing anyone does under time pressure. Only
              rendered when the card actually contains one. */}
          {(entries ?? []).some((e) => e.dateEstimated) && (
            <p className="mt-1.5 text-[10px] leading-snug text-faint">
              * date estimated from the task&apos;s activity window — the hours are
              recorded, the day they fell on is inferred.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Segment colours.
 *
 * ⚠️ A FIXED ROTATION, NOT THE MEMBERS' OWN COLOURS: profiles carry no colour, and
 * borrowing the CLIENT palette here would put a client's identity colour on a
 * person. The list beneath the bar carries the same swatch, so the mapping is read
 * off the card rather than remembered.
 */
const BAR = ["bg-brand", "bg-brand-dark", "bg-success", "bg-warning", "bg-faint"];

/**
 * One log row: day, who, hours, and the write-down.
 *
 * Its own component because `useKeysWriteDown` is a hook and these rows are a
 * `map` — and because each row's field has to open independently of its
 * neighbours.
 */
function InspectorLogRow({ entry, onMoved }: { entry: TimeEntry; onMoved: () => void }) {
  const { profiles } = useData();
  /**
   * ⚠️ The card RE-READS after a move rather than patching its rows: a split
   * changes one row here and adds another on a different task, and a hand-patched
   * list would disagree with the cell's own total until the next poll.
   */
  const keys = useKeysWriteDown(entry, onMoved);
  return (
    <li className="text-[11px] leading-snug">
      <div className="flex items-baseline gap-2">
        {/* ⚠️ THE ASTERISK IS NOT DECORATION — this card is what the studio reads
            immediately before publishing a client's bill, and a date recovered
            from a task's activity window used to render here identically to a
            timestamp somebody actually logged this week. `task-panel.tsx` has
            marked estimates since v0.99.34; this surface, the one that decides
            money, did not. Same convention deliberately: faint italic + "*". */}
        <span
          className={`shrink-0 ${entry.dateEstimated ? "italic text-faint" : "text-faint"}`}
          title={
            entry.dateEstimated
              ? "Date estimated from this task's activity window — the hours are from the task's own recorded total"
              : undefined
          }
        >
          {formatDayMonth(entry.date)}
          {entry.dateEstimated ? "*" : ""}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {profiles.find((p) => p.id === entry.userId)?.name ?? entry.legacyAuthorName ?? "Unknown"}
        </span>
        <span className="shrink-0 tabular-nums">{formatHoursShort(entry.minutes)}</span>
        {/* ⚠️ Per ROW, not per cell, and that is the whole point: a write-down is
            "this person's four hours on Tuesday were slow", and a cell-level
            control would make the studio choose whose hours to cut afterwards. */}
        <KeysButton state={keys} label={false} />
      </div>
      <KeysField state={keys} />
      {/* ⚠️ Not truncated to one line: the description is the reason to open this
          card at all, and "Fixed the thing the client asked about on…" cut at 40
          characters answers nothing. */}
      {entry.description?.trim() ? (
        <div className="text-muted">{entry.description}</div>
      ) : (
        <div className="text-faint">no description</div>
      )}
    </li>
  );
}
