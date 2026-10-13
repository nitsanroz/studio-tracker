import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { monthBill } from "@/lib/freelance-rate";

// Admin-only: freelancers' logs waiting for review, and each freelancer's
// private link, clients and terms (0054). The review page (/freelancers)
// reads and acts only through here.
//
// Approving a log is what turns it into hours: it inserts the real
// time_entries row — on the task the admin picked, credited to the freelancer —
// and only then marks the log approved. Nothing a freelancer types reaches
// reports or client hours before that.

/** 24 letters and digits (~143 bits) — no "-", so it splits cleanly off the
 * name in /log/<name>-<secret> (lib/freelancer-link.ts). */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function newToken(): string {
  let out = "";
  while (out.length < 24) {
    for (const b of randomBytes(32)) {
      // 248 = 62 × 4: drop the top bytes so every character is equally likely.
      if (b < 248 && out.length < 24) out += ALPHABET[b % 62];
    }
  }
  return out;
}

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
  const thisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()).slice(0, 7);

  // Few round trips, each a batch of independent queries — a month switch used
  // to wait on them one after another.
  const [{ data: freelancers }, { data: links }, { data: pending }, { data: clients }, { data: deliverables }, { data: waitingCharges }] = await Promise.all([
    sb.from("freelancers").select("profile_id, token, active, currency, rate_high, rate_low, hours_low, hours_high"),
    sb.from("freelancer_clients").select("profile_id, client_id"),
    sb.from("freelancer_logs").select("profile_id, date").eq("status", "pending"),
    sb.from("clients").select("id, name").eq("archived", false).order("name"),
    sb.from("freelancer_deliverables").select("profile_id, title, url, created_at").order("created_at", { ascending: false }),
    sb.from("freelancer_charges").select("profile_id, date").eq("status", "pending"),
  ]);
  const one = req.nextUrl.searchParams.get("freelancer");
  const people = (freelancers ?? []).filter((f) => !one || f.profile_id === one);
  if (one && people.length === 0) return NextResponse.json({ error: "No such freelancer" }, { status: 404 });
  // ?month=YYYY-MM picks the month (this one by default); the list shows it for
  // everyone, a freelancer's own page shows its logs.
  const asked = req.nextUrl.searchParams.get("month");
  const period = asked && /^\d{4}-\d{2}$/.test(asked) && asked <= thisMonth ? asked : thisMonth;
  const [py, pm] = period.split("-").map(Number);
  const from = `${period}-01`;
  const to = `${period}-${String(new Date(py, pm, 0).getDate()).padStart(2, "0")}`;
  const ids = people.map((f) => f.profile_id);
  const [{ data: profiles }, { data: monthCharges }, { data: monthLogs }] = await Promise.all([
    ids.length ? sb.from("profiles").select("id, name").in("id", ids) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    sb
      .from("freelancer_charges")
      .select("id, profile_id, date, title, amount, currency, note, status, source, review_note")
      .in("profile_id", ids)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .order("created_at"),
    sb
      .from("freelancer_logs")
      .select("id, profile_id, date, minutes, client_id, task_id, task_hint, description, status, review_note, source")
      .in("profile_id", ids)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .order("created_at"),
  ]);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.name as string]));

  const summary = (f: (typeof people)[number]) => {
    const terms = {
      currency: f.currency,
      rateHigh: Number(f.rate_high),
      rateLow: Number(f.rate_low),
      hoursLow: Number(f.hours_low),
      hoursHigh: Number(f.hours_high),
    };
    const hours =
      (monthLogs ?? []).filter((l) => l.profile_id === f.profile_id && l.status !== "rejected").reduce((t, l) => t + l.minutes, 0) / 60;
    const charges = (monthCharges ?? []).filter((c) => c.profile_id === f.profile_id).map((c) => ({ ...c, amount: Number(c.amount) }));
    const waiting = [...(pending ?? []), ...(waitingCharges ?? [])].filter((l) => l.profile_id === f.profile_id);
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
      month: monthBill(hours, terms, charges),
      pendingCount: waiting.length,
      // Months holding logs that wait for review — to jump straight to them.
      pendingMonths: [...new Set(waiting.map((l) => (l.date as string).slice(0, 7)))].sort(),
    };
  };

  if (!one) return NextResponse.json({ period, clients: clients ?? [], freelancers: people.map(summary) });

  // One freelancer's month, row by row — names for its clients and tasks, the
  // tasks of every client a waiting row names (for the inline task picker),
  // and how far back his logs go.
  const rows = monthLogs ?? [];
  const clientIds = [...new Set(rows.map((l) => l.client_id).filter((c): c is string => !!c))];
  const taskIds = [...new Set(rows.map((l) => l.task_id).filter((t): t is string => !!t))];
  const waitingClients = [...new Set(rows.filter((l) => l.status === "pending").map((l) => l.client_id).filter((c): c is string => !!c))];
  const [{ data: logClients }, { data: logTasks }, { data: pickTasks }, { data: allLogs }, { data: allCharges }] = await Promise.all([
    clientIds.length ? sb.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] }),
    taskIds.length ? sb.from("tasks").select("id, title").in("id", taskIds) : Promise.resolve({ data: [] }),
    waitingClients.length
      ? sb.from("tasks").select("id, title, client_id, status, completed_at").in("client_id", waitingClients).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    // Every month he has, for the months pane (and how far back to step).
    sb.from("freelancer_logs").select("date, minutes, status").eq("profile_id", one),
    sb.from("freelancer_charges").select("date, amount, currency, status").eq("profile_id", one),
  ]);
  // Every month he has, newest first — hours, that month's rate, the bill — for
  // the months pane beside the table.
  const byMonth = new Map<string, { minutes: number; charges: { amount: number; currency: string; status: string }[]; waiting: boolean }>();
  const monthOf = (p: string) => {
    const m = byMonth.get(p) ?? { minutes: 0, charges: [], waiting: false };
    byMonth.set(p, m);
    return m;
  };
  for (const l of allLogs ?? []) {
    const m = monthOf((l.date as string).slice(0, 7));
    if (l.status !== "rejected") m.minutes += l.minutes;
    if (l.status === "pending") m.waiting = true;
  }
  for (const c of allCharges ?? []) {
    const m = monthOf((c.date as string).slice(0, 7));
    m.charges.push({ amount: Number(c.amount), currency: c.currency, status: c.status });
    if (c.status === "pending") m.waiting = true;
  }
  const terms = summary(people[0]).terms;
  const months = [...byMonth]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([p, m]) => ({ period: p, waiting: m.waiting, ...monthBill(m.minutes / 60, terms, m.charges) }));

  const clientName = new Map(((logClients ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const taskTitle = new Map(((logTasks ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title]));
  return NextResponse.json({
    period,
    firstPeriod: (allLogs ?? []).reduce((min, l) => ((l.date as string) < min ? (l.date as string) : min), `${thisMonth}-01`).slice(0, 7),
    clients: clients ?? [],
    freelancer: summary(people[0]),
    months,
    logs: rows.map((l) => ({
      id: l.id,
      date: l.date,
      hours: l.minutes / 60,
      clientId: l.client_id,
      client: l.client_id ? (clientName.get(l.client_id) ?? null) : null,
      taskId: l.task_id,
      task: l.task_id ? (taskTitle.get(l.task_id) ?? null) : null,
      taskHint: l.task_hint,
      description: l.description,
      status: l.status,
      note: l.review_note,
      fromSheet: l.source === "sheet",
    })),
    charges: (monthCharges ?? []).map((c) => ({
      id: c.id,
      date: c.date,
      title: c.title,
      amount: Number(c.amount),
      currency: c.currency,
      note: c.note,
      status: c.status,
      reviewNote: c.review_note,
      fromSheet: c.source === "sheet",
    })),
    tasks: ((pickTasks ?? []) as { id: string; title: string; client_id: string; status: string; completed_at: string | null }[]).map((t) => ({
      id: t.id,
      title: t.title,
      clientId: t.client_id,
      done: !!t.completed_at || t.status === "done",
    })),
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
    case "approveCharge":
    case "rejectCharge": {
      const approve = body.action === "approveCharge";
      const { error } = await sb
        .from("freelancer_charges")
        .update({
          status: approve ? "approved" : "rejected",
          review_note: approve ? null : str("note").trim().slice(0, 300) || null,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", str("id"))
        .eq("status", "pending");
      return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
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
