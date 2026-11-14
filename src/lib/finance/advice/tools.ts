// The studio's subscriptions as &advice reads them (v1.11.0, Nitsan
// 2026-11-05: "recommend on the Expenses page — drop an account, switch to a
// better or cheaper one"). Monthly and yearly expense rows become one CHAIN per
// subscription (each year's renewal is its own row), so the checks can ask
// "what is live, when does it renew, what did it cost last time, and what else
// do we pay for that does the same job".
//
// ⚠️ PURE — no clock, no database. Amounts are net ILS (no VAT, foreign at the
// month's rate + FX_MARKUP), worked out by the loader with expenseNetIls, the
// same figure the Expenses page shows.

import { SYNTHETIC_YEARLY_MARKER, expenseNetIls } from "@/lib/finance/finance";
import type { FxTable } from "@/lib/finance/fx";

export interface Subscription {
  id: string;
  vendor: string;
  description: string;
  category: "monthly" | "yearly";
  currency: string;
  /** monthly = 1; yearly = the row's renew_months (default 12) */
  renewMonths: number;
  date: string;
  endDate: string | null;
  /** one payment, net ILS */
  netIls: number;
  /** one payment, in its own currency */
  gross: number;
  /** "final" rows are locked — a fix never touches them */
  state?: string;
}

/** One subscription over time: its rows oldest first. */
export interface Chain {
  /** the first row's id — stable for as long as the subscription lives */
  id: string;
  vendor: string;
  category: "monthly" | "yearly";
  rows: Subscription[];
  /** the row in force today (started on or before today) — null if it hasn't started */
  current: Subscription | null;
  /** a renewal already entered for a date after today */
  upcoming: Subscription | null;
  live: boolean;
  /** yearly only: the next payment date, null if it won't renew */
  nextRenewal: string | null;
  /** what it costs a year at its latest price, net ILS */
  yearIls: number;
  /** the latest price and the one before, for "went up" (same currency → gross, else net) */
  priceChange: number | null;
}

/** What a tool does, so two that do the same job can be spotted. */
export interface ToolKind {
  kind: string;
  /** "Three website builders" — the plural for a title */
  plural: string;
  match: RegExp;
  /** a job the studio does in-house: even ONE paid tool of this kind is worth a look */
  inHouse?: string;
}

/**
 * Matched on vendor + description. A vendor may fit several kinds (Google
 * Workspace is mail, files and video calls). Kept short and plain on purpose:
 * Claude's review (review.ts) knows the market; this only has to find overlaps.
 */
export const TOOL_KINDS: ToolKind[] = [
  { kind: "Website builder", plural: "website builders", match: /webflow|framer|\bwix\b|squarespace|wordpress/i },
  { kind: "Files and sharing", plural: "file storage and sharing tools", match: /dropbox|wetransfer|\bbox\b|onedrive|icloud|google (workspace|one|drive)|g suite|^google$|microsoft 365|office 365/i },
  { kind: "Office and email", plural: "office suites", match: /google (workspace)|g suite|^google$|microsoft 365|office 365|zoho/i },
  { kind: "Video calls", plural: "video-call tools", match: /\bzoom\b|google (workspace)|g suite|^google$|whereby/i },
  { kind: "AI assistant", plural: "AI assistants", match: /claude|anthropic|chatgpt|openai|gemini|perplexity|copilot/i },
  { kind: "Stock media", plural: "stock libraries", match: /artlist|envato|shutterstock|epidemic|motion ?array|storyblocks|freepik|adobe stock|ls\.graphics/i },
  { kind: "Design references", plural: "design-reference libraries", match: /mobbin|dribbble|behance|savee/i },
  { kind: "Time tracking", plural: "time trackers", match: /everhour|toggl|harvest|clockify|timely/i, inHouse: "The studio tracker has logged the studio's time since July 2026" },
];

function kindsOf(vendor: string, description = ""): ToolKind[] {
  const v = vendor.trim();
  return TOOL_KINDS.filter((k) => k.match.test(v) || k.match.test(description));
}

/** Expense rows → the Tools checks' subscriptions, net ILS exactly as the Expenses page converts them. */
export function subscriptionsOf(rs: Record<string, unknown>[], fx: FxTable): Subscription[] {
  return rs
    .filter((r) => r.description !== SYNTHETIC_YEARLY_MARKER && String(r.vendor ?? "").trim())
    .map((r) => {
      const date = String(r.date);
      const category = r.category === "yearly" ? ("yearly" as const) : ("monthly" as const);
      const net = expenseNetIls(
        { amount_gross: Number(r.amount_gross), amount_no_vat: r.amount_no_vat as number | null, currency: String(r.currency), vat_included: r.vat_included === true },
        Number(date.slice(0, 4)),
        { table: fx, month: Number(date.slice(5, 7)) },
      );
      const renew = Number(r.renew_months);
      return {
        id: String(r.id),
        vendor: String(r.vendor),
        description: String(r.description ?? ""),
        category,
        currency: String(r.currency),
        renewMonths: category === "monthly" ? 1 : renew >= 1 ? renew : 12,
        date,
        endDate: (r.end_date as string | null) ?? null,
        netIls: net,
        gross: Number(r.amount_gross),
        state: r.state == null ? undefined : String(r.state),
      };
    });
}

