/**
 * Seed the cycle-to-date egress figure from a dashboard reading.
 *
 *   node --env-file=.env.local scripts/seed-egress.mjs 11.95 2026-08-26
 *                                                       ^GB   ^date read
 *
 * ⚠️ WHY A SEED IS NEEDED AT ALL: `usage.api-counts` looks back 7 days at most, so
 * the first three weeks of a ~30-day cycle cannot be recovered. The estimate is
 * `seed + Σ(sampled days after the seed date)`, so one hand-typed number from the
 * dashboard anchors the whole cycle. Re-run this whenever somebody looks at the
 * dashboard — it is the only thing that bounds the drift.
 *
 * ⚠️⚠️ DATE THE SEED ONE DAY EARLIER THAN THE READING, ON PURPOSE. A figure read
 * mid-afternoon covers part of that day; dating the seed to the day BEFORE means
 * the whole of the reading day is also counted from samples, so the overlapping
 * few hours are counted twice. **For an alert, over-counting is the safe
 * direction** — it fires slightly early, whereas under-counting means no warning
 * at all. The default below does this for you.
 *
 * ⚠️ The seed is stamped with the cycle it belongs to (`seedCycleStart`). When the
 * cycle rolls over, `estimateCycle` discards it rather than carrying 11.95 GB into
 * a fresh month and screaming on day one.
 */
import { createClient } from "@supabase/supabase-js";

const [gbArg, dateArg] = process.argv.slice(2);
if (!gbArg) {
  console.error("usage: seed-egress.mjs <GB from the dashboard> [YYYY-MM-DD it was read]");
  process.exit(1);
}
const gb = Number(gbArg);
if (!Number.isFinite(gb) || gb < 0) {
  console.error(`not a number of GB: ${gbArg}`);
  process.exit(1);
}

const readOn = dateArg ? new Date(`${dateArg}T12:00:00`) : new Date();
if (Number.isNaN(readOn.getTime())) {
  console.error(`not a date: ${dateArg}`);
  process.exit(1);
}
// One day earlier — see the header.
const seedDay = new Date(readOn.getFullYear(), readOn.getMonth(), readOn.getDate() - 1);
const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const CYCLE_RESET_DAY = 5; // keep in step with src/lib/egress.ts
const cycleStart =
  readOn.getDate() >= CYCLE_RESET_DAY
    ? new Date(readOn.getFullYear(), readOn.getMonth(), CYCLE_RESET_DAY)
    : new Date(readOn.getFullYear(), readOn.getMonth() - 1, CYCLE_RESET_DAY);

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: row } = await db
  .from("app_settings")
  .select("value")
  .eq("key", "egress_state")
  .maybeSingle();
const state = row?.value ?? { samples: [], lastPolledAt: null };

const next = {
  ...state,
  seedBytes: Math.round(gb * 1024 ** 3),
  seedDate: iso(seedDay),
  seedCycleStart: iso(cycleStart),
};

const { error } = await db
  .from("app_settings")
  .upsert({ key: "egress_state", value: next }, { onConflict: "key" });
if (error) throw error;

console.log(`seeded ${gb} GB`);
console.log(`  read on      ${iso(readOn)}`);
console.log(`  seed dated   ${next.seedDate}  (a day earlier, so the reading day is counted in full)`);
console.log(`  cycle start  ${next.seedCycleStart}`);
console.log(`  samples kept ${(next.samples ?? []).length}`);
