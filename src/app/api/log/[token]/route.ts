import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { monthBill, type RateTerms } from "@/lib/freelance-rate";
import { signStorageUrl } from "@/lib/sign-storage";
import { tokenFromSegment } from "@/lib/freelancer-link";
import { fetchAll, MISSING_SCHEMA_CODES } from "@/lib/db";
import { snapOf, updateLog, type LogSnap } from "@/lib/freelancer-sync";

// Public endpoint behind a freelancer's private link (/log/[token], 0054).
// Token-gated; every read and write uses the service key on the server and is
// scoped to that freelancer's own rows. He has no login, so none of the
// studio-wide "read all" RLS ever applies to him — and this route must never
// return anything but: their enabled clients, those clients' open tasks (plus any
// task an admin already approved one of their logs on), and their own logs.

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
/** Any Hebrew letter — kept off a freelancer's page. */
const HEBREW = /[\u0590-\u05FF]/;
const noHebrew = (t: string | undefined) => (t && !HEBREW.test(t) ? t : null);
/** The first day he may write to: his own lines live in the current month only
 * — past months are history (billed, maybe already in a client's report). */
const editableFrom = () => `${today().slice(0, 7)}-01`;
/** The clients they may log against, and the tasks they may pick: every open
 * task of those clients, plus any done one an admin approved one of their logs on. */
