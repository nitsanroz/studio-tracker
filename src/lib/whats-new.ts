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
   * Optional picture of the new thing, e.g. "/whats-new/1.12.0.png".
   * Drop the file in `public/whats-new/`. Keep it PHONE-SHAPED or wide and
   * short — the panel caps it at 190px tall, so a tall desktop screenshot
   * arrives unreadable. Omit it rather than ship a vague one; a screenshot that
   * doesn't obviously show the thing is worse than the sentence alone.
   */
  image?: string;
  /** Alt text for `image`. Required when there is one. */
  imageAlt?: string;
}

/**
 * Newest first. Only the entry matching `APP_VERSION` is ever shown, so old
 * entries are kept purely as a record — trim them when the list gets long.
 */
export const RELEASES: Release[] = [
  {
    version: "v1.12.0",
    date: "2026-08-11",
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
