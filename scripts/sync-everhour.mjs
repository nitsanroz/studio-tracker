// Incremental Everhour → Supabase time-entry sync.
// Fetches recent entries straight from the Everhour API (no snapshots) and
// inserts only rows whose everhour_id isn't in the DB yet. Tasks/users are
// matched via their stored everhour_id; entries on unknown tasks are skipped.
//
// Run:  node --env-file=.env.local scripts/sync-everhour.mjs [from] [to]

import { createClient } from "@supabase/supabase-js";

const FROM = process.argv[2] ?? "2026-07-01";
const TO = process.argv[3] ?? new Date().toISOString().slice(0, 10);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function fetchAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function everhour(path) {
  const res = await fetch(`https://api.everhour.com${path}`, {
    headers: { "X-Api-Key": process.env.EVERHOUR_API_KEY, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Everhour ${path}: ${res.status}`);
  return res.json();
}

// paginated team time
const entries = [];
for (let page = 1; ; page++) {
  const batch = await everhour(`/team/time?from=${FROM}&to=${TO}&limit=1000&page=${page}`);
  entries.push(...batch);
  if (batch.length < 1000) break;
}
console.log(`everhour returned ${entries.length} entries ${FROM} → ${TO}`);

const [tasks, users, existing] = await Promise.all([
  fetchAll("tasks", "id, everhour_id"),
  fetchAll("profiles", "id, everhour_id"),
  fetchAll("time_entries", "everhour_id"),
]);
const taskMap = new Map(tasks.filter((t) => t.everhour_id).map((t) => [t.everhour_id, t.id]));
const userMap = new Map(users.filter((u) => u.everhour_id).map((u) => [String(u.everhour_id), u.id]));
const seen = new Set(existing.map((e) => e.everhour_id).filter(Boolean));

const rows = [];
let skippedSeen = 0,
  skippedNoMatch = 0;
for (const e of entries) {
  const ehId = String(e.id);
  if (seen.has(ehId)) {
    skippedSeen++;
    continue;
  }
  const taskId = taskMap.get(e.task?.id);
  const userId = userMap.get(String(e.user));
  if (!taskId || !userId) {
    skippedNoMatch++;
    continue;
  }
  const moved = (e.history ?? []).filter((h) => h.previousTask).at(-1);
  rows.push({
    task_id: taskId,
    user_id: userId,
    date: e.date,
    minutes: Math.round(e.time / 60),
    description: e.comment ?? "",
    moved_from_task_id: moved ? (taskMap.get(moved.previousTask) ?? null) : null,
    everhour_id: ehId,
    created_at: e.createdAt ? new Date(e.createdAt + "Z").toISOString() : undefined,
  });
}

if (rows.length) {
  const { error, count } = await supabase.from("time_entries").insert(rows, { count: "exact" });
  if (error) console.error("insert failed:", error.message);
  else console.log(`inserted ${count ?? rows.length} new entries`);
} else {
  console.log("nothing new to insert");
}
console.log(`skipped: ${skippedSeen} already imported, ${skippedNoMatch} unknown task/user`);