async function allowed(sb: SupabaseClient, profileId: string) {
  const [{ data: links }, { data: approved }] = await Promise.all([
    sb.from("freelancer_clients").select("client_id").eq("profile_id", profileId),
    // Approved — or approved once and changed since (back to pending with its
    // time entry kept), so a line he re-edits still validates on its own task.
    sb
      .from("freelancer_logs")
      .select("task_id")
      .eq("profile_id", profileId)
      .or("status.eq.approved,time_entry_id.not.is.null")
      .not("task_id", "is", null),
  ]);
  const clientIds = (links ?? []).map((l) => l.client_id as string);
  const taskIds = [...new Set((approved ?? []).map((l) => l.task_id as string))];
  type TaskRow = { id: string; title: string; client_id: string | null; status: string | null; completed_at: string | null };
  const [{ data: clients }, clientTasks, { data: pastTasks }] = await Promise.all([
    clientIds.length ? sb.from("clients").select("id, name, keys_task_id").in("id", clientIds) : Promise.resolve({ data: [] }),
    clientIds.length
      ? fetchAll<TaskRow>(sb, "tasks", "id, title, client_id, status, completed_at", (q) => q.in("client_id", clientIds))
      : Promise.resolve([] as TaskRow[]),
    taskIds.length ? sb.from("tasks").select("id, title, client_id").in("id", taskIds) : Promise.resolve({ data: [] }),
  ]);
  // Each client's keys task is the admin's write-down holder, never a place to log.
  const keys = new Set(((clients ?? []) as { keys_task_id: string | null }[]).map((c) => c.keys_task_id).filter(Boolean));
  const open = clientTasks.filter((t) => !t.completed_at && t.status !== "done" && !keys.has(t.id));
  const byId = new Map<string, { id: string; title: string; client_id: string | null }>();
  for (const t of [...open, ...((pastTasks ?? []) as { id: string; title: string; client_id: string | null }[])]) byId.set(t.id, t);
  return {
    clients: ((clients ?? []) as { id: string; name: string }[])
      .map((c) => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    tasks: [...byId.values()]
      .filter((t) => t.client_id && clientIds.includes(t.client_id) && t.title?.trim())
      .map((t) => ({ id: t.id, title: t.title.trim(), clientId: t.client_id! }))
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

  // One round of queries for everything that doesn't depend on another —
  // switching months used to wait on six round trips one after another.
  const [
    { data: profile },
    { clients, tasks },
    { data: logs },
    { data: deliverables },
    { data: charges },
    { data: allLogs },
    { data: allCharges },
  ] = await Promise.all([
    sb.from("profiles").select("name").eq("id", f.profile_id).single(),
    allowed(sb, f.profile_id),
    sb
      .from("freelancer_logs")
      .select("id, date, minutes, client_id, task_id, task_hint, description, status, review_note, source, time_entry_id")
      .eq("profile_id", f.profile_id)
      .neq("status", "rejected")
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .order("created_at"),
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
    // Every month he has, for the months pane (and how far back he can step).
    sb.from("freelancer_logs").select("date, minutes").eq("profile_id", f.profile_id).neq("status", "rejected"),
    sb.from("freelancer_charges").select("date, amount, currency").eq("profile_id", f.profile_id).neq("status", "rejected"),
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
    firstPeriod: (allLogs ?? []).reduce((min, l) => ((l.date as string) < min ? (l.date as string) : min), now).slice(0, 7),
    clients: clients.map((c) => chipOf.get(c.id) ?? { ...c, color: "#98a0b3", icon: null, iconUrl: null }),
    // ⚠️ No Hebrew on his page (Nitsan, 2026-11-09): he doesn't read it. A
    // Hebrew-titled task is left out of his picker — `allowed()` still knows it,
    // so a line already filed on one validates when he edits it.
    tasks: tasks.filter((x) => !HEBREW.test(x.title)),
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
      // A Hebrew title isn't shown — his own name for it (taskHint) stands in.
      task: l.task_id ? noHebrew(taskTitle.get(l.task_id)) : null,
      // His own name for the task — what he sees until it's filed on one.
      taskHint: l.task_hint,
      description: l.description,
      // Review is internal: he only learns whether a row is still his to change —
      // his own (not his sheet's) and in the current month. An APPROVED line can
      // be changed too (v1.88.0 — Milica logged a day on the wrong date the day
      // after it was approved): the change goes back for review, see PATCH.
      editable: l.status !== "rejected" && l.source !== "sheet" && l.date >= editableFrom(),
      // Taking a line back is only before it's filed — once approved it is
      // tracker hours, and removing them is the studio's call.
      removable: l.status === "pending" && !l.time_entry_id && l.source !== "sheet" && l.date >= editableFrom(),
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

/** He can change a line of his in the current month — before review, or after
 * (v1.88.0). A change to an APPROVED line puts it back to pending with its
 * `time_entry_id` kept: the approved hours stay in the tracker as they were
 * until an admin approves the change (which rewrites that entry) or keeps the
 * old one (which restores the line from it) — see /api/admin/freelancers. */
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
  if (table === "freelancer_logs") {
    const pick = (cols: string) =>
      sb
        .from("freelancer_logs")
        .select(cols)
        .eq("id", id)
        .eq("profile_id", f.profile_id)
        .eq("source", "link")
        .in("status", ["pending", "approved"])
        .gte("date", editableFrom())
        .maybeSingle();
    const base = "date, minutes, client_id, task_id, task_hint, description, status";
    // `approved` is 0062's; step down without it.
    let got = await pick(`${base}, approved`);
    if (got.error && MISSING_SCHEMA_CODES.has(got.error.code)) got = await pick(base);
    const current = got.data as unknown as (LogSnap & { status: string; approved?: LogSnap | null }) | null;
    if (!current) return NextResponse.json({ error: "This line can't be changed any more." }, { status: 409 });
    const row = read.row as Record<string, unknown>;
    const same = Object.keys(row).every((k) => ((current as unknown as Record<string, unknown>)[k] ?? null) === (row[k] ?? null));
    // Saving an approved line unchanged must not send it back for review.
    if (same) return NextResponse.json({ ok: true });
    // Leaving "approved" keeps what was approved (0062): the admin's review
    // shows it, Keep restores it, and Approve applies only the difference.
    const keep = current.status === "approved" && !current.approved ? { approved: snapOf(current) } : {};
    const { data } = await updateLog(sb, id, { ...row, ...keep, status: "pending" }, current.status);
    if (!data?.length) return NextResponse.json({ error: "This line changed meanwhile — reload and try again." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
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
    // A changed approved line still has tracker hours behind it.
    .is("time_entry_id", null)
    .eq("source", "link")
    .gte("date", editableFrom())
    .select("id");
  if (!data?.length) return NextResponse.json({ error: "This line can't be removed any more — it's been filed." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
