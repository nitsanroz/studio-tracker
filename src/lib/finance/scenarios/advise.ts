// The Scenarios advisor's one Claude call (server only). One call per click —
// never on a schedule. Each run is logged in finance_scenario_advice
// (reference/0023), with its answer or its error.
//
// The page sends what the advisor sees (advise-prompt.ts `adviceInput`,
// worked out in the browser from the owner's own data). Owner-only route;
// real figures by Nitsan's choice, people by initials.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADVISE_SCHEMA, ADVISE_SYSTEM, advisePrompt, type Advice, type AdviceInput } from "./advise-prompt";

const MODEL = "claude-opus-5-5";
export const ADVICE_TABLE = "finance_scenario_advice";

export interface AdviceRun {
  id: string | null;
  runAt: string;
  model: string;
  advice: Advice;
}

export async function adviseScenarios(sb: SupabaseClient, input: AdviceInput, scenarioIds: string[]): Promise<AdviceRun> {
  if (!process.env.ANTHROPIC_API_KEY) throw Object.assign(new Error("The advisor needs ANTHROPIC_API_KEY in this Vercel project."), { status: 503 });
  const client = new Anthropic();
  const ids = scenarioIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: ADVISE_SYSTEM,
      messages: [{ role: "user", content: advisePrompt(input) }],
      output_config: { effort: "high", format: { type: "json_schema", schema: ADVISE_SCHEMA } },
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    });
    if (res.stop_reason === "refusal") throw new Error("declined");
    if (res.stop_reason === "max_tokens") throw new Error("the answer was cut off");
  } catch (e) {
    const error = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}`.trim() : (e as Error).message;
    // Best-effort log: before 0023 is run there's no table to log into.
    await sb.from(ADVICE_TABLE).insert({ scenario_ids: ids, kind: input.kind, model: MODEL, error: error.slice(0, 500) });
    throw new Error(`The advisor didn't run: ${error}`);
  }
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const advice = JSON.parse(text) as Advice;
  const runAt = new Date().toISOString();
  const { data } = await sb
    .from(ADVICE_TABLE)
    .insert({ scenario_ids: ids, kind: input.kind, model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, result: advice, run_at: runAt })
    .select("id")
    .maybeSingle();
  return { id: (data as { id: string } | null)?.id ?? null, runAt, model: res.model, advice };
}
