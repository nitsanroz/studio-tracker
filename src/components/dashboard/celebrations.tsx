"use client";

// Birthdays, work anniversaries, Jewish holidays and studio days.
//
// ⚠️ TWO HORIZONS EXIST AND THE DIMMING IS WHAT DISTINGUISHES THEM: the admin
// pane looks 30 days ahead, a member's hero only `MEMBER_OCCASION_DAYS`. An
// occasion the team cannot see yet is drawn faint and says so.
//
// ⚠️ The dates come from `/api/celebrations`, which returns `MM-DD` and nothing
// else — a birthday is studio-social, a birth YEAR is not.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";


// ── celebrations: birthdays (admin-readable) + work anniversaries ──────────

export type ApiOccasion = {
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
export const MEMBER_OCCASION_DAYS = 7;


/** "today" / "tomorrow" / "in 9 days" / "in ~4 months" — days stop reading past ~2 months. */
export function relativeDays(inDays: number): string {
  if (inDays === 0) return "today";
  if (inDays === 1) return "tomorrow";
  if (inDays < 60) return `in ${inDays} days`;
  return `in ~${Math.round(inDays / 30)} months`;
}


/** `inline` drops the card chrome and inverts the colours, for use inside the blue
 *  member hero, and only shows what members can actually see. The admin form is a
 *  4-card carousel, soonest first, with the not-yet-visible ones dimmed. */
export function Celebrations({ inline = false }: { inline?: boolean }) {
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