/* ── dates ──────────────────────────────────────────────────────────────── */

const ymd = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const utc = (iso: string) => {
  const [y, m, d] = ymd(iso);
  return Date.UTC(y, m - 1, d);
};
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000);
/** `iso` moved by `n` days. */
export const shiftIso = (iso: string, n: number) => {
  const [y, m, d] = ymd(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
/** `iso` + `n` months, the day clamped to the month's last (Jan 31 + 1 → Feb 28). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = ymd(iso);
  const i = y * 12 + (m - 1) + n;
  const ny = Math.floor(i / 12);
  const nm = (i % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/* ── chains ─────────────────────────────────────────────────────────────── */

/** A vendor's name as two are compared: trimmed, lower case. */
export const canon = (s: string) => s.trim().toLowerCase();

/**
 * Each vendor's rows, linked into subscriptions: a yearly row continues the
 * chain whose next renewal falls within a month of its date (the closest; the
 * same description wins a tie), else it starts a new one — Wix pays for three
 * sites, each its own chain. Monthly rows of one vendor are one chain.
 */
export function chainsOf(subs: Subscription[], today: string): Chain[] {
  const groups = new Map<string, Subscription[][]>();
  const sorted = [...subs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const s of sorted) {
    const key = `${canon(s.vendor)}|${s.category}`;
    const chains = groups.get(key) ?? [];
    groups.set(key, chains);
    if (s.category === "monthly") {
      if (chains[0]) chains[0].push(s);
      else chains.push([s]);
      continue;
    }
    let best: { chain: Subscription[]; score: number } | null = null;
    for (const chain of chains) {
      const last = chain[chain.length - 1];
      const gap = Math.abs(daysBetween(addMonths(last.date, last.renewMonths), s.date));
      if (gap > 31) continue;
      const score = gap - (canon(last.description) === canon(s.description) ? 15 : 0);
      if (!best || score < best.score) best = { chain, score };
    }
    if (best) best.chain.push(s);
    else chains.push([s]);
  }
  return [...groups.values()].flat().map((rows) => chainFrom(rows, today));
}

function chainFrom(rows: Subscription[], today: string): Chain {
  const started = rows.filter((r) => r.date <= today);
  const current = started[started.length - 1] ?? null;
  const upcoming = rows.find((r) => r.date > today) ?? null;
  const last = rows[rows.length - 1];
  const category = last.category;
  let live = !last.endDate || last.endDate >= today;
  // A yearly renewal never entered, LAPSE_DAYS past its day, is a subscription that lapsed
  // (Nitsan, 2026-11-09: Envato's renewal failed in June 2025 and it still counted as live).
  // The P&L already stopped: a yearly row only costs the months it covers.
  if (live && category === "yearly" && !upcoming && current && !current.endDate && daysBetween(addMonths(current.date, current.renewMonths), today) > LAPSE_DAYS) live = false;

  let nextRenewal: string | null = null;
  if (category === "yearly" && live) {
    if (upcoming) nextRenewal = upcoming.date;
    else if (current) {
      // The Expenses page's own countdown: step the start by its period past today.
      let next = current.date;
      for (let i = 0; next <= today && i < 100; i++) next = addMonths(current.date, current.renewMonths * (i + 1));
      // An end date before that payment means it won't come (v1.15.1: "turn it off" = an end
      // date on the period's last day). An end ON the renewal day is an imported row's period end.
      nextRenewal = current.endDate && current.endDate < next ? null : next;
    }
  }

  const latest = upcoming ?? current ?? last;
  const yearIls = latest.netIls * (12 / Math.max(1, latest.renewMonths));
  const i = rows.indexOf(latest);
  const prev = i > 0 ? rows[i - 1] : null;
  let priceChange: number | null = null;
  if (prev && category === "yearly") {
    const [a, b] = prev.currency === latest.currency ? [prev.gross, latest.gross] : [prev.netIls, latest.netIls];
    if (a > 0) priceChange = b / a - 1;
  }
  return { id: rows[0].id, vendor: last.vendor.trim(), category, rows, current, upcoming, live, nextRenewal, yearIls, priceChange };
}

/** Days past a yearly renewal with none entered before it counts as lapsed. */
export const LAPSE_DAYS = 45;

/** Will it be paid again? Not a yearly that won't renew, nor a monthly with an end date (cancelled, running out its period). */
export const renews = (c: Chain) => (c.category === "yearly" ? c.nextRenewal != null : !c.rows[c.rows.length - 1].endDate);

/** Live subscriptions only, with what each one is. */
export function liveTools(subs: Subscription[], today: string): (Chain & { kinds: ToolKind[] })[] {
  return chainsOf(subs, today)
    .filter((c) => c.live && c.current)
    .map((c) => ({ ...c, kinds: kindsOf(c.vendor, c.rows.map((r) => r.description).join(" ")) }));
}
