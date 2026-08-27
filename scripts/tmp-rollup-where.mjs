import { createClient } from "@supabase/supabase-js";
import fs from "node:fs"; import path from "node:path";
const DATA = path.join(import.meta.dirname, "..", "data");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const FIN = "(from finance plan)";
const parents = JSON.parse(fs.readFileSync(path.join(DATA, "asana", "parents.json"), "utf8"));
const childrenOf = new Map();
for (const [g, i] of Object.entries(parents)) { if (!i?.parent) continue; (childrenOf.get(i.parent) ?? childrenOf.set(i.parent, []).get(i.parent)).push(g); }
async function all(t, c) { const o=[]; for (let f=0;;f+=1000){ const {data,error}=await db.from(t).select(c).range(f,f+999); if(error)throw error; o.push(...data); if(data.length<1000)break;} return o; }
const tasks = await all("tasks", "id,title,legacy_title,asana_gid,client_id,legacy_hours");
const entries = await all("time_entries", "id,task_id,minutes,legacy,legacy_author_name,date,legacy_author_name");
const clients = await all("clients", "id,name");
const cname = new Map(clients.map(c=>[c.id,c.name]));
const byGid = new Map(tasks.filter(t=>t.asana_gid).map(t=>[t.asana_gid,t]));
const eByTask = new Map();
for (const e of entries) { if(!e.legacy || e.legacy_author_name===FIN) continue; (eByTask.get(e.task_id) ?? eByTask.set(e.task_id,[]).get(e.task_id)).push(e); }
const rec = t => ((eByTask.get(t.id)??[]).reduce((a,e)=>a+e.minutes,0)/60) + Number(t.legacy_hours??0);

const TARGETS = ["Full Website Design", "Illustration animation", "Website Wireframes", "3 small tasks", "לעדכן אתר קיים"];
for (const t of tasks) {
  const title = t.legacy_title ?? t.title ?? "";
  if (!TARGETS.some(x => title.includes(x))) continue;
  if (!t.asana_gid || !(parents[t.asana_gid]?.subs > 0)) continue;
  const es = eByTask.get(t.id) ?? [];
  console.log(`\n${cname.get(t.client_id)} — ${title}`);
  console.log(`  PARENT  entries ${(es.reduce((a,e)=>a+e.minutes,0)/60).toFixed(2)}h in ${es.length} rows | legacy_hours ${Number(t.legacy_hours??0).toFixed(2)}h`);
  for (const g of childrenOf.get(t.asana_gid) ?? []) {
    const k = byGid.get(g); if (!k) continue;
    const ke = eByTask.get(k.id) ?? [];
    const kh = rec(k); if (kh <= 0) continue;
    console.log(`  child   entries ${(ke.reduce((a,e)=>a+e.minutes,0)/60).toFixed(2)}h in ${ke.length} rows | legacy_hours ${Number(k.legacy_hours??0).toFixed(2)}h  — ${(k.legacy_title??k.title??"").slice(0,52)}`);
  }
}
