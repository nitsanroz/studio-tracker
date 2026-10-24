"use client";

// The member home: the blue hero, the week ahead, and the portrait that breaks
// out of it.
//
// ⚠️ `todayLine` reads `timeEntries`, NEVER `entrySums` — the sums are fetched on
// the COLD tier and can be ten minutes stale, and a line reading "Nothing logged
// today" ten minutes after you logged an hour is worse than no line at all. Any
// new surface showing a figure for TODAY needs the same treatment.

import Link from "next/link";
import { DEFAULT_PORTRAIT, MemberPhoto } from "../member-photo";
import { Celebrations } from "./celebrations";
import { splitHours } from "./shared";
import type { HomeFilter } from "./shared";
import { StatTile } from "./tiles";
import { DAY_NAMES, formatHours, shiftDays, startOfWeek, toISODate } from "@/lib/format";
import { dailyTargetMinutes } from "@/lib/members";
import { useData } from "@/lib/store";
import type { Profile } from "@/lib/types";
import { useIsNarrow } from "@/lib/use-is-narrow";
import { useMemberPortraits } from "@/lib/use-member-portraits";
import { StudioArrow } from "@/components/studio-arrow";
import { useMemo } from "react";


export function MyWeek() {
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
    const all = Array.from({ length: 5 }, (_, i) => shiftDays(weekStart, i)); // Sun–Thu
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
        <h2 className="card-title">My week</h2>
        <Link href="/plan" className="flex items-center gap-1 text-xs text-brand hover:underline">
          Weekly plan <StudioArrow size={15} />
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


/** Member welcome: blue hero with the member's cut-out photo + this-week summary, then 3 KPI tiles. */
export function MemberWelcome({
  me,
  filter,
  prevRange,
  onLogTime,
  children,
}: {
  // ⚠️ The whole `Profile`, not the three fields the hero draws: the caller
  // already found it in `profiles`, and `dailyTargetMinutes` needs its capacity.
  // Narrowing here only meant looking the same object up a second time.
  me: Profile;
  filter: HomeFilter;
  prevRange: { from: string; to: string } | null;
  /** Phone-only: opens the log-time sheet, since `#log` has nothing to jump to. */
  onLogTime: () => void;
  /** Sits under the figures, beside the hero (My week). */
  children?: React.ReactNode;
}) {
  const { entrySums, timeEntries, tasks } = useData();
  const portraits = useMemberPortraits();
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
    // [plain lead, serif-italic word] — the hero's headline, in the website's voice.
    if (min <= 0) return ["Nothing logged ", "today"];
    // At or past the target the remaining figure is noise — say it's done.
    if (min >= target) return [`${formatHours(min)} logged — day `, "complete"];
    return [`${formatHours(min)} of ${formatHours(target)} logged `, "today"];
  }, [timeEntries, me]);
  const now = new Date();
  const dateLine = `${DAY_NAMES[now.getDay()]}, ${now.getDate()}/${now.getMonth() + 1}`;

  const [hFig, hUnit] = splitHours(scoped.min);
  const [adFig, adUnit] = splitHours(scoped.perDay, true);

  return (
    // ⚠️ RE-LAID OUT 2026-10-24 (Nitsan: "kpi cubes are big and empty, space
    // seems to be wasted"). The four figures were a 2×2 of full cards beside the
    // hero, each a number floating in ~150px of white. They are ONE strip now,
    // and the hero's other neighbour is My week (passed in as `children`), so
    // the first screen carries the week instead of air.
    <div className="grid items-stretch gap-2 lg:grid-cols-12 lg:gap-4">
      {/* mt-9 is the room the portrait's head needs above the panel. The hero can't
          clip (the head breaks out of the top), so the decorative disc gets its own
          clipping layer instead of relying on overflow-hidden here.
          ⚠️ Below `sm` the portrait is not rendered at all, so that 36px was pure
          gap on the screen with the least of it to spare. */}
      <div
        className="relative rounded-2xl bg-brand px-6 py-6 text-white sm:mt-9 lg:col-span-6"
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
          {/* ⚠️ The greeting is the PAGE's headline now, same as the admin's
              (2026-10-23) — this panel used to carry it, and the header above
              carried the name again. What the panel leads with instead is the one
              figure nothing else on the page shows — today against your own day —
              which is also the one the button underneath acts on. The sentence
              before that reported three figures the screen already carried (the
              week's hours, the open-task count, the due count). The date line
              under it is what the old header strip used to say. */}
          <h2 className="text-[34px] font-medium leading-tight tracking-[-0.02em]">
            {todayLine[0]}
            <span className="font-serif-accent font-normal">{todayLine[1]}</span>
          </h2>
          <div className="mt-1.5 text-sm text-white/85">{dateLine}</div>
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
          <MemberPhoto
            name={me.name}
            src={me.photoUrl}
            portrait={portraits[me.id] ?? DEFAULT_PORTRAIT}
            variant="hero"
            fill
          />
        </div>
      </div>

      {/* mt-9 only earns its place at `lg`, where this is the column BESIDE the
          hero and has to start level with it. Stacked under the hero it is just
          a 36px hole between two panes. */}
      <div className="mt-2 flex min-w-0 flex-col gap-2 md:gap-4 lg:col-span-6 lg:mt-9">
        {/* Four boxes in one row (Nitsan, 2026-10-24: a box each, but not the
            2×2 of tall cards beside the hero). */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:gap-4">
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
        {children}
      </div>
    </div>
  );
}
