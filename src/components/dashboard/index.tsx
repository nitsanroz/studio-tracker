"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Inbox } from "lucide-react";
import { useData, useIsAdmin } from "@/lib/store";
import {
  formatFeedDate,
  greetingFor,
  toISODate,
  DAY_NAMES,
} from "@/lib/format";
import {
  HOME_RANGES,
  comparablePrevRange,
  periodBounds,
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
import { MemberWelcome, MyAvatar, MyWeek } from "./member";
import { tenureSince } from "./shared";
import type { HomeFilter } from "./shared";
import { StudioTeamStrip } from "./team-strip";
import { StatTiles, UpdatedBriefsAlert } from "./tiles";



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

