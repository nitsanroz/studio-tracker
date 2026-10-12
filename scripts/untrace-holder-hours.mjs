// Undo the 0052 person-tracing on the "Pre-tracker hours (finance record)" holder tasks.
//
// WHY: those tasks were built from the yearly billing sheets (backfill-from-finance.mjs).
// They record which CLIENT paid for hours in a month and nothing about WHO did the work,
// so any person assigned to them was spread by "who was employed / around that month".
// Back-tested on hours whose author is known, that rule picked the right person for 41%
// of the hours. Nitsan, 2026-10-12: "no guessing" — so every trace on a holder task goes.
// Traces on ordinary tasks (Asana assignee, comment authors, people who logged on the
// task) are evidence-based and are NOT touched.
//
// Mechanics follow the undo SQL in supabase/migrations/0052_traced_history_hours.sql,
// scoped to holder tasks: each split child's minutes go back onto the row it came from
// and the child is deleted; a row assigned in place loses its person. Studio, client and
// month totals are unchanged by construction — checked before and after.
//
// Order is deliberate: origins are restored FIRST, children deleted SECOND. A failure in
// between duplicates hours (visible in every total, and recoverable from the backup)
// rather than losing them.
//
// Usage:  node --env-file=.env.local scripts/untrace-holder-hours.mjs          (dry run)
//         node --env-file=.env.local scripts/untrace-holder-hours.mjs --apply
// Backup: data/untrace-holder-hours-backup.json (written before any change).

import { writeFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function all(q) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${url}/rest/v1/${q}`, { headers: { ...H, Range: `${f}-${f + 999}` } });
    const b = await r.json();
    if (!Array.isArray(b)) throw new Error(`${q}: ${JSON.stringify(b)}`);
    out.push(...b);
    if (b.length < 1000) return out;
  }
}

const holders = await all("tasks?select=id,client_id&title=eq.Pre-tracker%20hours%20(finance%20record)&order=id");
const holderIds = new Set(holders.map((t) => t.id));
const clientOf = new Map(holders.map((t) => [t.id, t.client_id]));

const cols = "id,task_id,user_id,minutes,date,legacy,traced_from,legacy_author_name,date_estimated,description";
const traced = (await all(`time_entries?select=${cols}&traced_from=not.is.null&order=id`)).filter((r) =>
  holderIds.has(r.task_id),
);

// Group by the row each trace came from.
const groups = new Map();
for (const r of traced) {
  if (!groups.has(r.traced_from)) groups.set(r.traced_from, []);
  groups.get(r.traced_from).push(r);
}
const originIds = [...groups.keys()];
const origins = new Map();
for (let i = 0; i < originIds.length; i += 200) {
  const chunk = originIds.slice(i, i + 200);
  for (const o of await all(`time_entries?select=${cols}&id=in.(${chunk.join(",")})&order=id`)) origins.set(o.id, o);
}

const problems = [];
const plan = []; // { origin, restoreMinutes, clearUser, children: [ids] }
for (const [oid, rows] of groups) {
  const o = origins.get(oid);
  if (!o) { problems.push(`origin ${oid} missing`); continue; }
  if (!holderIds.has(o.task_id)) { problems.push(`origin ${oid} is not on a holder task`); continue; }
  const children = rows.filter((r) => r.id !== oid);
  if (children.some((c) => c.task_id !== o.task_id || c.date.slice(0, 7) !== o.date.slice(0, 7))) problems.push(`group ${oid}: child on another task or month`);
  if (children.some((c) => !c.legacy)) problems.push(`group ${oid}: non-legacy child`);
  plan.push({
    origin: o,
    restoreMinutes: o.minutes + children.reduce((s, c) => s + c.minutes, 0),
    clearUser: o.traced_from === o.id,
    children: children.map((c) => c.id),
  });
}

// Totals per client-month, before and after (after computed from the plan).
const key2 = (taskId, date) => `${clientOf.get(taskId)}|${date.slice(0, 7)}`;
const before = new Map();
const holderRows = await all(`time_entries?select=id,task_id,minutes,date,user_id&task_id=in.(${[...holderIds].join(",")})&order=id`);
for (const r of holderRows) before.set(key2(r.task_id, r.date), (before.get(key2(r.task_id, r.date)) || 0) + r.minutes);
const deleted = new Set(plan.flatMap((p) => p.children));
const restored = new Map(plan.map((p) => [p.origin.id, p.restoreMinutes]));
const after = new Map();
for (const r of holderRows) {
  if (deleted.has(r.id)) continue;
  const m = restored.get(r.id) ?? r.minutes;
  after.set(key2(r.task_id, r.date), (after.get(key2(r.task_id, r.date)) || 0) + m);
}
const drift = [...new Set([...before.keys(), ...after.keys()])].filter((k) => (before.get(k) || 0) !== (after.get(k) || 0));
if (drift.length) problems.push(`${drift.length} client-months would change total`);

const h = (m) => (m / 60).toFixed(2) + "h";
const tracedMin = traced.reduce((s, r) => s + r.minutes, 0);
console.log(`holder tasks: ${holders.length}`);
console.log(`traced rows on them: ${traced.length} (${h(tracedMin)}) in ${plan.length} groups`);
console.log(`  rows assigned in place → person cleared: ${plan.filter((p) => p.clearUser).length}`);
console.log(`  split children → merged back and deleted: ${deleted.size}`);
console.log(`holder hours before ${h([...before.values()].reduce((a, b) => a + b, 0))}, after ${h([...after.values()].reduce((a, b) => a + b, 0))}, client-months changing: ${drift.length}`);
if (problems.length) { console.log("\nPROBLEMS — refusing to continue:"); problems.slice(0, 20).forEach((p) => console.log(" - " + p)); process.exit(1); }
if (!APPLY) { console.log("\nDry run. Re-run with --apply to write."); process.exit(0); }

writeFileSync(
  "data/untrace-holder-hours-backup.json",
  JSON.stringify({ at: new Date().toISOString(), origins: plan.map((p) => p.origin), children: traced.filter((r) => deleted.has(r.id)) }, null, 1),
);
console.log("backup written: data/untrace-holder-hours-backup.json");

let done = 0;
for (const p of plan) {
  const patch = { minutes: p.restoreMinutes, traced_from: null, ...(p.clearUser ? { user_id: null } : {}) };
  const r = await fetch(`${url}/rest/v1/time_entries?id=eq.${p.origin.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`restore ${p.origin.id}: ${r.status} ${await r.text()} (after ${done} groups — children NOT yet deleted)`);
  if (++done % 200 === 0) console.log(`  restored ${done}/${plan.length}`);
}
const ids = [...deleted];
for (let i = 0; i < ids.length; i += 200) {
  const chunk = ids.slice(i, i + 200);
  const r = await fetch(`${url}/rest/v1/time_entries?id=in.(${chunk.join(",")})`, { method: "DELETE", headers: { ...H, Prefer: "return=minimal" } });
  if (!r.ok) throw new Error(`delete chunk ${i}: ${r.status} ${await r.text()}`);
}
console.log(`applied: ${plan.length} origins restored, ${ids.length} children deleted. Re-run (dry) to confirm 0 left.`);
