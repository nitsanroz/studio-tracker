// "Review the business" — the owner asks, from the &advice pane, and Claude
// reads the studio the way an outside business and organisational consultant
// would: the whole picture at once, not one alarm at a time.
//
// ⚠️ NO AMOUNTS LEAVE THE SERVER, as for the daily wording and the tools
// review (Nitsan, 2026-10-24). Claude gets business.ts `businessBrief`:
// shares of income, percentage changes, hours, counts, and rates as an index
// where the studio's average rate is 100. Any answer carrying an amount is
// dropped. The app's own strategic cards (business.ts `strategy`) hold the
// figures; this adds the judgement.
//
// One Claude call per click, never on a schedule. Its cards (signal "review")
// replace the last review's; the summary and the questions sit in the runs log.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { studioToday } from "@/lib/format";
import { ITEMS, RUNS } from "@/lib/finance/advice/load";
import { hasAmount, stripAmounts } from "@/lib/finance/advice/redact";
import { businessBrief, type BusinessMetrics } from "./business";
import { NOT_FROM_RULES, toDb, type AdviceRow } from "./merge";
import { PLAYBOOK } from "./playbook";

const MODEL = "claude-opus-5-5";
/** The business review's runs in RUNS: their `model` starts with this. */
export const BUSINESS_RUN = "business-review/";

export const AREAS = ["Pricing", "Team", "Clients", "Costs", "Tax", "Growth", "You"] as const;
export type Area = (typeof AREAS)[number];
export const HORIZONS = ["this month", "this quarter", "this year"] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Where a recommendation's card leads. */
const AREA_HREF: Record<Area, [string, string]> = {
  Pricing: ["/finance/rates", "Open Rates"],
  Team: ["/team", "Open Team"],
  Clients: ["/clients", "Open Clients"],
  Costs: ["/finance/expenses", "Open Expenses"],
  Tax: ["/finance/scenarios", "Open Scenarios"],
  Growth: ["/leads", "Open Leads"],
  You: ["/reports", "Open Reports"],
};

export const BUSINESS_SYSTEM = `You are &advice, acting as a senior business and organisational consultant to Studio&more — a design studio of about eight designers in Tel Aviv, working Sunday to Thursday, selling design hours to clients at an hourly rate (some fixed-price projects). Your reader is Nitsan, the owner: a designer, not a finance person. He reads quickly and dislikes vague or padded text.

You get the studio's last three complete months as a consultant's brief. There are NO money amounts in it, on purpose: costs are shares of income, changes are percentages, and rates are an index where the studio's average rate is 100 (so a client at 80 pays a fifth less than average, and "costOfABillableHourIndex" 95 means an hour costs the studio 95% of what the average hour is sold for). Hours, head counts and months are real. "leftAfterItsPeoplePct" is what a client's income leaves after the cost of the people who worked on it, before rent and tools. "whatTheChecksFoundToday" lists what the app's own rules already flagged — do not repeat those; build on them.

Before the brief you are given BACKGROUND: the benchmarks and decision rules consultants to small agencies work from, and what has changed for studios in the AI era. Use it to place this studio — where it sits against a healthy one, and which rule applies — but the studio's own figures always come first, and a benchmark is a rule of thumb, mostly from US agencies.

Think as a consultant who has seen many small studios, and weigh the whole picture together: price, the size and use of the team, which clients are worth the hours, the cost structure, dependence on the owner and on one client, the pipeline, tax timing where the brief mentions it, and how the studio is placed for a market where AI shortens the hours and clients take routine work in-house. Look for the two or three things that would change this studio's year, and say what to do about each. Prefer a decision to an observation: "raise X's rate at the January renewal" beats "X's rate is low". Say what you would NOT do when the obvious move is wrong (for example hiring when the team bills well under a full day). Be honest when the data is too thin to say.

Write:
- summary: three or four sentences — the state of the studio as you'd say it across a table.
- recommendations: three to six, most important first. Each has: area (one of the list), horizon (one of the list), title (one short line, max ~80 characters), why (one or two sentences citing the figures given), action (one or two sentences: the concrete next step, who or which client, by when).
- questions: up to three questions only the owner can answer, that would change your advice.

Never write a money amount, a currency, or an index number as if it were a price. Use percentages, hours, counts and names. Refer to people by name, never "he" or "she". Plain English.`;

export const BUSINESS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          area: { type: "string", enum: [...AREAS] },
          horizon: { type: "string", enum: [...HORIZONS] },
          title: { type: "string" },
          why: { type: "string" },
          action: { type: "string" },
        },
        required: ["area", "horizon", "title", "why", "action"],
        additionalProperties: false,
      },
    },
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "recommendations", "questions"],
  additionalProperties: false,
} as const;

export interface BusinessReviewed {
  summary: string;
  recommendations: { area: Area; horizon: Horizon; title: string; why: string; action: string }[];
  questions: string[];
}

