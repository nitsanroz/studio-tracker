// &advice in Hebrew (Nitsan, 2026-11-15: "an option to show the cards and the
// suggestions in Hebrew"). The rules write English; this translates what the
// pane shows, sentence by sentence, and remembers each translation.
//
// ⚠️ NO AMOUNTS LEAVE THE SERVER, as everywhere in &advice. Before a sentence
// goes to Claude every amount in it becomes a numbered mark ("{{1}}" —
// redact.ts `maskAmounts`). Claude translates around the marks; the server puts
// each amount back where its mark landed. A translation that drops or invents a
// mark, or that carries an amount of its own, is thrown away and the sentence
// stays in English.
//
// The memory is keyed by the MARKED sentence, so it holds no amount either, and
// a card whose amount changes keeps its Hebrew. It lives in the runs log
// (`finance_advice_runs`, model "hebrew/…", owner-only by policy) — one row per
// batch, so the option needs no migration.
//
// Server only, the owner's own session. One Claude call per batch of new
// sentences; a sentence already translated costs nothing.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RUNS } from "@/lib/finance/advice/load";
import { hasAmount, marksIn, maskAmounts, unmaskAmounts } from "@/lib/finance/advice/redact";

const MODEL = "claude-opus-5-5";
/** The translation batches in RUNS: their `model` starts with this. */
export const HEBREW_RUN = "hebrew/";
/** How many batches back the memory reads — sentences older than that are simply translated again. */
const MEMORY_ROWS = 300;
const BATCH = 60;
/** What one request may ask for. */
export const MAX_TEXTS = 400;
export const MAX_LENGTH = 2000;

