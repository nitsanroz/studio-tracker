// Release notes the team actually sees, in the app, once per version.
//
// The working log in CLAUDE.md is written for whoever picks the project up next
// — it is long, technical, and full of things nobody logging their hours needs
// to know. This is the other half: two or three sentences per release about
// what CHANGED FOR YOU, and nothing else.
//
// ⚠️ KEEP IT SHORT. Two or three items, one line each. If a release genuinely
// has more than three things worth a designer's attention, it is really two
// releases. Nobody reads a changelog they have to scroll.
//
// `audience` is the whole point of this file: an admin-only change shown to a
// designer is noise that teaches them to dismiss the panel without reading it,
// which costs you the one release where it mattered.

export type Audience = "all" | "admin" | "member";

export interface WhatsNewItem {
  /** One line. A verb and a noun — "Log time from your phone", not "Mobile support". */
  title: string;
  /** One sentence of detail. Optional; plenty of items don't need it. */
  body?: string;
  audience: Audience;
}

export interface Release {
  /** Must match `APP_VERSION` exactly for the release to be announced. */
  version: string;
  /** ISO date, shown under the heading. */
  date: string;
  items: WhatsNewItem[];
  /**
   * Pictures of the new thing. One is shown on its own; two or more become a
   * horizontal strip you swipe through, so a release with several new surfaces
   * doesn't have to pick one.
   *
   * Drop files in `public/whats-new/`. ⚠️ Draw them at **300×190 or the same
   * ratio** — the panel gives each a fixed 190px-tall box, so a tall portrait
   * screenshot arrives as a stamp. Show the RELEVANT CROP, not a whole screen.
   * Omit rather than ship a vague one: a picture that doesn't obviously show
   * the thing is worse than the sentence alone.
   */
  images?: Array<{ src: string; alt: string }>;
}

/**
 * Newest first. Only the entry matching `APP_VERSION` is ever shown, so old
 * entries are kept purely as a record — trim them when the list gets long.
 */
export const RELEASES: Release[] = [
  {
    version: "v1.12.0",
    date: "2026-08-11",
    images: [
      {
        src: "/whats-new/1.12.0-bar.svg",
        alt: "The task list on a phone, with the new bar along the bottom",
      },
      {
        src: "/whats-new/1.12.0-logtime.svg",
        alt: "The log-time sheet, with quick 30m, 1h and 2h buttons",
      },
    ],
    items: [
      {
        title: "The tracker works on your phone",
        body: "Home, My Tasks and your task details are all built for a small screen now.",
        audience: "all",
      },
      {
        title: "Log time from anywhere",
        body: "The + button in the bar at the bottom finds a task and logs against it in a few taps.",
        audience: "all",
      },
      {
        title: "Triage intake on the move",
        body: "New client submissions are one tap away under Inbox.",
        audience: "admin",
      },
    ],
  },
];

/** The release to announce, or null when this version has nothing for this person. */
export function releaseFor(version: string, isAdmin: boolean): Release | null {
  const r = RELEASES.find((x) => x.version === version);
  if (!r) return null;
  const items = r.items.filter(
    (i) => i.audience === "all" || (i.audience === "admin") === isAdmin,
  );
  return items.length ? { ...r, items } : null;
}