/** The amount-free JSON Claude is sent: the brief, with today's open findings as titles only. */
export function businessPrompt(m: BusinessMetrics, today: string, rows: AdviceRow[]): string {
  const findings = rows
    .filter((r) => !r.resolvedAt && !NOT_FROM_RULES.has(r.signal))
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 20)
    .map((r) => ({ area: r.area, title: stripAmounts(r.title) }));
  return JSON.stringify(businessBrief(m, today, findings), null, 1);
}

/** Claude's answer, kept only where it is well-formed and carries no amount. */
export function acceptBusiness(out: BusinessReviewed): BusinessReviewed {
  const clean = (s: unknown): s is string => typeof s === "string" && !!s.trim() && !hasAmount(s);
  return {
    summary: clean(out.summary) ? out.summary.trim() : "",
    recommendations: (out.recommendations ?? [])
      .filter((r) => AREAS.includes(r.area) && HORIZONS.includes(r.horizon) && clean(r.title) && clean(r.why) && clean(r.action))
      .slice(0, 6)
      .map((r) => ({ ...r, title: r.title.trim(), why: r.why.trim(), action: r.action.trim() })),
    questions: (out.questions ?? []).filter(clean).slice(0, 3).map((q) => q.trim()),
  };
}

/** The latest business review: when, what it said, and its error if it failed. */
export interface BusinessReviewState {
  at: string;
  summary: string | null;
  questions: string[];
  error: string | null;
}

export async function lastBusinessReview(sb: SupabaseClient): Promise<BusinessReviewState | null> {
  const { data } = await sb.from(RUNS).select("run_at, ideas, error").like("model", `${BUSINESS_RUN}%`).order("run_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const kept = (data.ideas as { summary?: string; questions?: string[] }[] | null)?.[0];
  return { at: String(data.run_at), summary: kept?.summary || null, questions: kept?.questions ?? [], error: (data.error as string | null) ?? null };
}

/**
 * Ask Claude for the review and store it. `metrics` and `rows` come from the
 * check the route has just run, so the brief is today's. Throws with a status
 * of 503 when there is no key, 409 when the last three months aren't booked.
 */
export async function reviewBusiness(sb: SupabaseClient, metrics: BusinessMetrics | null, rows: AdviceRow[]): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("The business review needs ANTHROPIC_API_KEY in this Vercel project."), { status: 503 });
  if (!metrics) throw Object.assign(new Error("The last three months aren't in the books yet — there is nothing to review."), { status: 409 });
  const today = studioToday();
  const client = new Anthropic();
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: BUSINESS_SYSTEM,
      messages: [{ role: "user", content: `${PLAYBOOK}\n\nTHE STUDIO — the last three complete months:\n${businessPrompt(metrics, today, rows)}` }],
      output_config: { effort: "high", format: { type: "json_schema", schema: BUSINESS_SCHEMA } },
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    });
    if (res.stop_reason === "refusal") throw new Error("declined");
    if (res.stop_reason === "max_tokens") throw new Error("the answer was cut off");
  } catch (e) {
    const error = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}`.trim() : (e as Error).message;
    await sb.from(RUNS).insert({ model: `${BUSINESS_RUN}${MODEL}`, error: error.slice(0, 500) });
    throw new Error(`The review didn't run: ${error}`);
  }

  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const kept = acceptBusiness(JSON.parse(text) as BusinessReviewed);
  const now = new Date().toISOString();

  // This review replaces the last one's cards (retire, then add — in that order).
  const retired = await sb.from(ITEMS).update(toDb({ resolvedAt: now })).eq("signal", "review").is("resolved_at", null);
  if (retired.error) throw new Error(`${ITEMS}: ${retired.error.message}`);
  if (kept.recommendations.length) {
    const fresh = kept.recommendations.map((r, n) =>
      toDb({
        key: `review:${today}:${n}`,
        signal: "review",
        kind: "idea",
        area: `Business · ${r.area}`,
        clientId: null,
        // The first is the one that matters most.
        severity: kept.recommendations.length - n,
        facts: { horizon: r.horizon, href: AREA_HREF[r.area][0], action: AREA_HREF[r.area][1] },
        title: r.title,
        body: `${r.why} ${r.action}`,
        wordedTitle: null,
        wordedBody: null,
        isReminder: false,
        firstSeen: now,
        lastSeen: now,
        resolvedAt: null,
        doneAt: null,
        snoozedUntil: null,
        snoozedAtSeverity: null,
      }),
    );
    const put = await sb.from(ITEMS).upsert(fresh, { onConflict: "key" });
    if (put.error) throw new Error(`${ITEMS}: ${put.error.message}`);
  }
  await sb.from(RUNS).insert({
    model: `${BUSINESS_RUN}${res.model}`,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
    ideas: [{ summary: kept.summary, questions: kept.questions, items: kept.recommendations.length }],
  });
}
