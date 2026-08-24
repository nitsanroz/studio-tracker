import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { avatarVariantFor, type AvatarVariant } from "@/lib/avatar-variant";

/**
 * Which default cut-out to draw for each member, when they haven't uploaded a
 * portrait of their own.
 *
 * Why a route rather than a client query: the answer comes from
 * `member_hr.gender`, and `member_hr` is **admin-only at the RLS level** — a
 * designer's browser selecting from it gets nothing back. Team cards are visible
 * to every signed-in member (studio-wide read visibility is intentional, see
 * CLAUDE.md), so the default has to be resolvable by a member. Same shape and
 * same reasoning as `/api/celebrations`, which reads birth dates from that table
 * for the same reason.
 *
 * ⚠️ THIS DELIBERATELY NARROWS WHAT LEAVES THE SERVER TO A PICTURE CHOICE.
 * The response is `{ [profileId]: "man" | "woman" }` and nothing else — no
 * national ids, no addresses, no birth dates, and not the recorded gender string
 * itself. A profile whose value is missing or unrecognised is simply ABSENT from
 * the map, so the caller falls back to the neutral cut-out rather than guessing.
 * Never widen this to return the row.
 *
 * ⚠️ And never infer this from a NAME. A name is not a statement about anyone's
 * gender, and a wrong guess is worse than the neutral default that already works.
 */
export const dynamic = "force-dynamic";

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function GET() {
  // Any signed-in member may read this — it decides a picture on a team card they
  // can already see. Signed out, they get nothing.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ avatars: {} }, { status: 401 });

  const { data, error } = await admin().from("member_hr").select("profile_id, gender");
  if (error) {
    // A missing table or column must read as "no preferences", not as a failure:
    // the caller's fallback is the neutral cut-out, which is what shipped before
    // this existed. Anything else would put a broken image on the team page.
    console.error("member-avatars failed", error.message);
    return NextResponse.json({ avatars: {} });
  }

  const avatars: Record<string, AvatarVariant> = {};
  for (const row of data ?? []) {
    const v = avatarVariantFor(row.gender as string | null);
    if (v) avatars[row.profile_id as string] = v;
  }
  return NextResponse.json({ avatars });
}
