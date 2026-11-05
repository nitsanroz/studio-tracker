import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, MISSING_SCHEMA_CODES } from "@/lib/db";
import { approvedSnap, snapOf, syncEntry, updateLog, type LogSnap } from "@/lib/freelancer-sync";
import { createClient } from "@/lib/supabase/server";
import { monthBill } from "@/lib/freelance-rate";
import { cleanPosition } from "@/lib/candidates/convert";
import { convertBlocked, finishConversion } from "@/lib/candidates/convert-server";

// Admin-only: freelancers' logs waiting for review, and each freelancer's
// private link, clients and terms (0054). The review page (/freelancers)
// reads and acts only through here.
//
// Approving a log is what turns it into hours: it inserts the real
// time_entries row — on the task the admin picked, credited to the freelancer —
// and only then marks the log approved. Nothing a freelancer types reaches
// reports or client hours before that.
//
// ⚠️ ONE EXCEPTION, a freelancer WITH a login (Dima, 2026-11-02): he logs hours
// like any designer, so his rows here are his own time_entries — read, never
// reviewed — and his link stays switched off (`active` false; the /log route
// serves only active links). He's here for his sliding-rate bill.

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

type LogRow = LogSnap & { id: string; profile_id: string; status: string; time_entry_id: string | null; approved?: LogSnap | null };
/** One freelancer line with 0062's snapshot — stepping down without the column. */
async function readLogRow(sb: SupabaseClient, id: string): Promise<LogRow | null> {
  const base = "id, profile_id, date, minutes, client_id, task_id, task_hint, description, status, time_entry_id";
  let got = await sb.from("freelancer_logs").select(`${base}, approved`).eq("id", id).maybeSingle();
  if (got.error && MISSING_SCHEMA_CODES.has(got.error.code)) got = await sb.from("freelancer_logs").select(base).eq("id", id).maybeSingle();
  return (got.data as unknown as LogRow | null) ?? null;
}

/** Login freelancers' time entries from → to, as filed log rows. */
async function loginEntries(sb: SupabaseClient, ids: string[], from: string, to: string) {
  const entries = await fetchAll<{ id: string; user_id: string; task_id: string; date: string; minutes: number; description: string | null }>(
    sb,
    "time_entries",
    "id, user_id, task_id, date, minutes, description",
    (q) => q.in("user_id", ids).gte("date", from).lte("date", to).not("minutes", "is", null),
  );
  const taskIds = [...new Set(entries.map((e) => e.task_id))];
  const clientOf = new Map<string, string | null>();
  for (let i = 0; i < taskIds.length; i += 100) {
    const { data } = await sb.from("tasks").select("id, client_id").in("id", taskIds.slice(i, i + 100));
    for (const t of data ?? []) clientOf.set(t.id, t.client_id);
  }
  return entries
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      id: e.id,
      profile_id: e.user_id,
      date: e.date,
      minutes: e.minutes,
      client_id: clientOf.get(e.task_id) ?? null,
      task_id: e.task_id,
      task_hint: null as string | null,
      description: e.description ?? "",
      status: "approved",
      review_note: null as string | null,
      source: "log",
      time_entry_id: null as string | null,
    }));
}

