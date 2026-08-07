#!/usr/bin/env node
/**
 * Regenerates `src/lib/about-data.json` — the numbers behind the About panel.
 *
 *   node scripts/build-about-stats.mjs          # preview, writes nothing
 *   node scripts/build-about-stats.mjs --apply  # write the JSON
 *
 * Three groups, from three different places, which is why this script exists at
 * all — no single query can answer "how much did this cost to build".
 *
 *   studio  — live, from Supabase. Hours, entries, clients, tasks, the span of
 *             history. These drift every day, so they are the reason to re-run.
 *   build   — from git. Commits, versions, lines, migrations.
 *   effort  — from the Claude Code transcripts in ~/.claude/projects. Machine
 *             local and NOT in the repo, so if that directory is missing the
 *             existing values are preserved rather than zeroed.
 *
 * Read-only against the database: it counts and sums, and writes nothing back.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "src/lib/about-data.json");
const APPLY = process.argv.includes("--apply");

/** The transcript folder Claude Code writes per project. Absent on any other machine. */
const TRANSCRIPTS = path.join(
  os.homedir(),
  ".claude/projects/-Users-nitsanrozenberg-Documents-Claude",
);

/**
 * A gap longer than this means somebody walked away — it is not work.
 * 20 minutes is the middle of the three thresholds that were measured; Claude's
 * own figure barely moves across them (33h/35h/36h at 10/20/30) because its gaps
 * are seconds, while the human figure is genuinely sensitive to the choice.
 */
const IDLE_MS = 20 * 60 * 1000;

/**
 * List API prices per million tokens, as of 2026-08-07.
 *
 * ⚠️ This is what the work WOULD have cost at API rates. Nitsan built the
 * tracker on a Claude subscription, so no per-token bill was ever paid — the
 * figure is a measure of the compute, not of money that left the studio. The
 * About panel says so; don't quietly turn it into "spend".
 *
 * Cache reads bill at 0.1× the input rate. Cache writes bill at 1.25× for the
 * 5-minute TTL and 2× for the 1-hour one — nearly every write here is 1-hour,
 * and the transcripts record which, so the split is read rather than assumed.
 */
