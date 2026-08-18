import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  assembleEmailHtml,
  assembleTaskBrief,
  parseBudgetHours,
  type BriefLink,
  type Deliverable,
  type IntakeAnswers,
  type IntakeFile,
} from "@/lib/brief";
import { kindById } from "@/lib/intake-fields";
import { hostLabel, normalizeUrl } from "@/lib/links";
import { MAX_INTAKE_FILES, describeUpload, describeUploadSet } from "@/lib/uploads";

// Anti-flood: max submissions accepted per intake link within the window.
const RATE_LIMIT_WINDOW_MIN = 10;
const RATE_LIMIT_MAX = 8;

// Titled links the client added with "+ Add link" on the form. Same cap as
// uploads — this is an unauthenticated endpoint, so every list it accepts needs
// a ceiling that isn't "whatever was posted".
const MAX_LINKS = 8;
const MAX_LINK_TITLE = 120;

// Public endpoint for the client intake form. Token-gated; all DB access via
// the service key on the server (nothing is exposed to anonymous clients).

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

type IntakeLink = {
  id: string;
  client_id: string | null;
  active: boolean;
  clients: { name: string | null } | null;
};

async function resolveLink(token: string): Promise<IntakeLink | null> {
  const sb = admin();
  const { data } = await sb
    .from("intake_links")
    .select("id, client_id, active, clients(name)")
    .eq("token", token)
    .maybeSingle();
  return data && data.active ? (data as unknown as IntakeLink) : null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const link = await resolveLink(token);
  if (!link) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  return NextResponse.json({
    clientName: link.clients?.name ?? null,
  });
}

/**
 * The kinds of work the client ticked.
 *
 * ⚠️ Validated against the real list rather than trusted. These decide which
 * questions count as "asked" when the notification reports what went
 * unanswered, and they arrive from an unauthenticated form. Anything unknown is
 * dropped, and an empty result makes `fieldsAsked` fall back to asking
 * everything — the safe direction, since it can only over-report gaps.
 */
function parseKinds(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((k): k is string => typeof k === "string" && !!kindById(k)))];
}

/**
 * The client's named pieces, posted as one JSON field.
 *
 * ⚠️ Unlike the links, none of this is ever rendered as markup or an href — it
 * goes into the brief as plain text — so the risk here is size, not injection.
 * Bounded on both count and length, and every entry is re-checked rather than
 * cast: the payload is whatever the browser sent.
 */
function parseDeliverables(raw: string): Deliverable[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, 10).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const g = (k: string, max: number) =>
      (typeof r[k] === "string" ? (r[k] as string) : "").trim().slice(0, max);
    const d = {
      name: g("name", 80),
      details: g("details", 2000),
      dimensions: g("dimensions", 120),
      format: g("format", 120),
    };
    return d.name || d.details || d.dimensions || d.format ? [d] : [];
  });
}

/**
 * The client's own "+ Add link" rows, posted as one JSON field.
 *
 * ⚠️ Every URL goes through `normalizeUrl`, exactly as the studio's own link
 * editor does — these become `href`s on an approved task where only the TITLE
 * is rendered, so a `javascript:` URL under a friendly title is something no
 * colleague could spot before clicking. Anything that isn't http/https/mailto
 * is dropped rather than stored and filtered later.
 */
function parseLinks(raw: string): BriefLink[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: BriefLink[] = [];
  for (const row of parsed.slice(0, MAX_LINKS)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const url = normalizeUrl(typeof r.url === "string" ? r.url : "");
    if (!url) continue;
    const title = (typeof r.title === "string" ? r.title : "").trim().slice(0, MAX_LINK_TITLE);
    // An untitled link still beats a lost one: "docs.google.com" is at least
    // something a person can recognise.
    out.push({ title: title || hostLabel(url), url });
  }
  return out;
}

