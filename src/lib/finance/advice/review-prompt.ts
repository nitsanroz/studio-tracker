// What the "Review the tools" step (review.ts, v1.11.0) sends Claude and
// what it keeps of the answer — pure, so it's tested without an API call.
//
// ⚠️ NO AMOUNTS, as for the daily wording (Nitsan, 2026-10-24; confirmed for
// the tools review 2026-11-05). Claude gets each live subscription's vendor,
// plan names (amounts stripped), job, billing cycle, currency, renewal date,
// how its price moved (a percentage) and its RANK by cost — never a figure.
// The card shows the app's own yearly cost beside Claude's sentence, and any
// answer carrying an amount is dropped.

import { hasAmount, stripAmounts } from "./redact";
import { canon, type Chain, type ToolKind } from "./tools";

export type LiveTool = Chain & { kinds: ToolKind[] };

export interface StudioFacts {
  /** people with time logged in the tracker over the last 30 days */
  loggingTime: number;
  /** salary rows last month — people on payroll */
  onPayroll: number;
}

export const VERDICTS = ["cancel", "merge", "switch", "downgrade", "check"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const REVIEW_SYSTEM = `You are &advice, the finance advisor inside the Studio&more finance app — a design studio in Tel Aviv, working Sunday to Thursday. Your reader is Nitsan, the owner: a designer who reads quickly and dislikes vague or padded text.

You get every subscription the studio pays for today, ranked by what it costs a year (rank 1 = the most), with its plan names, the job it does, how it's billed, when it renews, how its price moved, and the latest billing emails from that vendor (receipts, renewal notices, price changes, cancellations, failed payments) found in the studio's mailboxes. Money amounts are left out on purpose: the app shows the exact cost beside your text, so never write one.

Review them as a sharp studio operations manager would, and say what is worth doing:
- cancel: it looks unused or replaced (for example by something the studio does in-house).
- merge: several tools do one job; say which one to keep and why.
- switch: a better or cheaper alternative exists for a studio this size; name it.
- downgrade: a smaller plan, fewer seats, or yearly instead of monthly billing would do.
- check: worth confirming something first (who uses it, seat count against people, whether it belongs in the studio's books at all).

Use what you know of these products and their usual plans and prices, and say "usually" where prices or plans may have changed. Weigh the cost rank: a saving on a rank-1 tool matters more than on a rank-30 one. Seat counts in plan names can be set against the people numbers given. An email can show what the expense rows don't: a price change announced, a cancellation, a plan or seat change in a receipt's subject. Skip anything that is fine as it is — at most eight items, the most valuable first, and fewer is better than stretching.

For each item: ref (the tool's ref, exactly as given), verdict, title (one short line, max ~70 characters, no amounts), body (one to three plain sentences: what to do and why), alternative (the product to move to or keep instead, or "" if none). Then a summary: one or two sentences on the overall picture. Refer to people by name, never "he" or "she". Plain English. Never write a money amount, a currency symbol or "[amount]".`;

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ref: { type: "string" },
          verdict: { type: "string", enum: [...VERDICTS] },
          title: { type: "string" },
          body: { type: "string" },
          alternative: { type: "string" },
        },
        required: ["ref", "verdict", "title", "body", "alternative"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["items", "summary"],
  additionalProperties: false,
} as const;

export interface Reviewed {
  items: { ref: string; verdict: Verdict; title: string; body: string; alternative: string }[];
  summary: string;
}

const billing = (t: LiveTool) => {
  const row = t.upcoming ?? t.current!;
  return t.category === "monthly" ? "monthly" : row.renewMonths === 12 ? "yearly" : `every ${row.renewMonths} months`;
};

/** A billing email the scan kept (lib/mail/scan.ts): kind, day, subject. */
export interface MailHint {
  vendor: string;
  kind: string;
  date: string;
  subject: string;
}

/** The amount-free JSON Claude is sent. */
export function reviewPrompt(tools: LiveTool[], studio: StudioFacts, today: string, mail: MailHint[] = []): string {
  const ranked = [...tools].sort((a, b) => b.yearIls - a.yearIls);
  const subscriptions = ranked.map((t, i) => {
    const row = t.upcoming ?? t.current!;
    const plans = [...new Set(t.rows.map((r) => stripAmounts(r.description.trim())).filter(Boolean))];
    return {
      ref: t.id,
      vendor: t.vendor,
      costRank: i + 1,
      plans,
      job: t.kinds.map((k) => k.kind),
      billed: billing(t),
      currency: row.currency,
      since: t.rows[0].date,
      renews: t.nextRenewal,
      lastPriceChange: t.priceChange == null || Math.abs(t.priceChange) < 0.05 ? null : `${t.priceChange > 0 ? "+" : "−"}${Math.round(Math.abs(t.priceChange) * 100)}%`,
      // The vendor's latest billing mail, newest first — subjects with amounts stripped.
      recentMail: mail
        .filter((m) => canon(m.vendor) === canon(t.vendor))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 4)
        .map((m) => ({ kind: m.kind, date: m.date, subject: stripAmounts(m.subject) })),
    };
  });
  const inHouse = [...new Set(tools.flatMap((t) => t.kinds.flatMap((k) => (k.inHouse ? [`${k.kind}: ${k.inHouse}.`] : []))))];
  return JSON.stringify(
    {
      today,
      studio: { peopleLoggingTimeLast30Days: studio.loggingTime, onPayrollLastMonth: studio.onPayroll, doneInHouse: inHouse },
      subscriptions,
    },
    null,
    1,
  );
}

/** Claude's items that point at a real tool and carry no amount — the rest are dropped. */
export function acceptReview(out: Reviewed, tools: LiveTool[]): (Reviewed["items"][number] & { tool: LiveTool })[] {
  const byId = new Map(tools.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const clean = (s: string) => !hasAmount(s);
  return out.items.flatMap((i) => {
    const tool = byId.get(i.ref);
    if (!tool || seen.has(i.ref) || !VERDICTS.includes(i.verdict)) return [];
    if (!i.title.trim() || !i.body.trim() || !clean(i.title) || !clean(i.body) || !clean(i.alternative)) return [];
    seen.add(i.ref);
    return [{ ...i, title: i.title.trim(), body: i.body.trim(), alternative: i.alternative.trim(), tool }];
  }).slice(0, 8);
}
