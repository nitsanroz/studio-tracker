// &advice's daily Claude step (v1.80.0): reword the open findings in a
// colleague's voice and add up to three Ideas from the same figures.
//
// ⚠️ OPTIONAL BY DESIGN. Without ANTHROPIC_API_KEY — or when the call fails, the
// credit runs out, or the answer doesn't parse — nothing breaks: every item keeps
// the rule's own sentence and the run is logged with its error. Nitsan's $60
// promotional credit expires 2026-11-06 and he hasn't decided to pay beyond it.
//
// ⚠️ WHAT GOES TO ANTHROPIC: client names, task names, percentages, hours and
// dates — the findings' own text and facts. Never an amount, an HR field or a
// contact. The findings are built that way (signals.ts), so this sends them as
// they are and adds nothing from the database.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertOk } from "@/lib/db";
import { studioToday } from "@/lib/format";
import { runCheck } from "./run";
import { toDb, type AdviceRow } from "./merge";

const MODEL = "claude-opus-5-5";

const SYSTEM = `You are &advice, the advisor inside the Studio&more tracker — a design studio of about eight designers in Tel Aviv, working Sunday to Thursday. Your reader is Nitsan, the owner. He is a designer, reads quickly, and dislikes vague or padded text.

You get the findings the tracker's own checks produced today, with their figures. For each one, write:
- title: one short line saying what's happening (max ~70 characters).
- body: one or two plain sentences on why it matters and what to do. Use only the figures given; never invent a number, a name or a date.

Then suggest at most three ideas: things worth doing that follow from these figures taken together (for example two clients near their caps in the same week). Skip ideas rather than stretch. Each idea has a title, a body and an area (one or two words).

Never mention money amounts or currencies. Percentages, hours and dates only. Plain English.`;

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

/** What Claude is given: the findings as the rules wrote them, minus internal links. */
export function promptFor(rows: AdviceRow[], pulse: { label: string; value: number | null; unit: string; note: string }[]): string {
  const findings = rows.map((r) => {
    const facts = { ...r.facts };
    delete facts.href;
    delete facts.action;
    delete facts.changed;
    // Task and lead ids mean nothing to Claude; the title and body name what matters.
    delete facts.list;
    return { key: r.key, kind: r.kind, area: r.area, title: r.title, body: r.body, facts };
  });
  return JSON.stringify({ today: studioToday(), figures: pulse.filter((p) => p.value != null), findings }, null, 1);
}

/** Run the checks, then word them. Returns what happened, for the cron's log. */
export async function dailyRun(sb: SupabaseClient): Promise<{ worded: number; ideas: number; error: string | null }> {
  const { view, rows } = await runCheck(sb);
  if (!process.env.ANTHROPIC_API_KEY) return { worded: 0, ideas: 0, error: "no API key" };

  // ⚠️ Every write below is checked (`assertOk`): an unchecked Supabase write
  // fails silently, and the run would log success while the pane kept the
  // plain wording. A failure lands in `advice_runs.error`, which the footer reads.
  const open = rows.filter((r) => !r.resolvedAt && r.signal !== "idea");
  const client = new Anthropic();
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: promptFor(open, view.pulse) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    });
    if (res.stop_reason === "refusal") throw new Error("declined");
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const out = JSON.parse(text) as Worded;

    const byKey = new Map(open.map((r) => [r.key, r]));
    const wording = out.items.flatMap((w) => {
      const row = byKey.get(w.key);
      return row && w.title.trim() ? [{ id: row.id, title: w.title.trim(), body: w.body.trim() }] : [];
    });
    const now = new Date().toISOString();
    const today = studioToday();
    const ideas = out.ideas.slice(0, 3).filter((i) => i.title.trim());
    await Promise.all([
      ...wording.map((w) =>
        sb
          .from("advice_items")
          .update(toDb({ wordedTitle: w.title, wordedBody: w.body }))
          .eq("id", w.id)
          .then((r) => assertOk("advice_items", r)),
      ),
      // Today's ideas replace yesterday's (retire, then add — in that order); a snoozed idea simply never returns.
      sb
        .from("advice_items")
        .update(toDb({ resolvedAt: now }))
        .eq("signal", "idea")
        .is("resolved_at", null)
        .then(async (r) => {
          assertOk("advice_items", r);
          if (!ideas.length) return;
          const rows = ideas.map((i, n) =>
            toDb({
              key: `idea:${today}:${n}`,
              signal: "idea",
              kind: "idea",
              area: i.area.trim() || "Studio",
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
          assertOk("advice_items", await sb.from("advice_items").upsert(rows, { onConflict: "key" }));
        }),
      sb
        .from("advice_runs")
        .insert({ model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, ideas: out.ideas })
        .then((r) => assertOk("advice_runs", r)),
    ]);
    return { worded: wording.length, ideas: ideas.length, error: null };
  } catch (e) {
    const error = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}`.trim() : (e as Error).message;
    // If even this write fails, the cron's response still carries the error.
    const { error: logError } = await sb.from("advice_runs").insert({ model: MODEL, error: error.slice(0, 500) });
    return { worded: 0, ideas: 0, error: logError ? `${error} (and logging it failed: ${logError.message})` : error };
  }
}
