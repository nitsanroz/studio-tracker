// Which &advice items belong to the page you're on — the tracker's rule
// (its src/lib/advice/context.ts, Nitsan 2026-10-24): this page's items first
// ("Here"), the rest folded below ("Elsewhere"), nothing ever hidden. The
// Overview owns everything; Settings has nothing, so no button there.

export interface PageContext {
  /** what the "Here" heading calls this page */
  label: string;
  /** Overview: everything is "Here", no split */
  all: boolean;
  /** items of these signals */
  signals: Set<string>;
  /** the pane's figures for this page (signals.ts `TileScope`) */
  tiles: Set<string>;
}

/**
 * Every page: its name, its signals, and its own figures — never one the page
 * already shows (the tracker's v1.81.0: "not another dashboard").
 */
const PAGES: [string, string, string[], string[]][] = [
  ["/finance/plan", "Plan", ["close", "fx", "loss", "year", "client-quiet", "pace", "tax-reserve"], ["pace", "booked"]],
  ["/finance/salaries", "Salaries", ["salaries", "payslips", "close", "paid"], ["salaries", "booked"]],
  ["/finance/freelance", "Freelance", ["freelance", "close", "paid"], ["freelance"]],
  ["/finance/people", "People", ["salaries"], ["salaries"]],
  ["/finance/expenses", "Expenses", ["expense", "unfiled", "fx", "renewal", "overlap", "price-up", "fx-fee", "mail", "tools"], ["filing", "renewals"]],
  ["/finance/rates", "Rates", ["no-rate", "unpaid", "concentration", "client-quiet"], ["clients"]],
  ["/finance/scenarios", "Scenarios", ["loss", "year", "pace", "salaries", "freelance", "concentration", "client-quiet", "tax-reserve", "dividend-window", "books-gap"], ["pace", "salaries"]],
  ["/finance/settings", "Settings", [], []],
];

/** The Overview's figures: money and clients. Its own hours card covers the pace. */
const OVERVIEW_TILES = new Set(["money", "clients"]);

export function pageContext(pathname: string): PageContext {
  if (pathname === "/finance") return { label: "Overview", all: true, signals: new Set(), tiles: OVERVIEW_TILES };
  const page = PAGES.find(([path]) => pathname.startsWith(path));
  return page
    ? { label: page[1], all: false, signals: new Set(page[2]), tiles: new Set(page[3]) }
    : { label: "This page", all: false, signals: new Set(), tiles: new Set() };
}

/** The figures for this page. */
export function tilesFor<T extends { scope: string }>(tiles: T[], ctx: PageContext): T[] {
  return tiles.filter((t) => ctx.tiles.has(t.scope));
}

/** Split items into this page's and the rest, keeping their order. */
export function splitByPage<T extends { signal: string }>(items: T[], ctx: PageContext): { here: T[]; elsewhere: T[] } {
  if (ctx.all) return { here: items, elsewhere: [] };
  return { here: items.filter((i) => ctx.signals.has(i.signal)), elsewhere: items.filter((i) => !ctx.signals.has(i.signal)) };
}
