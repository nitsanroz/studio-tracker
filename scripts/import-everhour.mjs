// Everhour → Supabase import.
// Reads the JSON snapshots in data/ (downloaded from the Everhour API) and
// loads users, clients, projects, sections, tasks and time entries.
// Idempotent: rows are matched on their everhour_id and skipped if present.
//
// Run:  node --env-file=.env.local scripts/import-everhour.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";

const DATA = path.join(import.meta.dirname, "..", "data");
const read = (f) => JSON.parse(readFileSync(path.join(DATA, f), "utf8"));

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const ACTIVE_ADMINS = new Set(["nitsan@studionmore.com", "itay.b@studionmore.com", "office@studionmore.com"]);

const CLIENT_COLORS = [
  "#7c5cff", "#0ea5e9", "#f59e0b", "#ef4444", "#10b981", "#06b6d4",
  "#e879a0", "#8b5cf6", "#f97316", "#14b8a6", "#eab308", "#6366f1",
  "#84cc16", "#ec4899", "#0b43ed", "#a855f7", "#22c55e", "#f43f5e",
];

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

// Supabase caps a select at 1000 rows — page through everything.
async function fetchAll(table, columns) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`fetchAll(${table}): ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function upsertUsers() {
  const users = read("everhour-users.json");
  const map = new Map(); // everhour numeric id -> profile uuid

  const existing = await fetchAll("profiles", "id, everhour_id");
  const byEverhour = new Map(existing.map((p) => [p.everhour_id, p.id]));

  for (const u of users) {
    const ehId = String(u.id);
    if (byEverhour.has(ehId)) {
      map.set(u.id, byEverhour.get(ehId));
      continue;
    }
    // Create an auth user (no password — members set one via invite/reset)
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: u.email,
      email_confirm: true,
      user_metadata: { name: u.name },
    });
    let authId = created?.user?.id;
    if (error) {
      // User may already exist in auth (rerun) — look up by email
      const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      authId = list?.users?.find((x) => x.email === u.email)?.id;
      if (!authId) {
        log(`  ! auth user failed for ${u.email}: ${error.message}`);
        continue;
      }
    }
    const { error: pErr } = await supabase.from("profiles").insert({
      id: authId,
      name: u.name,
      role: ACTIVE_ADMINS.has(u.email) ? "admin" : "designer",
      avatar_url: u.avatarUrl || null,
      active: u.status === "active",
      everhour_id: ehId,
    });
    if (pErr) log(`  ! profile failed for ${u.email}: ${pErr.message}`);
    map.set(u.id, authId);
  }
  log(`users: ${map.size} mapped`);
  return map;
}

async function upsertClients() {
  const clients = read("everhour-clients.json");
  const map = new Map(); // everhour client id -> client uuid
  const projectToClient = new Map(); // everhour project id -> client uuid

  const existing = await fetchAll("clients", "id, everhour_id");
  const byEverhour = new Map(existing.map((c) => [c.everhour_id, c.id]));

  let i = 0;
  for (const c of clients) {
    if (c.name === "TEST client") continue;
    const ehId = String(c.id);
    let id = byEverhour.get(ehId);
    if (!id) {
      const { data, error } = await supabase
        .from("clients")
        .insert({
          name: c.name,
          color: CLIENT_COLORS[i % CLIENT_COLORS.length],
          archived: c.status !== "active",
          everhour_id: ehId,
        })
        .select("id")
        .single();
      if (error) {
        log(`  ! client failed ${c.name}: ${error.message}`);
        continue;
      }
      id = data.id;
    }
    map.set(c.id, id);
    for (const pid of c.projects ?? []) projectToClient.set(pid, id);
    i++;
  }
  log(`clients: ${map.size}`);
  return { map, projectToClient };
}

async function upsertProjects(projectToClient) {
  const projects = read("everhour-projects.json");
  const map = new Map(); // everhour project id -> project uuid

  const existing = await fetchAll("projects", "id, everhour_id");
  const byEverhour = new Map(existing.map((p) => [p.everhour_id, p.id]));

  // Bucket for projects with no Everhour client
  let unsortedClientId = null;
  async function getUnsorted() {
    if (unsortedClientId) return unsortedClientId;
    const { data } = await supabase.from("clients").select("id").eq("name", "Imported / Unsorted").maybeSingle();
    if (data) {
      unsortedClientId = data.id;
    } else {
      const { data: created } = await supabase
        .from("clients")
        .insert({ name: "Imported / Unsorted", color: "#9ca3af" })
        .select("id")
        .single();
      unsortedClientId = created.id;
    }
    return unsortedClientId;
  }

  for (const p of projects) {
    if (byEverhour.has(p.id)) {
      map.set(p.id, byEverhour.get(p.id));
      continue;
    }
    const clientId = projectToClient.get(p.id) ?? (await getUnsorted());
    const { data, error } = await supabase
      .from("projects")
      .insert({
        client_id: clientId,
        name: p.name.trim(),
        billable: p.billing?.type != null,
        archived: p.status === "archived",
        everhour_id: p.id,
        asana_gid: p.platform === "as" ? p.id.replace(/^as:/, "") : null,
      })
      .select("id")
      .single();
    if (error) {
      log(`  ! project failed ${p.name}: ${error.message}`);
      continue;
    }
    map.set(p.id, data.id);
  }
  log(`projects: ${map.size}`);
  return map;
}

async function upsertTasks(projectMap) {
  // A task can appear under several projects (multi-homed in Everhour) — keep the first occurrence.
  const tasks = [...new Map(read("everhour-tasks-all.json").map((t) => [t.id, t])).values()];
  const taskMap = new Map(); // everhour task id -> task uuid
  const sectionCache = new Map(); // `${projectUuid}::${name}` -> section uuid

  const existingTasks = await fetchAll("tasks", "id, everhour_id");
  const byEverhour = new Map(existingTasks.map((t) => [t.everhour_id, t.id]));
  const existingSections = await fetchAll("sections", "id, project_id, name");
  for (const s of existingSections) sectionCache.set(`${s.project_id}::${s.name}`, s.id);

  async function getSection(projectUuid, name) {
    if (!name || name === "Untitled section") return null;
    const key = `${projectUuid}::${name}`;
    if (sectionCache.has(key)) return sectionCache.get(key);
    const { data, error } = await supabase
      .from("sections")
      .insert({ project_id: projectUuid, name, position: sectionCache.size })
      .select("id")
      .single();
    if (error) return null;
    sectionCache.set(key, data.id);
    return data.id;
  }

  let inserted = 0;
  const rows = [];
  for (const t of tasks) {
    if (byEverhour.has(t.id)) {
      taskMap.set(t.id, byEverhour.get(t.id));
      continue;
    }
    const ehProjectId = t.projects?.[0];
    const projectUuid = projectMap.get(ehProjectId);
    if (!projectUuid) continue;
    const sectionId = await getSection(projectUuid, t.iteration);
    rows.push({
      _ehId: t.id,
      project_id: projectUuid,
      section_id: sectionId,
      title: t.name,
      status: t.completed ? "done" : "todo",
      billable: !/keys/i.test(t.name),
      estimate_hours: t.estimate?.total ? +(t.estimate.total / 3600).toFixed(2) : null,
      position: t.position ?? 0,
      completed_at: t.completedAt ? new Date(t.completedAt + "Z").toISOString() : null,
      everhour_id: t.id,
      asana_gid: t.id.startsWith("as:") ? t.id.replace(/^as:/, "") : null,
      created_at: t.createdAt ? new Date(t.createdAt + "Z").toISOString() : undefined,
    });
  }
  // Batch insert
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const clean = batch.map(({ _ehId, ...r }) => r);
    const { data, error } = await supabase.from("tasks").insert(clean).select("id, everhour_id");
    if (error) {
      log(`  ! task batch ${i}: ${error.message}`);
      continue;
    }
    for (const d of data) taskMap.set(d.everhour_id, d.id);
    inserted += data.length;
  }
  log(`tasks: ${inserted} inserted (${taskMap.size} total mapped)`);
  return taskMap;
}

async function insertTime(userMap, taskMap) {
  const entries = read("everhour-time-all.json");
  const existing = await fetchAll("time_entries", "everhour_id");
  const seen = new Set(existing.map((e) => e.everhour_id));

  let inserted = 0, skippedNoTask = 0;
  const rows = [];
  for (const e of entries) {
    const ehId = String(e.id);
    if (seen.has(ehId)) continue;
    const taskId = taskMap.get(e.task?.id);
    const userId = userMap.get(e.user);
    if (!taskId || !userId) {
      skippedNoTask++;
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
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000);
    const { error, count } = await supabase.from("time_entries").insert(batch, { count: "exact" });
    if (error) {
      log(`  ! time batch ${i}: ${error.message}`);
      continue;
    }
    inserted += count ?? batch.length;
  }
  log(`time entries: ${inserted} inserted, ${skippedNoTask} skipped (missing task/user)`);
}

async function seedDefaults(userMap) {
  // Task tags
  const TAGS = ["in design", "waiting for client approval", "in development", "done and approved"];
  for (let i = 0; i < TAGS.length; i++) {
    await supabase.from("tags").upsert({ name: TAGS[i], position: i }, { onConflict: "name" });
  }
  // Weekly-plan columns: Studio + one per active member + freelancers + waiting list
  const { data: cols } = await supabase.from("plan_columns").select("id");
  if ((cols ?? []).length > 0) return;
  const { data: active } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("active", true)
    .order("name");
  const rows = [{ name: "Studio", type: "studio", position: 0 }];
  let pos = 1;
  for (const p of active ?? []) {
    rows.push({ name: p.name.split(" ")[0], profile_id: p.id, type: "member", position: pos++ });
  }
  rows.push({ name: "Freelancers", type: "member", position: pos++ });
  rows.push({ name: "Waiting list", type: "waiting_list", position: pos++ });
  await supabase.from("plan_columns").insert(rows);
  log(`plan columns: ${rows.length} created`);
}

const userMap = await upsertUsers();
const { projectToClient } = await upsertClients();
const projectMap = await upsertProjects(projectToClient);
const taskMap = await upsertTasks(projectMap);
await insertTime(userMap, taskMap);
await seedDefaults(userMap);
log("done.");
