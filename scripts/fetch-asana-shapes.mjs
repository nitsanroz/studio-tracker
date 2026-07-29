/**
 * Fill the parent/subtask shape gap that report-rollup-risk.mjs found.
 *
 *   node --env-file=.env.local scripts/fetch-asana-shapes.mjs [--limit N]
 *
 * Reads data/rollup-refetch-gids.csv (written by report-rollup-risk.mjs) and
 * extends data/asana/parents.json with `{parent, subs}` for each gid.
 *
 * WHY A SEPARATE SCRIPT rather than fetch-asana-stories.mjs --all:
 *  - that script's scope EXCLUDES any task with time entries, and every task we
 *    need here has recovered legacy entries, so it would select none of them;
 *  - it also fetches whole comment threads and re-imports task_comments. The
 *    comments are already in; only the SHAPE is missing. One field-limited call
 *    per task instead of a thread pull, and nothing is written to the DB at all.
 *
 * WHAT THE SHAPE IS FOR. A parent task's title figure is the ROLL-UP of its
 * subtasks — `"Q&A Movies - 128.25h"` over children `Storyboards - 34h`,
 * `Design (70)- 50h`, `Animation - 18h`… summing to the same 128.25h. The
 * Everhour import flattened parents and children into sibling tasks, so counting
 * both doubles the figure. Per Nitsan (2026-07-28) the children win and the
 * parent contributes zero — but the rule can only be applied where we know which
 * tasks are parents, and that was only ever fetched for the 23 dissolved legacy
 * projects. 14,896h of 23,792h recovered hours sat outside that.
 *
 * WRITES NOTHING TO THE DATABASE. It only extends parents.json. Re-running the
 * reconciler is what turns the shape into corrected hours.
 *
 * RESUMABLE: parents.json is flushed to disk every 25 tasks and any gid already
 * present is skipped, so a rate-limit stall or a Ctrl-C costs only the current
 * batch. Asana rate-limits hard and this account has hit its session limit
 * repeatedly, so re-running must always be cheap.
 */
import fs from "node:fs";
import path from "node:path";
import { fromCsv } from "./lib/csv.mjs";

const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const TOKEN = process.env.ASANA_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("ASANA_ACCESS_TOKEN is not set in .env.local — see scripts/fetch-asana-stories.mjs.");
  process.exit(1);
}

const DATA = path.join(import.meta.dirname, "..", "data");
const PARENTS = path.join(DATA, "asana", "parents.json");
const INPUT = path.join(DATA, "rollup-refetch-gids.csv");

if (!fs.existsSync(INPUT)) {
  console.error(`missing ${path.relative(process.cwd(), INPUT)} — run report-rollup-risk.mjs first.`);
  process.exit(1);
}

const shapes = fs.existsSync(PARENTS) ? JSON.parse(fs.readFileSync(PARENTS, "utf8")) : {};
const before = Object.keys(shapes).length;

const rows = fromCsv(fs.readFileSync(INPUT, "utf8"));
// Biggest-hours first: if the run is interrupted, the hours most likely to matter
// are already covered.
const todo = rows
  .filter((r) => r.asana_gid && !(r.asana_gid in shapes))
  .sort((a, b) => Number(b.hours) - Number(a.hours))
  .slice(0, LIMIT);

console.log(`parents.json has ${before} tasks; ${rows.length} in the refetch list, ${todo.length} to fetch\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Honours Asana's Retry-After; returns null on a hard failure so one bad gid
 *  cannot abort the run. A null is NOT cached — the gid stays on the list. */
async function getShape(gid, attempt = 0) {
  let res;
  try {
    res = await fetch(
      `https://app.asana.com/api/1.0/tasks/${gid}?opt_fields=parent.gid,num_subtasks`,
      { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } },
    );
  } catch (e) {
    if (attempt >= 5) return null;
    await sleep(2000 * 2 ** attempt);
    return getShape(gid, attempt + 1);
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 6) return null;
    const wait = Number(res.headers.get("Retry-After") ?? 0) * 1000 || 2000 * 2 ** attempt;
    console.log(`  … ${res.status} on ${gid}, waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
    return getShape(gid, attempt + 1);
  }
  // A deleted or inaccessible task is a real answer: we know it has no parent
  // here, and caching it stops the gid coming back on every future run.
  if (res.status === 404 || res.status === 403) return { parent: null, subs: 0, gone: res.status };
  if (!res.ok) return null;
  const d = (await res.json()).data;
  return { parent: d.parent?.gid ?? null, subs: d.num_subtasks ?? 0 };
}

const flush = () => fs.writeFileSync(PARENTS, JSON.stringify(shapes, null, 1));

let done = 0;
let failed = 0;
let gone = 0;
for (const r of todo) {
  const s = await getShape(r.asana_gid);
  if (!s) {
    failed++;
  } else {
    shapes[r.asana_gid] = s;
    if (s.gone) gone++;
    done++;
  }
  if (done % 25 === 0) {
    flush();
    const kids = Object.values(shapes).filter((x) => x?.parent).length;
    console.log(`  ${done}/${todo.length} fetched · ${kids} subtasks known so far`);
  }
  // ~120 req/min. Asana's limit is higher, but this account has hit session
  // limits before and a stall is more expensive than the wait.
  await sleep(500);
}
flush();

const withParent = todo.filter((r) => shapes[r.asana_gid]?.parent).length;
const withSubs = todo.filter((r) => shapes[r.asana_gid]?.subs > 0).length;
console.log(`\nparents.json: ${before} → ${Object.keys(shapes).length} tasks`);
console.log(`fetched ${done}, failed ${failed}, deleted/inaccessible ${gone}`);
console.log(`of the newly fetched: ${withParent} are SUBTASKS, ${withSubs} HAVE subtasks`);
console.log(
  `\nNext: node --env-file=.env.local scripts/report-rollup-risk.mjs   (exposure should drop)` +
    `\nThen: re-run the reconciler so the roll-up rule applies to these.`,
);
