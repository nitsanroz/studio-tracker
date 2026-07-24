import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  assembleEmailHtml,
  assembleTaskBrief,
  parseBudgetHours,
  type IntakeAnswers,
  type IntakeFile,
} from "@/lib/brief";
import { classifyUpload } from "@/lib/uploads";

// Anti-flood: max submissions accepted per intake link within the window.
const RATE_LIMIT_WINDOW_MIN = 10;
const RATE_LIMIT_MAX = 8;

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
  };
  if (!answers.name || !answers.email || !answers.taskName) {
    return NextResponse.json({ error: "Name, email and task name are required" }, { status: 400 });
  }

  // Files (≤10MB each, max 5)
  const files: IntakeFile[] = [];
  for (const file of form.getAll("files").slice(0, 5)) {
    if (!(file instanceof File) || file.size === 0) continue;
    if (file.size > 10 * 1024 * 1024) continue;
    const cls = classifyUpload(file);
    if (!cls.ok) continue; // reject disallowed / active-content types
    const safe = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
    const { error } = await sb.storage.from("intake").upload(path, file, { contentType: cls.contentType });
    if (!error) {
      const { data: pub } = sb.storage.from("intake").getPublicUrl(path);
      files.push({ name: file.name, url: pub.publicUrl });
    }
  }

  const clientId = link.client_id ?? null;
  const suggested = clientId ?? (await suggestClient(sb, answers.company, answers.email));
  const brief = assembleTaskBrief(answers, files);

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
      answers: { ...answers, files },
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
            html: assembleEmailHtml(answers, files, `${origin}/intake-queue`),
          }),
        });
      }
    }
  } catch (e) {
    console.error("intake email failed", e);
  }

  return NextResponse.json({ ok: true, id: request.id });
}