export async function GET(req: NextRequest) {
  const a = await adminOnly();
  if ("error" in a) return a.error;
  const { sb } = a;
  // The review row's task picker, for whichever client the admin files a log on.
  const tasksOf = req.nextUrl.searchParams.get("tasks");
  if (tasksOf) {
    const [{ data }, { data: client }] = await Promise.all([
      sb.from("tasks").select("id, title, client_id, status, completed_at").eq("client_id", tasksOf).order("created_at", { ascending: false }),
      sb.from("clients").select("keys_task_id").eq("id", tasksOf).maybeSingle(),
    ]);
    // Never the client's Keys task: hours reach it only through a write-down
    // (which keeps them traceable), not by being filed there.
    return NextResponse.json({
      tasks: (data ?? [])
        .filter((t) => t.id !== client?.keys_task_id)
        .map((t) => ({ id: t.id, title: t.title, clientId: t.client_id, done: !!t.completed_at || t.status === "done" })),
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
  const [{ data: profiles }, { data: monthCharges }, { data: linkLogs }] = await Promise.all([
    ids.length
      ? sb.from("profiles").select("id, name, has_account").in("id", ids)
      : Promise.resolve({ data: [] as { id: string; name: string; has_account: boolean }[] }),
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
      .select("id, profile_id, date, minutes, client_id, task_id, task_hint, description, status, review_note, source, time_entry_id")
      .in("profile_id", ids)
      .gte("date", from)
      .lte("date", to)
      .order("date")
      .order("created_at"),
  ]);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.name as string]));
  const withLogin = new Set((profiles ?? []).filter((p) => p.has_account).map((p) => p.id as string));
  // A login's month: his own time entries, in the shape of a filed log.
  const entryRows = withLogin.size ? await loginEntries(sb, [...withLogin], from, to) : [];
  const monthLogs = [...(linkLogs ?? []).filter((l) => !withLogin.has(l.profile_id)), ...entryRows];

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
      token: withLogin.has(f.profile_id) ? "" : f.token,
      hasLogin: withLogin.has(f.profile_id),
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
  // A WAITING row that already has a time entry was approved once and changed
  // since by the freelancer (v1.88.0): the entry still holds what was approved.
  const changedEntryIds = rows.filter((l) => l.status === "pending" && l.time_entry_id).map((l) => l.time_entry_id as string);
  const { data: beforeEntries } = changedEntryIds.length
    ? await sb.from("time_entries").select("id, date, minutes, description, task_id").in("id", changedEntryIds)
    : { data: [] as { id: string; date: string; minutes: number; description: string | null; task_id: string }[] };
  // What was approved, from 0062's snapshot when there is one (the entry's own
  // minutes may be lower — a Keys write-down — and she's paid the line's).
  const changedIds = rows.filter((l) => l.status === "pending" && l.time_entry_id).map((l) => l.id as string);
  const snaps = changedIds.length ? await sb.from("freelancer_logs").select("id, approved").in("id", changedIds) : { data: [] };
  const snapOfLog = new Map(((snaps.data ?? []) as { id: string; approved: LogSnap | null }[]).map((r) => [r.id, r.approved]));
  const beforeOf = new Map((beforeEntries ?? []).map((e) => [e.id as string, e]));
  for (const e of beforeEntries ?? []) if (e.task_id && !taskIds.includes(e.task_id)) taskIds.push(e.task_id);
  for (const a of snapOfLog.values()) if (a?.task_id && !taskIds.includes(a.task_id)) taskIds.push(a.task_id);
  const [{ data: logClients }, { data: logTasks }, { data: pickTasks }, { data: allLogs }, { data: allCharges }] = await Promise.all([
    clientIds.length ? sb.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] }),
    taskIds.length ? sb.from("tasks").select("id, title").in("id", taskIds) : Promise.resolve({ data: [] }),
    waitingClients.length
      ? sb.from("tasks").select("id, title, client_id, status, completed_at").in("client_id", waitingClients).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    // Every month he has, for the months pane (and how far back to step).
    withLogin.has(one)
      ? fetchAll<{ date: string; minutes: number }>(sb, "time_entries", "date, minutes", (q) =>
          q.eq("user_id", one).not("minutes", "is", null),
        ).then((data) => ({ data: data.map((e) => ({ ...e, status: "approved" })) }))
      : sb.from("freelancer_logs").select("date, minutes, status").eq("profile_id", one),
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
      fromLog: l.source === "log",
      // What is approved today, when this waiting row is a change to it.
      before: (() => {
        if (l.status !== "pending" || !l.time_entry_id) return null;
        const a = snapOfLog.get(l.id);
        if (a) return { date: a.date, hours: a.minutes / 60, description: a.description, task: a.task_id ? (taskTitle.get(a.task_id) ?? null) : null };
        const e = beforeOf.get(l.time_entry_id);
        return e
          ? { date: e.date, hours: e.minutes / 60, description: e.description ?? "", task: taskTitle.get(e.task_id) ?? null }
          : null;
      })(),
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
      const log = await readLogRow(sb, str("id"));
      if (!log || log.status !== "pending") return NextResponse.json({ error: "That log isn't waiting for review." }, { status: 409 });
      const { data: task } = await sb.from("tasks").select("id, client_id").eq("id", str("taskId")).single();
      if (!task) return NextResponse.json({ error: "Pick a task to file it on." }, { status: 400 });
      const now: LogSnap = { ...snapOf(log), task_id: task.id, client_id: task.client_id ?? log.client_id, task_hint: null };
      // A change to an approved line moves ITS time entry by the difference
      // (v1.88.0 / 0062) — Keys write-downs survive; gone → filed afresh.
      let entryId: string | null = null;
      let fresh = false;
      const before = log.time_entry_id ? await approvedSnap(sb, log) : null;
      if (log.time_entry_id && before) {
        const r = await syncEntry(sb, log.time_entry_id, before, now);
        if (r && r !== "gone") return NextResponse.json({ error: r }, { status: 400 });
        if (!r) entryId = log.time_entry_id;
      }
      if (!entryId) {
        const { data: inserted, error } = await sb
          .from("time_entries")
          .insert({ task_id: task.id, user_id: log.profile_id, date: log.date, minutes: log.minutes, description: log.description })
          .select("id")
          .single();
        if (error || !inserted) return NextResponse.json({ error: error?.message ?? "Couldn't add the hours." }, { status: 500 });
        entryId = inserted.id as string;
        fresh = true;
      }
      const { error: e2 } = await updateLog(
        sb,
        log.id,
        {
          status: "approved",
          task_id: task.id,
          client_id: now.client_id,
          time_entry_id: entryId,
          approved: now,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        },
        "pending",
      );
      if (e2) {
        // Don't leave hours in the tracker that the log doesn't point at.
        if (fresh) await sb.from("time_entries").delete().eq("id", entryId);
        return NextResponse.json({ error: e2.message }, { status: 500 });
      }
      // Filed on a client he wasn't open for: open it, so this task is in his
      // picker next time (0055 — he names the work, the admin files it).
      if (task.client_id) {
        await sb.from("freelancer_clients").upsert({ profile_id: log.profile_id, client_id: task.client_id }, { ignoreDuplicates: true });
      }
      return NextResponse.json({ ok: true });
    }
    case "editLog": {
      // The admin edits any line of a freelancer's, approved ones included
      // (v1.89.0 — Nitsan: "keep me able to edit things in her freelance page
      // only"). An approved line's time entry follows by the difference, so a
      // Keys write-down survives. The tracker's own popup won't edit these.
      const log = await readLogRow(sb, str("id"));
      if (!log || log.status === "rejected") return NextResponse.json({ error: "That line can't be edited." }, { status: 409 });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(str("date")) ? str("date") : null;
      const minutes = typeof body.minutes === "number" ? Math.round(body.minutes) : NaN;
      const description = str("description").trim().slice(0, 600);
      if (!date) return NextResponse.json({ error: "Pick a date." }, { status: 400 });
      if (!(minutes >= 5 && minutes <= 1440)) return NextResponse.json({ error: "Hours must be between 0.1 and 24." }, { status: 400 });
      if (!description) return NextResponse.json({ error: "Say what they worked on." }, { status: 400 });
      let task: { id: string; client_id: string | null } | null = null;
      if (str("taskId")) {
        const { data } = await sb.from("tasks").select("id, client_id").eq("id", str("taskId")).maybeSingle();
        if (!data) return NextResponse.json({ error: "That task doesn't exist." }, { status: 400 });
        task = data;
      } else if (log.status === "approved") {
        return NextResponse.json({ error: "An approved line needs a task." }, { status: 400 });
      }
      const now: LogSnap = {
        date,
        minutes,
        description,
        task_id: task?.id ?? null,
        client_id: task?.client_id ?? log.client_id,
        task_hint: task ? null : log.task_hint,
      };
      if (log.status === "approved" && log.time_entry_id) {
        const before = (await approvedSnap(sb, log)) ?? snapOf(log);
        const r = await syncEntry(sb, log.time_entry_id, before, now);
        if (r === "gone") return NextResponse.json({ error: "Its tracker hours were deleted — nothing to update." }, { status: 409 });
        if (r) return NextResponse.json({ error: r }, { status: 400 });
      }
      const { data: written, error } = await updateLog(
        sb,
        log.id,
        { ...now, ...(log.status === "approved" ? { approved: now } : {}) },
        log.status,
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!written?.length) return NextResponse.json({ error: "It changed meanwhile — reload and try again." }, { status: 409 });
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
      // Turning down a CHANGE to an approved line keeps the approved one: the
      // line is restored from what was approved; its time entry never moved.
      const log = await readLogRow(sb, str("id"));
      const before = log?.status === "pending" && log.time_entry_id ? await approvedSnap(sb, log) : null;
      if (log && before) {
        const { error } = await updateLog(
          sb,
          log.id,
          { ...before, status: "approved", approved: before, reviewed_by: userId, reviewed_at: new Date().toISOString() },
          "pending",
        );
        return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
      }
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
    case "addMember": {
      // A studio member billed as a freelancer (Dima): his login stays, his
      // hours stay his own time entries, and his link is made switched off.
      const profileId = str("profileId");
      const { data: person } = await sb.from("profiles").select("id, has_account").eq("id", profileId).single();
      if (!person?.has_account) return NextResponse.json({ error: "Pick a member with a login." }, { status: 400 });
      const terms = readTerms(body);
      if ("error" in terms) return NextResponse.json({ error: terms.error }, { status: 400 });
      const { error } = await sb.from("freelancers").insert({ profile_id: profileId, token: newToken(), active: false, ...terms });
      if (error)
        return NextResponse.json({ error: error.code === "23505" ? "They're already on the list." : error.message }, { status: 500 });
      return NextResponse.json({ ok: true, profileId });
    }
    case "create": {
      // A freelancer is a person WITHOUT an account (0018): has_account false,
      // so also inactive — never in a member list, a task picker or the plan.
      const name = str("name").trim().slice(0, 80);
      if (!name) return NextResponse.json({ error: "Give the freelancer a name." }, { status: 400 });
      const terms = readTerms(body);
      if ("error" in terms) return NextResponse.json({ error: terms.error }, { status: 400 });
      // "Convert to a freelancer" from a hired candidate (v1.90.0): the same
      // create, refused if they were converted already, then finished like a
      // team member's (convert-server.ts). `position` is their role, never "owner".
      const candidateId = str("candidateId");
      if (candidateId) {
        const blocked = await convertBlocked(sb, candidateId);
        if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
      }
      const position = cleanPosition(body.position);
      const id = crypto.randomUUID();
      const { error } = await sb
        .from("profiles")
        .insert({ id, name, role: "designer", active: false, has_account: false, ...(position ? { position } : {}) });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const { error: e2 } = await sb.from("freelancers").insert({ profile_id: id, token: newToken(), ...terms });
      if (e2) {
        await sb.from("profiles").delete().eq("id", id);
        return NextResponse.json({ error: e2.message }, { status: 500 });
      }
      const warnings = candidateId ? await finishConversion(sb, "freelancer", candidateId, id, name, userId) : [];
      return NextResponse.json({ ok: true, profileId: id, warnings });
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
      // A login never gets a link: he'd see his hours twice, once unreviewed.
      if (body.active === true) {
        const { data: person } = await sb.from("profiles").select("has_account").eq("id", str("profileId")).single();
        if (person?.has_account) return NextResponse.json({ error: "They log with their own login." }, { status: 400 });
      }
      const { error } = await sb.from("freelancers").update({ active: body.active === true }).eq("profile_id", str("profileId"));
      return error ? NextResponse.json({ error: error.message }, { status: 500 }) : NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
