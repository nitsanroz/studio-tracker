import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Upcoming birthdays + work anniversaries for the home "Celebrations" pane.
//
// Why a route rather than a client query: birth dates live in member_hr, which is
// admin-only at the RLS level, so the old client-side select returned nothing for
// members — the people the pane is mostly for saw anniversaries only.
//
// This reads member_hr with the service role but deliberately narrows what leaves
// the server: only the month and day, never the birth year, and nothing else from
// that table. A birthday is studio-social information; an age is not.

export const dynamic = "force-dynamic";

type Occasion = {
  kind: "birthday" | "anniversary";
  name: string;
  /** "MM-DD" — no year, so a birth year can't be reconstructed. */
  monthDay: string;
  years?: number;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const [{ data: profiles }, { data: hr }] = await Promise.all([
    admin.from("profiles").select("id, name, active, start_date"),
    admin.from("member_hr").select("profile_id, birth_date").not("birth_date", "is", null),
  ]);

  const active = new Map(
    (profiles ?? []).filter((p) => p.active).map((p) => [p.id, p as { id: string; name: string; start_date: string | null }]),
  );

  const occasions: Occasion[] = [];

  for (const row of hr ?? []) {
    const p = active.get(row.profile_id);
    if (!p || typeof row.birth_date !== "string") continue;
    occasions.push({
      kind: "birthday",
      name: p.name.split(" ")[0],
      monthDay: row.birth_date.slice(5, 10), // drops the year before it leaves the server
    });
  }

  const thisYear = new Date().getFullYear();
  for (const p of active.values()) {
    if (!p.start_date) continue;
    const years = thisYear - Number(p.start_date.slice(0, 4));
    if (years <= 0) continue;
    occasions.push({
      kind: "anniversary",
      name: p.name.split(" ")[0],
      monthDay: p.start_date.slice(5, 10),
      years,
    });
  }

  return NextResponse.json({ occasions });
}
