"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Inbox,
  ListChecks,
} from "lucide-react";
import { StudioArrow } from "@/components/studio-arrow";
import { useData, useIsAdmin } from "@/lib/store";
import {
  formatFeedDate,
  greetingFor,
  toISODate,
} from "@/lib/format";
import {
  HOME_RANGES,
  comparablePrevRange,
  periodBounds,
  periodRange,
  rangeLabel,
} from "@/lib/period-math";
import { ConfirmDetailsBanner } from "../confirm-details-banner";
import { ClientChip } from "../ui";
import { PeriodStepper } from "../period-stepper";
import { WeekTimesheet } from "../week-timesheet";
import { MobileLogTimeSheet } from "../mobile-log-time";
import { MemberWeekHours } from "../member-week-hours";
import {
} from "@/lib/hours-split";
import { Celebrations } from "./celebrations";
import { DayLog } from "./day-log";
import { ClientBreakdown, MyGraphs } from "./graphs";
import { MemberWelcome, MyWeek } from "./member";
import { MyVacationCard } from "../vacation";
import { useVacation } from "@/lib/use-vacation";
import { tenureWords } from "./shared";
import type { HomeFilter } from "./shared";
import { StudioTeamStrip } from "./team-strip";
import { StatTiles, UpdatedBriefsAlert } from "./tiles";
import { FreelancerLogsAlert, StudioPace } from "./studio-pace";
import { EmptyState } from "../empty-state";



export function Dashboard() {
  const { profiles, tasks, clients, currentUserId, taskRequests, openTask } = useData();
  const me = profiles.find((p) => p.id === currentUserId);
  const isAdmin = useIsAdmin();
  // Members' own balance card; admins reach theirs on /vacation.
  const vacation = useVacation({ enabled: !isAdmin });

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
  // The pace chart's reference line wants the WHOLE previous period, not the
  // `prevRange` above (cut at today's point, for like-for-like tiles).
  const prevFullRange = useMemo(() => periodRange(rangeKey, periodOffset - 1), [rangeKey, periodOffset]);

  const firstName = me?.name.split(" ")[0] ?? "";
  const today = new Date();

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
        <h2 className="card-title">My tasks ({myTasks.length})</h2>
        <Link href="/my-tasks" className="flex items-center gap-1 text-xs text-brand hover:underline">
          All tasks <StudioArrow size={15} />
        </Link>
      </div>
      {myTasks.length === 0 ? (
        <EmptyState compact icon={ListChecks} text="Nothing assigned to you right now." />
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
          Second pass (Nitsan, on the phone): the client select is `md:` only —
          picking a client to scope your own hours is desk work. (The member's
          "Tasks assigned" counter is gone altogether since 2026-10-23: the My
          tasks pane's heading carries the same count.) That leaves identity +
          the period stepper, two rows. */}
      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-10 md:gap-y-3">
        {/* ⚠️ THE GREETING IS ONE HEADLINE (2026-10-23), in the studio website's
            voice: Saans at the page-title size with the one word that matters —
            the name — in brand-blue serif italic ("Want to apply?" on the site).
            The tenure, which was a serif counter beside it, reads as a plain line
            under it. Members get the same headline: theirs used to keep the old
            avatar + date + "2y 4m 14d" strip, with the greeting down in the hero,
            so the name appeared twice and the page read as two designs. The hero
            now leads with today's hours instead. */}
        <div className="min-w-0">
          <h1 className="page-title">
            {greetingFor(today)}, <span className="font-serif-accent font-normal text-brand">{firstName}</span>
          </h1>
          {me?.startDate && (
            <p className="mt-1 text-sm text-muted" title={`In the studio since ${me.startDate}`}>
              {tenureWords(me.startDate)} in the studio
            </p>
          )}
        </div>
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
          <StudioArrow size={18} className="ml-auto" />
        </Link>
      )}

      {isAdmin && <FreelancerLogsAlert />}

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

          {/* The studio's pace against the hours a workday that cover the
              month's costs — Nitsan and Michal watch it. Hours only; see
              studio-pace.tsx. Desk-only for now (laid out for a wide row). */}
          <div className="hidden md:block">
            <StudioPace />
          </div>

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
          {/* analytics — the running-total chart takes three fifths (design-lab
              "Graphs 1": the graphs were asked to be more prominent), hours by
              client the rest */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            {/* Kept on a phone: "hours over time" is a trend, and a trend is the
                one chart shape that still reads at 343px — it already renders
                through a `viewBox` at `width="100%"`, so it scales rather than
                being cropped. */}
            <div className="min-w-0 lg:col-span-3">
              <MyGraphs
                filter={filter}
                isAdmin={isAdmin}
                prevRange={prevFullRange}
                prevLabel={rangeLabel(rangeKey, periodOffset - 1)}
              />
            </div>
            {/* the split and the trend answer the same question, so they share a
                pane with a tab rather than competing for two slots.
                Hidden below md: reading a share is analysis, and analysis is a
                desk job. (It was first hidden for its donut, which couldn't fit
                a phone; the bars that replaced it could, if that's ever wanted.) */}
            <div className="hidden min-w-0 md:block lg:col-span-2">
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
            >
              <MyWeek />
            </MemberWelcome>
          )}
          {/* On a phone the vacation card keeps its own row here; from `md` it
              sits under My tasks, beside "Log my hours" (below), instead of
              spending a full-width row on one figure. */}
          <div className="md:hidden">
            <MyVacationCard vacation={vacation} />
          </div>
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
            <div className="flex flex-col gap-4">
              {compactTasksCard}
              <MyVacationCard vacation={vacation} />
            </div>
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

