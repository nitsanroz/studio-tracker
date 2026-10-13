import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { monthBill, type RateTerms } from "@/lib/freelance-rate";
import { signStorageUrl } from "@/lib/sign-storage";
import { tokenFromSegment } from "@/lib/freelancer-link";

// Public endpoint behind a freelancer's private link (/log/[token], 0054).
// Token-gated; every read and write uses the service key on the server and is
// scoped to that freelancer's own rows. He has no login, so none of the
// studio-wide "read all" RLS ever applies to him — and this route must never
// return anything but: his enabled clients, the tasks an admin already approved
// one of his logs on, and his own logs.

/** Anti-flood: logs accepted per link within the window. */
const RATE_LIMIT_WINDOW_MIN = 60;
const RATE_LIMIT_MAX = 30;
const MAX_DESCRIPTION = 600;

function admin() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

interface Freelancer {
  profile_id: string;
  currency: string;
  rate_high: number | string;
  rate_low: number | string;
  hours_low: number | string;
  hours_high: number | string;
}

async function freelancerFor(sb: SupabaseClient, segment: string): Promise<Freelancer | null> {
  // The link is /log/<name>-<secret>; only the secret is looked up.
  const token = tokenFromSegment(segment);
  // A short or malformed token is never a real one — don't spend a query on it.
  if (!/^[A-Za-z0-9_-]{24,}$/.test(token)) return null;
  const { data } = await sb
    .from("freelancers")
    .select("profile_id, currency, rate_high, rate_low, hours_low, hours_high")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  return data;
}

const terms = (f: Freelancer): RateTerms => ({
  currency: f.currency,
  rateHigh: Number(f.rate_high),
  rateLow: Number(f.rate_low),
  hoursLow: Number(f.hours_low),
  hoursHigh: Number(f.hours_high),
});

/** The studio's today (Vercel runs in UTC). */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());
}
/** The first day he may write to: his own lines live in the current month only
 * — past months are history (billed, maybe already in a client's report). */
const editableFrom = () => `${today().slice(0, 7)}-01`;
/** The clients he may log against, and the tasks he may pick: those an admin
 * approved one of his logs on. */
