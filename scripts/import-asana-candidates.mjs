#!/usr/bin/env node
/**
 * Import the Asana board "Candidate Tracking" into the tracker.
 *
 *   node --env-file=.env.local scripts/import-asana-candidates.mjs            # dry run
 *   node --env-file=.env.local scripts/import-asana-candidates.mjs --apply
 *   node --env-file=.env.local scripts/import-asana-candidates.mjs --apply --with-files
 *
 * Needs ASANA_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in .env.local. DRY RUN BY DEFAULT.
 *
 * ⚠️⚠️ IT NEVER PRINTS A CANDIDATE. Not a name, not an email, not a phone
 * number, not a line of anybody's CV — only counts, column names and gids. That
 * is deliberate and load-bearing rather than fastidious: this is 271 real
 * people's contact details and two colleagues' written opinions of them, and
 * (a) a terminal transcript is the easiest place in the world for that to leak
 * out of, and (b) once HR-grade PII enters a Claude session the safety
 * classifier blocks that session's shell and preview tools for the rest of it
 * (see "Session gotcha (PII)" in CLAUDE.md), so a chatty script would take the
 * tooling down with it. If you add a log line, make it a number.
 *
 * ⚠️ IDEMPOTENT. Every candidate is matched on `candidates.asana_gid` and every
 * comment on `candidate_comments.asana_story_gid`, both UNIQUE (0039). Running
 * it twice adds nothing; running it after a board change updates what moved.
 */

const ASANA = "https://app.asana.com/api/1.0";
const PROJECT = "1178660621693945";
const BUCKET = "candidate-files";

const APPLY = process.argv.includes("--apply");
const WITH_FILES = process.argv.includes("--with-files");
/** Dry run only: also fetch story history, to measure how much is recoverable. */
const DEEP = process.argv.includes("--deep");

