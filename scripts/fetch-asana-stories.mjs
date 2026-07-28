/**
 * Fetch the Asana comment threads that hold the pre-Everhour hours.
 *
 *   ASANA_ACCESS_TOKEN=… in .env.local, then:
 *   node --env-file=.env.local scripts/fetch-asana-stories.mjs [--all] [--limit N]
 *
 * Get the token at https://app.asana.com/0/my-apps → "Personal access token".
 * (A claude.ai Asana connector does NOT help here — this is a plain node script
 * and cannot reach an MCP server.)
 *
 * Writes one file per task to data/asana/stories/<taskGid>.json and imports the
 * comments into `task_comments`. Hours are NOT written here — run
 * reconcile-legacy-hours.mjs next to turn them into a review sheet.
 *
 * RESUMABLE BY DESIGN: each response is cached to disk before anything else
 * happens, and a task whose file already exists is skipped. Asana rate-limits
 * hard and this codebase has hit its account session limit repeatedly, so a
 * stall must cost nothing — just re-run.
 *
 * Scope: default is the "Imported / Unsorted" client; --all widens to every
 * billable task on a billable client with an asana_gid and no tracked time.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const WIDE = process.argv.includes("--all");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const TOKEN = process.env.ASANA_ACCESS_TOKEN;
if (!TOKEN) {
  console.error(
    "ASANA_ACCESS_TOKEN is not set.\n" +
      "Create a personal access token at https://app.asana.com/0/my-apps and add\n" +
      '  ASANA_ACCESS_TOKEN="1/12345…"\n' +
      "to studio-tracker/.env.local, then re-run.",
  );
  process.exit(1);
}

const STORIES = path.join(import.meta.dirname, "..", "data", "asana", "stories");
fs.mkdirSync(STORIES, { recursive: true });

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
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OPT_FIELDS = "gid,created_at,created_by.gid,created_by.name,text,resource_subtype";

/**
 * Parent/subtask shape, cached to data/asana/parents.json.
 *
 * This is NOT incidental — it is required for a correct total. A parent's title
 * figure is the ROLL-UP of its subtasks: "Q&A Movies - 128.25h" has 7 children
 * (Storyboards 34h, Design 50h, Animation 18h, …) that sum to the same 128.25h.
 * The tracker imported parents and children as flat sibling tasks, so counting
 * both would double every rolled-up figure. Per Nitsan: the children win.
 */
const PARENTS = path.join(import.meta.dirname, "..", "data", "asana", "parents.json");

async function getShape(gid, attempt = 0) {
  const res = await fetch(
    `https://app.asana.com/api/1.0/tasks/${gid}?opt_fields=parent.gid,num_subtasks`,
    { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } },
  );
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) return null;
    const wait = Number(res.headers.get("Retry-After") ?? 0) * 1000 || 2000 * 2 ** attempt;
    await sleep(wait);
    return getShape(gid, attempt + 1);
  }
  if (!res.ok) return null;
  const d = (await res.json()).data;
  return { parent: d.parent?.gid ?? null, subs: d.num_subtasks ?? 0 };
}

/** One task's comment thread. Retries 429/5xx with the Retry-After Asana sends. */
async function getStories(gid, attempt = 0) {
  const res = await fetch(
    `https://app.asana.com/api/1.0/tasks/${gid}/stories?opt_fields=${OPT_FIELDS}&limit=100`,
    { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } },
  );
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`${gid}: ${res.status} after 5 retries`);
    const wait = Number(res.headers.get("Retry-After") ?? 0) * 1000 || 2000 * 2 ** attempt;
    console.log(`  … ${res.status}, waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return getStories(gid, attempt + 1);
  }
  if (res.status === 404 || res.status === 403) return { gone: res.status };
  if (!res.ok) throw new Error(`${gid}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { data: body.data ?? [] };
}

// ── scope ─────────────────────────────────────────────────────────────────
const clients = await fetchAll("clients", "id, name, billable");
const tasks = await fetchAll("tasks", "id, title, client_id, asana_gid, billable");
const entries = await fetchAll("time_entries", "task_id");
const profiles = await fetchAll("profiles", "id, name");

