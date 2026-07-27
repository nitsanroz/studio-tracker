import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { jewishHolidays } from "@/lib/jewish-holidays";
import { STUDIO_DAYS } from "@/lib/studio-days";

// Everything for the home "Coming up" pane, from four sources:
//   birthdays      — member_hr.birth_date
//   anniversaries  — profiles.start_date
//   holidays       — computed from the Hebrew calendar (no table, never stale)
//   custom         — the `occasions` table (migration 0015)
//
// Why a route rather than a client query: birth dates live in member_hr, which is
// admin-only at the RLS level, so the old client-side select returned nothing for
// members — the people the pane is mostly for saw anniversaries only.
//
// This reads member_hr with the service role but deliberately narrows what leaves
// the server: only the month and day, never the birth year, and nothing else from
// that table. A birthday is studio-social information; an age is not.

export const dynamic = "force-dynamic";

export type OccasionGroup = "birthday" | "anniversary" | "holiday" | "studioday" | "custom";

/** Groups shown when the admin hasn't set a preference. */
const DEFAULT_GROUPS: Record<OccasionGroup, boolean> = {
  birthday: true,
  anniversary: true,
  holiday: true,
  studioday: true,
  custom: true,
};

type Occasion = {
  group: OccasionGroup;
  title: string;
  /** "MM-DD" for recurring things — no year, so a birth year can't be reconstructed. */
  monthDay?: string;
  /** "YYYY-MM-DD" for one-off dated things (holidays, non-recurring custom). */
  date?: string;
  icon?: string;
  years?: number;
};

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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

  type ProfileRow = { id: string; name: string; active: boolean; start_date: string | null };
  type HrRow = { profile_id: string; birth_date: string | null };
  type CustomRow = { title: string; date: string; recurring: boolean; icon: string };

  const [profilesRes, hrRes, settingRes, customRes] = await Promise.all([
    admin.from("profiles").select("id, name, active, start_date"),
    admin.from("member_hr").select("profile_id, birth_date").not("birth_date", "is", null),
    admin.from("app_settings").select("value").eq("key", "occasion_groups").maybeSingle(),
    admin.from("occasions").select("title, date, recurring, icon"),
  ]);

  const profiles = (profilesRes.data ?? []) as ProfileRow[];
  const hr = (hrRes.data ?? []) as HrRow[];
  const setting = settingRes.data;
  // Pre-migration `occasions` doesn't exist. The pane must still work, so an error
  // here degrades to "no custom occasions" rather than breaking every home page.
  const custom = (customRes.error ? [] : (customRes.data ?? [])) as CustomRow[];

  const groups: Record<OccasionGroup, boolean> = {
    ...DEFAULT_GROUPS,
    ...((setting?.value as Partial<Record<OccasionGroup, boolean>> | null) ?? {}),
  };

  const active = new Map(profiles.filter((p) => p.active).map((p) => [p.id, p]));

  const occasions: Occasion[] = [];

  if (groups.birthday) {
    for (const row of hr ?? []) {
      const p = active.get(row.profile_id);
      if (!p || typeof row.birth_date !== "string") continue;
      occasions.push({
        group: "birthday",
        title: `${p.name.split(" ")[0]}'s birthday`,
        monthDay: row.birth_date.slice(5, 10), // year dropped before it leaves the server
        icon: "🎂",
      });
    }
  }

  if (groups.anniversary) {
    const thisYear = new Date().getFullYear();
    for (const p of active.values()) {
      if (!p.start_date) continue;
      const years = thisYear - Number(p.start_date.slice(0, 4));
      if (years <= 0) continue;
      occasions.push({
        group: "anniversary",
        title: p.name.split(" ")[0],
        monthDay: p.start_date.slice(5, 10),
        icon: "🎉",
        years,
      });
    }
  }

  if (groups.holiday) {
    // A little past the 30-day window the UI shows, so it stays correct if that widens.
    for (const h of jewishHolidays(isoDaysFromToday(-1), isoDaysFromToday(60))) {
      occasions.push({ group: "holiday", title: h.title, date: h.date, icon: h.icon });
    }
  }

  if (groups.studioday) {
    // Fixed month/day, so they ride the same recurring path as birthdays — no
    // calendar conversion, and they never need re-seeding.
    for (const d of STUDIO_DAYS) {
      occasions.push({ group: "studioday", title: d.title, monthDay: d.monthDay, icon: d.icon });
    }
  }

  if (groups.custom) {
    for (const c of custom) {
      occasions.push(
        c.recurring
          ? { group: "custom", title: c.title, monthDay: c.date.slice(5, 10), icon: c.icon }
          : { group: "custom", title: c.title, date: c.date, icon: c.icon },
      );
    }
  }

  return NextResponse.json({ occasions, groups });
}
