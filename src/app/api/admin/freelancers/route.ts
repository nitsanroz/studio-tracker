import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { billFor, rateFor } from "@/lib/freelance-rate";

// Admin-only: freelancers' logs waiting for review, and each freelancer's
// private link, clients and terms (0054). The review page (/freelancers)
// reads and acts only through here.
//
// Approving a log is what turns it into hours: it inserts the real
// time_entries row — on the task the admin picked, credited to the freelancer —
// and only then marks the log approved. Nothing a freelancer types reaches
// reports or client hours before that.

const newToken = () => randomBytes(24).toString("base64url");

/** A freelancer's rate terms from a request: a flat rate when the two rates
 * are equal, else sliding from `rateHigh` at `hoursLow` to `rateLow` at `hoursHigh`. */
function readTerms(body: Record<string, unknown>) {
  const n = (k: string) => Number(body[k]);
  const currency = typeof body.currency === "string" && ["EUR", "USD", "ILS"].includes(body.currency) ? body.currency : "EUR";
  const [rate_high, rate_low, hours_low, hours_high] = [n("rateHigh"), n("rateLow"), n("hoursLow"), n("hoursHigh")];
  if (![rate_high, rate_low, hours_low, hours_high].every((v) => Number.isFinite(v) && v >= 0))
    return { error: "Rates and hours must be numbers." };
  if (rate_low > rate_high) return { error: "The rate for many hours can't be above the rate for few." };
  if (hours_low >= hours_high) return { error: "The upper hours mark must be above the lower one." };
  return { currency, rate_high, rate_low, hours_low, hours_high };
}

async function adminOnly() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return { error: NextResponse.json({ error: "Admins only" }, { status: 403 }) };
  const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  return { sb, userId: user.id };
}

export async function GET(req: NextRequest) {
  const a = await adminOnly();
  if ("error" in a) return a.error;
  const { sb } = a;
  // The review row's task picker, for whichever client the admin files a log on.
  const tasksOf = req.nextUrl.searchParams.get("tasks");
  if (tasksOf) {
    const { data } = await sb
      .from("tasks")
      .select("id, title, client_id, status, completed_at")
      .eq("client_id", tasksOf)
      .order("created_at", { ascending: false });
    return NextResponse.json({
      tasks: (data ?? []).map((t) => ({ id: t.id, title: t.title, clientId: t.client_id, done: !!t.completed_at || t.status === "done" })),
    });
  }
  // The home page's alert needs only the count.
  if (req.nextUrl.searchParams.has("count")) {
    const { count } = await sb.from("freelancer_logs").select("id", { count: "exact", head: true }).eq("status", "pending");
    return NextResponse.json({ pending: count ?? 0 });
  }
  const monthStart = `${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()).slice(0, 7)}-01`;

  const [{ data: freelancers }, { data: links }, { data: pending }, { data: month }, { data: clients }] = await Promise.all([
    sb.from("freelancers").select("profile_id, token, active, currency, rate_high, rate_low, hours_low, hours_high"),
    sb.from("freelancer_clients").select("profile_id, client_id"),
    sb
      .from("freelancer_logs")
      .select("id, profile_id, date, minutes, client_id, task_id, task_hint, description, created_at")
      .eq("status", "pending")
      .order("date")
      .order("created_at"),
    sb.from("freelancer_logs").select("profile_id, minutes").neq("status", "rejected").gte("date", monthStart),
    sb.from("clients").select("id, name").eq("archived", false).order("name"),
  ]);
  const { data: deliverables } = await sb
    .from("freelancer_deliverables")
    .select("profile_id, title, url, created_at")
    .order("created_at", { ascending: false });
  const people = freelancers ?? [];
  const { data: profiles } = people.length
    ? await sb.from("profiles").select("id, name").in("id", people.map((f) => f.profile_id))
    : { data: [] as { id: string; name: string }[] };
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.name as string]));

  // Tasks to file a log on: the open tasks of every client a pending log names.
  const pendingClients = [...new Set((pending ?? []).map((l) => l.client_id).filter((c): c is string => !!c))];
  const { data: tasks } = pendingClients.length
    ? await sb
        .from("tasks")
        .select("id, title, client_id, status, completed_at")
        .in("client_id", pendingClients)
        .order("created_at", { ascending: false })
    : { data: [] as { id: string; title: string; client_id: string; status: string; completed_at: string | null }[] };

  return NextResponse.json({
    clients: clients ?? [],
    freelancers: people.map((f) => {
      const hours = (month ?? []).filter((m) => m.profile_id === f.profile_id).reduce((t, m) => t + m.minutes, 0) / 60;
      const terms = {
        currency: f.currency,
        rateHigh: Number(f.rate_high),
        rateLow: Number(f.rate_low),
        hoursLow: Number(f.hours_low),
        hoursHigh: Number(f.hours_high),
      };
      return {
        profileId: f.profile_id,
        name: nameOf.get(f.profile_id) ?? "",
        token: f.token,
        active: f.active,
        terms,
        clientIds: (links ?? []).filter((l) => l.profile_id === f.profile_id).map((l) => l.client_id),
        deliverables: (deliverables ?? [])
          .filter((d) => d.profile_id === f.profile_id)
          .map((d) => ({ title: d.title as string, url: d.url as string, date: (d.created_at as string).slice(0, 10) })),
        month: { hours, rate: rateFor(hours, terms), bill: billFor(hours, terms) },
      };
    }),
    pending: (pending ?? []).map((l) => ({
      id: l.id,
      profileId: l.profile_id,
      date: l.date,
      hours: l.minutes / 60,
      clientId: l.client_id,
      taskId: l.task_id,
      taskHint: l.task_hint,
      description: l.description,
    })),
    tasks: (tasks ?? []).map((t) => ({ id: t.id, title: t.title, clientId: t.client_id, done: !!t.completed_at || t.status === "done" })),
  });
}

