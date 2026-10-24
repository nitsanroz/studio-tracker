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
}

/**
 * Every other page: its name, and the signals that are about it (Nitsan: "try
 * to say something on each page"). Settings has none, so no button there.
 */
const PAGES: [string, string, string[]][] = [
  ["/plan", "Weekly Plan", ["plan-gaps"]],
  ["/my-tasks", "My Tasks", ["my-overdue"]],
  ["/vacation", "Vacation", ["vacation"]],
  ["/feed", "Time Feed", ["missing-hours"]],
  ["/settings", "Settings", []],
  ["/intake-queue", "Intake", ["intake"]],
  ["/clients", "Clients", ["overdue"]],
  ["/team", "Team", ["missing-hours", "vacation", "plan-gaps"]],
  ["/candidates", "Candidates", ["candidates"]],
  ["/leads", "Leads", ["leads"]],
  ["/freelancers", "Freelancers", ["freelancer-logs"]],
];

const CLIENT_SIGNALS = new Set(["report-due", "unpaid", "cap", "estimate"]);
const STUDIO_SIGNALS = new Set(["billable", "pace", "income"]);

export function pageContext(pathname: string, search: string): PageContext {
  const none = { all: false, clientId: null, signals: null };
  if (pathname === "/") return { ...none, label: "Home", all: true };
  const client = pathname.match(/^\/clients\/([^/]+)/);
  if (client) return { ...none, label: "This client", clientId: client[1] };
  if (pathname.startsWith("/client-reports")) {
    const id = new URLSearchParams(search).get("client");
    return id ? { ...none, label: "This client", clientId: id } : { ...none, label: "Client Reports", signals: CLIENT_SIGNALS };
  }
  if (pathname.startsWith("/reports")) return { ...none, label: "Reports", signals: STUDIO_SIGNALS };
  const page = PAGES.find(([path]) => pathname.startsWith(path));
  return page ? { ...none, label: page[1], signals: new Set(page[2]) } : { ...none, label: "This page" };
}

/** Split items into this page's and the rest, keeping their order. */
export function splitByPage<T extends { signal: string; clientId: string | null }>(items: T[], ctx: PageContext): { here: T[]; elsewhere: T[] } {
  if (ctx.all) return { here: items, elsewhere: [] };
  const mine = (i: T) => (ctx.clientId ? i.clientId === ctx.clientId : ctx.signals ? ctx.signals.has(i.signal) : false);
  return { here: items.filter(mine), elsewhere: items.filter((i) => !mine(i)) };
}