const clientById = new Map(clients.map((c) => [c.id, c]));
const unsorted = clients.find((c) => c.name === "Imported / Unsorted");
const tracked = new Set(entries.map((e) => e.task_id));

const scope = tasks.filter((t) => {
  if (!t.asana_gid || tracked.has(t.id)) return false;
  if (unsorted && t.client_id === unsorted.id) return true;
  if (!WIDE) return false;
  return t.billable && clientById.get(t.client_id)?.billable;
});

const shapes = fs.existsSync(PARENTS) ? JSON.parse(fs.readFileSync(PARENTS, "utf8")) : {};
const todo = scope.filter(
  (t) => !fs.existsSync(path.join(STORIES, `${t.asana_gid}.json`)) || shapes[t.asana_gid] === undefined,
);
console.log(`in scope ${scope.length} | already cached ${scope.length - todo.length} | to fetch ${Math.min(todo.length, LIMIT)}`);

// ── fetch ─────────────────────────────────────────────────────────────────
let fetched = 0;
let withComments = 0;
let gone = 0;
const flush = () => fs.writeFileSync(PARENTS, JSON.stringify(shapes));

for (const t of todo.slice(0, LIMIT)) {
  const file = path.join(STORIES, `${t.asana_gid}.json`);

  // Parent shape first: it is the cheaper call and the one the totals depend on.
  if (shapes[t.asana_gid] === undefined) {
    shapes[t.asana_gid] = await getShape(t.asana_gid);
    await sleep(320);
  }

  if (!fs.existsSync(file)) {
    let result;
    try {
      result = await getStories(t.asana_gid);
    } catch (e) {
      console.warn(`! ${t.asana_gid} (${t.title.slice(0, 40)}): ${e.message}`);
      flush();
      continue;
    }
    if (result.gone) {
      // Cache the miss too, so a re-run doesn't keep paying for a deleted task.
      fs.writeFileSync(file, JSON.stringify([]));
      gone++;
    } else {
      fs.writeFileSync(file, JSON.stringify(result.data));
      if (result.data.some((s) => s.resource_subtype === "comment_added")) withComments++;
    }
    await sleep(320);
  }

  if (++fetched % 40 === 0) {
    flush();
    console.log(`  ${fetched}/${Math.min(todo.length, LIMIT)}…`);
  }
}
flush();
const kids = Object.values(shapes).filter((s) => s?.parent).length;
const parents = Object.values(shapes).filter((s) => s?.subs > 0).length;
console.log(`fetched ${fetched} (${withComments} had comments, ${gone} gone from Asana)`);
console.log(`shape: ${parents} tasks have subtasks, ${kids} are subtasks of another task`);

// ── import the comment text ───────────────────────────────────────────────
// The thread is the audit trail behind every recovered hour, so it is stored
// verbatim. Hours are derived later, from these same rows.
const nameToProfile = new Map(profiles.map((p) => [p.name.trim().toLowerCase(), p.id]));
const rows = [];
for (const t of scope) {
  const file = path.join(STORIES, `${t.asana_gid}.json`);
  if (!fs.existsSync(file)) continue;
  let stories;
  try {
    stories = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  for (const s of stories) {
    if (s.resource_subtype !== "comment_added") continue;
    const author = s.created_by?.name ?? "";
    rows.push({
      task_id: t.id,
      user_id: nameToProfile.get(author.trim().toLowerCase()) ?? null,
      author_name: author,
      body: s.text ?? "",
      created_at: s.created_at,
      asana_story_gid: s.gid,
    });
  }
}

let imported = 0;
for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  const { error } = await supabase
    .from("task_comments")
    .upsert(chunk, { onConflict: "asana_story_gid", ignoreDuplicates: true });
  if (error) {
    console.error(`! comment import failed: ${error.message}`);
    console.error("  (is migration 0016 applied? it adds asana_story_gid + author_name)");
    break;
  }
  imported += chunk.length;
}
console.log(`comments imported/kept ${imported} of ${rows.length}`);
console.log(`  unmatched authors: ${new Set(rows.filter((r) => !r.user_id).map((r) => r.author_name)).size} distinct`);
console.log(`\nNext: node --env-file=.env.local scripts/reconcile-legacy-hours.mjs${WIDE ? " --all" : ""}`);
