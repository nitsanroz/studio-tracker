"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { formatHoursShort } from "@/lib/format";
import { capTone } from "@/lib/cap";
import { parseISO } from "@/lib/format";
import { daysBetween } from "@/lib/period-math";
import { ClientAvatar } from "@/components/client-avatar";
import { ReportTable, ViewToggle } from "@/components/report-table";
import { toggleIn } from "@/lib/toggle";
import { useIsNarrow } from "@/lib/use-is-narrow";
import type { ReportSnapshot, ReportViewFlags } from "@/lib/types";

/** `1/8` — compact enough to sit inside a period label. */
function dm(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d}/${m}`;
}

/**
 * Whole days from today to the end of the period, floored at 0.
 *
 * ⚠️ `daysBetween` from `period-math`, NOT `(end - now) / 86_400_000`. That module's
 * version floors both dates to local midnight and rounds, which is what makes it
 * survive a clocks-change — the whole reason `addDays` was deleted from the app in
 * v1.23.0. 0 means the period ends today; a period already past reads 0 too, which
 * is the honest answer to "how much time is left".
 */
function daysLeftIn(to: string): number {
  return Math.max(0, daysBetween(new Date(), parseISO(to)));
}

/**
 * Client-facing snapshot view. The snapshot arrives already sanitized by the
 * server (see page.tsx `sanitizeSnapshot`) — admin-hidden tasks and columns are
 * gone from the data entirely, so there is no reveal/toggle for those: the client
 * physically cannot see hidden rows/columns. `hiddenColumns` only ever carries
 * the leading estimate/total columns, whose values were already nulled.
 *
 * ⚠️ `viewFlags` is a DIFFERENT thing and the difference matters. Those are the
 * filters the studio had on when it published — how the report opens — and the
 * client can switch them off, because the data behind them was deliberately sent.
 * Anything that must not be seen belongs in the hidden lists above, not here.
 */
/**
 * The studio's `&more` mark.
 *
 * ⚠️⚠️ PUT THE RESPONSIVE `hidden` / `sm:*` ON `className`, WHICH LANDS ON THE
 * WRAPPER — never reach past it to the mask span. `.brand-ampmore` sets
 * `display: inline-block` in globals.css, which is UNLAYERED, while Tailwind emits
 * display utilities inside `@layer utilities`, so the unlayered rule wins whatever
 * the specificity and a `sm:hidden` on the span is silently inert. Measured: with
 * it on the span, BOTH instances rendered at 944px. Third time this trap has cost
 * time here (v1.12.0 form fields, v1.22.1 `.brand-wordmark`).
 *
 * ⚠️ It is rendered TWICE on this page and that is deliberate — the same call
 * v1.22.1 made on the public Gantt. On a phone the mark belongs on the client-name
 * row ("up inline with client name just aligne to right"); on a desktop it is the
 * last item in the header's right-hand cluster, beside the billing box. The figures
 * and the period selector wrap between those two positions, so ONE DOM ORDER
 * CANNOT SERVE BOTH. It costs nothing to duplicate: a CSS-mask span, no image, no
 * request.
 */
function AmpMark({ size, className = "" }: { size: string; className?: string }) {
  return (
    <span className={`shrink-0 ${className}`}>
      <span className={`brand-ampmore bg-brand ${size}`} role="img" aria-label="Studio&more" />
    </span>
  );
}

/**
 * "Updated 25 Aug 2026" — when the studio last published this snapshot.
 *
 * ⚠️ A `span`, deliberately NOT a button or a chip: nothing happens when you press
 * it, and on a page a client only reads, anything shaped like a control invites a
 * click that goes nowhere. A CLOCK rather than a refresh arrow for the same reason
 * — a refresh glyph is a verb. It sits inches from the period selector, which IS
 * outlined to look pressable, so that contrast has to stay legible.
 *
 * ⚠️ Also rendered twice, for the same reason as the mark: on a desktop it belongs
 * in the table pane's top-right corner, on a phone beside the billing box, and the
 * two rows in between are full (two 44px capsules there, the figures here). Pass
 * the display utility in `className`; exactly one instance may be visible.
 */
function UpdatedStamp({ at, className = "" }: { at: string; className?: string }) {
  return (
    <span className={`items-center gap-1.5 text-[11px] font-medium text-muted ${className}`}>
      <Clock size={12} aria-hidden />
      Updated {at}
    </span>
  );
}

export function PublicReportView({
  clientName,
  clientColor,
  clientIcon,
  clientIconUrl,
  snapshot,
  publishedAt,
  hiddenColumns,
  periodTotals,
  periodActiveTasks,
  viewFlags,
}: {
  clientName: string;
  clientColor: string;
  /** the client's own mark, so their report looks like they do in the studio */
  clientIcon: string | null;
  clientIconUrl: string | null;
  snapshot: ReportSnapshot;
  publishedAt: string | null;
  hiddenColumns: string[];
  /** True hours per visible period, spanning hidden tasks too — see `sanitizeSnapshot`. */
  periodTotals: number[];
  /** Tasks with hours in each visible period, spanning hidden ones — same rule as `periodTotals`. */
  periodActiveTasks: number[];
  viewFlags: ReportViewFlags | null;
}) {
  const [periodOnly, setPeriodOnly] = useState(viewFlags?.periodOnly ?? false);
  const [hideEmptyRows, setHideEmptyRows] = useState(viewFlags?.hideEmptyRows ?? false);
  const [foldedSections, setFoldedSections] = useState<string[]>([]);
  const [periodsOpen, setPeriodsOpen] = useState(false);
  // ⚠️ For the avatar SIZE only, which is a number rather than a class — the
  // hook returns false on the first render, so a phone paints 56px for one
  // frame. Harmless here; anything structural stays on `sm:` classes.
  const narrow = useIsNarrow();
  const lastUpdated = publishedAt
    ? new Date(publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  /**
   * Per-period charged totals.
   *
   * ⚠️ FROM `periodTotals`, NOT SUMMED FROM THE ROWS ON SCREEN. Summing the
   * visible rows made hiding a task change the client's figures — the defect
   * v1.29.0 fixed. (It named two surfaces that no longer exist, the tile row and
   * the Billing periods aside; the rule now protects the three header figures,
   * and `remaining` is gone with the tiles.) Hiding is a focus tool, not
   * confidentiality (the same reason `totalMinutes` spans hidden periods), so
   * the summary has to be the real one. Computed server-side before the hidden
   * rows are removed, since afterwards those hours are simply gone.
   */
  const periodSummary = useMemo(
    () =>
      snapshot.periods.map((p, i) => ({
        ...p,
        minutes: periodTotals[i] ?? 0,
        activeTasks: periodActiveTasks[i] ?? 0,
      })),
    [snapshot, periodTotals, periodActiveTasks],
  );

  /**
   * ⚠️ NO PERIOD FILTER HERE, AND THAT IS THE POINT: hidden period columns are
   * already GONE from `snapshot.periods`, removed server-side by
   * `sanitizeSnapshot` before this component ever runs.
   *
   * This used to filter on `hiddenColumns.includes(columnKey(i))`, which could
   * never match — `hiddenColumns` on this page only ever holds "estimate" and/or
   * "total" (the two leading columns, whose values are nulled rather than
   * dropped), while `columnKey` returns `p:{i}`. So it kept every element and
   * merely read as though the view were enforcing the rule. Anyone trusting that
   * could move period-hiding into the client, or drop the server-side filtering
   * believing this covered it, and either would ship hidden columns to the
   * browser. The enforcement is server-side, full stop.
   */
  /**
   * The period the client is currently inside — the last one, since periods are
   * built in date order.
   *
   * ⚠️ `delivered` (the all-periods total) and `remaining` (cap − charged) are
   * GONE with the tiles that showed them. Nitsan removed "Delivered to date", and
   * the cap now reads as `12h/150h` beside the client's name, which says the same
   * thing as a cap-plus-remaining pair without asking the reader to subtract.
   */
  const current = periodSummary.at(-1) ?? null;

  return (
    /* ⚠️ FLUID, not `max-w-6xl`. Nitsan: "all page should expand responsively to all
       screen inclusing titles logos and table so it fits the screen size." A client
       on a 27" screen was reading a 1152px column with the table scrolling inside
       it while the window sat empty either side — the same complaint v1.9.2 fixed
       on the public Gantt. Capped at 2200px only so it does not stretch absurdly on
       an ultrawide, and the padding grows with the screen. */
    <main className="mx-auto w-full max-w-[2200px] p-2 sm:p-6 lg:p-10">
      {/*
        ⚠️ TWO CLUSTERS, NOT ONE ROW OF FOUR THINGS — Nitsan's layout: identity on the
        left, and everything that answers "how much / how current" pushed to the
        right, in the order figures → billing box → mark ("next billing box align to
        right next to &more logo… 3 data elements can be aligned right to the billing
        box"). `items-center` rather than `items-start`, so the right cluster sits
        level with two lines of large serif on the left instead of riding above them.
      */}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-x-10 gap-y-4">
        <div className="flex min-w-0 basis-full items-center gap-3 sm:basis-auto">
          {/* ⚠️ The real `ClientAvatar`, not a letter in a coloured box — Nitsan:
              "you can use client avatar in the color cube - just as a client looks
              in the system". It falls back to the glyph and then to the initial on
              its own, so a client with no mark looks exactly as it did before. */}
          <ClientAvatar
            client={{ name: clientName, color: clientColor, icon: clientIcon, iconUrl: clientIconUrl }}
            size={narrow ? 44 : 56}
            className="shrink-0"
          />
          <div className="min-w-0">
            {/* The name grows with the screen — it is the page's title, and a 3xl
                heading on a 2560px page reads as a caption. */}
            {/* ⚠️ `leading-tight` + a small negative margin, so the caption sits
                under the name rather than floating below it. The default line
                height on a 5xl serif leaves ~14px of air, which reads as two
                separate things instead of a title and its subtitle. Applied to
                the hours pair below as well — they are set alike on purpose, so
                they have to be spaced alike. */}
            <h1 className="font-serif-accent truncate text-3xl leading-tight lg:text-4xl xl:text-5xl">
              {clientName}
            </h1>
            <p className="-mt-0.5 text-sm text-muted">Hours report</p>
          </div>
          {/* The PHONE instance — see `AmpMark` for why there are two. `ml-auto`
              pushes it to the right end of the name row, which is `basis-full`
              below `sm` and so spans the screen. */}
          <AmpMark size="h-8" className="ml-auto sm:hidden" />
        </div>

        {/* ⚠️ Below `sm` this is `w-full`, so it wraps UNDER the name and its own
            children stack; from `sm` it shrinks to its content and hugs the right
            edge. That is what lets one DOM order serve both shapes here — unlike the
            mark, which genuinely needs two instances. */}
        <div className="flex w-full flex-wrap items-center gap-x-8 gap-y-3 sm:w-auto sm:justify-end lg:gap-x-10">
          {current && (
            /* ⚠️ Three big numbers in a row need real space between them or they
               read as one figure ("12h 0 3"). Wider than the 16px this started at,
               and it wraps rather than squeezing on a narrow screen. */
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 lg:gap-x-10">
              {/* ⚠️ Set like the client NAME and its subtitle, deliberately — same
                  serif face, same sizes, same muted caption beneath. Nitsan's call:
                  the two are a matched pair at the top of the page, so the hours
                  read as the page's second headline rather than as a stray stat in
                  a different typeface. */}
              <div>
                <div
                  className={`font-serif-accent text-3xl leading-tight tabular-nums lg:text-4xl xl:text-5xl ${capTone(current.minutes, current.hourCap)}`}
                >
                  {formatHoursShort(current.minutes)}
                  {current.hourCap != null && (
                    <span className="text-lg opacity-70 lg:text-xl xl:text-2xl">/{current.hourCap}h</span>
                  )}
                </div>
                <p className="-mt-0.5 text-sm text-muted">this period</p>
              </div>

              {/* Set exactly like the pair beside it — the client asked how much of
                  the period is gone, and time left is the other half of that. */}
              <div>
                <div className="font-serif-accent text-3xl leading-tight tabular-nums lg:text-4xl xl:text-5xl">
                  {daysLeftIn(current.to)}
                </div>
                <p className="-mt-0.5 text-sm text-muted">days left</p>
              </div>

              <div>
                <div className="font-serif-accent text-3xl leading-tight tabular-nums lg:text-4xl xl:text-5xl">
                  {current.activeTasks}
                </div>
                <p className="-mt-0.5 text-sm text-muted">active tasks</p>
              </div>

              {/*
                ⚠️⚠️ FOUR ROUNDS, AND THE TINT HERE IS THE OPPOSITE OF THE UPDATED
                STAMP'S — read both together before changing either. It shipped as a
                bordered pill reading `Aug (20/7 – 20/8) 12h` and every round took
                something out: no brackets, no chip, then "too big", then "oh wait
                hours this perios is allready there", then "just write the billing
                period name + dates". So: one small PLAIN-SANS line (the serif accent
                is italic and its numerals plus an en dash came out as a tangle —
                "looks messy"), name and range held apart by gap-3 rather than a word
                space, and NO hours, because `12h this period` is the first figure in
                this very row and the pill was printing that number twice.
                ⚠️ Then he asked for "a slightly tinted cube… to sho its pressed" —
                so this element DOES carry chrome, while the Updated stamp below was
                deliberately DE-chipped for looking pressable. That is not an
                inconsistency: on a page a client only reads, the one thing that
                opens has to look like it does, and nothing else may.
                ⚠️ It is a weak OUTLINE, not a fill — his call, "mayeb a weak outline
                is better the fill to that cube", and he is right: a filled block
                sitting beside three unfilled figures reads as a highlight on the
                data rather than as a control. Hover firms the border, and OPEN turns
                it brand with the faintest wash, so the pressed state is unmistakable
                without the resting state shouting.
              */}
              <div className="flex basis-full items-center gap-3 sm:basis-auto">
                <div className="relative">
                  <button
                    onClick={() => setPeriodsOpen((v) => !v)}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                      periodsOpen
                        ? "border-brand bg-brand/[0.06]"
                        : "border-border hover:border-strong hover:bg-brand/[0.04]"
                    }`}
                    title="Billing periods"
                  >
                    <span>
                      {/* ⚠️ Above the figure, not below it: the other three carry their
                          label as a subtitle, and this element already uses that slot
                          for the date range. Nitsan's wording verbatim — and note it
                          names the CURRENT period, which he confirmed is what he means
                          by "next billing" (it is what the client is about to be
                          invoiced for). */}
                      <span className="block text-[11px] font-medium uppercase tracking-wide text-faint">
                        next billing:
                      </span>
                      {/* ⚠️ PLAIN SANS, NOT the serif accent — "looks messy". That face
                          is italic, so at this size its numerals and the en dash in a
                          date range come out as a tangle; it earns its place on the
                          three big figures and nowhere else in this row. One line,
                          name then dates, no hours (`12h this period` is the first
                          figure here and the pill was printing it twice). */}
                      {/* ⚠️ gap-3, not a word space — "move dates away from period name
                          - its too tight". A single space puts a bold month and a
                          muted range close enough to read as one string. */}
                      <span className="flex items-baseline gap-3 text-sm font-semibold leading-tight">
                        {current.label}
                        <span className="font-medium text-muted">
                          {dm(current.from)} – {dm(current.to)}
                        </span>
                      </span>
                    </span>
                    <ChevronDown size={20} className={periodsOpen ? "rotate-180" : ""} />
                  </button>
                  {periodsOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setPeriodsOpen(false)} />
                      <div className="absolute left-0 z-50 mt-2 max-h-96 w-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-card">
                        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
                          Billing periods
                        </div>
                        {[...periodSummary].reverse().map((p) => (
                          <div
                            key={p.label + p.from}
                            className={`rounded-lg px-2.5 py-2 ${p === current ? "bg-brand-soft" : ""}`}
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="truncate text-lg font-semibold">{p.label}</span>
                              <span
                                className={`shrink-0 text-lg font-semibold tabular-nums ${capTone(p.minutes, p.hourCap)}`}
                              >
                                {formatHoursShort(p.minutes)}
                                {p.hourCap != null && (
                                  <span className="text-xs font-medium opacity-70">/{p.hourCap}h</span>
                                )}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-muted">
                              {dm(p.from)} – {dm(p.to)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {/* ⚠️ MOVED AGAIN, and this is its third home — page header, then
                    the table's toolbar row, now here: "time updated can be right to
                    billing element outside the table". It belongs beside the period
                    selector because both answer "how current is this?", and outside
                    the table because it describes the whole report rather than the
                    figures in any column.
                    ⚠️ STILL NOT A CHIP. It sits inches from an element that IS
                    outlined to look pressable, so the contrast has to stay legible:
                    plain muted text and a clock, no border, no fill. */}
                {/* PHONE instance — right-aligned across the billing row. */}
                {lastUpdated && (
                  <UpdatedStamp at={lastUpdated} className="ml-auto flex shrink-0 sm:hidden" />
                )}
              </div>
            </div>
          )}

          {/* The DESKTOP instance — last in this right-hand cluster, beside the
              billing box. See `AmpMark`. */}
          <AmpMark size="h-8 lg:h-11" className="hidden items-center sm:flex" />
        </div>
      </header>

      {/* ⚠️ FULL WIDTH — the "Billing periods" aside is gone. Nitsan: "Billing
          periods pane can be removed as it has the dropdown new thing". It listed
          exactly what the period selector beside the client's name now shows, and
          keeping both meant the same nine rows twice on one page. Dropping it also
          hands the table the whole width, which is what the responsive ask wanted. */}
      <div>
        {/* ⚠️ `p-2` below `sm`: at p-4 the page and the card each took 16px a side,
          which left the table a 309px scroller on a 375px screen — 66px of
          padding on the one element that needs every pixel it can get. */}
        <div className="rounded-2xl border border-border bg-surface p-2 shadow-card sm:p-4">
          {/* ⚠️ Centred below `sm` only — "align them to center too". From `sm` up the
              row also holds the Updated stamp on its `ml-auto` right edge, and
              centring there would pull the toggles off the table's left edge they
              are aligned to. */}
          <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
            {/* ⚠️ THE DESKTOP STAMP LIVES HERE, the phone one in the header — its
                fourth and fifth homes, and the split is Nitsan's: "updated date can
                be inside table pane aligned to top right corner" (desktop) while on
                a phone it sits beside the billing box, right-aligned. Two instances
                rather than one, because on a phone this row holds two 44px capsules
                that already fill the width, and on a desktop the header's right
                cluster is full of figures. `order-last` + `ml-auto` put it at the
                right end of this row without moving the capsules off the left edge.
                ⚠️ Still plain text and a clock, still NOT a chip. */}
            {lastUpdated && (
              <UpdatedStamp
                at={lastUpdated}
                className="order-last ml-auto hidden shrink-0 sm:flex"
              />
            )}
            <ViewToggle
              touch
              on={!periodOnly}
              onClick={() => setPeriodOnly((v) => !v)}
              title={
                periodOnly
                  ? "Show every period, not just the latest"
                  : "Show only the latest payment period"
              }
            >
              {periodOnly ? "Show all periods" : "All periods"}
            </ViewToggle>
            <ViewToggle
              touch
              on={hideEmptyRows}
              onClick={() => setHideEmptyRows((v) => !v)}
              title="Hide tasks with no hours in the columns shown"
            >
              Only rows with hours
            </ViewToggle>
            {foldedSections.length > 0 && (
              <button
                onClick={() => setFoldedSections([])}
                className="min-h-11 rounded-full px-2.5 py-1 text-xs text-muted hover:bg-background hover:text-foreground sm:min-h-0"
              >
                Unfold {foldedSections.length} section{foldedSections.length > 1 ? "s" : ""}
              </button>
            )}
          </div>
          <ReportTable
            snapshot={snapshot}
            hiddenColumns={hiddenColumns}
            hiddenTaskIds={[]}
            periodOnly={periodOnly}
            hideEmptyRows={hideEmptyRows}
            foldedSections={foldedSections}
            onToggleSection={(name) => setFoldedSections((prev) => toggleIn(prev, name))}
          />
        </div>

      </div>

      {/* Kept from the removed aside: it is the one line that explains why the
          figures are not live, which is the question a stale-looking report raises. */}
      <p className="mt-4 text-center text-[11px] text-faint">
        Generated by Studio&amp;more · updated only when the studio publishes a new version.
      </p>
    </main>
  );
}
