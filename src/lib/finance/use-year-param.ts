"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { studioYear } from "@/lib/finance/format";

/** The years a page can show: the studio's first in this app, to next year's plan. */
export const FIRST_YEAR = 2017;

/**
 * The year a year-paged grid shows, starting on `?year=` when a link names
 * one (an &advice card pointing at last December's cells) — read in the
 * initializer, so no current-year load races it — and following the link if
 * it changes while the page is open. Picking a year writes it back to the URL
 * (history.replaceState, which Next's router follows), so a link to the year
 * the URL held before the pick still changes `?year=` and is followed.
 */
export function useYearParam(): [number, (y: number) => void] {
  const param = Number(useSearchParams().get("year"));
  // The current year read now, not at module load: a tab left open over New
  // Year would still refuse next year's ?year= and open on last year.
  const curYear = studioYear();
  const valid = param >= FIRST_YEAR && param <= curYear + 1;
  const [year, setYear] = useState(valid ? param : curYear);
  useEffect(() => {
    if (valid) setYear(param);
  }, [param, valid]);
  const pick = useCallback((y: number) => {
    setYear(y);
    const url = new URL(window.location.href);
    url.searchParams.set("year", String(y));
    // null state, as Next's docs do — passing its own state on skips the sync to useSearchParams.
    window.history.replaceState(null, "", url);
  }, []);
  return [year, pick];
}
