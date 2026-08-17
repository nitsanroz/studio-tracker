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
   * `shape` decides how the blue panel treats it, and the two are NOT
   * interchangeable:
   *  · `phone` — a device shot. ⚠️ Draw it at **LIFE SIZE** — a 375×812 screen
   *    with the app's own values (`h-14` header, `p-4` padding, 13px labels) —
   *    and let the panel scale the whole thing down. Sizing elements by eye on
   *    a small canvas gets every proportion wrong in a different direction.
   *    `scripts/build-whatsnew-phone.mjs` does this and is the one to copy.
   *    Rendered taller than the panel and anchored top, so the device bleeds
   *    off the bottom edge.
   *  · `element` — draw **360×240** (3:2) showing the ONE surface that changed,
   *    close up, on a transparent background. Rendered whole, with a margin of
   *    blue around it. ⚠️ Not a whole screen: a desktop view scaled into a 345px
   *    panel is a stamp nobody can read. Draw the Timeline rows, or the board
   *    columns, or the status table — cropped to the part that changed, big.
   *    ⚠️ And give it REAL TEXT. Grey placeholder rules cannot be read as
   *    "254.5h" or as a column renamed to STATUS, which is usually the point.
   *
   * An item with no picture falls back to the studio mark. That is a last
   * resort, not a default: a panel of wordmarks teaches people there is nothing
   * to look at.
   */
  image?: { src: string; alt: string; shape?: "phone" | "element" };
  /**
   * Higher sorts first. Default 0, and **leave it there almost always** — the
   * natural order is newest release first, which is what people expect.
   *
   * It exists for the case where the newest release is NOT the most useful
   * thing to lead with: v1.12.0 is mobile, and the studio works on laptops, so
   * announcing a phone feature ahead of a week of desktop work would bury the
   * part they can use today.
   */
  priority?: number;
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
    version: "v1.19.0",
    date: "2026-08-17",
    items: [
      {
        // `all`: this one reaches everybody, because everybody searches for a
        // task — the log-time popup, the quick log on your home page, the search
        // box at the top, and the picker on a phone.
        title: "Narrow a task search to one client",
        body: "Open any task search and the clients you've worked on lately sit across the top. Tap one and the list is just theirs.",
        audience: "all",
        image: {
          src: "/whats-new/1.19.0-client-filter.svg",
          shape: "element",
          alt: "A task search open, its client chips across the top with the pointer on No Traffic, and three results below all called some form of Homepage — one each for DualBird, Anchor and No Traffic",
        },
      },
      {
        // `all`. ⚠️ I first made this `member`, on the grounds that the phone's
        // log-time sheet is a designer's screen — wrong: the bar's middle "+" is
        // rendered UNCONDITIONALLY (`app-shell.tsx`, aria-label "Log time", no
        // text), so an admin has the same sheet. Searching the DOM for a button
        // reading "+ Log time" is what produced the false negative. **Read the
        // gate in the code, not the labels on a screenshot.**
        title: "Your day adds up as you log it",
        body: "Logging time on your phone now shows what today comes to against your 8 hours, and lists the entries so you can fix one.",
        audience: "all",
        image: {
          src: "/whats-new/1.19.0-day-hours.svg",
          shape: "phone",
          alt: "The log-time sheet on a phone: under the form, Logged today reads 3h 30m of 8h over a part-filled bar, with the day's two entries listed beneath",
        },
      },
      {
        title: "See the week you've logged, on your phone",
        body: "Your home page lists each day of this week with its hours — tap a day to see the entries, tap one to change it.",
        audience: "member",
      },
    ],
  },
  {
    version: "v1.13.0",
    date: "2026-08-11",
    items: [
      {
        // `admin`, not `all`: groups live on the client page, and /clients is
        // admin-only. Telling eight designers about a screen they cannot open is
        // exactly the noise that teaches people to dismiss this panel unread.
        title: "Group tasks by subject",
        body: "Inside a section, gather the tasks for one page or deliverable under a name you choose — then fold it away.",
        audience: "admin",
        image: {
          src: "/whats-new/1.13.0-group.svg",
          shape: "element",
          alt: "A Website section holding a Home page group, its three tasks indented under it with the group's dates and hours totalled beside it",
        },
      },
      {
        title: "Sections and groups can show their totals",
        body: "Turn on “Section totals” under Show to see each one's dates, working days, hours and budget. On by default on the Timeline.",
        audience: "admin",
        image: {
          src: "/whats-new/1.13.0-totals.svg",
          shape: "element",
          alt: "The Show menu open, with a new Section totals switch turned on beneath Completed, Undated and Colour by type",
        },
      },
    ],
  },
  {
    version: "v1.12.0",
    date: "2026-08-11",
    items: [
      {
        // Deprioritised, at Nitsan's call: the studio works on laptops, and the
        // week's desktop work is what they can use today. Announcing a phone
        // feature first would bury it.
        priority: -1,
        title: "The tracker works on your phone",
        body: "Home, My Tasks and your task details are all built for a small screen now.",
        audience: "all",
        image: {
          src: "/whats-new/1.12.0-bar.svg",
          shape: "phone",
          alt: "The task list on a phone, with the new bar along the bottom",
        },
      },
      {
        priority: -1,
        title: "Log time from your phone",
        body: "The + button in the bar finds a task and logs against it in a few taps.",
        audience: "all",
        image: {
          src: "/whats-new/1.12.0-logtime.svg",
          shape: "phone",
          alt: "The log-time sheet, with quick 30m, 1h and 2h buttons",
        },
      },
      {
        priority: -1,
        title: "Triage intake on the move",
        body: "New client submissions are one tap away under Inbox.",
        audience: "admin",
      },
    ],
  },
  {
    version: "v1.11.1",
    date: "2026-08-10",
    items: [
      {
        title: "Your edits stop jumping back",
        body: "A background refresh could overwrite something you'd just typed. It can't now.",
        audience: "all",
        image: {
          src: "/whats-new/element-saved.svg",
          shape: "element",
          alt: "A budget being edited, keeping its new value and marked saved",
        },
      },
    ],
  },
  {
    version: "v1.11.0",
    date: "2026-08-10",
    items: [
      {
        title: "The Board uses your own statuses",
        body: "Columns are the studio's real statuses now, and cards drag between them to change one.",
        audience: "admin",
        image: {
          src: "/whats-new/element-board.svg",
          shape: "element",
          alt: "Board columns named In design and Client approval, with a card being dragged across",
        },
      },
    ],
  },
  {
    version: "v1.10.0",
    date: "2026-08-09",
    items: [
      {
        title: "Milestones on the Timeline",
        body: "Click the date ruler to drop one and name it. Clients see it on the shared plan.",
        audience: "admin",
        image: {
          src: "/whats-new/element-milestone.svg",
          shape: "element",
          alt: "A milestone named Client review, its line running down past the task bars",
        },
      },
      {
        title: "Select bars by dragging a box",
        body: "Drag over empty calendar to pick several, then move them all by the same working days.",
        audience: "admin",
        image: {
          src: "/whats-new/element-multidrag.svg",
          shape: "element",
          alt: "A box dragged across the Timeline selecting three task bars at once",
        },
      },
    ],
  },
  {
    version: "v1.8.0",
    date: "2026-08-07",
    items: [
      {
        title: "Send a client their plan",
        body: "Share on the Timeline copies a link to a live schedule. No hours, no assignees — just dates.",
        audience: "admin",
        image: {
          src: "/whats-new/element-share.svg",
          shape: "element",
          alt: "The Share plan button, the copied link, and the plan a client opens",
        },
      },
    ],
  },
  // v1.7.0's "the Timeline is editable end to end" was written and then cut: it
  // had no picture of its own, and the milestone and multi-drag steps above
  // already show an editable Timeline. A step whose visual is the studio logo
  // teaches people there is nothing here to look at — better to say less.
  {
    version: "v1.5.0",
    date: "2026-08-06",
    items: [
      {
        title: "Tags are called Status now",
        body: "Same list, clearer name — and tasks gained a separate Type for the kind of work.",
        audience: "all",
        image: {
          src: "/whats-new/element-status.svg",
          shape: "element",
          alt: "A task row with its Status pill and a separate Type beside it",
        },
      },
    ],
  },
];

/**
 * ⚠️ The cap is on STEPS, not releases. Capping releases was wrong for the case
 * this panel exists for: the studio shipped seven releases in the week before it
 * was built, several of them one small item each, and a three-RELEASE cap hid
 * four of them while the panel was nowhere near too long. Length is what needs
 * limiting, and length is measured in points to read.
 */
export const MAX_STEPS = 8;

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
  // ⚠️ `priority` first, THEN version. The default 0 leaves the natural
  // newest-first order intact; a negative pushes an item to the back however new
  // it is. That is how the mobile release sits behind a week of desktop work
  // without lying about when it shipped — its own step still shows v1.12.0.
  const all: Step[] = matched
    .flatMap((r) => r.items.map((i) => ({ ...i, version: r.version, date: r.date })))
    .sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || compareVersions(b.version, a.version),
    );
  return {
    releases: matched,
    steps: all.slice(0, MAX_STEPS),
    olderCount: Math.max(0, all.length - MAX_STEPS),
  };
}
