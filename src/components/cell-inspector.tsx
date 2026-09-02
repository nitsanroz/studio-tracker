"use client";

import { useEffect, useState } from "react";
import { formatHoursShort, formatDayMonth } from "@/lib/format";
import { useData } from "@/lib/store";
import { formatHoursDecimal } from "@/lib/format";
import { Avatar } from "@/components/ui";
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
  keysTaskId,
  onEnter,
  onLeave,
}: {
  cell: InspectableCell;
  /** the hovered cell's box, in viewport coordinates */
  rect: DOMRect;
  /**
   * The client's Keys task, or null when none is set — see `Client.keysTaskId`.
   *
   * ⚠️ Null HIDES the write-down entirely rather than disabling it: an admin who
   * has not chosen a keys task has nowhere for the hours to go, and a control that
   * explains itself only after a click is worse than one that is not there.
   * ⚠️ Also null when the hovered cell IS the keys task, since writing keys hours
   * down to themselves is a no-op the caller must not offer.
   */
  keysTaskId: string | null;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const { profiles, loadCellEntries, writeDownToKeys } = useData();
  /** which entry's write-down field is open, and what has been typed into it */
  const [writing, setWriting] = useState<{ id: string; hours: string } | null>(null);
  const [busy, setBusy] = useState(false);
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
   * ⚠️⚠️ THE TYPED FIGURE IS HOURS AND THE STORE TAKES MINUTES — and the rounding
   * is where a write-down would otherwise lie. `1.6` hours is 96 minutes exactly;
   * a value that does not land on a whole minute is REFUSED rather than rounded,
   * because rounding down under-bills the studio by a minute a time and rounding up
   * over-bills the client, and neither is a decision this field should make quietly.
   */
  const commitWriteDown = async (e: TimeEntry) => {
    if (!keysTaskId || !writing || busy) return;
    const hours = Number(writing.hours.trim());
    const minutes = hours * 60;
    if (!Number.isFinite(hours) || hours <= 0 || !Number.isInteger(minutes) || minutes > e.minutes) return;
    setBusy(true);
    const ok = await writeDownToKeys(e.id, minutes, keysTaskId);
    setBusy(false);
    if (ok) {
      setWriting(null);
      setReloads((n) => n + 1);
    }
  };

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

          {/* The rows themselves. ⚠️ Scrolls at a fixed height rather than growing:
              a task with forty entries in one week would otherwise make a card
              taller than the screen, which cannot be scrolled to on hover. */}
          <div className="mt-2.5 max-h-40 overflow-y-auto border-t border-border pt-2">
            <ul className="flex flex-col gap-1.5">
              {(entries ?? []).map((e) => (
                <li key={e.id} className="text-[11px] leading-snug">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-faint">{formatDayMonth(e.date)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {profiles.find((p) => p.id === e.userId)?.name ??
                        e.legacyAuthorName ??
                        "Unknown"}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatHoursShort(e.minutes)}</span>
                    {/* ⚠️ Per ROW, not per cell, and that is the whole point: a
                        write-down is "this person's four hours on Tuesday were
                        slow", and a cell-level control would make the studio
                        choose whose hours to cut after the fact. */}
                    {keysTaskId && (
                      <button
                        onClick={() =>
                          setWriting((w) =>
                            w?.id === e.id
                              ? null
                              : { id: e.id, hours: formatHoursDecimal(e.minutes) },
                          )
                        }
                        title="Move some of these hours to the client's Keys task, so they are not billed"
                        className={`shrink-0 rounded px-1 text-[10px] font-semibold ${
                          writing?.id === e.id
                            ? "bg-brand text-white"
                            : "text-faint hover:bg-background hover:text-brand"
                        }`}
                      >
                        keys
                      </button>
                    )}
                  </div>
                  {writing?.id === e.id && (
                    <div className="mt-1 flex items-center gap-1.5 rounded-lg bg-background px-1.5 py-1">
                      <input
                        autoFocus
                        value={writing.hours}
                        onChange={(ev) => setWriting({ id: e.id, hours: ev.target.value })}
                        onKeyDown={(ev) => {
                          if (ev.key === "Escape") setWriting(null);
                          if (ev.key === "Enter") void commitWriteDown(e);
                        }}
                        className="w-12 rounded border border-border bg-surface px-1 py-0.5 text-right text-[11px] tabular-nums outline-none focus:border-brand"
                      />
                      <span className="text-[10px] text-muted">
                        h of {formatHoursDecimal(e.minutes)} → Keys
                      </span>
                      <button
                        onClick={() => void commitWriteDown(e)}
                        disabled={busy}
                        className="ml-auto rounded-md bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
                      >
                        {busy ? "Moving…" : "Move"}
                      </button>
                    </div>
                  )}
                  {/* ⚠️ Not truncated to one line: the description is the reason to
                      open this card at all, and "Fixed the thing the client asked
                      about on…" cut at 40 characters answers nothing. */}
                  {e.description?.trim() ? (
                    <div className="text-muted">{e.description}</div>
                  ) : (
                    <div className="text-faint">no description</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
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
