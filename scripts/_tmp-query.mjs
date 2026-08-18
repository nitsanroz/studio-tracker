import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.storage.from("intake").list("", { limit: 100, sortBy: { column: "created_at", order: "desc" } });
if (error) { console.error(error); process.exit(1); }
let total = 0;
for (const o of data.slice(0, 20)) {
  const kb = (o.metadata?.size ?? 0) / 1024;
  total += kb;
  console.log(`${(o.created_at||"").slice(0,16)}  ${String(Math.round(kb)).padStart(7)} KB  ${o.name.slice(0,70)}`);
}