async function allowed(sb: SupabaseClient, profileId: string) {
  const [{ data: links }, { data: approved }] = await Promise.all([
    sb.from("freelancer_clients").select("client_id").eq("profile_id", profileId),
    sb.from("freelancer_logs").select("task_id").eq("profile_id", profileId).eq("status", "approved").not("task_id", "is", null),
  ]);
  const clientIds = (links ?? []).map((l) => l.client_id as string);
  const taskIds = [...new Set((approved ?? []).map((l) => l.task_id as string))];
  const [{ data: clients }, { data: tasks }] = await Promise.all([
    clientIds.length ? sb.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] }),
    taskIds.length ? sb.from("tasks").select("id, title, client_id").in("id", taskIds) : Promise.resolve({ data: [] }),
  ]);
  return {
    clients: ((clients ?? []) as { id: string; name: string }[]).sort((a, b) => a.name.localeCompare(b.name)),
    tasks: ((tasks ?? []) as { id: string; title: string; client_id: string | null }[])
      .filter((t) => t.client_id && clientIds.includes(t.client_id))
      .map((t) => ({ id: t.id, title: t.title, clientId: t.client_id! }))
      .sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = admin();
  const f = await freelancerFor(sb, token);
  if (!f) return NextResponse.json({ error: "This link isn't active." }, { status: 404 });

  // One month at a time (?month=YYYY-MM), this month by default — he steps
  // back through his history like the sheet's month blocks.
  const now = today();
  const thisMonth = now.slice(0, 7);
  const asked = req.nextUrl.searchParams.get("month");
  const period = asked && /^\d{4}-\d{2}$/.test(asked) && asked <= thisMonth ? asked : thisMonth;
  const [y, m] = period.split("-").map(Number);
  const from = `${period}-01`;
  const to = `${period}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

  const [{ data: profile }, { clients, tasks }, { data: logs }, { data: first }, { data: deliverables }, { data: charges }] = await Promise.all([
    sb.from("profiles").select("name").eq("id", f.profile_id).single(),
    allowed(sb, f.profile_id),
    sb
      .from("freelancer_logs")
      .select("id, date, minutes, client_id, task_id, task_hint, description, status, review_note, source")
      .eq("profile_id", f.profile_id)
      .neq("status", "rejected")
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .order("created_at"),
    sb.from("freelancer_logs").select("date").eq("profile_id", f.profile_id).order("date").limit(1),
    sb
      .from("freelancer_deliverables")
      .select("id, title, url, created_at")
      .eq("profile_id", f.profile_id)
      .order("created_at", { ascending: false }),
    sb
      .from("freelancer_charges")
      .select("id, date, title, amount, currency, note, status, source, review_note")
      .eq("profile_id", f.profile_id)
      .neq("status", "rejected")
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .order("created_at"),
  ]);

  // Names for the clients and tasks on his own logs — only those.
  const rows = logs ?? [];
  const logClientIds = [...new Set([...rows.map((l) => l.client_id), ...clients.map((c) => c.id)].filter((x): x is string => !!x))];
  const logTaskIds = [...new Set(rows.map((l) => l.task_id).filter((x): x is string => !!x))];
  const [{ data: logClients }, { data: logTasks }] = await Promise.all([
    logClientIds.length ? sb.from("clients").select("id, name, color, icon, icon_url").in("id", logClientIds) : Promise.resolve({ data: [] }),
    logTaskIds.length ? sb.from("tasks").select("id, title").in("id", logTaskIds) : Promise.resolve({ data: [] }),
  ]);
  // Every month he has, newest first — hours, that month's rate, the bill —
  // for the months pane. Turned-down rows are out, as everywhere on his page.
  const [{ data: allLogs }, { data: allCharges }] = await Promise.all([
    sb.from("freelancer_logs").select("date, minutes").eq("profile_id", f.profile_id).neq("status", "rejected"),
    sb.from("freelancer_charges").select("date, amount, currency").eq("profile_id", f.profile_id).neq("status", "rejected"),
  ]);
  const perMonth = new Map<string, { minutes: number; charges: { amount: number; currency: string; status: string }[] }>();
  const bucket = (d: string) => {
    const m = perMonth.get(d.slice(0, 7)) ?? { minutes: 0, charges: [] };
    perMonth.set(d.slice(0, 7), m);
    return m;
  };
  for (const l of allLogs ?? []) bucket(l.date as string).minutes += l.minutes;
  for (const c of allCharges ?? []) bucket(c.date as string).charges.push({ amount: Number(c.amount), currency: c.currency, status: "approved" });
  const months = [...perMonth]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([p, m]) => ({ period: p, ...monthBill(m.minutes / 60, terms(f), m.charges) }));

  // Each client as the tracker's chip draws it — the logo signed here, since
  // his page has no session to fetch it through the app's file proxy.
  type ClientRow = { id: string; name: string; color: string; icon: string | null; icon_url: string | null };
  const chips = await Promise.all(
    ((logClients ?? []) as ClientRow[]).map(async (c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      iconUrl: await signStorageUrl(c.icon_url),
    })),
  );
  const chipOf = new Map(chips.map((c) => [c.id, c]));
  const taskTitle = new Map(((logTasks ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title]));

  // The month's bill counts every hour he logged that wasn't turned down.
  const hours = rows.filter((l) => l.status !== "rejected").reduce((t, l) => t + l.minutes, 0) / 60;
  const t = terms(f);
  const extra = (charges ?? []).map((c) => ({ ...c, amount: Number(c.amount) }));

  return NextResponse.json({
    name: (profile?.name as string | undefined)?.split(" ")[0] ?? "",
    today: now,
    earliest: editableFrom(),
    period,
    firstPeriod: ((first?.[0]?.date as string | undefined) ?? now).slice(0, 7),
    clients: clients.map((c) => chipOf.get(c.id) ?? { ...c, color: "#98a0b3", icon: null, iconUrl: null }),
    tasks,
    summary: { ...monthBill(hours, t, extra), currency: t.currency },
    charges: extra.map((c) => ({
      id: c.id,
      date: c.date,
      title: c.title,
      amount: c.amount,
      currency: c.currency,
      note: c.note,
      // His to change only until it's reviewed, and only in the current month.
      editable: c.status === "pending" && c.source !== "sheet" && c.date >= editableFrom(),
    })),
    terms: t,
    months,
    logs: rows.map((l) => ({
      id: l.id,
      date: l.date,
      hours: l.minutes / 60,
      client: l.client_id ? (chipOf.get(l.client_id) ?? null) : null,
      task: l.task_id ? (taskTitle.get(l.task_id) ?? null) : null,
      // His own name for the task — what he sees until it's filed on one.
      taskHint: l.task_hint,
      description: l.description,
      // Review is internal: he only learns whether a row is still his to change —
      // waiting, his own (not his sheet's), and in the current month.
      editable: l.status === "pending" && l.source !== "sheet" && l.date >= editableFrom(),
      clientId: l.client_id,
      taskId: l.task_id,
    })),
    deliverables: (deliverables ?? []).map((d) => ({ id: d.id, title: d.title, url: d.url, date: (d.created_at as string).slice(0, 10) })),
  });
}

/** An extra charge on his month (0057) — another freelancer he brought in, a
 * purchase. Waits for review like his hours. Checked the same for a new charge
 * and an edit. */
function readCharge(f: Freelancer, body: Record<string, unknown>) {
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  if (!date || date > today() || date < editableFrom()) return { error: "Pick a date in this month, up to today." };
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return { error: "Say what the charge is for." };
  const amount = typeof body.amount === "number" ? Math.round(body.amount * 100) / 100 : NaN;
  if (!(amount > 0 && amount <= 100_000)) return { error: "Enter the amount, e.g. 150" };
  const currency = typeof body.currency === "string" && ["EUR", "USD", "ILS"].includes(body.currency) ? body.currency : f.currency;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) || null : null;
  return { row: { date, title, amount, currency, note } };
}

async function addCharge(sb: SupabaseClient, f: Freelancer, body: Record<string, unknown>) {
  const read = readCharge(f, body);
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
  const { count } = await sb
    .from("freelancer_charges")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", f.profile_id)
    .eq("status", "pending")
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return NextResponse.json({ error: "Too many in a short time — try again in a while." }, { status: 429 });
  }
  const { error } = await sb.from("freelancer_charges").insert({ profile_id: f.profile_id, ...read.row });
  if (error) return NextResponse.json({ error: "Couldn't save — try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** A log of hours as he sent it, checked the same for a new log and an edit:
 * this month, sane hours, something said, and a client / task that are his. */
async function readLog(sb: SupabaseClient, f: Freelancer, body: Record<string, unknown>) {
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null;
  if (!date || date > today() || date < editableFrom()) return { error: "Pick a date in this month, up to today." };
  const minutes = typeof body.minutes === "number" ? Math.round(body.minutes) : NaN;
  if (!(minutes >= 5 && minutes <= 1440)) return { error: "Hours must be between 0.1 and 24." };
  const description = typeof body.description === "string" ? body.description.trim().slice(0, MAX_DESCRIPTION) : "";
  if (!description) return { error: "Say what you worked on." };
  // The client is optional (0055) — he may not know which client record the
  // work belongs to; the admin files it. If he does pick one, it must be his.
  const { clients, tasks } = await allowed(sb, f.profile_id);
  const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;
  if (clientId && !clients.some((c) => c.id === clientId)) return { error: "Pick one of your clients." };
  const taskHint = typeof body.taskHint === "string" ? body.taskHint.trim().slice(0, 120) || null : null;
  let taskId: string | null = null;
  if (body.taskId != null && body.taskId !== "") {
    const task = tasks.find((t) => t.id === body.taskId);
    if (!task || (clientId && task.clientId !== clientId)) return { error: "That task isn't one of yours for this client." };
    taskId = task.id;
  }
  return {
    row: {
      date,
      minutes,
      client_id: clientId ?? tasks.find((t) => t.id === taskId)?.clientId ?? null,
      task_id: taskId,
      task_hint: taskId ? null : taskHint,
      description,
    },
  };
}

/** A deliverable link he leaves on his page (0056) — a delivery or a shared folder. */
async function addDeliverable(sb: SupabaseClient, profileId: string, body: Record<string, unknown>) {
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!title) return NextResponse.json({ error: "Give the link a name." }, { status: 400 });
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 2000) {
    return NextResponse.json({ error: "Paste a full link, starting with https://" }, { status: 400 });
  }
  const { count } = await sb.from("freelancer_deliverables").select("id", { count: "exact", head: true }).eq("profile_id", profileId);
  if ((count ?? 0) >= 200) return NextResponse.json({ error: "Too many links — ask Studio&more to tidy up." }, { status: 429 });
  const { error } = await sb.from("freelancer_deliverables").insert({ profile_id: profileId, title, url });
  if (error) return NextResponse.json({ error: "Couldn't save — try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = admin();
  const f = await freelancerFor(sb, token);
  if (!f) return NextResponse.json({ error: "This link isn't active." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (body.type === "link") return addDeliverable(sb, f.profile_id, body);
  if (body.type === "charge") return addCharge(sb, f, body);
  const read = await readLog(sb, f, body);
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });

  // Counts only logs still waiting: a flood is unreviewed logs piling up, and
  // rows an admin wrote (history moved in, reviews) must never lock him out.
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
  const { count } = await sb
    .from("freelancer_logs")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", f.profile_id)
    .eq("status", "pending")
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return NextResponse.json({ error: "Too many logs in a short time — try again in a while." }, { status: 429 });
  }

  const { error } = await sb.from("freelancer_logs").insert({ profile_id: f.profile_id, ...read.row });
  if (error) return NextResponse.json({ error: "Couldn't save — try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** He can change or take back a line of his until it's reviewed — in the
 * current month only. Once approved it is tracker hours (and maybe already in a
 * client's report), so it is history and stays as filed. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = admin();
  const f = await freelancerFor(sb, token);
  if (!f) return NextResponse.json({ error: "This link isn't active." }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const table = body.type === "charge" ? "freelancer_charges" : "freelancer_logs";
  const read = body.type === "charge" ? readCharge(f, body) : await readLog(sb, f, body);
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });
  const { data } = await sb
    .from(table)
    .update(read.row)
    .eq("id", id)
    .eq("profile_id", f.profile_id)
    .eq("status", "pending")
    .eq("source", "link")
    .gte("date", editableFrom())
    .select("id");
  if (!data?.length) return NextResponse.json({ error: "This line can't be changed any more — it's been filed." }, { status: 409 });
  return NextResponse.json({ ok: true });
}

/** He can take back a line until it's reviewed (current month only, as above). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = admin();
  const f = await freelancerFor(sb, token);
  if (!f) return NextResponse.json({ error: "This link isn't active." }, { status: 404 });
  const chargeId = req.nextUrl.searchParams.get("charge");
  if (chargeId) {
    if (!/^[0-9a-f-]{36}$/.test(chargeId)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const { data } = await sb
      .from("freelancer_charges")
      .delete()
      .eq("id", chargeId)
      .eq("profile_id", f.profile_id)
      .eq("status", "pending")
      .eq("source", "link")
      .gte("date", editableFrom())
      .select("id");
    if (!data?.length) return NextResponse.json({ error: "This charge can't be removed any more — it's been filed." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  const linkId = req.nextUrl.searchParams.get("link");
  if (linkId) {
    if (!/^[0-9a-f-]{36}$/.test(linkId)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    await sb.from("freelancer_deliverables").delete().eq("id", linkId).eq("profile_id", f.profile_id);
    return NextResponse.json({ ok: true });
  }
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { data } = await sb
    .from("freelancer_logs")
    .delete()
    .eq("id", id)
    .eq("profile_id", f.profile_id)
    .eq("status", "pending")
    .eq("source", "link")
    .gte("date", editableFrom())
    .select("id");
  if (!data?.length) return NextResponse.json({ error: "This line can't be removed any more — it's been filed." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
