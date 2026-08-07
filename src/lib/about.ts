import data from "./about-data.json";

/**
 * The numbers behind the About panel.
 *
 * `about-data.json` is GENERATED — run `node scripts/build-about-stats.mjs
 * --apply` to refresh it. Don't hand-edit the JSON: the studio figures come from
 * the database and the build figures from git, so a typed-in number would be
 * wrong the next time anybody re-runs the script.
 */
export type AboutData = typeof data;

export const ABOUT = data;

/** Days from the first commit to the last — the calendar the project spans. */
export function projectSpanDays(): number {
  const from = Date.parse(ABOUT.build.firstCommit);
  const to = Date.parse(ABOUT.build.lastCommit);
  return Math.max(1, Math.round((to - from) / 86_400_000));
}

/**
 * The share of the studio's history that had to be recovered rather than logged.
 * This is the fact most worth stating: those hours lived only in Asana task
 * titles and comment threads, and were data nowhere until they were parsed out.
 */
export function recoveredShare(): number {
  if (!ABOUT.studio.hours) return 0;
  return Math.round((ABOUT.studio.recoveredHours / ABOUT.studio.hours) * 100);
}

/** `87,577` — thousands separated, which every figure in this panel wants. */
export function group(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The project's arc, for the About panel's timeline.
 *
 * EDITORIAL, and deliberately not generated: git knows every commit but not
 * which ones mattered, and a timeline that lists all 94 says nothing. Add a row
 * when something changes what the app IS — a release everyone noticed, a whole
 * capability arriving, data appearing that wasn't there before. `major` is the
 * filled dot; keep it for the two or three that genuinely earn it.
 */
/**
 * What the build actually cost the studio, in real money.
 *
 * NOT derivable from anything on this machine — the transcripts carry token
 * counts but no prices, and Claude Code writes no billing data. So
 * `effort.costUsd` in the generated JSON is a LIST-PRICE VALUATION of the
 * compute, and this is the bill that was really paid: the Claude seat, for the
 * days the build ran. Only Nitsan's seat built the tracker, hence `seats: 1` —
 * raise it only if someone else's seat did work that belongs in this figure.
 *
 * Set to null and the panel drops the claim rather than implying the list price
 * was paid.
 */
export const ACTUAL_SPEND: { seatMonthlyUsd: number; seats: number } | null = {
  seatMonthlyUsd: 25,
  seats: 1,
};

/**
 * The seat cost apportioned to the build's actual span, so it stays true as the
 * project runs on rather than freezing at whatever it was the day it was typed.
 */
export function actualSpendUsd(): number | null {
  if (!ACTUAL_SPEND) return null;
  const months = projectSpanDays() / 30.44; // mean month, so a 33-day span isn't "1 month"
  return ACTUAL_SPEND.seatMonthlyUsd * ACTUAL_SPEND.seats * months;
}

/**
 * What the tracker replaced, and what each thing became inside it.
 *
 * EDITORIAL — nothing in the repo records that a Tally form or a Gantt tab in
 * Sheets ever existed, so this is the only place that history is written down.
 * Add a row when a surface here retires an outside tool for good; the point of
 * the list is that it is SEVEN, not the three everyone remembers.
 */
export const REPLACED: { tool: string; became: string }[] = [
  { tool: "Everhour", became: "logging time against a task" },
  { tool: "Asana", became: "clients, sections and tasks" },
  { tool: "Weekly plan sheet", became: "the weekly plan grid" },
  { tool: "Tally", became: "the client intake form" },
  { tool: "Client hours sheet", became: "published client reports" },
  { tool: "Gantt sheet", became: "the client Timeline, now shareable" },
  { tool: "Team sheet", became: "Team pages and HR details" },
];

export const MILESTONES: { date: string; label: string; major?: boolean }[] = [
  { date: "2026-07-05", label: "First commit" },
  { date: "2026-07-07", label: "Live on Vercel" },
  { date: "2026-07-11", label: "Reports freeze on publish" },
  { date: "2026-07-13", label: "Finance splits off" },
  { date: "2026-07-25", label: "Design refresh" },
  { date: "2026-07-28", label: "11 years recovered" },
  { date: "2026-07-29", label: "v1.0 · the team moves in", major: true },
  { date: "2026-08-07", label: "Shareable client Gantt" },
];