const SYSTEM = `You translate the text of &advice — the advisor inside the Studio&more tracker, a design studio in Tel Aviv — from English into Hebrew. The reader is the studio's owner, a designer and a native Hebrew speaker.

You get a list of items, each with an id and a text: card titles, one- or two-sentence explanations, short labels, and notes under figures. Return every id with its Hebrew.

Rules:
- Natural, plain, concise Hebrew, the way a sharp colleague would say it. Not word for word, not formal, no padding. Keep the meaning and every fact exactly: add nothing, drop nothing.
- Marks like {{1}} or {{2}} stand for money amounts you are not shown. Keep each mark exactly as written, once, where the amount belongs in the Hebrew sentence. Never write an amount or a currency yourself.
- Keep every number, percentage and date. Write hours as "שעות" (or "ש׳" in a short label), percentage points as "נק׳".
- Keep in English, untranslated: names of people, clients and products; and the names of the app's pages and buttons, which the reader looks for on screen (for example Client Reports, Rates, Plan, Expenses, Leads, Team, Overview, Scenarios, Keys, &advice). An instruction such as "Open Rates" becomes "לפתוח את Rates".
- Speak to the reader in neutral forms — infinitives and impersonal phrasing ("כדאי להעלות", "לבדוק") — not imperatives.
- For a named person prefer constructions that do not gender them — "השעות של" and the name, not a gendered verb — wherever the sentence allows it.
- Month names and weekdays in Hebrew. "Sun–Thu" becomes "א׳–ה׳".
- If a text is only a name, a number or a page name, return it unchanged.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, he: { type: "string" } },
        required: ["id", "he"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

/** Marked sentence → marked Hebrew: every translation remembered, newest winning. */
export async function loadMemory(sb: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await sb.from(RUNS).select("ideas").like("model", `${HEBREW_RUN}%`).is("error", null).order("run_at", { ascending: false }).limit(MEMORY_ROWS);
  if (error) throw new Error(`${RUNS}: ${error.message}`);
  const memory = new Map<string, string>();
  for (const row of data ?? []) {
    const pairs = (row.ideas as { pairs?: Record<string, string> }[] | null)?.[0]?.pairs;
    for (const [k, v] of Object.entries(pairs ?? {})) if (!memory.has(k) && typeof v === "string") memory.set(k, v);
  }
  return memory;
}

const HEBREW_LETTER = /[א-ת]/;

/**
 * Is `he` a usable translation of the marked sentence `masked`? The same marks,
 * no amount the source didn't have, and Hebrew in it unless the source was
 * nothing to translate (a name, a number).
 */
export function acceptable(masked: string, he: string): boolean {
  const text = he.trim();
  if (!text || text.length > MAX_LENGTH * 2) return false;
  if (marksIn(text) !== marksIn(masked)) return false;
  // "1,250h" reads as an amount to `hasAmount`; a sentence that had it may keep it.
  if (hasAmount(text) && !hasAmount(masked)) return false;
  return HEBREW_LETTER.test(text) || text === masked.trim();
}

/** One Claude call: marked sentences in, marked Hebrew out for those that came back usable. */
async function translateBatch(client: Anthropic, masked: string[]): Promise<{ pairs: Record<string, string>; usage: { in: number; out: number }; model: string }> {
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify({ items: masked.map((text, i) => ({ id: String(i), text })) }, null, 1) }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    fallbacks: "default",
    betas: ["server-side-fallback-2026-07-01"],
  });
  if (res.stop_reason === "refusal") throw new Error("declined");
  if (res.stop_reason === "max_tokens") throw new Error("the answer was cut off");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const out = JSON.parse(text) as { items: { id: string; he: string }[] };
  const pairs: Record<string, string> = {};
  for (const it of out.items ?? []) {
    const src = masked[Number(it.id)];
    if (src != null && typeof it.he === "string" && acceptable(src, it.he)) pairs[src] = it.he.trim();
  }
  return { pairs, usage: { in: res.usage.input_tokens, out: res.usage.output_tokens }, model: res.model };
}

export interface HebrewAnswer {
  /** English sentence (as shown) → Hebrew, amounts in place. Sentences with no translation are absent. */
  he: Record<string, string>;
  /** why new sentences weren't translated, in a few words; null when all is well */
  off: string | null;
}

/**
 * The Hebrew of each sentence: from memory where it's there, from Claude where
 * it isn't. Never throws for a failed translation — the sentence is just absent
 * and shows in English.
 */
export async function hebrewFor(sb: SupabaseClient, texts: string[]): Promise<HebrewAnswer> {
  const sources = [...new Set(texts.map((t) => t.trim()).filter((t) => t && t.length <= MAX_LENGTH))].slice(0, MAX_TEXTS);
  const marked = sources.map((text) => ({ text, ...maskAmounts(text) }));
  const memory = await loadMemory(sb);
  const missing = [...new Set(marked.filter((m) => !memory.has(m.masked)).map((m) => m.masked))];

  let off: string | null = null;
  if (missing.length) {
    if (!process.env.ANTHROPIC_API_KEY) off = "Hebrew needs a Claude API key";
    else {
      const client = new Anthropic();
      const chunks: string[][] = [];
      for (let i = 0; i < missing.length; i += BATCH) chunks.push(missing.slice(i, i + BATCH));
      const done = await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const r = await translateBatch(client, chunk);
            const put = await sb.from(RUNS).insert({ model: `${HEBREW_RUN}${r.model}`, input_tokens: r.usage.in, output_tokens: r.usage.out, ideas: [{ pairs: r.pairs }] });
            if (put.error) throw new Error(`${RUNS}: ${put.error.message}`);
            return r.pairs;
          } catch (e) {
            const error = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}`.trim() : (e as Error).message;
            await sb.from(RUNS).insert({ model: `${HEBREW_RUN}${MODEL}`, error: error.slice(0, 500) });
            return null;
          }
        }),
      );
      if (done.some((d) => d == null)) off = "Some of it couldn't be translated — try again";
      for (const pairs of done) for (const [k, v] of Object.entries(pairs ?? {})) memory.set(k, v);
    }
  }

  const he: Record<string, string> = {};
  for (const m of marked) {
    const found = memory.get(m.masked);
    // Checked again on the way out: a remembered line is trusted no more than a new one.
    if (found && acceptable(m.masked, found)) he[m.text] = unmaskAmounts(found, m.amounts);
  }
  return { he, off };
}
