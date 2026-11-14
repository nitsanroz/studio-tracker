// &advice's daily Claude step for finance (v1.6.0): reword the open findings in
// a colleague's voice and add up to three Ideas. The tracker's word.ts is the
// model; this one runs on the day's first pane open (finance has no crons).
//
// ⚠️ NO AMOUNTS LEAVE THE SERVER (Nitsan, 2026-10-24: "yes, without amounts").
// Claude gets titles (amount-free by construction, signals.ts), bodies and pulse
// notes with every amount replaced by "[amount]", and facts without their money
// keys. The card puts the rule's exact figure beside Claude's sentence, and any
// wording that comes back with an amount in it is thrown away.
//
// ⚠️ OPTIONAL BY DESIGN. Without ANTHROPIC_API_KEY, or when the call fails, the
// credit runs out (Nitsan's promotional credit expires 2026-11-06), or the
// answer doesn't parse, nothing breaks: items keep the rule's own sentence and
// the run is logged with its error, which the pane's footer reads.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOT_FROM_RULES, toDb } from "./merge";
import { hasAmount, promptFor } from "./redact";
import { ITEMS, RUNS, runCheck, studioToday, type AdviceView } from "./run";

const MODEL = "claude-opus-5-5";

const SYSTEM = `You are &advice, the finance advisor inside the Studio&more finance app — a design studio of about eight designers in Tel Aviv, working Sunday to Thursday. Your reader is Nitsan, the owner. He is a designer, reads quickly, and dislikes vague or padded text.

You get the findings the app's own checks produced today. Every money amount has been replaced by "[amount]": the app shows the exact figure beside your text, so you never need one. For each finding, write:
- title: one short line saying what's happening (max ~70 characters).
- body: one or two plain sentences on why it matters and what to do. Use only the hours, percentages, names and dates given; never invent a number, a name or a date.

Then suggest at most three ideas: things worth doing that follow from these findings taken together (for example a client paying late in the same month the pace is behind). Skip ideas rather than stretch. Each idea has a title, a body and an area (one or two words).

Never write a money amount, a currency, or "[amount]". Refer to people by name, never by "he" or "she". Plain English.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, title: { type: "string" }, body: { type: "string" } },
        required: ["key", "title", "body"],
        additionalProperties: false,
      },
    },
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" }, area: { type: "string" } },
        required: ["title", "body", "area"],
        additionalProperties: false,
      },
    },
  },
  required: ["items", "ideas"],
  additionalProperties: false,
} as const;

interface Worded {
  items: { key: string; title: string; body: string }[];
  ideas: { title: string; body: string; area: string }[];
}

/**
 * Today's wording, once: runs the checks, and unless a run already happened
 * today, asks Claude. Returns the pane's fresh view either way.
 */
export async function wordToday(sb: SupabaseClient): Promise<AdviceView> {
  const today = studioToday();
  const { view, rows } = await runCheck(sb);
  // wordingDue = an API key and no run yet today (runCheck read the runs log).
  if (!view.wordingDue) return { ...view, wordingDue: false };

  // Claude's own items (ideas, the tools review) aren't reworded.
  const open = rows.filter((r) => !r.resolvedAt && !NOT_FROM_RULES.has(r.signal));
  const client = new Anthropic();
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: promptFor(open, view.pulse, today) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    });
    if (res.stop_reason === "refusal") throw new Error("declined");
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const out = JSON.parse(text) as Worded;

    const byKey = new Map(open.map((r) => [r.key, r]));
    const clean = (s: string) => s.trim() && !hasAmount(s);
    const wording = out.items.flatMap((w) => {
      const row = byKey.get(w.key);
      return row && clean(w.title) && clean(w.body) ? [{ id: row.id, title: w.title.trim(), body: w.body.trim() }] : [];
    });
    const now = new Date().toISOString();
    const ideas = out.ideas.slice(0, 3).filter((i) => clean(i.title) && clean(i.body));
    const check = (table: string) => (r: { error: { message: string } | null }) => {
      if (r.error) throw new Error(`${table}: ${r.error.message}`);
    };
    await Promise.all([
      ...wording.map((w) => sb.from(ITEMS).update(toDb({ wordedTitle: w.title, wordedBody: w.body })).eq("id", w.id).then(check(ITEMS))),
      // Today's ideas replace yesterday's (retire, then add — in that order).
      sb
        .from(ITEMS)
        .update(toDb({ resolvedAt: now }))
        .eq("signal", "idea")
        .is("resolved_at", null)
        .then(async (r) => {
          check(ITEMS)(r);
          if (!ideas.length) return;
          const fresh = ideas.map((i, n) =>
            toDb({
              key: `idea:${today}:${n}`,
              signal: "idea",
              kind: "idea",
              area: (clean(i.area) && i.area.trim()) || "Finance",
              severity: 0,
              facts: {},
              title: i.title.trim(),
              body: i.body.trim(),
              isReminder: false,
              firstSeen: now,
              lastSeen: now,
              resolvedAt: null,
            }),
          );
          check(ITEMS)(await sb.from(ITEMS).upsert(fresh, { onConflict: "key" }));
        }),
      sb
        .from(RUNS)
        .insert({ model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, ideas })
        .then(check(RUNS)),
    ]);
  } catch (e) {
    const error = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}`.trim() : (e as Error).message;
    await sb.from(RUNS).insert({ model: MODEL, error: error.slice(0, 500) });
  }
  // The pane shows the stored wording, so read it back through one more check.
  return { ...(await runCheck(sb)).view, wordingDue: false };
}
