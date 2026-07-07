// Asana → task enrichment.
// Reads data/asana/<projectGid>.json dumps (raw Asana task objects) and:
//  - matched tasks (by asana_gid): fills brief, due date, assignee, figma link
//    ONLY where the DB field is still empty (never overwrites edits)
//  - unmatched Asana tasks: inserted as new tasks (pre-Everhour history)
//
// Run:  node --env-file=.env.local scripts/enrich-asana.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = path.join(import.meta.dirname, "..", "data", "asana");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Asana user gid -> email (from the workspace user list)
const ASANA_USERS = {
  "1213133403131729": "adaya@studionmore.com",
  "1210682630033814": "aki@studionmore.com",
  "1178236968554591": "daniel@studionmore.com",
  "1213352178360044": "dima@studionmore.com",
  "1213676397334342": "itay.b@studionmore.com",
  "1208980808187472": "itay.c@studionmore.com",
  "1215769288616159": "leeyam@studionmore.com",
  "1206858324797116": "liza@studionmore.com",
  "1212644471173780": "michal@studionmore.com",
  "1207503684349891": "nadav.h@studionmore.com",
  "119644861961683": "nitsan@studionmore.com",
  "1202732458183440": "shnitz@studionmore.com",
  "1213991315479067": "sefi@studionmore.com",
  "1201675320609741": "sofia@studionmore.com",
  "1203432225207168": "peter@studionmore.com",
  "366074454182724": "office@studionmore.com",
};

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

const figmaRe = /https?:\/\/(?:www\.)?figma\.com\/[^\s)>\]"]+/;

// email -> profile id (via auth admin)
const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
const profileByEmail = new Map(authList.users.map((u) => [u.email, u.id]));
const asanaGidToProfile = new Map(
  Object.entries(ASANA_USERS)
    .map(([gid, email]) => [gid, profileByEmail.get(email)])
    .filter(([, id]) => id),
);

const projects = await fetchAll("projects", "id, asana_gid");
const projectByAsana = new Map(projects.filter((p) => p.asana_gid).map((p) => [p.asana_gid, p.id]));

const dbSections = await fetchAll("sections", "id, project_id, name");
const sectionKey = (pid, name) => `${pid}::${name.trim().toLowerCase()}`;
const sectionByKey = new Map(dbSections.map((s) => [sectionKey(s.project_id, s.name), s.id]));

const dbTasks = await fetchAll("tasks", "id, asana_gid, brief, figma_url, due_date, assignee_id");
const taskByAsana = new Map(dbTasks.filter((t) => t.asana_gid).map((t) => [t.asana_gid, t]));

let updated = 0, inserted = 0, skipped = 0, sectionsCreated = 0;

async function getSection(projectId, name) {
  if (!name || name === "Untitled section") return null;
  const key = sectionKey(projectId, name);
  if (sectionByKey.has(key)) return sectionByKey.get(key);
  const { data, error } = await supabase
    .from("sections")
    .insert({ project_id: projectId, name: name.trim(), position: 99 })
    .select("id")
    .single();
  if (error) return null;
  sectionByKey.set(key, data.id);
  sectionsCreated++;
  return data.id;
}

for (const file of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const projectGid = file.replace(".json", "");
  const projectId = projectByAsana.get(projectGid);
  if (!projectId) {
    console.log(`! no DB project for board ${projectGid} — skipped`);
    continue;
  }
  let tasks;
  try {
    const parsed = JSON.parse(readFileSync(path.join(DIR, file), "utf8"));
    tasks = Array.isArray(parsed) ? parsed : (parsed.data ?? []);
  } catch (e) {
    console.log(`! bad JSON in ${file}: ${e.message}`);
    continue;
  }

  for (const t of tasks) {
    const notes = (t.notes ?? "").trim();
    const assigneeProfile = t.assignee?.gid ? asanaGidToProfile.get(t.assignee.gid) : null;
    const figma = notes.match(figmaRe)?.[0] ?? null;
    const existing = taskByAsana.get(t.gid);

    if (existing) {
      const patch = {};
      if (notes && !(existing.brief ?? "").trim()) patch.brief = notes;
      if (figma && !existing.figma_url) patch.figma_url = figma;
      if (t.due_on && !existing.due_date) patch.due_date = t.due_on;
      if (assigneeProfile && !existing.assignee_id) patch.assignee_id = assigneeProfile;
      if (Object.keys(patch).length === 0) {
        skipped++;
        continue;
      }
      const { error } = await supabase.from("tasks").update(patch).eq("id", existing.id);
      if (error) console.log(`! update ${t.gid}: ${error.message}`);
      else updated++;
    } else {
      const sectionName = t.memberships?.[0]?.section?.name;
      const sectionId = await getSection(projectId, sectionName);
      const { error } = await supabase.from("tasks").insert({
        project_id: projectId,
        section_id: sectionId,
        title: t.name || "(untitled)",
        brief: notes,
        figma_url: figma,
        status: t.completed ? "done" : "todo",
        assignee_id: assigneeProfile ?? null,
        due_date: t.due_on ?? null,
        billable: !/keys/i.test(t.name ?? ""),
        completed_at: t.completed_at ?? null,
        created_at: t.created_at ?? undefined,
        asana_gid: t.gid,
      });
      if (error) console.log(`! insert ${t.gid}: ${error.message}`);
      else inserted++;
    }
  }
}

console.log(
  `done. enriched: ${updated}, new tasks inserted: ${inserted}, unchanged: ${skipped}, sections created: ${sectionsCreated}`,
);