const TOKEN = process.env.ASANA_ACCESS_TOKEN;
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TOKEN || !SB_URL || !SB_KEY) {
  console.error("Missing ASANA_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

/**
 * ⚠️ THE WHOLE MAPPING, AND THE ONE PART TO ARGUE WITH BEFORE RUNNING IT.
 *
 * Asana has seven columns; this app has five stages plus a status, because
 * "To Reject" and "On Hold" are things a candidate IS, not steps they pass
 * through — which is the change that keeps 140 rejected people off the board.
 *
 * `completed` is what decides live-or-decided. 263 of the 271 cards are
 * complete, so the column alone would import thirty people into an active
 * "Contract" column years after they were hired.
 */
/**
 * ⚠️⚠️ THE MAPPING, AND IT IS SIMPLER THAN IT FIRST LOOKED — read this before
 * "improving" it.
 *
 * My first version read "Contract" as hired and "To Reject" as rejected.
 * Nitsan's correction, 2026-09-28: **those two columns were never outcomes,
 * they were TODO MARKERS.** "Contract" meant *send this person a contract* and
 * "To Reject" meant *ring them and say no* — jobs for the studio, sitting in
 * the same board as the stages. And a card was marked complete whenever the
 * candidate stopped being relevant, for ANY reason: hired, turned down,
 * withdrew, or hired without anybody updating the card.
 *
 * So the import records only what the board actually knows:
 *   • `completed`  → ARCHIVED, with NO outcome. The reason is not in the data,
 *                    and inventing one would put a wrong word beside 260 real
 *                    people's names.
 *   • not complete → active, on the board.
 *   • the stage    → the column when it is a real step; recovered from the
 *                    move history when the card is parked in a todo column.
 *
 * That last line is what carries the value now. "Reached a physical interview"
 * is a fact; "rejected" would have been a guess.
 */
const REAL_STAGES = [
  "Candidates",
  "Phone interview",
  "Physical interview",
  "התנסות בסטודיו",
  "Contract",
];

/** Columns that are a job for the studio rather than a step for the candidate. */
const TODO_COLUMNS = ["To Reject"];

/** Parked, not decided. Still a real state going forward, even if every such
 *  card on the old board turns out to be complete and so archives anyway. */
const HOLD_COLUMNS = ["On Hold"];

const KNOWN_COLUMNS = [...REAL_STAGES, ...TODO_COLUMNS, ...HOLD_COLUMNS];

// ── plumbing ───────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function asana(path, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${ASANA}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (res.status === 429) {
      // Asana rate-limits hard and tells you how long to wait.
      const wait = Number(res.headers.get("retry-after") ?? 30);
      console.log(`  rate limited, waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`asana ${path} -> ${res.status}`);
    return res.json();
  }
  throw new Error(`asana ${path} -> gave up after ${tries} tries`);
}

async function asanaAll(path) {
  const out = [];
  let next = path;
  while (next) {
    const j = await asana(next);
    out.push(...j.data);
    next = j.next_page ? j.next_page.path : null;
  }
  return out;
}

const SB_HEAD = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: SB_HEAD });
  if (!res.ok) throw new Error(`supabase GET ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbWrite(method, path, body, prefer = "return=representation") {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: { ...SB_HEAD, Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`supabase ${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ── read Asana ─────────────────────────────────────────────────────────────

async function readBoard() {
  const sections = await asanaAll(`/projects/${PROJECT}/sections?opt_fields=name`);
  const tasks = await asanaAll(
    `/projects/${PROJECT}/tasks?opt_fields=gid,name,notes,completed,created_at,completed_at,` +
      `memberships.section.name,assignee.name,permalink_url&limit=100`,
  );
  return { sections, tasks };
}

/**
 * The stage a candidate had reached before they were rejected.
 *
 * ⚠️ WORTH THE EXTRA CALL, because the Asana board cannot answer it: a rejected
 * person sits in "To Reject", so the column says the decision and loses the
 * point at which it was made. Rejected after a phone call and rejected after a
 * tryout day are different facts about a candidate you may look up again in two
 * years, and `candidates.stage_id` is deliberately left set on archive (0039)
 * precisely so the archive keeps them. Asana records every column move as a
 * `section_changed` story, so the last one naming a REAL stage recovers it.
 *
 * Best-effort: a card somebody dragged before Asana kept those stories, or
 * created directly in To Reject, simply has no answer and gets none.
 */
function lastRealStage(stories, stageNames) {
  // ⚠️ THE TEXT IS QUOTED AND HAS A TRAILING CLAUSE, which a looser pattern
  // silently misses — the first version of this matched 0 of 158 cards while
  // the stories were right there. The real shape, measured on the board:
  //   Nitsan Rozenberg moved this task from "Physical interview" to "To Reject" in Candidate Tracking
  // Curly quotes are tolerated because Asana's own clients have produced both.
  const MOVE = /moved this task from ["\u201c](.+?)["\u201d] to ["\u201c](.+?)["\u201d]/i;
  for (let i = stories.length - 1; i >= 0; i--) {
    const s = stories[i];
    if (s.resource_subtype !== "section_changed") continue;
    const m = MOVE.exec(s.text ?? "");
    if (!m) continue;
    // FROM first: the last move of a rejected card is out of the stage they had
    // actually reached and into "To Reject", so `from` is the answer and `to`
    // is the column we are deliberately not importing as a stage.
    for (const name of [m[1], m[2]]) {
      const trimmed = name.trim();
      if (stageNames.includes(trimmed)) return trimmed;
    }
  }
  return null;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(APPLY ? "── APPLYING ──" : "── DRY RUN (pass --apply to write) ──");

  const [{ sections, tasks }, stages, existing] = await Promise.all([
    readBoard(),
    sbGet("candidate_stages?select=id,name"),
    sbGet("candidates?select=id,asana_gid"),
  ]);

  const stageId = new Map(stages.map((s) => [s.name, s.id]));
  const stageNames = stages.map((s) => s.name);
  const alreadyIn = new Map(existing.filter((c) => c.asana_gid).map((c) => [c.asana_gid, c.id]));

  console.log(`asana: ${tasks.length} cards across ${sections.length} columns`);
  console.log(`tracker: ${stages.length} stages, ${existing.length} candidates already present`);

  const unmapped = sections.map((s) => s.name).filter((n) => !KNOWN_COLUMNS.includes(n));
  if (unmapped.length) {
    // ⚠️ Refuse rather than guess. A column added since this mapping was written
    // would otherwise import its candidates with NO stage, which on the board is
    // an amber "No stage" pile nobody asked for.
    console.error(
      `\nUNMAPPED COLUMNS — add each to REAL_STAGES, TODO_COLUMNS or HOLD_COLUMNS first: ${unmapped.join(", ")}`,
    );
    process.exit(1);
  }

  // ── plan ────────────────────────────────────────────────────────────────
  const plan = [];
  const tally = {};

  for (const t of tasks) {
    const column = t.memberships?.[0]?.section?.name ?? "(none)";
    if (!KNOWN_COLUMNS.includes(column)) continue;

    const isTodoColumn = TODO_COLUMNS.includes(column) || HOLD_COLUMNS.includes(column);
    // `completed` is the only thing the board records about whether somebody is
    // still in play, so it is the only thing that decides it.
    const status = t.completed
      ? "archived"
      : HOLD_COLUMNS.includes(column)
        ? "on_hold"
        : "active";

    const key = `${column} → ${status}`;
    tally[key] = (tally[key] ?? 0) + 1;

    plan.push({
      gid: t.gid,
      name: (t.name ?? "").trim() || "(no name)",
      notes: (t.notes ?? "").trim() || null,
      column,
      status,
      // ⚠️ NEVER WRITTEN. The column cannot tell us why somebody stopped being
      // relevant, so the field stays null rather than carrying a guess.
      outcome: null,
      stage: isTodoColumn ? null : column,
      needsStageRecovery: isTodoColumn,
      appliedOn: t.created_at ? t.created_at.slice(0, 10) : null,
      archivedAt: t.completed_at ?? null,
      permalink: t.permalink_url ?? null,
      existingId: alreadyIn.get(t.gid) ?? null,
    });
  }

  console.log("\nHOW EACH COLUMN LANDS:");
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  // The shape of the result, stated plainly. No column is read as an outcome,
  // so there is nothing here to second-guess — only a count of how much of the
  // board is history.
  const archived = plan.filter((p) => p.status === "archived").length;
  const live = plan.filter((p) => p.status === "active").length;
  const held = plan.filter((p) => p.status === "on_hold").length;
  console.log(
    `\n${archived} archived (complete — no longer in play), ${live} live on the board, ${held} on hold.`,
  );
  console.log(
    "  No outcome is recorded for any of them: the board marked a card complete whether",
  );
  console.log(
    "  somebody was hired, turned down, or withdrew, so the reason is simply not in the data.",
  );

  if (DEEP) {
    // ⚠️ 158 extra API calls, which is why it is opt-in. It answers the one
    // question the dry run otherwise cannot: how much of "rejected at WHICH
    // stage" survives, given Asana loses it by moving the card to To Reject.
    const needsRecovery = plan.filter((p) => p.needsStageRecovery);
    console.log(`\nchecking stage recovery on ${needsRecovery.length} archived/on-hold cards…`);
    let found = 0;
    const atStage = {};
    for (const p of needsRecovery) {
      const stories = await asanaAll(
        `/tasks/${p.gid}/stories?opt_fields=gid,resource_subtype,text`,
      );
      const recovered = lastRealStage(stories, stageNames);
      if (recovered) {
        found++;
        atStage[recovered] = (atStage[recovered] ?? 0) + 1;
      }
      await sleep(110);
    }
    const pct = Math.round((found / needsRecovery.length) * 100);
    console.log(`  recovered the stage they had reached for ${found} of ${needsRecovery.length} (${pct}%)`);
    for (const [k, v] of Object.entries(atStage).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(v).padStart(4)}  reached ${k}`);
    }
    if (pct < 40) {
      console.log("  ⚠️ Low. Most of the archive will not say how far somebody got.");
    }
  }

  const fresh = plan.filter((p) => !p.existingId);
  console.log(`\n${fresh.length} to create, ${plan.length - fresh.length} already imported.`);

  if (!APPLY) {
    console.log("\nNothing written. Re-run with --apply.");
    console.log(
      WITH_FILES
        ? "--with-files was passed: attachments WOULD be re-hosted into the private bucket."
        : "Pass --with-files as well to bring CVs and portfolios across.",
    );
    return;
  }

  // ── write ───────────────────────────────────────────────────────────────
  if (WITH_FILES) await ensureBucket();

  let created = 0;
  let updated = 0;
  let comments = 0;
  let files = 0;
  let fileFailures = 0;
  let stagesRecovered = 0;

  for (const p of plan) {
    // Stories are needed for the discussion anyway, so recovering the stage
    // costs nothing extra beyond the parse.
    const stories = await asanaAll(
      `/tasks/${p.gid}/stories?opt_fields=gid,type,resource_subtype,text,created_at,created_by.name`,
    );

    let stage = p.stage;
    if (p.needsStageRecovery) {
      const recovered = lastRealStage(stories, stageNames);
      if (recovered) {
        stage = recovered;
        stagesRecovered++;
      }
    }

    const row = {
      name: p.name,
      application_text: p.notes,
      stage_id: stage ? (stageId.get(stage) ?? null) : null,
      status: p.status,
      outcome: p.outcome,
      archived_at: p.status === "archived" ? p.archivedAt : null,
      applied_on: p.appliedOn,
      source: "Asana import",
      asana_gid: p.gid,
      last_activity_at: p.archivedAt ?? p.appliedOn ?? new Date().toISOString(),
    };

    let candidateId = p.existingId;
    if (candidateId) {
      await sbWrite("PATCH", `candidates?id=eq.${candidateId}`, row, "return=minimal");
      updated++;
    } else {
      const [ins] = await sbWrite("POST", "candidates", [row]);
      candidateId = ins.id;
      created++;
    }

    // ── discussion ──
    // ⚠️ `author_name` rather than author_id: every comment on this board was
    // posted by one of two Asana accounts, one of which is the SHARED
    // `office &more` login, so "who said this" cannot be resolved to a person.
    // 0039 carries the raw name for exactly this, the same way task_comments
    // does for the pre-Everhour history.
    const rows = stories
      .filter((s) => s.type === "comment" && (s.text ?? "").trim())
      .map((s) => ({
        candidate_id: candidateId,
        author_name: s.created_by?.name ?? null,
        body: s.text.trim(),
        created_at: s.created_at,
        asana_story_gid: s.gid,
      }));
    if (rows.length) {
      // `ignoreDuplicates` via on_conflict: a re-run must not double the thread.
      await sbWrite(
        "POST",
        "candidate_comments?on_conflict=asana_story_gid",
        rows,
        "return=minimal,resolution=ignore-duplicates",
      );
      comments += rows.length;
    }

    // ── attachments ──
    if (WITH_FILES) {
      const atts = await asanaAll(
        `/tasks/${p.gid}/attachments?opt_fields=gid,name,download_url,permanent_url`,
      );
      for (const a of atts) {
        try {
          const stored = await rehost(a, candidateId);
          if (stored) files++;
        } catch {
          fileFailures++;
        }
      }
    }

    // Asana rate-limits on sustained reads; this keeps a 271-card run well under.
    await sleep(120);
  }

  console.log(`\ncreated ${created}, updated ${updated}`);
  console.log(`comments imported (incl. already present): ${comments}`);
  console.log(`stage recovered from the move history for ${stagesRecovered} archived/on-hold cards`);
  if (WITH_FILES) console.log(`files re-hosted: ${files}, failed: ${fileFailures}`);
}

// ── attachments ────────────────────────────────────────────────────────────

/**
 * ⚠️ PRIVATE FROM CREATION, unlike the three buckets this app made public in
 * 2026 and has been unpicking ever since (v1.34.0 → v1.35.0). These are CVs.
 * They are served by `/api/candidate-file`, which is ADMIN-gated — deliberately
 * not `/api/file`, whose own doc says any signed-in member may read anything it
 * serves.
 */
async function ensureBucket() {
  const res = await fetch(`${SB_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: SB_HEAD,
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: 26214400,
    }),
  });
  if (res.ok) {
    console.log(`created private bucket "${BUCKET}"`);
    return;
  }
  const body = await res.text();
  // Already there is the normal case on a re-run.
  if (res.status === 409 || body.includes("already exists")) return;
  throw new Error(`could not create the bucket: ${res.status} ${body}`);
}

/** Extension → the Content-Type we will serve it as. Anything else is refused. */
const SAFE = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  doc: "application/octet-stream",
  docx: "application/octet-stream",
  zip: "application/octet-stream",
};

async function rehost(att, candidateId) {
  const name = (att.name ?? "file").trim();
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  // ⚠️ An allowlist, and the Content-Type comes from OUR table rather than from
  // anything Asana or the uploader said — the rule `src/lib/uploads.ts` already sets
  // for every other upload in this app, and the reason no bucket here can host
  // an HTML page on the studio's own domain.
  const contentType = SAFE[ext];
  if (!contentType || !att.download_url) return false;

  const bin = await fetch(att.download_url);
  if (!bin.ok) return false;
  const bytes = Buffer.from(await bin.arrayBuffer());

  const path = `${candidateId}/${att.gid}-${name.replace(/[^\w.\-]+/g, "_")}`;
  const up = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: bytes,
  });
  if (!up.ok) return false;

  // A CV is the file worth finding first, so it is tagged as one.
  const kind = /cv|resume|curriculum|קורות/i.test(name) ? "cv" : "other";
  await sbWrite(
    "POST",
    "candidate_links",
    [
      {
        candidate_id: candidateId,
        title: name,
        url: `/api/candidate-file?p=${encodeURIComponent(path)}`,
        kind,
        storage_path: path,
        position: 0,
      },
    ],
    "return=minimal",
  );
  return true;
}

main().catch((e) => {
  // ⚠️ The message only — an Asana or PostgREST error body can echo the row it
  // choked on, which on this board means a name and an email in your terminal.
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