const PRICES = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-fable-5": { in: 10, out: 50 },
};
const CACHE_READ = 0.1;
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2.0;

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function buildStats() {
  const commits = Number(git("rev-list", "--count", "HEAD"));

  // Every release, with the day it shipped — the About timeline draws one tick
  // per entry, so the pace of the project is read off real dates rather than
  // an evenly spaced decoration. Deduped: a version can be touched by more than
  // one commit (the "log: record vX as deployed" follow-ups), and two ticks on
  // one day would overstate the cadence.
  const seen = new Set();
  const releases = [];
  for (const line of git("log", "--reverse", "--format=%ad\t%s", "--date=short").split("\n")) {
    const [date, subject] = line.split("\t");
    const m = subject?.match(/^(v\d+\.\d+(?:\.\d+)?)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    releases.push({ version: m[1], date });
  }
  const versions = releases.length;
  const firstCommit = git("log", "--reverse", "--format=%ad", "--date=short").split("\n")[0];
  const lastCommit = git("log", "-1", "--format=%ad", "--date=short");
  const commitDays = new Set(git("log", "--format=%ad", "--date=short").split("\n")).size;

  // Source only — the committed data/ dumps are megabytes of client history and
  // would swamp the figure with numbers nobody wrote.
  const files = git("ls-files")
    .split("\n")
    .filter((f) => /\.(ts|tsx|js|jsx|css|sql|mjs)$/.test(f) && !f.startsWith("data/"));
  let lines = 0;
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) lines += fs.readFileSync(p, "utf8").split("\n").length;
  }

  const migrations = fs
    .readdirSync(path.join(ROOT, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql")).length;

  return {
    commits,
    versions,
    firstCommit,
    lastCommit,
    commitDays,
    files: files.length,
    lines,
    migrations,
    releases,
  };
}

async function studioStats() {
  const env = Object.fromEntries(
    fs
      .readFileSync(path.join(ROOT, ".env.local"), "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const count = async (table) => {
    const { count: c, error } = await db.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`${table}: ${error.message}`);
    return c;
  };

  // PostgREST caps a select at 1000 rows, so this pages rather than trusting one
  // call — an earlier version of this script silently reported 6,150h of 87,577h
  // because it read the first page and stopped.
  let from = 0;
  let minutes = 0;
  let legacyMinutes = 0;
  let entries = 0;
  let first = null;
  let last = null;
  for (;;) {
    const { data, error } = await db
      .from("time_entries")
      .select("minutes,date,legacy")
      .range(from, from + 999);
    if (error) throw new Error(`time_entries: ${error.message}`);
    if (!data.length) break;
    for (const r of data) {
      entries++;
      minutes += r.minutes || 0;
      if (r.legacy) legacyMinutes += r.minutes || 0;
      if (!first || r.date < first) first = r.date;
      if (!last || r.date > last) last = r.date;
    }
    if (data.length < 1000) break;
    from += 1000;
  }

  return {
    hours: Math.round(minutes / 60),
    recoveredHours: Math.round(legacyMinutes / 60),
    entries,
    clients: await count("clients"),
    tasks: await count("tasks"),
    people: await count("profiles"),
    firstEntry: first,
    lastEntry: last,
    years: first && last ? Number(last.slice(0, 4)) - Number(first.slice(0, 4)) + 1 : 0,
  };
}

/**
 * Walks the Claude Code transcripts and splits the time between the two of us.
 *
 * Every event carries a timestamp. Merge them into blocks (a gap over IDLE_MS is
 * a break, not work), then attribute each segment: one ending in a message from
 * Nitsan is his — reading, deciding, typing — and everything else is Claude
 * running. The boundary needs care, because Claude Code logs a `queue-operation`
 * at the same instant as the message it carries, so the gap BEFORE that marker
 * is the human's, not the assistant's.
 */
function effortStats(previous) {
  if (!fs.existsSync(TRANSCRIPTS)) {
    console.warn(`! ${TRANSCRIPTS} not found — keeping the existing effort figures`);
    return previous;
  }

  let claudeMs = 0;
  let humanMs = 0;
  let sessions = 0;
  let toolCalls = 0;
  let outputTokens = 0;
  let inputTokens = 0;
  let prompts = 0;
  const days = new Set();
  /** per-model token tallies, so the split and the cost come from one pass */
  const byModel = new Map();

  for (const file of fs.readdirSync(TRANSCRIPTS).filter((f) => f.endsWith(".jsonl"))) {
    const raw = fs.readFileSync(path.join(TRANSCRIPTS, file), "utf8");
    // Sessions live in one folder regardless of subject. A session counts as
    // tracker work if it touched tracker paths more than finance-admin ones —
    // the finance product was split out of this repo, so it names both.
    const tracker = (raw.match(/studio-tracker/g) ?? []).length;
    const finance = (raw.match(/finance-admin/g) ?? []).length;
    if (tracker === 0 || finance >= tracker) continue;

    const events = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (!d.timestamp) continue;
      const t = Date.parse(d.timestamp);
      if (Number.isNaN(t)) continue;

      let kind = d.type;
      const m = d.message;
      if (d.type === "user" && m && !d.isMeta) {
        const c = m.content;
        const typed =
          (typeof c === "string" && c.trim()) ||
          (Array.isArray(c) && c.some((b) => b?.type === "text" && b.text?.trim()));
        kind = typed ? "USER" : "toolres";
      } else if (d.type === "assistant" && m) {
        const u = m.usage ?? {};
        outputTokens += u.output_tokens ?? 0;
        inputTokens +=
          (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        if (Array.isArray(m.content)) toolCalls += m.content.filter((b) => b?.type === "tool_use").length;

        // `<synthetic>` is the harness's own placeholder, not a model that ran.
        const name = m.model;
        if (name && name !== "<synthetic>") {
          const t = byModel.get(name) ?? { in: 0, out: 0, read: 0, write5m: 0, write1h: 0 };
          t.in += u.input_tokens ?? 0;
          t.out += u.output_tokens ?? 0;
          t.read += u.cache_read_input_tokens ?? 0;
          // The per-TTL breakdown is authoritative where present; fall back to
          // the flat total only on older entries that predate those fields.
          const cc = u.cache_creation;
          if (cc && typeof cc === "object") {
            t.write5m += cc.ephemeral_5m_input_tokens ?? 0;
            t.write1h += cc.ephemeral_1h_input_tokens ?? 0;
          } else {
            t.write5m += u.cache_creation_input_tokens ?? 0;
          }
          byModel.set(name, t);
        }
      }
      events.push([t, kind]);
    }
    if (!events.length) continue;
    events.sort((a, b) => a[0] - b[0]);

    // A typed message is preceded by same-instant queue/attachment markers. Fold
    // them into the message so the wait in front of them is credited to Nitsan.
    for (let i = 0; i < events.length; i++) {
      if (events[i][1] !== "USER") continue;
      prompts++;
      events[i][1] = "UBOUND";
      for (let j = i - 1; j >= 0; j--) {
        const [t, k] = events[j];
        if ((k === "queue-operation" || k === "attachment") && events[i][0] - t <= 2000) events[j][1] = "UBOUND";
        else break;
      }
    }

    sessions++;
    for (const [t] of events) days.add(new Date(t).toISOString().slice(0, 10));
    for (let i = 1; i < events.length; i++) {
      const gap = events[i][0] - events[i - 1][0];
      if (gap <= 0 || gap > IDLE_MS) continue;
      if (events[i][1] === "UBOUND") humanMs += gap;
      else claudeMs += gap;
    }
  }

  // Share of the work is measured by OUTPUT tokens — what each model actually
  // produced. Counting messages instead would flatter whichever model happened
  // to take the most turns, regardless of how much it wrote in them.
  const totalOut = [...byModel.values()].reduce((s, t) => s + t.out, 0) || 1;
  let cost = 0;
  const models = [...byModel.entries()]
    .map(([name, t]) => {
      const p = PRICES[name];
      if (!p) console.warn(`! no price for ${name} — excluded from the cost figure`);
      const c = p
        ? (t.in * p.in +
            t.out * p.out +
            t.read * p.in * CACHE_READ +
            t.write5m * p.in * CACHE_WRITE_5M +
            t.write1h * p.in * CACHE_WRITE_1H) /
          1e6
        : 0;
      cost += c;
      return { name, share: +((t.out / totalOut) * 100).toFixed(1), cost: Math.round(c) };
    })
    .sort((a, b) => b.share - a.share);

  const hours = (ms) => Math.round(ms / 3_600_000);
  return {
    models,
    costUsd: Math.round(cost),
    claudeHours: hours(claudeMs),
    humanHours: hours(humanMs),
    wallClockHours: hours(claudeMs + humanMs),
    sessions,
    prompts,
    toolCalls,
    days: days.size,
    outputTokensM: Number((outputTokens / 1e6).toFixed(1)),
    inputTokensM: Math.round(inputTokens / 1e6),
    idleThresholdMinutes: IDLE_MS / 60000,
  };
}

const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

const data = {
  // Stamped so the panel can say how fresh it is rather than implying "now".
  generatedAt: new Date().toISOString().slice(0, 10),
  studio: await studioStats(),
  build: buildStats(),
  effort: effortStats(previous.effort ?? null),
};

console.log(JSON.stringify(data, null, 2));
if (APPLY) {
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + "\n");
  console.log(`\n→ wrote ${path.relative(ROOT, OUT)}`);
} else {
  console.log("\n(preview only — pass --apply to write)");
}
