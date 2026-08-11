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
  /**
   * The picture for THIS point — one item, one visual, because the panel steps
   * through them one at a time. Drop files in `public/whats-new/`.
   *
   * ⚠️ Draw them **200×400 (a phone) or the same 1:2 ratio**: the blue panel
   * crops the bottom to make the device bleed off the edge, so anything squarer
   * arrives with air around it and reads as a sticker. Items without one fall
   * back to the studio mark — which is fine, and better than a vague picture.
   */
  image?: { src: string; alt: string };
}

export interface Release {
  /** Must match `APP_VERSION` exactly for the release to be announced. */
  version: string;
  /** ISO date, shown under the heading. */
  date: string;
  items: WhatsNewItem[];
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
        image: {
          src: "/whats-new/1.12.0-bar.svg",
          alt: "The task list on a phone, with the new bar along the bottom",
        },
      },
      {
        title: "Log time from anywhere",
        body: "The + button in the bar at the bottom finds a task and logs against it in a few taps.",
        audience: "all",
        image: {
          src: "/whats-new/1.12.0-logtime.svg",
          alt: "The log-time sheet, with quick 30m, 1h and 2h buttons",
        },
      },
      {
        title: "Triage intake on the move",
        body: "New client submissions are one tap away under Inbox.",
        audience: "admin",
      },
    ],
  },
  // The three below shipped BEFORE this panel existed, so nobody was told about
  // them. They are here so the studio gets caught up the first time it opens —
  // `seen === null` shows the whole list. Trim them once everyone has.
  {
    version: "v1.11.1",
    date: "2026-08-10",
    items: [
      {
        title: "Your edits stop jumping back",
        body: "A background refresh could overwrite something you'd just changed. It can't now.",
        audience: "all",
      },
    ],
  },
  {
    version: "v1.11.0",
    date: "2026-08-10",
    items: [
      {
        title: "The Board uses the studio's statuses",
        body: "Columns are your real statuses now, and cards drag between them.",
        audience: "admin",
      },
      {
        title: "Today is marked on the Timeline",
        body: "A black date chip, with everything before it shaded.",
        audience: "admin",
      },
    ],
  },
  {
    version: "v1.10.0",
    date: "2026-08-09",
    items: [
      {
        title: "Move several Timeline bars at once",
        body: "Select them, drag one, and the whole selection shifts by the same days.",
        audience: "admin",
      },
      {
        title: "Milestones on the Timeline",
        body: "Click the date ruler to drop one. Clients see it on the shared link.",
        audience: "admin",
      },
    ],
  },
];

/**
 * At most this many releases in one panel. Somebody back from three weeks away
 * should be caught up, not handed a changelog — past three the older ones are
 * summarised as a count instead.
 */
export const MAX_RELEASES = 3;

/** `v1.12.0` → `[1, 12, 0]`. Anything unparseable sorts as oldest. */
function parts(v: string): [number, number, number] {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

/** >0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const [a1, a2, a3] = parts(a);
  const [b1, b2, b3] = parts(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

/**
 * How many points the desktop panel will step through. Past this it stops being
 * a welcome and starts being homework — the rest are summarised as a count.
 */
export const MAX_STEPS = 5;

/** One item, plus which release it came from. The unit the panel steps through. */
export interface Step extends WhatsNewItem {
  version: string;
  date: string;
}

export interface WhatsNew {
  /** Newest first, already filtered to this person and capped. */
  releases: Release[];
  /** The same items flattened, newest release first — one per step. */
  steps: Step[];
  /** Items that matched but didn't fit `MAX_STEPS`. 0 most of the time. */
  olderCount: number;
}

/**
 * Everything this person hasn't seen yet — not just the newest release.
 *
 * ⚠️ The point is somebody coming back from leave. If this only ever showed the
 * CURRENT version, two releases in one week would mean the first is announced to
 * whoever happened to sign in that day and silently lost for everyone else. The
 * panel is keyed on what YOU last acknowledged, so it holds the gap however long
 * it is.
 *
 * ⚠️ `seen === null` means "never dismissed one", which is BOTH a brand-new
 * account AND everyone on the team the first time this feature ships. It shows
 * the whole (deliberately short) list — that is what gets the studio caught up
 * on the releases that predate this panel. **Trimming `RELEASES` is how you stop
 * a new hire reading history**; there is no other lever, on purpose, because a
 * date cutoff would go stale silently.
 */
export function whatsNewSince(seen: string | null, isAdmin: boolean): WhatsNew | null {
  const matched = RELEASES.filter(
    (r) => seen === null || compareVersions(r.version, seen) > 0,
  )
    .map((r) => ({
      ...r,
      items: r.items.filter((i) => i.audience === "all" || (i.audience === "admin") === isAdmin),
    }))
    // A release whose every item was for the other role is not "an update you
    // missed" — it is nothing, and saying so would train people to skip the panel.
    .filter((r) => r.items.length > 0)
    .sort((a, b) => compareVersions(b.version, a.version));

  if (matched.length === 0) return null;
  const releases = matched.slice(0, MAX_RELEASES);
  const all: Step[] = releases.flatMap((r) =>
    r.items.map((i) => ({ ...i, version: r.version, date: r.date })),
  );
  // ⚠️ The count includes what MAX_RELEASES already dropped as well as what
  // MAX_STEPS drops, so "+ N earlier" is the true remainder rather than the
  // remainder of one of the two caps.
  const droppedByReleaseCap = matched
    .slice(MAX_RELEASES)
    .reduce((n, r) => n + r.items.length, 0);
  return {
    releases,
    steps: all.slice(0, MAX_STEPS),
    olderCount: Math.max(0, all.length - MAX_STEPS) + droppedByReleaseCap,
  };
}
