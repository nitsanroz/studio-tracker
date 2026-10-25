// Which &advice items belong to the page you're on (v1.80.0, Nitsan 2026-10-24:
// "correlate the pane to the page — what you show now can be the homepage").
//
// The pane shows this page's items first ("Here") and folds the rest below
// ("Elsewhere"); nothing is ever hidden, so nothing urgent is missed. Home owns
// everything; every other page has its own signals below (Settings has none,
// and there the corner button doesn't show).

export interface PageContext {
  /** what the "Here" heading calls this page */
  label: string;
  /** Home: everything is "Here", no split */
  all: boolean;
  /** items about this client */
  clientId: string | null;
  /** items of these signals */
  signals: Set<string> | null;
  /** the pane's figures for this page (signals.ts `TileScope`) */
  tiles: Set<string>;
}

/**
 * Every other page: its name, the signals that are about it (Nitsan: "try to
 * say something on each page"), and the figures that belong to it — never
 * Home's again (2026-10-25). Settings has none, so no button there.
 */
const PAGES: [string, string, string[], string[]][] = [
  ["/plan", "Weekly Plan", ["plan-gaps", "unassigned", "pace"], ["plan"]],
  ["/my-tasks", "My Tasks", ["my-overdue"], []],
  ["/vacation", "Vacation", ["vacation"], []],
  ["/feed", "Time Feed", ["missing-hours", "internal"], ["team"]],
  ["/settings", "Settings", [], []],
  ["/intake-queue", "Intake", ["intake"], []],
  ["/clients", "Clients", ["overdue", "unassigned", "client-quiet", "concentration"], ["concentration"]],
  ["/team", "Team", ["missing-hours", "vacation", "plan-gaps", "internal"], ["plan", "team"]],
  ["/candidates", "Candidates", ["candidates"], []],
  ["/leads", "Leads", ["leads", "concentration"], ["concentration"]],
  ["/freelancers", "Freelancers", ["freelancer-logs"], []],
];

const CLIENT_SIGNALS = new Set(["report-due", "unpaid", "cap", "estimate"]);
const STUDIO_SIGNALS = new Set(["pace", "income", "concentration", "internal"]);
/** Home's figures: the studio-wide ones. Plan and team figures belong to their pages. */
const HOME_TILES = new Set(["money", "concentration", "billing"]);

export function pageContext(pathname: string, search: string): PageContext {
  const none = { all: false, clientId: null, signals: null, tiles: new Set<string>() };
  if (pathname === "/") return { ...none, label: "Home", all: true, tiles: HOME_TILES };
  const client = pathname.match(/^\/clients\/([^/]+)/);
  if (client) return { ...none, label: "This client", clientId: client[1] };
  if (pathname.startsWith("/client-reports")) {
    const id = new URLSearchParams(search).get("client");
    return id
      ? { ...none, label: "This client", clientId: id }
      : { ...none, label: "Client Reports", signals: CLIENT_SIGNALS, tiles: new Set(["billing"]) };
  }
  if (pathname.startsWith("/reports")) return { ...none, label: "Reports", signals: STUDIO_SIGNALS, tiles: new Set(["money", "concentration"]) };
  const page = PAGES.find(([path]) => pathname.startsWith(path));
  return page ? { ...none, label: page[1], signals: new Set(page[2]), tiles: new Set(page[3]) } : { ...none, label: "This page" };
}

/** Split items into this page's and the rest, keeping their order. */
export function splitByPage<T extends { signal: string; clientId: string | null }>(items: T[], ctx: PageContext): { here: T[]; elsewhere: T[] } {
  if (ctx.all) return { here: items, elsewhere: [] };
  const mine = (i: T) => (ctx.clientId ? i.clientId === ctx.clientId : ctx.signals ? ctx.signals.has(i.signal) : false);
  return { here: items.filter(mine), elsewhere: items.filter((i) => !mine(i)) };
}

/** The figures for this page: a client's own on its page and report tab, else the page's scopes. */
export function tilesFor<T extends { scope: string; clientId: string | null }>(tiles: T[], ctx: PageContext): T[] {
  if (ctx.clientId) return tiles.filter((t) => t.clientId === ctx.clientId);
  return tiles.filter((t) => t.clientId == null && ctx.tiles.has(t.scope));
}
