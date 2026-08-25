"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Clock } from "lucide-react";
import { formatHoursShort } from "@/lib/format";
import { capTone } from "@/lib/cap";
import { ClientAvatar } from "@/components/client-avatar";
import { ReportTable, ViewToggle } from "@/components/report-table";
import { toggleIn } from "@/lib/toggle";
import type { ReportSnapshot, ReportViewFlags } from "@/lib/types";

/** `1/8` — compact enough to sit inside a period label. */
function dm(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d}/${m}`;
}

/**
 * `August (1/8 – 31/8) 62.5h` — Nitsan's wording, used for the current period and
 * for every row of its dropdown, so the two read as one list rather than two
 * different ideas.
 */
function periodLabelOf(p: { label: string; from: string; to: string; minutes: number }): string {
  return `${p.label} (${dm(p.from)} – ${dm(p.to)}) ${formatHoursShort(p.minutes)}`;
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
export function PublicReportView({
  clientName,
  clientColor,
  clientIcon,
  clientIconUrl,
  snapshot,
  publishedAt,
  hiddenColumns,
  periodTotals,
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
  viewFlags: ReportViewFlags | null;
}) {
  const [periodOnly, setPeriodOnly] = useState(viewFlags?.periodOnly ?? false);
  const [hideEmptyRows, setHideEmptyRows] = useState(viewFlags?.hideEmptyRows ?? false);
  const [foldedSections, setFoldedSections] = useState<string[]>([]);
  const [periodsOpen, setPeriodsOpen] = useState(false);
  const lastUpdated = publishedAt
    ? new Date(publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  /**
   * Per-period charged totals.
   *
   * ⚠️ FROM `periodTotals`, NOT SUMMED FROM THE ROWS ON SCREEN. Summing the
   * visible rows made hiding a task change the client's figures: the tiles below
   * and the Billing periods pane both understated, and `remaining` — cap minus
   * charged — therefore OVERSTATED the budget left. Hiding is a focus tool, not
   * confidentiality (the same reason `totalMinutes` spans hidden periods), so
   * the summary has to be the real one. Computed server-side before the hidden
   * rows are removed, since afterwards those hours are simply gone.
   */
  const periodSummary = useMemo(
    () => snapshot.periods.map((p, i) => ({ ...p, minutes: periodTotals[i] ?? 0 })),
    [snapshot, periodTotals],
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
    <main className="mx-auto w-full max-w-[2200px] p-4 sm:p-6 lg:p-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        {/* ⚠️ A WIDE gap, not the 20px this shipped with: the hours are set like the
            client's name on purpose, and two headlines that close together read as
            one run-on title ("Visitt 12h"). Nitsan: "move it away from client name -
            its too close". It grows with the screen, and the row still wraps on a
            narrow one rather than squeezing. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-10 gap-y-3 lg:gap-x-20">
          <div className="flex min-w-0 items-center gap-3">
            {/* ⚠️ The real `ClientAvatar`, not a letter in a coloured box — Nitsan:
                "you can use client avatar in the color cube - just as a client looks
                in the system". It falls back to the glyph and then to the initial on
                its own, so a client with no mark looks exactly as it did before. */}
            <ClientAvatar
              client={{ name: clientName, color: clientColor, icon: clientIcon, iconUrl: clientIconUrl }}
              size={56}
              className="shrink-0"
            />
            <div className="min-w-0">
              {/* The name grows with the screen — it is the page's title, and a 3xl
                  heading on a 2560px page reads as a caption. */}
              <h1 className="font-serif-accent truncate text-3xl lg:text-4xl xl:text-5xl">
                {clientName}
              </h1>
              <p className="text-sm text-muted">Hours report</p>
            </div>
          </div>

          {/*
            ⚠️ BESIDE THE NAME, NOT A BOXED TILE, and the four tiles that used to sit
            below are GONE — Nitsan's call: "'this period' pane should move right to
            the title of client name and not as a pane with a box". "Delivered to
            date" went with them, and so did the separate Period-cap and Remaining
            tiles: the cap is SEMANTIC, so it reads better as `12h/150h` that changes
            colour than as two more boxes of arithmetic the client has to combine.
          */}
          {current && (
            <div className="flex items-center gap-4">
              {/* ⚠️ Set like the client NAME and its subtitle, deliberately — same
                  serif face, same sizes, same muted caption beneath. Nitsan's call:
                  the two are a matched pair at the top of the page, so the hours
                  read as the page's second headline rather than as a stray stat in
                  a different typeface. */}
              <div>
                <div
                  className={`font-serif-accent text-3xl tabular-nums lg:text-4xl xl:text-5xl ${capTone(current.minutes, current.hourCap)}`}
                >
                  {formatHoursShort(current.minutes)}
                  {current.hourCap != null && (
                    <span className="text-lg opacity-70 lg:text-xl xl:text-2xl">/{current.hourCap}h</span>
                  )}
                </div>
                <p className="text-sm text-muted">this period</p>
              </div>

              {/* The period this figure belongs to, and a way to see the others in
                  the same wording. Informational — the report's own toggles are what
                  change what the table shows. */}
              <div className="relative">
                <button
                  onClick={() => setPeriodsOpen((v) => !v)}
                  className="flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm hover:border-brand sm:min-h-0"
                  title="Billing periods"
                >
                  <span className="font-medium">{periodLabelOf(current)}</span>
                  <ChevronDown size={16} className={periodsOpen ? "rotate-180" : ""} />
                </button>
                {periodsOpen && (
                  <>
                    {/* a backdrop, so a click anywhere closes it */}
                    <div className="fixed inset-0 z-40" onClick={() => setPeriodsOpen(false)} />
                    <div className="absolute right-0 z-50 mt-1 max-h-96 w-72 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-card">
                      {/* A title, so the panel says what the list IS rather than
                          leaving a bare column of months to be inferred. */}
                      <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
                        Billing periods
                      </div>
                      {[...periodSummary].reverse().map((p) => (
                        <div
                          key={p.label + p.from}
                          className={`rounded-lg px-2.5 py-2 ${
                            p === current ? "bg-brand-soft" : ""
                          }`}
                        >
                          {/* ⚠️ The period NAME and its HOURS are the two things
                              being compared down the list, so they carry the size;
                              the dates only qualify which "Aug" this is, so they sit
                              under the name as a subtitle rather than competing on
                              the same line. Nitsan's call. */}
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-base font-semibold">{p.label}</span>
                            <span
                              className={`shrink-0 text-base font-semibold tabular-nums ${capTone(p.minutes, p.hourCap)}`}
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
            </div>
          )}
        </div>

        {/*
          ⚠️ A CHIP AT THE TOP, NOT A LINE UNDER THE TITLE — Nitsan's call: "can be a
          chip or any element that is not a button in the top of the page and not
          under the title". Under the heading it read as part of the report's name;
          up here it reads as what it is, a stamp on the page.

          ⚠️ A `span`, deliberately NOT a button: nothing happens when you press it,
          and a chip that looks pressable on a page a client is reading invites a
          click that goes nowhere.
        */}
        <div className="flex shrink-0 items-center gap-3">
          {lastUpdated && (
            /*
              ⚠️ NO BORDER, NO BACKGROUND, NO PILL. It was a bordered chip and read
              as pressable — Nitsan: "mayb enot a chip - it looks pressable". On a
              page a client is reading, anything shaped like a control invites a
              click that goes nowhere. Plain muted text with an icon says the same
              thing and promises nothing.

              ⚠️ A CLOCK, not a refresh arrow: a refresh glyph is a verb and would
              put the pressable idea straight back.
            */
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
              <Clock size={12} aria-hidden />
              Updated {lastUpdated}
            </span>
          )}
          <span
            className="brand-wordmark h-5 w-32 shrink-0 lg:h-6 lg:w-40"
            style={{ backgroundColor: "#0b43ed" }}
            role="img"
            aria-label="Studio&more"
          />
        </div>
      </header>

      {/* ⚠️ FULL WIDTH — the "Billing periods" aside is gone. Nitsan: "Billing
          periods pane can be removed as it has the dropdown new thing". It listed
          exactly what the period selector beside the client's name now shows, and
          keeping both meant the same nine rows twice on one page. Dropping it also
          hands the table the whole width, which is what the responsive ask wanted. */}
      <div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
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