/** Match "Company" text + email domain against client names. */
async function suggestClient(sb: ReturnType<typeof admin>, company: string, email: string) {
  const { data: clients } = await sb.from("clients").select("id, name").eq("archived", false);
  if (!clients) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const c = norm(company);
  const domain = norm(email.split("@")[1]?.split(".")[0] ?? "");
  let best: { id: string; score: number } | null = null;
  for (const cl of clients) {
    const n = norm(cl.name);
    let score = 0;
    if (c && (n === c || n.includes(c) || c.includes(n))) score = n === c ? 3 : 2;
    else if (domain && (n === domain || n.includes(domain) || domain.includes(n))) score = 1;
    if (score > (best?.score ?? 0)) best = { id: cl.id, score };
  }
  return best?.id ?? null;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const link = await resolveLink(token);
  if (!link) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const sb = admin();

  // Rate limit: cap accepted submissions per link per window (serverless-safe,
  // counted in the DB rather than in memory).
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
  const { count: recent } = await sb
    .from("task_requests")
    .select("id", { count: "exact", head: true })
    .eq("intake_link_id", link.id)
    .gte("created_at", since);
  if ((recent ?? 0) >= RATE_LIMIT_MAX) {
    return NextResponse.json(
      { error: "Too many submissions — please try again in a few minutes." },
      { status: 429 },
    );
  }

  const form = await req.formData();
  const f = (k: string) => String(form.get(k) ?? "").slice(0, 5000);

  const answers: IntakeAnswers = {
    name: f("name"),
    email: f("email"),
    company: f("company"),
    taskName: f("taskName"),
    dimensions: f("dimensions"),
    format: f("format"),
    animated: f("animated"),
    dueDate: f("dueDate"),
    budgetRange: f("budgetRange"),
    creativeBrief: f("creativeBrief"),
    goal: f("goal"),
    displayedWhere: f("displayedWhere"),
    targetAudience: f("targetAudience"),
    thingsToAvoid: f("thingsToAvoid"),
    content: f("content"),
    notes: f("notes"),
    scheduleMeeting: f("scheduleMeeting"),
    // ⚠️ Validated against the real list rather than trusted. This value decides
    // which questions count as "asked" when the brief reports what wasn't
    // answered, and it arrives from an unauthenticated form — an unknown id
    // falls back to "" and `fieldsAsked` then treats the submission as having
    // been asked everything, which is the safe direction.
    kinds: parseKinds(String(form.get("kinds") ?? "")),
    techNotes: f("techNotes"),
    deliverables: parseDeliverables(String(form.get("deliverables") ?? "")),
  };
  // ⚠️ These three, and no more. A brief with gaps still tells the studio
  // something, and the notification email reports what went unanswered — the
  // task brief deliberately does not. A form that refuses to submit is a client
  // who phones instead.
  if (!answers.name || !answers.email || !answers.taskName) {
    return NextResponse.json({ error: "Name, email and task name are required" }, { status: 400 });
  }

  const links = parseLinks(String(form.get("links") ?? ""));

  // Files (≤10MB each, max 5)
  //
  // ⚠️ Every branch here used to be a bare `continue`, so a refused or failed
  // file vanished without a trace: the client was thanked, and the studio saw a
  // brief that gave no hint an attachment was ever meant to exist. The form now
  // runs the same `describeUpload` check before submitting, so anything landing
  // in `dropped` is a storage failure or a client that bypassed the form — rare,
  // and exactly the case worth recording rather than swallowing.
  const files: IntakeFile[] = [];
  const dropped: string[] = [];
  const sent = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  // ⚠️ Report the overflow rather than letting `slice` eat it. The cap is real,
  // but a 6th file disappearing without a word is the same silence this whole
  // change exists to end — and the form caps at 5 already, so anything landing
  // here came from something that bypassed it.
  for (const extra of sent.slice(MAX_INTAKE_FILES)) {
    dropped.push(`${extra.name} — only ${MAX_INTAKE_FILES} files can be attached`);
  }
  // ⚠️ The same budget the form enforces, re-checked here. A request this size
  // normally never arrives — the platform drops anything over 4.5MB before this
  // route runs — so reaching this branch means something bypassed the form. Say
  // so in the brief rather than storing files the form would have refused.
  const budget = describeUploadSet(sent.slice(0, MAX_INTAKE_FILES));
  if (!budget.ok) dropped.push(budget.reason);
  for (const file of budget.ok ? sent.slice(0, MAX_INTAKE_FILES) : []) {
    const cls = describeUpload(file);
    if (!cls.ok) {
      dropped.push(`${file.name} — ${cls.reason}`);
      continue;
    }
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
    const { error } = await sb.storage.from("intake").upload(path, file, { contentType: cls.contentType });
    if (error) {
      dropped.push(`${file.name} — upload failed (${error.message})`);
      continue;
    }
    const { data: pub } = sb.storage.from("intake").getPublicUrl(path);
    files.push({ name: file.name, url: pub.publicUrl });
  }

  const clientId = link.client_id ?? null;
  const suggested = clientId ?? (await suggestClient(sb, answers.company, answers.email));
  // The SUBMISSION's brief lists files and links as text — the queue card and
  // the notification email are the only places anyone can reach them until the
  // request is approved. `approveRequest` rebuilds it without them, because by
  // then they are real rows in `links`.
  const brief = assembleTaskBrief(answers, { files, links, dropped });

  const { data: request, error } = await sb
    .from("task_requests")
    .insert({
      intake_link_id: link.id,
      client_id: clientId,
      suggested_client_id: suggested,
      submitter_name: answers.name,
      submitter_email: answers.email,
      title: answers.taskName,
      brief,
      requested_due_date: answers.dueDate || null,
      client_approved_budget_hours: parseBudgetHours(answers.budgetRange),
      answers: { ...answers, files, links },
      status: "pending",
    })
    .select("id")
    .single();
  if (error) {
    console.error("intake submission failed", error);
    return NextResponse.json({ error: "Could not submit — please try again." }, { status: 500 });
  }

  // Email notification (best-effort; queue works even if mail fails)
  try {
    if (process.env.RESEND_API_KEY) {
      const { data: setting } = await sb
        .from("app_settings")
        .select("value")
        .eq("key", "intake_notify_emails")
        .maybeSingle();
      const recipients: string[] = Array.isArray(setting?.value) ? setting.value : [];
      if (recipients.length) {
        const origin = req.nextUrl.origin;
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: process.env.INTAKE_FROM_EMAIL || "Studio&more Tracker <onboarding@resend.dev>",
            to: recipients,
            subject: `New task: ${answers.taskName} — ${answers.company || answers.name}`,
            html: assembleEmailHtml(answers, { files, links, dropped }, `${origin}/intake-queue`),
          }),
        });
      }
    }
  } catch (e) {
    console.error("intake email failed", e);
  }

  return NextResponse.json({ ok: true, id: request.id });
}
