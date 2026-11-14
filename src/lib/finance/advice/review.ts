// "Review the tools" (v1.11.0): the owner asks, from the &advice pane on the
// Expenses page, and Claude looks over every live subscription — what to
// cancel, merge, switch or downgrade (Nitsan, 2026-11-05). On demand only:
// one call per click, never on a schedule.
//
// Its suggestions are `finance_advice_items` rows with signal "tools" (kind
// idea), so snooze and dismiss work as on any card; the rule check never
// resolves them (merge.ts NOT_FROM_RULES) and the next review replaces them.
// Each run is logged in `finance_advice_runs` with model "tools-review/…",
// which the daily wording's "ran today?" check skips (run.ts REVIEW_RUN).
//
// ⚠️ NO AMOUNTS LEAVE THE SERVER — review-prompt.ts builds what Claude sees.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/finance/db";
import { buildFxTable, type FxRow } from "@/lib/finance/fx";
import { formatILS, formatILSShort } from "@/lib/finance/format";
import { monthsBack } from "@/lib/finance/overview";
import { TOOL_MAIL } from "@/lib/finance/mail/scan";
import { toDb } from "./merge";
import { hasAmount } from "./redact";
import { acceptReview, REVIEW_SCHEMA, REVIEW_SYSTEM, reviewPrompt, type Reviewed, type Verdict } from "./review-prompt";
import { ITEMS, REVIEW_RUN, RUNS, runCheck, studioToday, type AdviceView } from "./run";
import { toolHref } from "./signals";
import { liveTools, shiftIso, subscriptionsOf } from "./tools";

const MODEL = "claude-opus-5-5";

type Row = Record<string, unknown>;

const VERDICT_LABEL: Record<Verdict, string> = { cancel: "Cancel", merge: "Merge", switch: "Switch", downgrade: "Downgrade", check: "Check" };
/** cancel matters most; a "check" is a question, not a saving. */
const SEVERITY: Record<Verdict, number> = { cancel: 2, merge: 1, switch: 1, downgrade: 1, check: 0 };
const money = (n: number) => (Math.abs(n) >= 10_000 ? formatILSShort(n) : formatILS(Math.round(n)));

export async function reviewTools(sb: SupabaseClient): Promise<AdviceView> {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("The tools review needs ANTHROPIC_API_KEY in this Vercel project."), { status: 503 });
  const today = studioToday();
  const [y, m] = today.split("-").map(Number);
  const [ly, lm] = monthsBack(y, m, 1);
  const since30 = shiftIso(today, -30);

  const [subs, fx, payroll, entries, mail] = await Promise.all([
    fetchAll<Row>(sb, "finance_expenses", "id, date, end_date, category, vendor, description, amount_gross, amount_no_vat, currency, vat_included, renew_months", (q) =>
      q.in("category", ["monthly", "yearly"]).gte("date", `${y - 2}-01-01`),
    ),
    fetchAll<FxRow>(sb, "fx_rates", "year, month, usd_ils, eur_ils"),
    // Counted, never read: salaries are personal.
    sb.from("finance_salaries").select("id", { count: "exact", head: true }).eq("year", ly).eq("month", lm),
    fetchAll<Row>(sb, "time_entries", "user_id", (q) => q.gte("date", since30).not("minutes", "is", null)),
    // Billing mail (reference/0015) — none before it's run.
    fetchAll<Row>(sb, TOOL_MAIL, "vendor, kind, sent_at, subject", (q) => q.gte("sent_at", new Date(Date.now() - 400 * 86_400_000).toISOString())).catch(() => [] as Row[]),
  ]);
  const tools = liveTools(subscriptionsOf(subs, buildFxTable(fx)), today);
  const studio = { loggingTime: new Set(entries.map((e) => String(e.user_id))).size, onPayroll: payroll.count ?? 0 };

  const client = new Anthropic();
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: REVIEW_SYSTEM,
      messages: [
        {
          role: "user",
          content: reviewPrompt(
            tools,
            studio,
            today,
            mail.map((r) => ({ vendor: String(r.vendor), kind: String(r.kind), date: String(r.sent_at).slice(0, 10), subject: String(r.subject ?? "") })),
          ),
        },
      ],
      output_config: { effort: "high", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    });
    if (res.stop_reason === "refusal") throw new Error("declined");
    if (res.stop_reason === "max_tokens") throw new Error("the answer was cut off");
  } catch (e) {
    const error = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}`.trim() : (e as Error).message;
    await sb.from(RUNS).insert({ model: `${REVIEW_RUN}${MODEL}`, error: error.slice(0, 500) });
    throw new Error(`The review didn't run: ${error}`);
  }

  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const out = JSON.parse(text) as Reviewed;
  const accepted = acceptReview(out, tools);
  const now = new Date().toISOString();

  // This review replaces the last one's cards (retire, then add — in that order).
  const retired = await sb.from(ITEMS).update(toDb({ resolvedAt: now })).eq("signal", "tools").is("resolved_at", null);
  if (retired.error) throw new Error(`${ITEMS}: ${retired.error.message}`);
  if (accepted.length) {
    const fresh = accepted.map((a) => {
      const row = a.tool.upcoming ?? a.tool.current!;
      return toDb({
        key: `tools:${today}:${a.ref}`,
        signal: "tools",
        kind: "idea",
        area: `Tools · ${VERDICT_LABEL[a.verdict]}`,
        clientId: null,
        severity: SEVERITY[a.verdict],
        // The card's figure is the app's: what the tool costs a year.
        facts: {
          vendor: a.tool.vendor,
          verdict: a.verdict,
          alternative: a.alternative || null,
          yearIls: Math.round(a.tool.yearIls),
          figure: `${money(a.tool.yearIls)}/yr`,
          href: toolHref(a.tool, row),
          action: "Show it on Expenses",
          focus: `row:${row.id}`,
        },
        title: a.title,
        body: a.alternative && !a.body.includes(a.alternative) ? `${a.body} (${a.alternative})` : a.body,
        wordedTitle: null,
        wordedBody: null,
        isReminder: false,
        firstSeen: now,
        lastSeen: now,
        resolvedAt: null,
        doneAt: null,
        snoozedUntil: null,
        snoozedAtSeverity: null,
      });
    });
    const put = await sb.from(ITEMS).upsert(fresh, { onConflict: "key" });
    if (put.error) throw new Error(`${ITEMS}: ${put.error.message}`);
  }
  const summary = out.summary?.trim() && !hasAmount(out.summary) ? out.summary.trim() : null;
  await sb.from(RUNS).insert({
    model: `${REVIEW_RUN}${res.model}`,
    input_tokens: res.usage.input_tokens,
    output_tokens: res.usage.output_tokens,
    ideas: [{ summary, items: accepted.length, offered: out.items.length }],
  });
  return (await runCheck(sb)).view;
}