export async function POST(req: NextRequest) {
  const a = await adminOnly();
  if ("error" in a) return a.error;
  const { sb, userId } = a;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");

  switch (body.action) {
    case "approve": {
      const { data: log } = await sb
        .from("freelancer_logs")
        .select("id, profile_id, date, minutes, client_id, description, status")
        .eq("id", str("id"))
        .single();
      if (!log || log.status !== "pending") return NextResponse.json({ error: "That log isn't waiting for review." }, { status: 409 });
      const { data: task } = await sb.from("tasks").select("id, client_id").eq("id", str("taskId")).single();
      if (!task) return NextResponse.json({ error: "Pick a task to file it on." }, { status: 400 });
      const { data: entry, error } = await sb
        .from("time_entries")
        .insert({ task_id: task.id, user_id: log.profile_id, date: log.date, minutes: log.minutes, description: log.description })
        .select("id")
        .single();
      if (error || !entry) return NextResponse.json({ error: error?.message ?? "Couldn't add the hours." }, { status: 500 });
      const { error: e2 } = await sb
        .from("freelancer_logs")
        .update({
          status: "approved",
          task_id: task.id,
          client_id: task.client_id ?? log.client_id,
          time_entry_id: entry.id,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", log.id)
        .eq("status", "pending");
      if (e2) {
        // Don't leave hours in the tracker that the log doesn't point at.
        await sb.from("time_entries").delete().eq("id", entry.id);
        return NextResponse.json({ error: e2.message }, { status: 500 });
      }
      // Filed on a client he wasn't open for: open it, so this task is in his
      // picker next time (0055 — he names the work, the admin files it).
      if (task.client_id) {
        await sb.from("freelancer_clients").upsert({ profile_id: log.profile_id, client_id: task.client_id }, { ignoreDuplicates: true });
      }
      return NextResponse.json({ ok: true });
    }
    case "reject": {
      const { error } = await sb
        .from("freelancer_logs")
        .update({ status: "rejected", review_note: str("note").trim().slice(0, 300) || null, reviewed_by: userId, reviewed_at: new Date().toISOString() })
        .eq("id", str("id"))
        .eq("status", "pending");
      return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
    }
    case "clients": {
      const profileId = str("profileId");
      const clientIds = Array.isArray(body.clientIds) ? (body.clientIds as unknown[]).filter((c): c is string => typeof c === "string") : [];
      await sb.from("freelancer_clients").delete().eq("profile_id", profileId);
      if (clientIds.length) {
        const { error } = await sb.from("freelancer_clients").insert(clientIds.map((client_id) => ({ profile_id: profileId, client_id })));
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }
    case "create": {
      // A freelancer is a person WITHOUT an account (0018): has_account false,
      // so also inactive — never in a member list, a task picker or the plan.
      const name = str("name").trim().slice(0, 80);
      if (!name) return NextResponse.json({ error: "Give the freelancer a name." }, { status: 400 });
      const terms = readTerms(body);
      if ("error" in terms) return NextResponse.json({ error: terms.error }, { status: 400 });
      const id = crypto.randomUUID();
      const { error } = await sb.from("profiles").insert({ id, name, role: "designer", active: false, has_account: false });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const { error: e2 } = await sb.from("freelancers").insert({ profile_id: id, token: newToken(), ...terms });
      if (e2) {
        await sb.from("profiles").delete().eq("id", id);
        return NextResponse.json({ error: e2.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, profileId: id });
    }
    case "terms": {
      const terms = readTerms(body);
      if ("error" in terms) return NextResponse.json({ error: terms.error }, { status: 400 });
      const { error } = await sb.from("freelancers").update(terms).eq("profile_id", str("profileId"));
      return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
    }
    case "regenerate": {
      const { error } = await sb.from("freelancers").update({ token: newToken() }).eq("profile_id", str("profileId"));
      return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
    }
    case "active": {
      const { error } = await sb.from("freelancers").update({ active: body.active === true }).eq("profile_id", str("profileId"));
      return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
