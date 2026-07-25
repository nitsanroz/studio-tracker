import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { runEverhourSync } from "@/lib/everhour-sync";

// The Everhour sync queue: entries that couldn't be imported because their
// Everhour task or person isn't mapped in the tracker.
//   • GET  — list issues for the admin queue page.
//   • POST — resolve one: map the Everhour task/person to a tracker row (then
//            re-sync so the hours actually land), or ignore it on the record.
// Admins only, both ways.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Oldest window we'll ever re-sync when resolving a mapping. */
const MAX_RESYNC_DAYS = 90;

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Verify the caller's own session says admin before touching anything. */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin")
    return { error: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  return { userId: user.id };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { data, error } = await service()
    .from("sync_issues")
    .select("*")
    .order("entry_date", { ascending: false })
    .limit(1000);
  if (error) {
    console.error("sync-issues list failed", error.message);
    return NextResponse.json({ error: "Couldn't load the sync queue." }, { status: 500 });
  }
  return NextResponse.json({ issues: data ?? [] });
}

/**
 * Re-run the sync from the oldest affected entry, so a newly-mapped task
 * imports its backlog immediately instead of waiting for tonight's cron.
 * reconcileSyncIssues then closes the queue rows that made it in.
 */
async function resyncFrom(dates: string[]) {
  const apiKey = process.env.EVERHOUR_API_KEY;
  if (!apiKey) {
    return { synced: false, message: "Mapping saved. EVERHOUR_API_KEY isn't set here, so run the sync from the Time Feed to import the hours." };
  }
  const floor = new Date();
  floor.setDate(floor.getDate() - MAX_RESYNC_DAYS);
  const oldest = dates.sort()[0] ?? new Date().toISOString().slice(0, 10);
  const from = oldest < floor.toISOString().slice(0, 10) ? floor.toISOString().slice(0, 10) : oldest;
  const to = new Date().toISOString().slice(0, 10);

  try {
    const summary = await runEverhourSync(service(), apiKey, from, to);
    return {
      synced: true,
      inserted: summary.inserted,
      openIssues: summary.openIssues,
      message: `Mapping saved — ${summary.inserted} ${summary.inserted === 1 ? "entry" : "entries"} imported.`,
    };
  } catch (e) {
    console.error("resync after mapping failed", e);
    return { synced: false, message: "Mapping saved, but the re-sync failed. Try the Sync Everhour button." };
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const admin = service();

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    ids?: string[];
    note?: string;
    everhourTaskId?: string;
    everhourUserId?: string;
    taskId?: string;
    profileId?: string;
  };

  switch (body.action) {
    // ── map an unmapped Everhour task onto an existing tracker task
    case "link-task": {
      const { everhourTaskId, taskId } = body;
      if (!everhourTaskId || !taskId)
        return NextResponse.json({ error: "Pick a task to link to." }, { status: 400 });

      const { data: clash } = await admin
        .from("tasks")
        .select("id")
        .eq("everhour_id", everhourTaskId)
        .neq("id", taskId)
        .maybeSingle();
      if (clash)
        return NextResponse.json(
          { error: "That Everhour task is already mapped to a different tracker task." },
          { status: 409 },
        );

      const { error } = await admin.from("tasks").update({ everhour_id: everhourTaskId }).eq("id", taskId);
      if (error) {
        console.error("link-task failed", error.message);
        return NextResponse.json({ error: "Couldn't save the mapping." }, { status: 500 });
      }

      const { data: affected } = await admin
        .from("sync_issues")
        .select("entry_date")
        .eq("everhour_task_id", everhourTaskId)
        .eq("status", "open");
      const result = await resyncFrom(((affected ?? []) as { entry_date: string }[]).map((r) => r.entry_date));
      return NextResponse.json({ ok: true, ...result });
    }

    // ── the task only ever existed in Everhour: create it here, pre-mapped
    case "create-task": {
      const { everhourTaskId } = body;
      const { clientId, sectionId, title } = body as unknown as {
        clientId?: string;
        sectionId?: string | null;
        title?: string;
      };
      if (!everhourTaskId || !clientId || !title?.trim())
        return NextResponse.json({ error: "Pick a client and give the task a name." }, { status: 400 });

      const { data: clash } = await admin
        .from("tasks")
        .select("id")
        .eq("everhour_id", everhourTaskId)
        .maybeSingle();
      if (clash)
        return NextResponse.json(
          { error: "That Everhour task is already mapped to a tracker task." },
          { status: 409 },
        );

      // new tasks inherit the client's billable flag (same rule as store.addTask)
      const { data: client } = await admin
        .from("clients")
        .select("billable")
        .eq("id", clientId)
        .single();
      const { data: siblings } = await admin
        .from("tasks")
        .select("position")
        .eq("client_id", clientId)
        .order("position", { ascending: false })
        .limit(1);
      const position = ((siblings?.[0]?.position as number | undefined) ?? -1) + 1;

      const { error } = await admin.from("tasks").insert({
        client_id: clientId,
        section_id: sectionId || null,
        title: title.trim(),
        billable: client?.billable ?? true,
        position,
        everhour_id: everhourTaskId,
      });
      if (error) {
        console.error("create-task failed", error.message);
        return NextResponse.json({ error: "Couldn't create the task." }, { status: 500 });
      }

      const { data: affected } = await admin
        .from("sync_issues")
        .select("entry_date")
        .eq("everhour_task_id", everhourTaskId)
        .eq("status", "open");
      const result = await resyncFrom(((affected ?? []) as { entry_date: string }[]).map((r) => r.entry_date));
      return NextResponse.json({ ok: true, ...result });
    }

    // ── map an unmapped Everhour person onto a tracker profile
    case "link-user": {
      const { everhourUserId, profileId } = body;
      if (!everhourUserId || !profileId)
        return NextResponse.json({ error: "Pick a member to link to." }, { status: 400 });

      const { data: clash } = await admin
        .from("profiles")
        .select("id")
        .eq("everhour_id", everhourUserId)
        .neq("id", profileId)
        .maybeSingle();
      if (clash)
        return NextResponse.json(
          { error: "That Everhour person is already mapped to a different member." },
          { status: 409 },
        );

      const { error } = await admin
        .from("profiles")
        .update({ everhour_id: everhourUserId })
        .eq("id", profileId);
      if (error) {
        console.error("link-user failed", error.message);
        return NextResponse.json({ error: "Couldn't save the mapping." }, { status: 500 });
      }

      const { data: affected } = await admin
        .from("sync_issues")
        .select("entry_date")
        .eq("everhour_user_id", everhourUserId)
        .eq("status", "open");
      const result = await resyncFrom(((affected ?? []) as { entry_date: string }[]).map((r) => r.entry_date));
      return NextResponse.json({ ok: true, ...result });
    }

    // ── on the record: these hours are deliberately not coming in
    case "ignore": {
      if (!body.ids?.length)
        return NextResponse.json({ error: "Nothing selected." }, { status: 400 });
      const { error } = await admin
        .from("sync_issues")
        .update({
          status: "ignored",
          note: body.note ?? "",
          resolved_at: new Date().toISOString(),
          resolved_by: auth.userId,
        })
        .in("id", body.ids);
      if (error) {
        console.error("ignore failed", error.message);
        return NextResponse.json({ error: "Couldn't update the queue." }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    case "reopen": {
      if (!body.ids?.length)
        return NextResponse.json({ error: "Nothing selected." }, { status: 400 });
      const { error } = await admin
        .from("sync_issues")
        .update({ status: "open", note: "", resolved_at: null, resolved_by: null })
        .in("id", body.ids);
      if (error) {
        console.error("reopen failed", error.message);
        return NextResponse.json({ error: "Couldn't update the queue." }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
